import { stablePayloadHash } from "./domain-command.js";

export type PaymentProviderStatus = "AUTHORIZED" | "CAPTURED" | "CANCELLED" | "REFUNDED";

export interface AuthorizeProviderPayment {
  readonly operationKey: string;
  readonly paymentId: string;
  readonly amountMinor: number;
  readonly currency: "USD";
}

export interface MutateProviderPayment {
  readonly operationKey: string;
  readonly paymentId: string;
}

export interface RefundProviderPayment extends MutateProviderPayment {
  readonly amountMinor: number;
}

export type PaymentProviderMutationResult =
  | {
      readonly kind: "APPLIED";
      readonly providerReference: string;
      readonly status: PaymentProviderStatus;
    }
  | { readonly kind: "REJECTED"; readonly rejectionCode: string };

export type PaymentProviderRetrievalResult =
  | {
      readonly kind: "FOUND";
      readonly providerReference: string;
      readonly status: PaymentProviderStatus;
    }
  | { readonly kind: "NOT_FOUND" };

export interface PaymentProvider {
  authorize(request: AuthorizeProviderPayment): Promise<PaymentProviderMutationResult>;
  capture(request: MutateProviderPayment): Promise<PaymentProviderMutationResult>;
  cancel(request: MutateProviderPayment): Promise<PaymentProviderMutationResult>;
  refund(request: RefundProviderPayment): Promise<PaymentProviderMutationResult>;
  retrieve(request: { readonly paymentId: string }): Promise<PaymentProviderRetrievalResult>;
}

export type PaymentProviderFailureEffect =
  | "BUSINESS_REJECTION"
  | "THROTTLE"
  | "TIMEOUT"
  | "COMMIT_THEN_LOST_RESPONSE";

export interface DeterministicPaymentProviderOptions {
  readonly failurePlan?: Readonly<Record<string, readonly PaymentProviderFailureEffect[]>>;
}

interface ProviderPayment {
  readonly paymentId: string;
  readonly providerReference: string;
  readonly amountMinor: number;
  readonly currency: "USD";
  readonly status: PaymentProviderStatus;
}

interface RecordedProviderOperation {
  readonly payloadHash: string;
  readonly result: PaymentProviderMutationResult;
}

export class DeterministicPaymentProvider implements PaymentProvider {
  readonly #attempts = new Map<string, number>();
  readonly #failurePlan: Readonly<Record<string, readonly PaymentProviderFailureEffect[]>>;
  readonly #mutationCounts = new Map<string, number>();
  readonly #operations = new Map<string, RecordedProviderOperation>();
  readonly #payments = new Map<string, ProviderPayment>();

  public constructor(options: DeterministicPaymentProviderOptions = {}) {
    this.#failurePlan = options.failurePlan ?? {};
  }

  public authorize(request: AuthorizeProviderPayment): Promise<PaymentProviderMutationResult> {
    return this.#mutate(request, () => {
      if (this.#payments.has(request.paymentId)) {
        return { kind: "REJECTED", rejectionCode: "PAYMENT_ALREADY_EXISTS" };
      }
      const payment: ProviderPayment = {
        paymentId: request.paymentId,
        providerReference: providerReference(request.paymentId),
        amountMinor: request.amountMinor,
        currency: request.currency,
        status: "AUTHORIZED",
      };
      this.#payments.set(request.paymentId, payment);
      return applied(payment);
    });
  }

  public capture(request: MutateProviderPayment): Promise<PaymentProviderMutationResult> {
    return this.#transition(request, "AUTHORIZED", "CAPTURED", "PAYMENT_NOT_AUTHORIZED");
  }

  public cancel(request: MutateProviderPayment): Promise<PaymentProviderMutationResult> {
    return this.#transition(request, "AUTHORIZED", "CANCELLED", "PAYMENT_NOT_CANCELLABLE");
  }

  public refund(request: RefundProviderPayment): Promise<PaymentProviderMutationResult> {
    return this.#mutate(request, () => {
      const payment = this.#payments.get(request.paymentId);
      if (payment?.status !== "CAPTURED" || request.amountMinor > payment.amountMinor) {
        return { kind: "REJECTED", rejectionCode: "PAYMENT_NOT_REFUNDABLE" };
      }
      const refunded = { ...payment, status: "REFUNDED" as const };
      this.#payments.set(request.paymentId, refunded);
      return applied(refunded);
    });
  }

  public async retrieve(
    request: { readonly paymentId: string },
  ): Promise<PaymentProviderRetrievalResult> {
    const payment = this.#payments.get(request.paymentId);
    return payment === undefined
      ? { kind: "NOT_FOUND" }
      : {
          kind: "FOUND",
          providerReference: payment.providerReference,
          status: payment.status,
        };
  }

  public mutationCount(operationKey: string): number {
    return this.#mutationCounts.get(operationKey) ?? 0;
  }

  #transition(
    request: MutateProviderPayment,
    requiredStatus: PaymentProviderStatus,
    targetStatus: PaymentProviderStatus,
    rejectionCode: string,
  ): Promise<PaymentProviderMutationResult> {
    return this.#mutate(request, () => {
      const payment = this.#payments.get(request.paymentId);
      if (payment?.status !== requiredStatus) return { kind: "REJECTED", rejectionCode };
      const updated = { ...payment, status: targetStatus };
      this.#payments.set(request.paymentId, updated);
      return applied(updated);
    });
  }

  async #mutate(
    request: AuthorizeProviderPayment | MutateProviderPayment | RefundProviderPayment,
    applyMutation: () => PaymentProviderMutationResult,
  ): Promise<PaymentProviderMutationResult> {
    const payloadHash = stablePayloadHash(request);
    const recorded = this.#operations.get(request.operationKey);
    if (recorded !== undefined) {
      if (recorded.payloadHash !== payloadHash) {
        throw new Error("Payment provider operation key was reused with a different payload");
      }
      return recorded.result;
    }

    const effect = this.#nextEffect(request.operationKey);
    if (effect === "THROTTLE") throw new PaymentProviderThrottledError();
    if (effect === "TIMEOUT") throw new PaymentProviderTimeoutError();

    const result = effect === "BUSINESS_REJECTION"
      ? { kind: "REJECTED" as const, rejectionCode: "PAYMENT_DECLINED" }
      : applyMutation();
    this.#operations.set(request.operationKey, { payloadHash, result });
    if (result.kind === "APPLIED") {
      this.#mutationCounts.set(
        request.operationKey,
        this.mutationCount(request.operationKey) + 1,
      );
    }
    if (effect === "COMMIT_THEN_LOST_RESPONSE") throw new PaymentProviderResponseLostError();
    return result;
  }

  #nextEffect(operationKey: string): PaymentProviderFailureEffect | undefined {
    const attempt = this.#attempts.get(operationKey) ?? 0;
    this.#attempts.set(operationKey, attempt + 1);
    return this.#failurePlan[operationKey]?.[attempt];
  }
}

export class PaymentProviderThrottledError extends Error {
  public constructor() {
    super("Payment provider throttled the operation");
    this.name = "PaymentProviderThrottledError";
  }
}

export class PaymentProviderTimeoutError extends Error {
  public constructor() {
    super("Payment provider operation timed out");
    this.name = "PaymentProviderTimeoutError";
  }
}

export class PaymentProviderResponseLostError extends Error {
  public constructor() {
    super("Payment provider committed the operation but its response was lost");
    this.name = "PaymentProviderResponseLostError";
  }
}

function providerReference(paymentId: string): string {
  return `fake-payment-${paymentId}`;
}

function applied(payment: ProviderPayment): PaymentProviderMutationResult {
  return {
    kind: "APPLIED",
    providerReference: payment.providerReference,
    status: payment.status,
  };
}
