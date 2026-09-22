import { describe, expect, it, vi } from "vitest";

import { createStripeEventReconciler } from "./stripe-event-reconciler.js";

describe("Stripe EventBridge reconciliation", () => {
  it("retrieves current Stripe state before repairing a provider event", async () => {
    const retrieve = vi.fn(async () => ({
      kind: "FOUND" as const,
      providerReference: "pi_123",
      status: "CAPTURED" as const,
    }));
    const reconcileProviderState = vi.fn(async () => "REPAIRED" as const);
    const consume = createStripeEventReconciler({
      provider: { retrieve },
      payment: { reconcileProviderState },
    });

    await consume(stripeDelivery({
      id: "pi_123",
      metadata: { paymentId: "payment-123" },
      object: "payment_intent",
      status: "canceled",
    }));

    expect(retrieve).toHaveBeenCalledWith({
      paymentId: "payment-123",
      providerReference: "pi_123",
    });
    expect(reconcileProviderState).toHaveBeenCalledWith("payment-123", {
      kind: "FOUND",
      providerReference: "pi_123",
      status: "CAPTURED",
    });
  });

  it("tolerates duplicate and reordered deliveries by re-retrieving current state", async () => {
    const retrieve = vi.fn(async () => ({
      kind: "FOUND" as const,
      providerReference: "pi_123",
      status: "REFUNDED" as const,
    }));
    const reconcileProviderState = vi.fn(async () => "CONSISTENT" as const);
    const consume = createStripeEventReconciler({
      provider: { retrieve },
      payment: { reconcileProviderState },
    });
    const oldCapture = stripeDelivery({
      id: "pi_123",
      metadata: { paymentId: "payment-123" },
      object: "payment_intent",
      status: "succeeded",
    });

    await consume(oldCapture);
    await consume(oldCapture);

    expect(retrieve).toHaveBeenCalledTimes(2);
    expect(reconcileProviderState).toHaveBeenCalledTimes(2);
    expect(reconcileProviderState).toHaveBeenLastCalledWith(
      "payment-123",
      expect.objectContaining({ status: "REFUNDED" }),
    );
  });

  it("uses refund metadata and its PaymentIntent reference", async () => {
    const retrieve = vi.fn(async () => ({ kind: "NOT_FOUND" as const }));
    const reconcileProviderState = vi.fn(async () => "CONSISTENT" as const);
    const consume = createStripeEventReconciler({
      provider: { retrieve },
      payment: { reconcileProviderState },
    });

    await consume(stripeDelivery({
      id: "re_123",
      metadata: { paymentId: "payment-123" },
      object: "refund",
      payment_intent: "pi_123",
      status: "succeeded",
    }, "refund.updated"));

    expect(retrieve).toHaveBeenCalledWith({
      paymentId: "payment-123",
      providerReference: "pi_123",
    });
  });
});

function stripeDelivery(object: Record<string, unknown>, type = "payment_intent.succeeded") {
  return {
    version: "0",
    id: "eventbridge-123",
    "detail-type": "Stripe Event",
    source: "aws.partner/stripe.com/example",
    account: "123456789012",
    time: "2026-09-17T12:00:00Z",
    region: "us-east-1",
    resources: [],
    detail: {
      id: "evt_123",
      object: "event",
      type,
      data: { object },
    },
  };
}
