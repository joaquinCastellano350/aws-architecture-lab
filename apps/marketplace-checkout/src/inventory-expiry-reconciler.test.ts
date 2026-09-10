import { describe, expect, it, vi } from "vitest";

import { reconcileExpiredInventory } from "./inventory-expiry-reconciler.js";

describe("Inventory expiry reconciliation", () => {
  it("releases each due reservation with a stable expiry operation", async () => {
    const due = [{
      reservationId: "reservation-abandoned",
      checkoutId: "checkout-abandoned",
      correlationId: "corr-abandoned",
      itemId: "sku-123",
      quantity: 1,
      status: "RESERVED" as const,
      expiresAt: "2026-09-09T11:59:00.000Z",
    }];
    const findExpiredReservations = vi.fn(async () => due);
    const execute = vi.fn(async (command) => ({
      schemaVersion: "1.0" as const,
      operationId: command.operationId,
      checkoutId: command.checkoutId,
      reservationId: command.reservationId,
      status: "RELEASED" as const,
    }));

    const result = await reconcileExpiredInventory(
      { findExpiredReservations, execute },
      {
        clock: () => new Date("2026-09-09T12:00:00.000Z"),
        limit: 25,
      },
    );

    expect(findExpiredReservations).toHaveBeenCalledWith("2026-09-09T12:00:00.000Z", 25);
    expect(execute).toHaveBeenCalledWith({
      schemaVersion: "1.0",
      commandType: "ReleaseInventory",
      operationId: "expire-sweep-reservation-abandoned",
      checkoutId: "checkout-abandoned",
      reservationId: "reservation-abandoned",
      releaseReason: "CHECKOUT_EXPIRED",
      correlationId: "corr-abandoned",
      causationId: "expire-sweep-reservation-abandoned",
    });
    expect(result).toEqual({
      examined: 1,
      released: 1,
      alreadyFinalized: 0,
      attemptedReservationIds: ["reservation-abandoned"],
    });
  });

  it("treats a commit that wins the expiry race as an already-finalized stable result", async () => {
    const reservation = {
      reservationId: "reservation-race",
      checkoutId: "checkout-race",
      correlationId: "corr-race",
      itemId: "sku-race",
      quantity: 1,
      status: "RESERVED" as const,
      expiresAt: "2026-09-09T11:59:00.000Z",
    };
    const execute = vi.fn(async () => ({
      schemaVersion: "1.0" as const,
      operationId: "expire-sweep-reservation-race",
      checkoutId: "checkout-race",
      reservationId: "reservation-race",
      status: "RESERVATION_NOT_ACTIVE" as const,
    }));

    const result = await reconcileExpiredInventory(
      { findExpiredReservations: async () => [reservation], execute },
      {
        clock: () => new Date("2026-09-09T12:00:00.000Z"),
        limit: 10,
      },
    );

    expect(result).toEqual({
      examined: 1,
      released: 0,
      alreadyFinalized: 1,
      attemptedReservationIds: ["reservation-race"],
    });
  });
});
