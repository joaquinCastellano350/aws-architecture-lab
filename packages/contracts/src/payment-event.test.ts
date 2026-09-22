import { describe, expect, it } from "vitest";

import { validatePaymentEvent } from "./generated/payment-event.js";

describe("Payment event JSON schemas", () => {
  it.each([
    ["PaymentAuthorized", "AUTHORIZED"],
    ["PaymentCaptured", "CAPTURED"],
    ["PaymentCancelled", "CANCELLED"],
    ["PaymentRefunded", "REFUNDED"],
  ])("accepts the versioned %s fact", (eventType, status) => {
    expect(validatePaymentEvent({
      eventId: `event-${eventType}`,
      eventType,
      eventVersion: "1.0",
      occurredAt: "2026-09-10T12:00:00.000Z",
      correlationId: "correlation-123",
      causationId: "operation-123",
      aggregateType: "Payment",
      aggregateId: "payment-123",
      payload: {
        checkoutId: "checkout-123",
        paymentId: "payment-123",
        providerReference: "fake-payment-payment-123",
        status,
      },
    }).ok).toBe(true);
  });

  it("rejects provider payloads and unsupported Payment facts", () => {
    expect(validatePaymentEvent({
      eventId: "event-provider",
      eventType: "payment_intent.succeeded",
      eventVersion: "1.0",
      occurredAt: "2026-09-10T12:00:00.000Z",
      correlationId: "correlation-123",
      causationId: "operation-123",
      aggregateType: "PaymentIntent",
      aggregateId: "pi_123",
      payload: { status: "succeeded" },
    }).ok).toBe(false);
  });
});
