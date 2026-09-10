import { describe, expect, it } from "vitest";

import {
  validateCreatePendingOrderCommand,
  validateCreatePendingOrderOutcome,
  validateMarkOrderInventoryUnavailableCommand,
  validateMarkOrderInventoryUnavailableOutcome,
} from "./generated/order-command.js";

describe("Order command JSON schemas", () => {
  it("accepts the versioned pending-Order command and sanitized outcome", () => {
    expect(validateCreatePendingOrderCommand({
      schemaVersion: "1.0",
      checkoutId: "checkout-123",
      cartId: "cart-123",
      correlationId: "corr-123",
      causationId: "command-123",
    }).ok).toBe(true);
    expect(validateCreatePendingOrderOutcome({
      schemaVersion: "1.0",
      checkoutId: "checkout-123",
      correlationId: "corr-123",
      causationId: "command-123",
      status: "PENDING",
    }).ok).toBe(true);
    expect(validateCreatePendingOrderCommand({
      schemaVersion: "1.0",
      checkoutId: "checkout-from-older-workflow",
      cartId: "cart-123",
      correlationId: "corr-123",
    }).ok).toBe(true);
  });

  it("accepts the typed Order outcome for an unavailable Inventory reservation", () => {
    const command = {
      schemaVersion: "1.0",
      commandType: "MarkOrderInventoryUnavailable",
      operationId: "mark-inventory-unavailable-checkout-123",
      checkoutId: "checkout-123",
      correlationId: "corr-123",
      causationId: "execution-123",
    };

    expect(validateMarkOrderInventoryUnavailableCommand(command).ok).toBe(true);
    expect(validateMarkOrderInventoryUnavailableOutcome({
      schemaVersion: "1.0",
      checkoutId: "checkout-123",
      correlationId: "corr-123",
      status: "INVENTORY_UNAVAILABLE",
    }).ok).toBe(true);
  });

  it("rejects unsupported versions and incomplete commands", () => {
    expect(validateCreatePendingOrderCommand({
      schemaVersion: "2.0",
      checkoutId: "checkout-123",
      cartId: "cart-123",
      correlationId: "corr-123",
    }).ok).toBe(false);
    expect(validateCreatePendingOrderCommand({
      schemaVersion: "1.0",
      checkoutId: "checkout-123",
    }).ok).toBe(false);
  });
});
