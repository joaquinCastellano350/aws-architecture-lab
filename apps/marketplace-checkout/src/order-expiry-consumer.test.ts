import { describe, expect, it, vi } from "vitest";

import { createOrderExpiryConsumer } from "./order-expiry-consumer.js";

describe("Order expiry consumer", () => {
  it("turns an expired Inventory release fact into a stable Order command", async () => {
    const markExpired = vi.fn(async () => ({
      schemaVersion: "1.0" as const,
      checkoutId: "checkout-123",
      correlationId: "corr-123",
      status: "EXPIRED" as const,
    }));
    const consume = createOrderExpiryConsumer({
      eventSource: "aws-architecture-lab.inventory",
      markExpired,
    });

    const delivery = inventoryReleasedDelivery("CHECKOUT_EXPIRED");
    await consume(delivery);
    await consume(delivery);

    expect(markExpired).toHaveBeenCalledTimes(2);
    expect(markExpired).toHaveBeenNthCalledWith(2, {
      schemaVersion: "1.0",
      commandType: "MarkOrderExpired",
      operationId: "consume-order-expiry-event-inventory-released",
      checkoutId: "checkout-123",
      correlationId: "corr-123",
      causationId: "event-inventory-released",
    });
  });

  it("does not expire an Order for a compensation release", async () => {
    const markExpired = vi.fn();
    const consume = createOrderExpiryConsumer({
      eventSource: "aws-architecture-lab.inventory",
      markExpired,
    });

    await consume(inventoryReleasedDelivery("COMPENSATION"));

    expect(markExpired).not.toHaveBeenCalled();
  });
});

function inventoryReleasedDelivery(releaseReason: "CHECKOUT_EXPIRED" | "COMPENSATION") {
  return {
    id: "eventbridge-delivery-123",
    version: "0",
    account: "123456789012",
    time: "2026-09-09T12:00:01.000Z",
    region: "us-east-1",
    resources: [],
    source: "aws-architecture-lab.inventory",
    "detail-type": "InventoryReleased",
    detail: {
      eventId: "event-inventory-released",
      eventVersion: "1.0",
      occurredAt: "2026-09-09T12:00:00.000Z",
      correlationId: "corr-123",
      causationId: "scheduled-event-123",
      aggregateType: "InventoryReservation",
      aggregateId: "reservation-123",
      payload: {
        checkoutId: "checkout-123",
        itemId: "sku-123",
        quantity: 1,
        status: "RELEASED",
        releaseReason,
      },
    },
  };
}
