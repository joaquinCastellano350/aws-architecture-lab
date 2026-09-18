import type { EventBridgeEvent } from "aws-lambda";

import type {
  PaymentProvider,
  PaymentProviderRetrievalResult,
} from "./payment-provider.js";
import type { ProviderReconciliationResult } from "./payment-command-service.js";

interface ProviderStateReconciler {
  reconcileProviderState(
    paymentId: string,
    state: PaymentProviderRetrievalResult,
  ): Promise<ProviderReconciliationResult>;
}

export interface StripeEventReconcilerDependencies {
  readonly payment: ProviderStateReconciler;
  readonly provider: Pick<PaymentProvider, "retrieve">;
}

export function createStripeEventReconciler(dependencies: StripeEventReconcilerDependencies) {
  return async (delivery: EventBridgeEvent<string, unknown>): Promise<void> => {
    if (!delivery.source.startsWith("aws.partner/stripe.com/")) {
      throw new Error(`Unsupported Stripe event source: ${delivery.source}`);
    }
    const event = stripeEvent(delivery.detail);
    const paymentId = metadataPaymentId(event.data.object);
    const providerReference = paymentIntentReference(event.data.object);
    const current = await dependencies.provider.retrieve({ paymentId, providerReference });
    const result = await dependencies.payment.reconcileProviderState(paymentId, current);
    if (result === "DIVERGED") {
      console.error(JSON.stringify({
        eventType: "ProviderDivergence",
        paymentId,
        providerReference,
        stripeEventId: event.id,
        stripeEventType: event.type,
      }));
      throw new PaymentProviderDivergenceError(paymentId);
    }
  };
}

export class PaymentProviderDivergenceError extends Error {
  public constructor(paymentId: string) {
    super(`Stripe and local Payment state diverged for ${paymentId}`);
    this.name = "PaymentProviderDivergenceError";
  }
}

interface StripeEvent {
  readonly id: string;
  readonly type: string;
  readonly data: {
    readonly object: Record<string, unknown>;
  };
}

function stripeEvent(value: unknown): StripeEvent {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.type !== "string") {
    throw new Error("Stripe EventBridge detail is missing its event identity");
  }
  if (!isRecord(value.data) || !isRecord(value.data.object)) {
    throw new Error("Stripe EventBridge detail is missing its data object");
  }
  return {
    id: value.id,
    type: value.type,
    data: { object: value.data.object },
  };
}

function metadataPaymentId(object: Record<string, unknown>): string {
  if (!isRecord(object.metadata) || typeof object.metadata.paymentId !== "string") {
    throw new Error("Stripe provider event is missing Payment metadata");
  }
  return object.metadata.paymentId;
}

function paymentIntentReference(object: Record<string, unknown>): string {
  if (object.object === "payment_intent" && typeof object.id === "string") return object.id;
  if (typeof object.payment_intent === "string") return object.payment_intent;
  throw new Error("Stripe provider event is missing its PaymentIntent reference");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
