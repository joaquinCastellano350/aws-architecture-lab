import { describe, expect, it } from "vitest";

import {
  validateCreateReconciliationCommand,
  validateReconciliationCommandOutcome,
  validateReplayReconciliationCommand,
  validateResolveReconciliationCommand,
} from "./generated/reconciliation-command.js";

describe("Reconciliation command JSON schemas", () => {
  it("accepts creation with the invariant, recovery action, attempts, correlation, and workflow version", () => {
    expect(validateCreateReconciliationCommand({
      schemaVersion: "1.0",
      commandType: "CreateReconciliation",
      operationId: "reconcile-checkout-123",
      reconciliationId: "reconciliation-checkout-123",
      checkoutId: "checkout-123",
      correlationId: "corr-123",
      causationId: "execution-123",
      workflowVersionArn: "arn:aws:states:us-east-1:123456789012:stateMachine:checkout:42",
      failedInvariant: "CAPTURED_PAYMENT_MUST_BE_REFUNDED",
      requiredAction: "COMPENSATE_CAPTURED_PAYMENT",
      attempts: 3,
    })).toEqual(expect.objectContaining({ ok: true }));
  });

  it("accepts audited replay and workflow-owned resolution commands", () => {
    expect(validateReplayReconciliationCommand({
      schemaVersion: "1.0",
      commandType: "ReplayReconciliation",
      operationId: "replay-reconciliation-checkout-123-1",
      reconciliationId: "reconciliation-checkout-123",
      requestedBy: "operator@example.com",
      reason: "Provider recovered",
    })).toEqual(expect.objectContaining({ ok: true }));
    expect(validateResolveReconciliationCommand({
      schemaVersion: "1.0",
      commandType: "ResolveReconciliation",
      operationId: "resolve-reconciliation-checkout-123",
      reconciliationId: "reconciliation-checkout-123",
      checkoutId: "checkout-123",
      correlationId: "corr-123",
      causationId: "replay-execution-123",
    })).toEqual(expect.objectContaining({ ok: true }));
    expect(validateReconciliationCommandOutcome({
      schemaVersion: "1.0",
      reconciliationId: "reconciliation-checkout-123",
      checkoutId: "checkout-123",
      status: "RESOLVED",
      attempts: 4,
    })).toEqual(expect.objectContaining({ ok: true }));
  });

  it("rejects incomplete work records and unaudited replay", () => {
    expect(validateCreateReconciliationCommand({
      schemaVersion: "1.0",
      commandType: "CreateReconciliation",
      checkoutId: "checkout-123",
    }).ok).toBe(false);
    expect(validateReplayReconciliationCommand({
      schemaVersion: "1.0",
      commandType: "ReplayReconciliation",
      reconciliationId: "reconciliation-checkout-123",
    }).ok).toBe(false);
  });
});
