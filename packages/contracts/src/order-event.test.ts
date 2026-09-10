import { describe, expect, it } from "vitest";

import {
  validateOrderInventoryUnavailableEvent,
  validateOrderPendingEvent,
} from "./generated/order-event.js";

describe("Order event JSON schema", () => {
  it("accepts the complete versioned OrderPending envelope", () => {
    expect(validateOrderPendingEvent({
      eventId: "event-123",
      eventType: "OrderPending",
      eventVersion: "1.0",
      occurredAt: "2026-09-08T12:00:00.000Z",
      correlationId: "corr-123",
      causationId: "command-123",
      aggregateType: "Order",
      aggregateId: "checkout-123",
      payload: { status: "PENDING" },
    })).toEqual({
      ok: true,
      value: {
        eventId: "event-123",
        eventType: "OrderPending",
        eventVersion: "1.0",
        occurredAt: "2026-09-08T12:00:00.000Z",
        correlationId: "corr-123",
        causationId: "command-123",
        aggregateType: "Order",
        aggregateId: "checkout-123",
        payload: { status: "PENDING" },
      },
    });
  });

  it("accepts the customer-visible Inventory-unavailable Order fact", () => {
    expect(validateOrderInventoryUnavailableEvent({
      eventId: "event-unavailable",
      eventType: "OrderInventoryUnavailable",
      eventVersion: "1.0",
      occurredAt: "2026-09-09T12:00:00.000Z",
      correlationId: "corr-123",
      causationId: "execution-123",
      aggregateType: "Order",
      aggregateId: "checkout-123",
      payload: { status: "INVENTORY_UNAVAILABLE" },
    }).ok).toBe(true);
  });

  it("rejects an incomplete envelope or wrong payload", () => {
    expect(validateOrderPendingEvent({ eventId: "event-123" }).ok).toBe(false);
    expect(validateOrderPendingEvent({
      eventId: "event-123",
      eventType: "OrderPending",
      eventVersion: "1.0",
      occurredAt: "2026-09-08T12:00:00.000Z",
      correlationId: "corr-123",
      causationId: "command-123",
      aggregateType: "Order",
      aggregateId: "checkout-123",
      payload: { status: "CONFIRMED" },
    }).ok).toBe(false);
  });
});
