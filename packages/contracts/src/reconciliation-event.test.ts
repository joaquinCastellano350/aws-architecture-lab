import { describe, expect, it } from "vitest";

import {
  validateReconciliationRequiredEvent,
  validateReconciliationResolvedEvent,
} from "./generated/reconciliation-event.js";

describe("Reconciliation event JSON schemas", () => {
  it("publishes an actionable work item without provider payloads", () => {
    expect(validateReconciliationRequiredEvent({
      eventId: "event-123",
      eventType: "ReconciliationRequired",
      eventVersion: "1.0",
      occurredAt: "2026-09-13T12:00:00.000Z",
      correlationId: "corr-123",
      causationId: "execution-123",
      aggregateType: "Reconciliation",
      aggregateId: "reconciliation-checkout-123",
      payload: {
        checkoutId: "checkout-123",
        status: "RECONCILIATION_REQUIRED",
        failedInvariant: "CAPTURED_PAYMENT_MUST_BE_REFUNDED",
        requiredAction: "COMPENSATE_CAPTURED_PAYMENT",
        attempts: 3,
        workflowVersionArn: "arn:aws:states:us-east-1:123456789012:stateMachine:checkout:42",
      },
    })).toEqual(expect.objectContaining({ ok: true }));
  });

  it("publishes eventual resolution", () => {
    expect(validateReconciliationResolvedEvent({
      eventId: "event-456",
      eventType: "ReconciliationResolved",
      eventVersion: "1.0",
      occurredAt: "2026-09-13T12:05:00.000Z",
      correlationId: "corr-123",
      causationId: "replay-execution-123",
      aggregateType: "Reconciliation",
      aggregateId: "reconciliation-checkout-123",
      payload: {
        checkoutId: "checkout-123",
        status: "RESOLVED",
        attempts: 4,
      },
    })).toEqual(expect.objectContaining({ ok: true }));
  });
});
