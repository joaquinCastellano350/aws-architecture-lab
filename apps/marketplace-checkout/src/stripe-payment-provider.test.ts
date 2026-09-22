import { describe, expect, it, vi } from "vitest";

import type {
  AuthorizeProviderPayment,
  MutateProviderPayment,
  RefundProviderPayment,
} from "./payment-provider.js";
import {
  StripePaymentProvider,
  StripePaymentRejectedError,
  type StripeClient,
  type StripePaymentIntent,
} from "./stripe-payment-provider.js";
import { PaymentProviderResponseLostError } from "./payment-provider.js";

describe("Stripe Payment Provider contract", () => {
  it("authorizes a test PaymentIntent for manual capture and retrieves it", async () => {
    const client = new MemoryStripeClient();
    const provider = new StripePaymentProvider(client);

    await expect(provider.authorize(authorizeRequest())).resolves.toEqual({
      kind: "APPLIED",
      providerReference: "pi_payment-123",
      status: "AUTHORIZED",
    });
    await expect(provider.retrieve({
      paymentId: "payment-123",
      providerReference: "pi_payment-123",
    })).resolves.toEqual({
      kind: "FOUND",
      providerReference: "pi_payment-123",
      status: "AUTHORIZED",
    });

    expect(client.createdWith).toEqual({
      amountMinor: 1250,
      captureMethod: "manual",
      confirm: true,
      currency: "usd",
      idempotencyKey: "authorize:checkout-123",
      metadata: { paymentId: "payment-123" },
      paymentMethod: "pm_card_visa",
    });
  });

  it("uses stable operation-specific keys for capture, cancellation, and refund", async () => {
    const client = new MemoryStripeClient();
    const provider = new StripePaymentProvider(client);
    await provider.authorize(authorizeRequest());

    await expect(provider.capture(mutationRequest("capture:checkout-123"))).resolves
      .toEqual(expect.objectContaining({ status: "CAPTURED" }));
    await expect(provider.refund(refundRequest())).resolves
      .toEqual(expect.objectContaining({ status: "REFUNDED" }));

    const second = new MemoryStripeClient();
    const cancellable = new StripePaymentProvider(second);
    await cancellable.authorize(authorizeRequest());
    await expect(cancellable.cancel(mutationRequest("cancel:checkout-123"))).resolves
      .toEqual(expect.objectContaining({ status: "CANCELLED" }));

    expect(client.operationKeys).toEqual([
      "authorize:checkout-123",
      "capture:checkout-123",
      "refund:checkout-123",
    ]);
    expect(second.operationKeys).toEqual([
      "authorize:checkout-123",
      "cancel:checkout-123",
    ]);
  });

  it("turns a Stripe card rejection into a stable business rejection", async () => {
    const client = new MemoryStripeClient();
    client.createError = new StripePaymentRejectedError("card_declined");
    const provider = new StripePaymentProvider(client);

    await expect(provider.authorize(authorizeRequest())).resolves.toEqual({
      kind: "REJECTED",
      rejectionCode: "card_declined",
    });
  });

  it("finds a PaymentIntent by stable payment metadata after a locally lost response", async () => {
    const client = new MemoryStripeClient();
    const provider = new StripePaymentProvider(client);
    await provider.authorize(authorizeRequest());

    await expect(provider.retrieve({ paymentId: "payment-123" })).resolves.toEqual({
      kind: "FOUND",
      providerReference: "pi_payment-123",
      status: "AUTHORIZED",
    });
    expect(client.searchedFor).toBe("payment-123");
  });

  it("keeps a pending refund ambiguous so a later provider event can repair it", async () => {
    const client = new MemoryStripeClient();
    client.refundStatus = "pending";
    const provider = new StripePaymentProvider(client);
    await provider.authorize(authorizeRequest());
    await provider.capture(mutationRequest("capture:checkout-123"));

    await expect(provider.refund(refundRequest())).rejects.toBeInstanceOf(
      PaymentProviderResponseLostError,
    );
  });
});

function authorizeRequest(): AuthorizeProviderPayment {
  return {
    operationKey: "authorize:checkout-123",
    paymentId: "payment-123",
    amountMinor: 1250,
    currency: "USD",
  };
}

function mutationRequest(operationKey: string): MutateProviderPayment {
  return {
    operationKey,
    paymentId: "payment-123",
    providerReference: "pi_payment-123",
  };
}

function refundRequest(): RefundProviderPayment {
  return {
    ...mutationRequest("refund:checkout-123"),
    amountMinor: 1250,
  };
}

class MemoryStripeClient implements StripeClient {
  public createError: Error | undefined;
  public createdWith: Record<string, unknown> | undefined;
  public readonly operationKeys: string[] = [];
  public refundStatus: "pending" | "succeeded" = "succeeded";
  public searchedFor: string | undefined;
  readonly #payments = new Map<string, StripePaymentIntent>();

  public async createPaymentIntent(request: Parameters<StripeClient["createPaymentIntent"]>[0]) {
    this.operationKeys.push(request.idempotencyKey);
    this.createdWith = request;
    if (this.createError !== undefined) throw this.createError;
    const payment = intent("requires_capture");
    this.#payments.set(payment.id, payment);
    return payment;
  }

  public async capturePaymentIntent(
    providerReference: string,
    request: Parameters<StripeClient["capturePaymentIntent"]>[1],
  ) {
    this.operationKeys.push(request.idempotencyKey);
    return this.update(providerReference, "succeeded");
  }

  public async cancelPaymentIntent(
    providerReference: string,
    request: Parameters<StripeClient["cancelPaymentIntent"]>[1],
  ) {
    this.operationKeys.push(request.idempotencyKey);
    return this.update(providerReference, "canceled");
  }

  public async createRefund(request: Parameters<StripeClient["createRefund"]>[0]) {
    this.operationKeys.push(request.idempotencyKey);
    const payment = this.refundStatus === "succeeded"
      ? this.update(request.providerReference, "succeeded", true)
      : this.#payments.get(request.providerReference);
    if (payment === undefined) throw new Error("Stripe test PaymentIntent is missing");
    return { id: "re_payment-123", status: this.refundStatus, paymentIntent: payment.id };
  }

  public retrievePaymentIntent(providerReference: string) {
    return Promise.resolve(this.#payments.get(providerReference));
  }

  public findPaymentIntent(paymentId: string) {
    this.searchedFor = paymentId;
    return Promise.resolve([...this.#payments.values()].find(
      (payment) => payment.metadata.paymentId === paymentId,
    ));
  }

  private update(
    providerReference: string,
    status: StripePaymentIntent["status"],
    refunded = false,
  ): StripePaymentIntent {
    const current = this.#payments.get(providerReference);
    if (current === undefined) throw new Error("Stripe test PaymentIntent is missing");
    const updated = { ...current, status, refunded };
    this.#payments.set(providerReference, updated);
    return updated;
  }
}

function intent(
  status: StripePaymentIntent["status"],
  refunded = false,
): StripePaymentIntent {
  return {
    id: "pi_payment-123",
    amountMinor: 1250,
    currency: "usd",
    metadata: { paymentId: "payment-123" },
    refunded,
    status,
  };
}
