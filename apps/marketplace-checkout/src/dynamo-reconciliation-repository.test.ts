import {
  GetCommand,
  TransactWriteCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";
import { describe, expect, it } from "vitest";

import { DynamoReconciliationRepository } from "./dynamo-reconciliation-repository.js";

describe("Reconciliation persistence", () => {
  it("atomically creates actionable work, marks the Saga, and publishes a fact", async () => {
    const sent: unknown[] = [];
    const client = {
      async send(command: unknown) {
        sent.push(command);
        if (command instanceof GetCommand) {
          return command.input.Key?.recordKey === "SAGA#checkout-123"
            ? { Item: { workflowVersionArn: createCommand().workflowVersionArn } }
            : {};
        }
        return {};
      },
    } as unknown as DynamoDBDocumentClient;
    const repository = new DynamoReconciliationRepository(
      "reconciliations",
      "sagas",
      "reconciliation-outbox",
      {
        client,
        clock: () => new Date("2026-09-13T12:00:00.000Z"),
        eventId: () => "event-required",
      },
    );

    const outcome = await repository.create({
      ...createCommand(),
      workflowVersionArn: "arn:aws:states:us-east-1:123456789012:stateMachine:checkout",
    });

    expect(outcome).toEqual({
      schemaVersion: "1.0",
      reconciliationId: "reconciliation-checkout-123",
      checkoutId: "checkout-123",
      status: "RECONCILIATION_REQUIRED",
      attempts: 3,
    });
    const transaction = sent.find(
      (command): command is TransactWriteCommand => command instanceof TransactWriteCommand,
    );
    expect(transaction?.input.TransactItems).toEqual([
      {
        Put: expect.objectContaining({
          TableName: "reconciliations",
          Item: expect.objectContaining({
            reconciliationId: "reconciliation-checkout-123",
            checkoutId: "checkout-123",
            correlationId: "corr-123",
            workflowVersionArn: expect.stringContaining(":42"),
            failedInvariant: "CAPTURED_PAYMENT_MUST_BE_REFUNDED",
            requiredAction: "COMPENSATE_CAPTURED_PAYMENT",
            attempts: 3,
            status: "RECONCILIATION_REQUIRED",
            createdAt: "2026-09-13T12:00:00.000Z",
            updatedAt: "2026-09-13T12:00:00.000Z",
          }),
          ConditionExpression: "attribute_not_exists(reconciliationId)",
        }),
      },
      {
        Update: expect.objectContaining({
          TableName: "sagas",
          Key: { recordKey: "SAGA#checkout-123" },
          UpdateExpression: "SET #status = :status, updatedAt = :updatedAt",
          ExpressionAttributeValues: expect.objectContaining({
            ":status": "RECONCILIATION_REQUIRED",
          }),
        }),
      },
      {
        Put: expect.objectContaining({
          TableName: "reconciliation-outbox",
          Item: expect.objectContaining({
            eventId: "event-required",
            eventType: "ReconciliationRequired",
            payload: expect.objectContaining({
              status: "RECONCILIATION_REQUIRED",
              requiredAction: "COMPENSATE_CAPTURED_PAYMENT",
            }),
          }),
        }),
      },
    ]);
  });

  it("records an audited replay before returning the pinned recovery input", async () => {
    const existing = reconciliationRecord();
    const sent: unknown[] = [];
    const client = {
      async send(command: unknown) {
        sent.push(command);
        if (command instanceof GetCommand) return { Item: existing };
        return {};
      },
    } as unknown as DynamoDBDocumentClient;
    const repository = new DynamoReconciliationRepository(
      "reconciliations",
      "sagas",
      "reconciliation-outbox",
      { client, clock: () => new Date("2026-09-13T12:04:00.000Z") },
    );

    const replay = await repository.beginReplay({
      schemaVersion: "1.0",
      commandType: "ReplayReconciliation",
      operationId: "replay-reconciliation-checkout-123-1",
      reconciliationId: "reconciliation-checkout-123",
      requestedBy: "operator@example.com",
      reason: "Provider recovered",
    });

    expect(replay).toEqual(expect.objectContaining({
      requiredAction: "COMPENSATE_CAPTURED_PAYMENT",
      workflowVersionArn: expect.stringContaining(":42"),
      attempts: 4,
    }));
    const update = sent.find((command): command is UpdateCommand => command instanceof UpdateCommand);
    expect(update?.input).toEqual(expect.objectContaining({
      UpdateExpression:
        "SET #status = :replaying, replayOperationId = :operationId, replayExecutionName = :executionName, attempts = attempts + :one, updatedAt = :updatedAt, replayAudit = list_append(if_not_exists(replayAudit, :empty), :entry)",
      ConditionExpression: "#status = :required",
      ExpressionAttributeValues: expect.objectContaining({
        ":operationId": "replay-reconciliation-checkout-123-1",
        ":entry": [{
          operationId: "replay-reconciliation-checkout-123-1",
          requestedAt: "2026-09-13T12:04:00.000Z",
          requestedBy: "operator@example.com",
          reason: "Provider recovered",
        }],
      }),
    }));
  });

  it("idempotently resumes admission for the same replay operation", async () => {
    const existing = reconciliationRecord({
      status: "REPLAYING",
      replayOperationId: "replay-reconciliation-checkout-123-1",
      replayExecutionName: "replay-execution-name",
      attempts: 4,
    });
    const sent: unknown[] = [];
    const client = {
      async send(command: unknown) {
        sent.push(command);
        return { Item: existing };
      },
    } as unknown as DynamoDBDocumentClient;
    const repository = new DynamoReconciliationRepository(
      "reconciliations",
      "sagas",
      "reconciliation-outbox",
      { client },
    );

    const replay = await repository.beginReplay({
      schemaVersion: "1.0",
      commandType: "ReplayReconciliation",
      operationId: "replay-reconciliation-checkout-123-1",
      reconciliationId: "reconciliation-checkout-123",
      requestedBy: "operator@example.com",
      reason: "Provider recovered",
    });

    expect(replay).toBe(existing);
    expect(sent).toHaveLength(1);
  });

  it("resolves the work and Saga with an immutable resolution fact", async () => {
    const sent: unknown[] = [];
    const client = {
      async send(command: unknown) {
        sent.push(command);
        if (command instanceof GetCommand) return { Item: reconciliationRecord({ attempts: 4 }) };
        return {};
      },
    } as unknown as DynamoDBDocumentClient;
    const repository = new DynamoReconciliationRepository(
      "reconciliations",
      "sagas",
      "reconciliation-outbox",
      {
        client,
        clock: () => new Date("2026-09-13T12:05:00.000Z"),
        eventId: () => "event-resolved",
      },
    );

    const outcome = await repository.resolve({
      schemaVersion: "1.0",
      commandType: "ResolveReconciliation",
      operationId: "resolve-reconciliation-checkout-123",
      reconciliationId: "reconciliation-checkout-123",
      checkoutId: "checkout-123",
      correlationId: "corr-123",
      causationId: "replay-execution-123",
    });

    expect(outcome.status).toBe("RESOLVED");
    const transaction = sent.find(
      (command): command is TransactWriteCommand => command instanceof TransactWriteCommand,
    );
    expect(transaction?.input.TransactItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ Update: expect.objectContaining({
        TableName: "reconciliations",
        ConditionExpression: "#status = :replaying AND checkoutId = :checkoutId AND correlationId = :correlationId",
      }) }),
      expect.objectContaining({ Update: expect.objectContaining({
        TableName: "sagas",
        ExpressionAttributeValues: expect.objectContaining({ ":status": "RESOLVED" }),
      }) }),
      expect.objectContaining({ Put: expect.objectContaining({
        TableName: "reconciliation-outbox",
        Item: expect.objectContaining({ eventType: "ReconciliationResolved" }),
      }) }),
    ]));
  });
});

function createCommand() {
  return {
    schemaVersion: "1.0" as const,
    commandType: "CreateReconciliation" as const,
    operationId: "reconcile-checkout-123",
    reconciliationId: "reconciliation-checkout-123",
    checkoutId: "checkout-123",
    correlationId: "corr-123",
    causationId: "execution-123",
    workflowVersionArn: "arn:aws:states:us-east-1:123456789012:stateMachine:checkout:42",
    failedInvariant: "CAPTURED_PAYMENT_MUST_BE_REFUNDED",
    requiredAction: "COMPENSATE_CAPTURED_PAYMENT" as const,
    attempts: 3,
  };
}

function reconciliationRecord(overrides: Record<string, unknown> = {}) {
  return {
    ...createCommand(),
    status: "RECONCILIATION_REQUIRED" as const,
    createdAt: "2026-09-13T12:00:00.000Z",
    updatedAt: "2026-09-13T12:00:00.000Z",
    ...overrides,
  };
}
