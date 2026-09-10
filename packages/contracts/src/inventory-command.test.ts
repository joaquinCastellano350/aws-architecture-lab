import { describe, expect, it } from "vitest";

import {
  validateCommitInventoryCommand,
  validateInventoryCommandOutcome,
  validateReleaseInventoryCommand,
  validateReserveInventoryCommand,
} from "./generated/inventory-command.js";

describe("Inventory command JSON schemas", () => {
  it("accepts versioned reserve, commit, and release commands", () => {
    expect(validateReserveInventoryCommand({
      schemaVersion: "1.0",
      commandType: "ReserveInventory",
      operationId: "reserve-checkout-123",
      checkoutId: "checkout-123",
      reservationId: "reservation-checkout-123",
      itemId: "sku-123",
      quantity: 2,
      expiresAt: "2026-09-09T12:05:00.000Z",
      correlationId: "corr-123",
      causationId: "execution-123",
    }).ok).toBe(true);
    expect(validateCommitInventoryCommand(transitionCommand("commit-checkout-123")).ok).toBe(true);
    expect(validateReleaseInventoryCommand({
      ...transitionCommand("release-checkout-123"),
      releaseReason: "CHECKOUT_EXPIRED",
    }).ok).toBe(true);
  });

  it("accepts every typed business outcome", () => {
    for (const status of [
      "RESERVED",
      "COMMITTED",
      "RELEASED",
      "OUT_OF_STOCK",
      "RESERVATION_NOT_ACTIVE",
    ] as const) {
      expect(validateInventoryCommandOutcome({
        schemaVersion: "1.0",
        operationId: "inventory-operation-123",
        checkoutId: "checkout-123",
        reservationId: "reservation-checkout-123",
        status,
      }).ok).toBe(true);
    }
    expect(validateInventoryCommandOutcome({
      schemaVersion: "1.0",
      operationId: "release-checkout-123",
      checkoutId: "checkout-123",
      reservationId: "reservation-checkout-123",
      status: "RESERVATION_NOT_ACTIVE",
      reservationStatus: "COMMITTED",
    }).ok).toBe(true);
  });

  it("rejects invalid quantities, dates, versions, and incomplete outcomes", () => {
    expect(validateReserveInventoryCommand({
      schemaVersion: "1.0",
      commandType: "ReserveInventory",
      operationId: "reserve-checkout-123",
      checkoutId: "checkout-123",
      reservationId: "reservation-checkout-123",
      itemId: "sku-123",
      quantity: 0,
      expiresAt: "not-a-date",
      correlationId: "corr-123",
      causationId: "execution-123",
    }).ok).toBe(false);
    expect(validateCommitInventoryCommand({
      ...transitionCommand("commit-checkout-123"),
      schemaVersion: "2.0",
    }).ok).toBe(false);
    expect(validateInventoryCommandOutcome({ status: "RESERVED" }).ok).toBe(false);
    expect(validateInventoryCommandOutcome({
      schemaVersion: "1.0",
      operationId: "release-checkout-123",
      checkoutId: "checkout-123",
      reservationId: "reservation-checkout-123",
      status: "RESERVATION_NOT_ACTIVE",
      reservationStatus: "UNKNOWN",
    }).ok).toBe(false);
    expect(validateReleaseInventoryCommand(transitionCommand("release-from-v1-workflow")).ok)
      .toBe(true);
  });
});

function transitionCommand(operationId: string) {
  return {
    schemaVersion: "1.0",
    commandType: operationId.startsWith("commit") ? "CommitInventory" : "ReleaseInventory",
    operationId,
    checkoutId: "checkout-123",
    reservationId: "reservation-checkout-123",
    correlationId: "corr-123",
    causationId: "execution-123",
  };
}
