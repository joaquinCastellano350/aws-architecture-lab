import {
  PaymentProviderResponseLostError,
  type AuthorizeProviderPayment,
  type MutateProviderPayment,
  type PaymentProvider,
  type PaymentProviderMutationResult,
  type PaymentProviderRetrievalResult,
  type RefundProviderPayment,
} from "./payment-provider.js";

/*
 * Stripe-specific values stay behind the provider capability. The rest of the
 * Payment domain receives only the provider-neutral statuses above.
 */
export type StripePaymentIntentStatus =
  | "requires_payment_method"
  | "requires_confirmation"
  | "requires_action"
  | "processing"
  | "requires_capture"
  | "canceled"
  | "succeeded";

export interface StripePaymentIntent {
  readonly id: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly refunded: boolean;
  readonly status: StripePaymentIntentStatus;
}

export interface StripeRefund {
  readonly id: string;
  readonly paymentIntent: string;
  readonly status: "pending" | "requires_action" | "succeeded" | "failed" | "canceled";
}

export interface StripeClient {
  createPaymentIntent(request: {
    readonly amountMinor: number;
    readonly captureMethod: "manual";
    readonly confirm: true;
    readonly currency: "usd";
    readonly idempotencyKey: string;
    readonly metadata: { readonly paymentId: string };
    readonly paymentMethod: string;
  }): Promise<StripePaymentIntent>;
  capturePaymentIntent(
    providerReference: string,
    request: { readonly idempotencyKey: string },
  ): Promise<StripePaymentIntent>;
  cancelPaymentIntent(
    providerReference: string,
    request: { readonly idempotencyKey: string },
  ): Promise<StripePaymentIntent>;
  createRefund(request: {
    readonly amountMinor: number;
    readonly idempotencyKey: string;
    readonly metadata: { readonly paymentId: string };
    readonly providerReference: string;
  }): Promise<StripeRefund>;
  retrievePaymentIntent(providerReference: string): Promise<StripePaymentIntent | undefined>;
  findPaymentIntent(paymentId: string): Promise<StripePaymentIntent | undefined>;
}

export interface StripePaymentProviderOptions {
  readonly paymentMethod?: string;
}

export class StripePaymentProvider implements PaymentProvider {
  readonly #paymentMethod: string;

  public constructor(
    private readonly client: StripeClient,
    options: StripePaymentProviderOptions = {},
  ) {
    this.#paymentMethod = options.paymentMethod ?? "pm_card_visa";
    if (!this.#paymentMethod.startsWith("pm_card_")) {
      throw new Error("Stripe Sandbox adapter requires a Stripe test Payment Method");
    }
  }

  public async authorize(
    request: AuthorizeProviderPayment,
  ): Promise<PaymentProviderMutationResult> {
    try {
      const intent = await this.client.createPaymentIntent({
        amountMinor: request.amountMinor,
        captureMethod: "manual",
        confirm: true,
        currency: request.currency.toLowerCase() as "usd",
        idempotencyKey: request.operationKey,
        metadata: { paymentId: request.paymentId },
        paymentMethod: this.#paymentMethod,
      });
      return mutationResult(intent, "AUTHORIZED", "PAYMENT_DECLINED");
    } catch (error) {
      if (error instanceof StripePaymentRejectedError) {
        return { kind: "REJECTED", rejectionCode: error.rejectionCode };
      }
      throw error;
    }
  }

  public async capture(
    request: MutateProviderPayment,
  ): Promise<PaymentProviderMutationResult> {
    const reference = requiredProviderReference(request);
    try {
      const intent = await this.client.capturePaymentIntent(reference, {
        idempotencyKey: request.operationKey,
      });
      return mutationResult(intent, "CAPTURED", "PAYMENT_NOT_AUTHORIZED");
    } catch (error) {
      return rejectedOrThrow(error);
    }
  }

  public async cancel(
    request: MutateProviderPayment,
  ): Promise<PaymentProviderMutationResult> {
    const reference = requiredProviderReference(request);
    try {
      const intent = await this.client.cancelPaymentIntent(reference, {
        idempotencyKey: request.operationKey,
      });
      return mutationResult(intent, "CANCELLED", "PAYMENT_NOT_CANCELLABLE");
    } catch (error) {
      return rejectedOrThrow(error);
    }
  }

  public async refund(
    request: RefundProviderPayment,
  ): Promise<PaymentProviderMutationResult> {
    const reference = requiredProviderReference(request);
    try {
      const refund = await this.client.createRefund({
        amountMinor: request.amountMinor,
        idempotencyKey: request.operationKey,
        metadata: { paymentId: request.paymentId },
        providerReference: reference,
      });
      switch (refund.status) {
        case "succeeded":
          return { kind: "APPLIED", providerReference: reference, status: "REFUNDED" };
        case "pending":
        case "requires_action":
          throw new PaymentProviderResponseLostError();
        case "failed":
        case "canceled":
          return { kind: "REJECTED", rejectionCode: "PAYMENT_NOT_REFUNDABLE" };
      }
    } catch (error) {
      return rejectedOrThrow(error);
    }
  }

  public async retrieve(request: {
    readonly paymentId: string;
    readonly providerReference?: string;
  }): Promise<PaymentProviderRetrievalResult> {
    const intent = request.providerReference === undefined
      ? await this.client.findPaymentIntent(request.paymentId)
      : await this.client.retrievePaymentIntent(request.providerReference);
    if (intent === undefined) return { kind: "NOT_FOUND" };
    const status = providerStatus(intent);
    if (status === undefined) return { kind: "NOT_FOUND" };
    return { kind: "FOUND", providerReference: intent.id, status };
  }
}

export class StripePaymentRejectedError extends Error {
  public constructor(public readonly rejectionCode: string) {
    super(`Stripe rejected the Payment operation: ${rejectionCode}`);
    this.name = "StripePaymentRejectedError";
  }
}

function mutationResult(
  intent: StripePaymentIntent,
  expectedStatus: "AUTHORIZED" | "CAPTURED" | "CANCELLED",
  rejectionCode: string,
): PaymentProviderMutationResult {
  return providerStatus(intent) === expectedStatus
    ? { kind: "APPLIED", providerReference: intent.id, status: expectedStatus }
    : { kind: "REJECTED", rejectionCode };
}

function providerStatus(intent: StripePaymentIntent) {
  if (intent.refunded) return "REFUNDED" as const;
  switch (intent.status) {
    case "requires_capture":
      return "AUTHORIZED" as const;
    case "succeeded":
      return "CAPTURED" as const;
    case "canceled":
      return "CANCELLED" as const;
    case "requires_payment_method":
    case "requires_confirmation":
    case "requires_action":
    case "processing":
      return undefined;
  }
}

function requiredProviderReference(request: MutateProviderPayment): string {
  if (request.providerReference === undefined) {
    throw new Error(`Stripe provider reference is required for ${request.operationKey}`);
  }
  return request.providerReference;
}

function rejectedOrThrow(error: unknown): PaymentProviderMutationResult {
  if (error instanceof StripePaymentRejectedError) {
    return { kind: "REJECTED", rejectionCode: error.rejectionCode };
  }
  throw error;
}
