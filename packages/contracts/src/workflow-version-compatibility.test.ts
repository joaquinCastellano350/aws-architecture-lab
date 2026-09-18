import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  validateAuthorizePaymentCommand,
  validateCancelFulfillmentCommand,
  validateCancelPaymentCommand,
  validateCapturePaymentCommand,
  validateCommitInventoryCommand,
  validateCreateReconciliationCommand,
  validateCreatePendingOrderCommand,
  validateFulfillmentCancelledEvent,
  validateHandoffFulfillmentCommand,
  validateInventoryReleasedEvent,
  validateMarkOrderCancelledCommand,
  validateMarkOrderCompensatingCommand,
  validateMarkOrderConfirmedCommand,
  validateMarkOrderInventoryUnavailableCommand,
  validateMarkOrderReconciliationRequiredCommand,
  validateOrderCompensatingEvent,
  validatePaymentRefundedEvent,
  validateReconciliationRequiredEvent,
  validateRefundPaymentCommand,
  validateReleaseInventoryCommand,
  validateReserveFulfillmentCommand,
  validateReserveInventoryCommand,
  validateResolveReconciliationCommand,
  validateRetrieveFulfillmentCommand,
  validateRetrievePaymentCommand,
} from "./index.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

describe("workflow version compatibility", () => {
  it("keeps every v1 happy-path command accepted by current handlers", () => {
    const fixture = fixtureFile("workflow-v1-happy-path.json");

    expect(fixture.fixtureVersion).toBe("workflow-v1");
    expect(validateCreatePendingOrderCommand(fixture.createPendingOrder).ok).toBe(true);
    expect(validateReserveInventoryCommand(fixture.reserveInventory).ok).toBe(true);
    expect(validateAuthorizePaymentCommand(fixture.authorizePayment).ok).toBe(true);
    expect(validateReserveFulfillmentCommand(fixture.reserveFulfillment).ok).toBe(true);
    expect(validateCapturePaymentCommand(fixture.capturePayment).ok).toBe(true);
    expect(validateCommitInventoryCommand(fixture.commitInventory).ok).toBe(true);
    expect(validateHandoffFulfillmentCommand(fixture.handoffFulfillment).ok).toBe(true);
    expect(validateMarkOrderConfirmedCommand(fixture.markOrderConfirmed).ok).toBe(true);
  });

  it("keeps v1 compensation and recovery commands accepted by current handlers", () => {
    const fixture = fixtureFile("workflow-v1-recovery.json");

    expect(fixture.fixtureVersion).toBe("workflow-v1");
    expect(validateMarkOrderCompensatingCommand(fixture.markOrderCompensating).ok).toBe(true);
    expect(
      validateMarkOrderInventoryUnavailableCommand(fixture.markOrderInventoryUnavailable).ok,
    ).toBe(true);
    expect(validateCancelPaymentCommand(fixture.cancelPayment).ok).toBe(true);
    expect(validateRefundPaymentCommand(fixture.refundPayment).ok).toBe(true);
    expect(validateRetrievePaymentCommand(fixture.retrievePayment).ok).toBe(true);
    expect(validateCancelFulfillmentCommand(fixture.cancelFulfillment).ok).toBe(true);
    expect(validateRetrieveFulfillmentCommand(fixture.retrieveFulfillment).ok).toBe(true);
    expect(validateReleaseInventoryCommand(fixture.releaseInventory).ok).toBe(true);
    expect(validateMarkOrderCancelledCommand(fixture.markOrderCancelled).ok).toBe(true);
    expect(
      validateMarkOrderReconciliationRequiredCommand(fixture.markOrderReconciliationRequired).ok,
    ).toBe(true);
    expect(validateCreateReconciliationCommand(fixture.createReconciliation).ok).toBe(true);
    expect(validateResolveReconciliationCommand(fixture.resolveReconciliation).ok).toBe(true);
  });

  it("keeps representative v1 facts accepted by current domain boundary validators", () => {
    const fixture = fixtureFile("workflow-v1-events.json");

    expect(fixture.fixtureVersion).toBe("workflow-v1");
    expect(validateOrderCompensatingEvent(fixture.orderCompensating).ok).toBe(true);
    expect(validateInventoryReleasedEvent(fixture.inventoryReleased).ok).toBe(true);
    expect(validatePaymentRefundedEvent(fixture.paymentRefunded).ok).toBe(true);
    expect(validateFulfillmentCancelledEvent(fixture.fulfillmentCancelled).ok).toBe(true);
    expect(validateReconciliationRequiredEvent(fixture.reconciliationRequired).ok).toBe(true);
  });
});

function fixtureFile(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(
    path.resolve(currentDirectory, "..", "fixtures", name),
    "utf8",
  )) as Record<string, unknown>;
}
