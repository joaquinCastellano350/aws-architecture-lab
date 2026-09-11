import { describe, expect, it } from "vitest";

import {
  validateFulfillmentHandedOffEvent,
  validateFulfillmentReservedEvent,
} from "./generated/fulfillment-event.js";

describe("Fulfillment event JSON schemas", () => {
  it.each([
    ["FulfillmentReserved", "RESERVED", validateFulfillmentReservedEvent],
    ["FulfillmentHandedOff", "HANDED_OFF", validateFulfillmentHandedOffEvent],
  ] as const)("accepts the versioned %s committed fact", (eventType, status, validate) => {
    expect(validate({
      eventId: "event-123",
      eventType,
      eventVersion: "1.0",
      occurredAt: "2026-09-11T12:00:00.000Z",
      correlationId: "corr-123",
      causationId: "command-123",
      aggregateType: "Fulfillment",
      aggregateId: "fulfillment-checkout-123",
      payload: {
        checkoutId: "checkout-123",
        reservationId: "fulfillment-checkout-123",
        status,
      },
    }).ok).toBe(true);
  });
});
