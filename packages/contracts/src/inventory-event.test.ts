import { describe, expect, it } from "vitest";

import { validateInventoryEvent } from "./generated/inventory-event.js";

describe("Inventory event JSON schema", () => {
  it.each([
    ["InventoryReserved", "RESERVED"],
    ["InventoryCommitted", "COMMITTED"],
    ["InventoryReleased", "RELEASED"],
  ] as const)("accepts a versioned %s fact", (eventType, status) => {
    expect(validateInventoryEvent({
      eventId: "event-123",
      eventType,
      eventVersion: "1.0",
      occurredAt: "2026-09-09T12:00:00.000Z",
      correlationId: "corr-123",
      causationId: "execution-123",
      aggregateType: "InventoryReservation",
      aggregateId: "reservation-123",
      payload: {
        itemId: "sku-123",
        quantity: 1,
        status,
        ...(status === "RESERVED" ? { expiresAt: "2026-09-09T12:05:00.000Z" } : {}),
      },
    }).ok).toBe(true);
  });

  it("rejects facts whose type and payload are outside the Inventory contract", () => {
    expect(validateInventoryEvent({
      eventId: "event-123",
      eventType: "InventoryDeleted",
      eventVersion: "1.0",
      occurredAt: "2026-09-09T12:00:00.000Z",
      correlationId: "corr-123",
      causationId: "execution-123",
      aggregateType: "InventoryReservation",
      aggregateId: "reservation-123",
      payload: { itemId: "sku-123", quantity: 0, status: "DELETED" },
    }).ok).toBe(false);
    expect(validateInventoryEvent({
      eventId: "event-contradictory",
      eventType: "InventoryCommitted",
      eventVersion: "1.0",
      occurredAt: "2026-09-09T12:00:00.000Z",
      correlationId: "corr-123",
      causationId: "execution-123",
      aggregateType: "InventoryReservation",
      aggregateId: "reservation-123",
      payload: { itemId: "sku-123", quantity: 1, status: "RELEASED" },
    }).ok).toBe(false);
  });
});
