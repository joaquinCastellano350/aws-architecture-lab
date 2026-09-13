import { describe, expect, it } from "vitest";

import { ReconciliationReplayService } from "./reconciliation-replay.js";

describe("audited reconciliation replay", () => {
  it("resumes the pinned workflow version through the recorded domain action", async () => {
    const starts: unknown[] = [];
    const service = new ReconciliationReplayService(
      {
        async beginReplay() {
          return record();
        },
        async failReplay() {
          throw new Error("unexpected replay failure");
        },
      },
      {
        async start(workflowVersionArn, name, input) {
          starts.push({ workflowVersionArn, name, input });
          return { executionArn: "arn:aws:states:us-east-1:123:execution:checkout:replay" };
        },
      },
    );

    const outcome = await service.execute(replayCommand());

    expect(outcome).toEqual({
      schemaVersion: "1.0",
      reconciliationId: "reconciliation-checkout-123",
      checkoutId: "checkout-123",
      status: "REPLAYING",
      attempts: 4,
      executionArn: "arn:aws:states:us-east-1:123:execution:checkout:replay",
    });
    expect(starts).toEqual([{
      workflowVersionArn: "arn:aws:states:us-east-1:123:stateMachine:checkout:42",
      name: "replay-execution-name",
      input: {
        checkoutId: "checkout-123",
        correlationId: "corr-123",
        inventoryReservation: { reservationId: "reservation-checkout-123" },
        paymentAuthorization: { paymentId: "payment-checkout-123" },
        fulfillmentReservation: { reservationId: "fulfillment-checkout-123" },
        compensation: { kind: "CAPTURED_PAYMENT" },
        reconciliationReplay: {
          operationId: "replay-reconciliation-checkout-123-1",
          attempts: 4,
          reconciliationId: "reconciliation-checkout-123",
          requiredAction: "COMPENSATE_CAPTURED_PAYMENT",
        },
      },
    }]);
  });

  it("returns work to required when Step Functions does not admit the replay", async () => {
    const failures: unknown[] = [];
    const service = new ReconciliationReplayService(
      {
        async beginReplay() { return record(); },
        async failReplay(reconciliationId, operationId, reason) {
          failures.push({ reconciliationId, operationId, reason });
        },
      },
      { async start() { throw new Error("workflow unavailable"); } },
    );

    await expect(service.execute(replayCommand())).rejects.toThrow("workflow unavailable");
    expect(failures).toEqual([{
      reconciliationId: "reconciliation-checkout-123",
      operationId: "replay-reconciliation-checkout-123-1",
      reason: "workflow unavailable",
    }]);
  });

  it("returns the recorded resolution when the same replay command is retried", async () => {
    const service = new ReconciliationReplayService(
      {
        async beginReplay() { return { ...record(), status: "RESOLVED" }; },
        async failReplay() { throw new Error("unexpected replay failure"); },
      },
      { async start() { throw new Error("resolved replay must not start again"); } },
    );

    await expect(service.execute(replayCommand())).resolves.toEqual({
      schemaVersion: "1.0",
      reconciliationId: "reconciliation-checkout-123",
      checkoutId: "checkout-123",
      status: "RESOLVED",
      attempts: 4,
      executionArn:
        "arn:aws:states:us-east-1:123:execution:checkout:replay-execution-name",
    });
  });
});

function replayCommand() {
  return {
    schemaVersion: "1.0" as const,
    commandType: "ReplayReconciliation" as const,
    operationId: "replay-reconciliation-checkout-123-1",
    reconciliationId: "reconciliation-checkout-123",
    requestedBy: "operator@example.com",
    reason: "Provider recovered",
  };
}

function record() {
  return {
    reconciliationId: "reconciliation-checkout-123",
    recordType: "RECONCILIATION" as const,
    operationId: "reconcile-checkout-123",
    checkoutId: "checkout-123",
    correlationId: "corr-123",
    workflowVersionArn: "arn:aws:states:us-east-1:123:stateMachine:checkout:42",
    failedInvariant: "CAPTURED_PAYMENT_MUST_BE_REFUNDED",
    requiredAction: "COMPENSATE_CAPTURED_PAYMENT" as const,
    attempts: 4,
    status: "REPLAYING" as const,
    replayOperationId: "replay-reconciliation-checkout-123-1",
    replayExecutionName: "replay-execution-name",
    createdAt: "2026-09-13T12:00:00.000Z",
    updatedAt: "2026-09-13T12:04:00.000Z",
  };
}
