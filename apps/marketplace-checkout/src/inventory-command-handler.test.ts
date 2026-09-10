import { describe, expect, it, vi } from "vitest";

import { createInventoryCommandHandler } from "./inventory-command-handler.js";

describe("Inventory command handler", () => {
  it.each([
    ["ReserveInventory", reserveCommand()],
    ["CommitInventory", transitionCommand("CommitInventory")],
    ["ReleaseInventory", transitionCommand("ReleaseInventory")],
  ] as const)("validates and dispatches %s commands", async (_name, command) => {
    const execute = vi.fn(async (input) => ({
      schemaVersion: "1.0" as const,
      operationId: input.operationId,
      checkoutId: input.checkoutId,
      reservationId: input.reservationId,
      status: "RESERVED" as const,
    }));

    await createInventoryCommandHandler({ execute })(command);

    expect(execute).toHaveBeenCalledWith(command);
  });

  it("rejects malformed and unknown commands before persistence", async () => {
    const execute = vi.fn();
    const handler = createInventoryCommandHandler({ execute });

    await expect(handler({ commandType: "ReserveInventory", quantity: 0 })).rejects.toThrow(
      "Value does not match ReserveInventoryCommand",
    );
    await expect(handler({ commandType: "DeleteInventory" })).rejects.toThrow(
      "Unsupported Inventory command",
    );
    expect(execute).not.toHaveBeenCalled();
  });
});

function reserveCommand() {
  return {
    schemaVersion: "1.0" as const,
    commandType: "ReserveInventory" as const,
    operationId: "reserve-checkout-123",
    checkoutId: "checkout-123",
    reservationId: "reservation-checkout-123",
    itemId: "sku-123",
    quantity: 1,
    expiresAt: "2026-09-09T12:05:00.000Z",
    correlationId: "corr-123",
    causationId: "execution-123",
  };
}

function transitionCommand(commandType: "CommitInventory" | "ReleaseInventory") {
  return {
    schemaVersion: "1.0" as const,
    commandType,
    operationId: `${commandType}-checkout-123`,
    checkoutId: "checkout-123",
    reservationId: "reservation-checkout-123",
    correlationId: "corr-123",
    causationId: "execution-123",
  };
}
