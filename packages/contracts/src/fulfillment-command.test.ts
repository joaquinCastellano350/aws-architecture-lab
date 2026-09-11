import { describe, expect, it } from "vitest";

import {
  validateFulfillmentCommandOutcome,
  validateHandoffFulfillmentCommand,
  validateReserveFulfillmentCommand,
} from "./generated/fulfillment-command.js";

describe("Fulfillment command JSON schemas", () => {
  it("accepts versioned reservation and irreversible-handoff contracts", () => {
    expect(validateReserveFulfillmentCommand(command("ReserveFulfillment", "reserve"))).toEqual(
      expect.objectContaining({ ok: true }),
    );
    expect(validateHandoffFulfillmentCommand(command("HandoffFulfillment", "handoff"))).toEqual(
      expect.objectContaining({ ok: true }),
    );
    expect(validateFulfillmentCommandOutcome({
      schemaVersion: "1.0",
      operationId: "handoff-checkout-123",
      checkoutId: "checkout-123",
      reservationId: "fulfillment-checkout-123",
      status: "HANDED_OFF",
    })).toEqual(expect.objectContaining({ ok: true }));
  });

  it("rejects unsupported versions", () => {
    expect(validateReserveFulfillmentCommand({
      ...command("ReserveFulfillment", "reserve"),
      schemaVersion: "2.0",
    }).ok).toBe(false);
  });
});

function command(commandType: "ReserveFulfillment" | "HandoffFulfillment", prefix: string) {
  return {
    schemaVersion: "1.0",
    commandType,
    operationId: `${prefix}-checkout-123`,
    checkoutId: "checkout-123",
    reservationId: "fulfillment-checkout-123",
    correlationId: "corr-123",
    causationId: "execution-123",
  };
}
