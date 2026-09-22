import { describe, expect, it } from "vitest";

import {
  validateOrderInventoryUnavailableEvent,
  validateOrderCancelledEvent,
  validateOrderCompensatingEvent,
  validateOrderExpiredEvent,
  validateOrderPendingEvent,
  validateOrderReconciliationRequiredEvent,
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

  it("accepts a customer-visible Order expiry fact", () => {
    expect(validateOrderExpiredEvent({
      eventId: "event-expired",
      eventType: "OrderExpired",
      eventVersion: "1.0",
      occurredAt: "2026-09-09T12:00:00.000Z",
      correlationId: "corr-123",
      causationId: "inventory-released-event-123",
      aggregateType: "Order",
      aggregateId: "checkout-123",
      payload: { status: "EXPIRED" },
    }).ok).toBe(true);
  });

  it("accepts a customer-visible confirmed cancellation fact", () => {
    expect(validateOrderCancelledEvent({
      eventId: "event-cancelled",
      eventType: "OrderCancelled",
      eventVersion: "1.0",
      occurredAt: "2026-09-12T12:00:00.000Z",
      correlationId: "corr-123",
      causationId: "execution-123",
      aggregateType: "Order",
      aggregateId: "checkout-123",
      payload: { status: "CANCELLED" },
    }).ok).toBe(true);
  });

  it("accepts a customer-visible compensation-in-progress fact", () => {
    expect(validateOrderCompensatingEvent({
      eventId: "event-compensating",
      eventType: "OrderCompensating",
      eventVersion: "1.0",
      occurredAt: "2026-09-12T11:59:00.000Z",
      correlationId: "corr-123",
      causationId: "execution-123",
      aggregateType: "Order",
      aggregateId: "checkout-123",
      payload: { status: "COMPENSATING" },
    }).ok).toBe(true);
  });

  it("accepts a truthful reconciliation-required Order fact", () => {
    expect(validateOrderReconciliationRequiredEvent({
      eventId: "event-reconciliation",
      eventType: "OrderReconciliationRequired",
      eventVersion: "1.0",
      occurredAt: "2026-09-13T12:00:00.000Z",
      correlationId: "corr-123",
      causationId: "execution-123",
      aggregateType: "Order",
      aggregateId: "checkout-123",
      payload: { status: "RECONCILIATION_REQUIRED" },
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
