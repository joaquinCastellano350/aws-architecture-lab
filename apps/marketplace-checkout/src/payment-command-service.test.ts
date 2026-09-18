import { describe, expect, it } from "vitest";

import type {
  AuthorizePaymentCommand,
  PaymentCommand,
  PaymentCommandOutcome,
} from "@aws-architecture-lab/contracts";

import {
  PaymentCommandService,
  type PaymentLedger,
  type PaymentOperationCompletion,
  type PaymentOperationRecord,
  type PaymentRecord,
} from "./payment-command-service.js";
import {
  DeterministicPaymentProvider,
  PaymentProviderResponseLostError,
  PaymentProviderTransientError,
  type PaymentProvider,
} from "./payment-provider.js";

describe("Payment command boundary", () => {
  it("records stable authorize and capture results with one fact per mutation", async () => {
    const ledger = new MemoryPaymentLedger();
    const provider = new DeterministicPaymentProvider();
    const payment = service(ledger, provider);

    const authorized = await payment.execute(authorizeCommand());
    const captured = await payment.execute(captureCommand());
    const replay = await payment.execute(captureCommand());

    expect(authorized.status).toBe("AUTHORIZED");
    expect(captured.status).toBe("CAPTURED");
    expect(replay).toEqual(captured);
    expect(provider.mutationCount("payment:payment-123:authorize")).toBe(1);
    expect(provider.mutationCount("payment:payment-123:capture")).toBe(1);
    expect(ledger.events.map(({ eventType }) => eventType)).toEqual([
      "PaymentAuthorized",
      "PaymentCaptured",
    ]);
    expect(ledger.operation("capture-checkout-123")).toEqual(expect.objectContaining({
      semanticKey: "payment:payment-123:capture",
      payloadHash: expect.any(String),
      state: "SUCCEEDED",
      result: captured,
      providerReference: "fake-payment-payment-123",
      createdAt: "2026-09-10T12:00:00.000Z",
      updatedAt: "2026-09-10T12:00:00.000Z",
    }));
  });

  it("passes the durable provider reference to later provider mutations", async () => {
    const ledger = new MemoryPaymentLedger();
    const provider = new ReferenceRequiredProvider();
    const payment = service(ledger, provider);

    await payment.execute(authorizeCommand());
    await expect(payment.execute(captureCommand())).resolves.toEqual(
      expect.objectContaining({ status: "CAPTURED" }),
    );

    expect(provider.captureReference).toBe("pi_payment-123");
  });

  it("reconciles an abandoned capture before attempting a refund", async () => {
    const ledger = new MemoryPaymentLedger();
    const provider = new DeterministicPaymentProvider({
      failurePlan: { "payment:payment-123:capture": ["AMBIGUOUS_COMPLETION"] },
    });
    const payment = service(ledger, provider);
    await payment.execute(authorizeCommand());

    await expect(payment.execute(captureCommand())).rejects
      .toBeInstanceOf(PaymentProviderResponseLostError);
    expect(ledger.operation("capture-checkout-123")?.state).toBe("IN_PROGRESS");

    const refunded = await payment.execute(refundCommand());

    expect(refunded.status).toBe("REFUNDED");
    expect(provider.mutationCount("payment:payment-123:capture")).toBe(1);
    expect(provider.mutationCount("payment:payment-123:refund")).toBe(1);
    expect(ledger.operation("capture-checkout-123")?.state).toBe("SUCCEEDED");
    expect(ledger.events.map(({ eventType }) => eventType)).toEqual([
      "PaymentAuthorized",
      "PaymentCaptured",
      "PaymentRefunded",
    ]);
  });

  it("reconciles an ambiguous refund without repeating the economic effect", async () => {
    const ledger = new MemoryPaymentLedger();
    const provider = new DeterministicPaymentProvider({
      failurePlan: { "payment:payment-123:refund": ["AMBIGUOUS_COMPLETION"] },
    });
    const payment = service(ledger, provider);
    await payment.execute(authorizeCommand());
    await payment.execute(captureCommand());

    await expect(payment.execute(refundCommand())).rejects.toBeInstanceOf(
      PaymentProviderResponseLostError,
    );
    const refunded = await payment.execute(refundCommand());
    const replay = await payment.execute(refundCommand());

    expect(refunded.status).toBe("REFUNDED");
    expect(replay).toEqual(refunded);
    expect(provider.mutationCount("payment:payment-123:refund")).toBe(1);
    expect(ledger.events.map(({ eventType }) => eventType)).toEqual([
      "PaymentAuthorized",
      "PaymentCaptured",
      "PaymentRefunded",
    ]);
  });

  it("returns the committed result when an ambiguous capture itself is replayed", async () => {
    const ledger = new MemoryPaymentLedger();
    const provider = new DeterministicPaymentProvider({
      failurePlan: { "payment:payment-123:capture": ["AMBIGUOUS_COMPLETION"] },
    });
    const payment = service(ledger, provider);
    await payment.execute(authorizeCommand());
    await expect(payment.execute(captureCommand())).rejects.toBeInstanceOf(
      PaymentProviderResponseLostError,
    );

    await expect(payment.execute(captureCommand())).resolves.toEqual(
      expect.objectContaining({ status: "CAPTURED" }),
    );
    expect(provider.mutationCount("payment:payment-123:capture")).toBe(1);
  });

  it("repairs a successful provider mutation whose local response was lost", async () => {
    const ledger = new MemoryPaymentLedger();
    const provider = new DeterministicPaymentProvider({
      failurePlan: { "payment:payment-123:capture": ["COMMIT_THEN_LOST_RESPONSE"] },
    });
    const payment = service(ledger, provider);
    await payment.execute(authorizeCommand());
    await expect(payment.execute(captureCommand())).rejects.toBeInstanceOf(
      PaymentProviderResponseLostError,
    );

    const currentProviderState = await provider.retrieve({ paymentId: "payment-123" });
    await expect(payment.reconcileProviderState("payment-123", currentProviderState))
      .resolves.toBe("REPAIRED");

    expect(provider.mutationCount("payment:payment-123:capture")).toBe(1);
    expect(ledger.operation("capture-checkout-123")).toEqual(expect.objectContaining({
      state: "SUCCEEDED",
      result: expect.objectContaining({ status: "CAPTURED" }),
    }));
  });

  it("does not fail an in-flight mutation when an older provider event arrives", async () => {
    const ledger = new MemoryPaymentLedger();
    const provider = new DeterministicPaymentProvider({
      failurePlan: { "payment:payment-123:capture": ["FAIL_BEFORE_MUTATION"] },
    });
    const payment = service(ledger, provider);
    await payment.execute(authorizeCommand());
    await expect(payment.execute(captureCommand())).rejects.toBeInstanceOf(
      PaymentProviderTransientError,
    );

    const earlierProviderState = await provider.retrieve({ paymentId: "payment-123" });
    await expect(payment.reconcileProviderState("payment-123", earlierProviderState))
      .resolves.toBe("CONSISTENT");

    expect(ledger.operation("capture-checkout-123")).toEqual(expect.objectContaining({
      state: "IN_PROGRESS",
    }));
    expect(ledger.operation("capture-checkout-123")).not.toHaveProperty("result");
  });

  it("reconciles a failed capture as still authorized before cancellation", async () => {
    const ledger = new MemoryPaymentLedger();
    const provider = new DeterministicPaymentProvider({
      failurePlan: { "payment:payment-123:capture": ["FAIL_BEFORE_MUTATION"] },
    });
    const payment = service(ledger, provider);
    await payment.execute(authorizeCommand());

    await expect(payment.execute(captureCommand())).rejects.toBeInstanceOf(
      PaymentProviderTransientError,
    );
    await expect(payment.execute(retrieveCommand())).resolves.toEqual(
      expect.objectContaining({ status: "AUTHORIZED" }),
    );
    await expect(payment.execute(cancelCommand())).resolves.toEqual(
      expect.objectContaining({ status: "CANCELLED" }),
    );

    expect(ledger.operation("capture-checkout-123")).toEqual(expect.objectContaining({
      state: "FAILED",
      result: expect.objectContaining({
        status: "REJECTED",
        rejectionCode: "CAPTURE_NOT_APPLIED",
      }),
    }));
    expect(provider.mutationCount("payment:payment-123:capture")).toBe(0);
    expect(provider.mutationCount("payment:payment-123:cancel")).toBe(1);
  });

  it("returns stable rejection and retrieval outcomes", async () => {
    const ledger = new MemoryPaymentLedger();
    const provider = new DeterministicPaymentProvider({
      failurePlan: { "payment:payment-123:authorize": ["BUSINESS_REJECTION"] },
    });
    const payment = service(ledger, provider);

    const rejected = await payment.execute(authorizeCommand());
    expect(rejected).toEqual(expect.objectContaining({
      status: "REJECTED",
      rejectionCode: "PAYMENT_DECLINED",
    }));
    await expect(payment.execute(authorizeCommand())).resolves.toEqual(rejected);
    await expect(payment.execute(retrieveCommand())).resolves.toEqual(expect.objectContaining({
      status: "NOT_FOUND",
    }));
    expect(ledger.events).toHaveLength(0);
  });

  it("rejects operation ID reuse with a changed payload", async () => {
    const payment = service(new MemoryPaymentLedger(), new DeterministicPaymentProvider());
    await payment.execute(authorizeCommand());

    await expect(payment.execute({ ...authorizeCommand(), amountMinor: 1300 })).rejects.toThrow(
      "Payment operation ID was reused with a different payload",
    );
  });
});

function service(ledger: PaymentLedger, provider: PaymentProvider) {
  return new PaymentCommandService({
    ledger,
    provider,
    clock: () => new Date("2026-09-10T12:00:00.000Z"),
    eventId: (() => {
      let sequence = 0;
      return () => `payment-event-${++sequence}`;
    })(),
  });
}

class ReferenceRequiredProvider implements PaymentProvider {
  public captureReference: string | undefined;

  public authorize() {
    return Promise.resolve({
      kind: "APPLIED" as const,
      providerReference: "pi_payment-123",
      status: "AUTHORIZED" as const,
    });
  }

  public capture(request: Parameters<PaymentProvider["capture"]>[0]) {
    this.captureReference = request.providerReference;
    return Promise.resolve(request.providerReference === undefined
      ? { kind: "REJECTED" as const, rejectionCode: "MISSING_PROVIDER_REFERENCE" }
      : {
          kind: "APPLIED" as const,
          providerReference: request.providerReference,
          status: "CAPTURED" as const,
        });
  }

  public cancel() {
    throw new Error("Not used by this test");
  }

  public refund() {
    throw new Error("Not used by this test");
  }

  public retrieve() {
    throw new Error("Not used by this test");
  }
}

function authorizeCommand(): AuthorizePaymentCommand {
  return {
    schemaVersion: "1.0",
    commandType: "AuthorizePayment",
    operationId: "authorize-checkout-123",
    checkoutId: "checkout-123",
    paymentId: "payment-123",
    amountMinor: 1250,
    currency: "USD",
    correlationId: "correlation-123",
    causationId: "execution-123",
  };
}

function captureCommand(): PaymentCommand {
  return {
    schemaVersion: "1.0",
    commandType: "CapturePayment",
    operationId: "capture-checkout-123",
    checkoutId: "checkout-123",
    paymentId: "payment-123",
    correlationId: "correlation-123",
    causationId: "execution-123",
  };
}

function refundCommand(): PaymentCommand {
  return {
    schemaVersion: "1.0",
    commandType: "RefundPayment",
    operationId: "refund-checkout-123",
    checkoutId: "checkout-123",
    paymentId: "payment-123",
    amountMinor: 1250,
    correlationId: "correlation-123",
    causationId: "execution-123",
  };
}

function cancelCommand(): PaymentCommand {
  return {
    schemaVersion: "1.0",
    commandType: "CancelPayment",
    operationId: "cancel-checkout-123",
    checkoutId: "checkout-123",
    paymentId: "payment-123",
    correlationId: "correlation-123",
    causationId: "execution-123",
  };
}

function retrieveCommand(): PaymentCommand {
  return {
    schemaVersion: "1.0",
    commandType: "RetrievePayment",
    operationId: "retrieve-checkout-123",
    checkoutId: "checkout-123",
    paymentId: "payment-123",
    correlationId: "correlation-123",
    causationId: "execution-123",
  };
}

class MemoryPaymentLedger implements PaymentLedger {
  readonly events: Array<Record<string, unknown>> = [];
  readonly #operations = new Map<string, PaymentOperationRecord>();
  readonly #active = new Map<string, string>();
  readonly #payments = new Map<string, PaymentRecord>();

  public operation(operationId: string): PaymentOperationRecord | undefined {
    return this.#operations.get(operationId);
  }

  public findOperation(operationId: string): Promise<PaymentOperationRecord | undefined> {
    return Promise.resolve(this.operation(operationId));
  }

  public findPayment(paymentId: string): Promise<PaymentRecord | undefined> {
    return Promise.resolve(this.#payments.get(paymentId));
  }

  public findActiveOperation(paymentId: string): Promise<PaymentOperationRecord | undefined> {
    const operationId = this.#active.get(paymentId);
    return Promise.resolve(operationId === undefined ? undefined : this.operation(operationId));
  }

  public begin(operation: PaymentOperationRecord): Promise<PaymentOperationRecord> {
    const existing = this.operation(operation.operationId);
    if (existing !== undefined) return Promise.resolve(existing);
    if (this.#active.has(operation.paymentId)) throw new Error("Payment already has an active operation");
    this.#operations.set(operation.operationId, operation);
    this.#active.set(operation.paymentId, operation.operationId);
    return Promise.resolve(operation);
  }

  public complete(completion: PaymentOperationCompletion): Promise<PaymentCommandOutcome> {
    const operation = this.operation(completion.operationId);
    if (operation === undefined) throw new Error("Payment operation is missing");
    const completed: PaymentOperationRecord = {
      ...operation,
      state: completion.state,
      result: completion.result,
      updatedAt: completion.updatedAt,
      ...(completion.providerReference === undefined
        ? {}
        : { providerReference: completion.providerReference }),
    };
    this.#operations.set(operation.operationId, completed);
    this.#active.delete(operation.paymentId);
    const previousPayment = this.#payments.get(operation.paymentId);
    this.#payments.set(operation.paymentId, {
      recordKey: `PAYMENT#${operation.paymentId}`,
      recordType: "PAYMENT",
      paymentId: operation.paymentId,
      checkoutId: operation.checkoutId,
      ...(completion.state === "SUCCEEDED"
        ? {
            status: completion.result.status,
            providerReference: completion.providerReference,
          }
        : previousPayment?.status === undefined
          ? {}
          : {
              status: previousPayment.status,
              ...(previousPayment.providerReference === undefined
                ? {}
                : { providerReference: previousPayment.providerReference }),
            }),
      updatedAt: completion.updatedAt,
    });
    if (completion.event !== undefined) this.events.push(completion.event);
    return Promise.resolve(completion.result);
  }
}
