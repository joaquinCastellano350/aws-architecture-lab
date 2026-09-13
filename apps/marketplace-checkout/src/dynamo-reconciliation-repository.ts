import { createHash, randomUUID } from "node:crypto";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type {
  CreateReconciliationCommand,
  ReconciliationCommandOutcome,
  ReconciliationRequiredEvent,
  ReconciliationResolvedEvent,
  ReplayReconciliationCommand,
  ResolveReconciliationCommand,
} from "@aws-architecture-lab/contracts";

export type ReconciliationRequiredAction = CreateReconciliationCommand["requiredAction"];

export interface ReconciliationRecord {
  readonly reconciliationId: string;
  readonly recordType: "RECONCILIATION";
  readonly operationId: string;
  readonly checkoutId: string;
  readonly correlationId: string;
  readonly workflowVersionArn: string;
  readonly failedInvariant: string;
  readonly requiredAction: ReconciliationRequiredAction;
  readonly attempts: number;
  readonly status: "RECONCILIATION_REQUIRED" | "REPLAYING" | "RESOLVED";
  readonly lastError?: string;
  readonly replayOperationId?: string;
  readonly replayExecutionName?: string;
  readonly replayAudit?: readonly ReplayAuditEntry[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ReplayAuditEntry {
  readonly operationId: string;
  readonly requestedAt: string;
  readonly requestedBy: string;
  readonly reason: string;
}

export type AdmittedReconciliationReplay = ReconciliationRecord & {
  readonly replayOperationId: string;
  readonly replayExecutionName: string;
  readonly status: "REPLAYING" | "RESOLVED";
};

export class DynamoReconciliationRepository {
  readonly #client: DynamoDBDocumentClient;
  readonly #clock: () => Date;
  readonly #eventId: () => string;

  public constructor(
    readonly tableName: string,
    readonly sagaTableName: string,
    readonly outboxTableName: string,
    dependencies: ReconciliationRepositoryDependencies = {},
  ) {
    this.#client = dependencies.client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
    this.#clock = dependencies.clock ?? (() => new Date());
    this.#eventId = dependencies.eventId ?? randomUUID;
  }

  public async create(
    command: CreateReconciliationCommand,
  ): Promise<ReconciliationCommandOutcome> {
    const now = this.#clock().toISOString();
    const workflowVersionArn = await this.#sagaWorkflowVersion(command.checkoutId);
    const record: ReconciliationRecord = {
      reconciliationId: command.reconciliationId,
      recordType: "RECONCILIATION",
      operationId: command.operationId,
      checkoutId: command.checkoutId,
      correlationId: command.correlationId,
      workflowVersionArn,
      failedInvariant: command.failedInvariant,
      requiredAction: command.requiredAction,
      attempts: command.attempts,
      status: "RECONCILIATION_REQUIRED",
      ...(command.lastError === undefined ? {} : { lastError: command.lastError }),
      createdAt: now,
      updatedAt: now,
    };
    const event: ReconciliationRequiredEvent = {
      eventId: this.#eventId(),
      eventType: "ReconciliationRequired",
      eventVersion: "1.0",
      occurredAt: now,
      correlationId: command.correlationId,
      causationId: command.causationId,
      aggregateType: "Reconciliation",
      aggregateId: command.reconciliationId,
      payload: {
        checkoutId: command.checkoutId,
        status: "RECONCILIATION_REQUIRED",
        failedInvariant: command.failedInvariant,
        requiredAction: command.requiredAction,
        attempts: command.attempts,
        workflowVersionArn,
      },
    };
    const existing = await this.get(command.reconciliationId);
    if (existing !== undefined) {
      assertSameWork(existing, command);
      if (existing.status === "REPLAYING") {
        return this.#reopen(existing, event, now);
      }
      return outcome(existing);
    }
    try {
      await this.#client.send(new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: record,
              ConditionExpression: "attribute_not_exists(reconciliationId)",
            },
          },
          sagaStatusUpdate(this.sagaTableName, command.checkoutId, "RECONCILIATION_REQUIRED", now),
          {
            Put: {
              TableName: this.outboxTableName,
              Item: event,
              ConditionExpression: "attribute_not_exists(eventId)",
            },
          },
        ],
      }));
      return outcome(record);
    } catch (error) {
      if (!isTransactionCancellation(error)) throw error;
      const existing = await this.get(command.reconciliationId);
      if (existing === undefined) throw error;
      assertSameWork(existing, command);
      return outcome(existing);
    }
  }

  public async beginReplay(
    command: ReplayReconciliationCommand,
  ): Promise<AdmittedReconciliationReplay> {
    const record = await this.get(command.reconciliationId);
    if (record === undefined) throw new Error("Reconciliation work was not found");
    if (
      (record.status === "REPLAYING" || record.status === "RESOLVED") &&
      record.replayOperationId === command.operationId &&
      record.replayExecutionName !== undefined
    ) {
      return record as AdmittedReconciliationReplay;
    }
    if (record.status !== "RECONCILIATION_REQUIRED") {
      throw new Error(`Reconciliation work cannot be replayed from ${record.status}`);
    }
    const now = this.#clock().toISOString();
    const replayExecutionName = executionName(command.operationId);
    if (record.replayOperationId === command.operationId) {
      await this.#client.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { reconciliationId: command.reconciliationId },
        UpdateExpression:
          "SET #status = :replaying, replayExecutionName = :executionName, updatedAt = :updatedAt",
        ConditionExpression: "#status = :required AND replayOperationId = :operationId",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":replaying": "REPLAYING",
          ":required": "RECONCILIATION_REQUIRED",
          ":operationId": command.operationId,
          ":executionName": replayExecutionName,
          ":updatedAt": now,
        },
      }));
      return {
        ...record,
        status: "REPLAYING",
        replayOperationId: command.operationId,
        replayExecutionName,
        updatedAt: now,
      };
    }
    const audit: ReplayAuditEntry = {
      operationId: command.operationId,
      requestedAt: now,
      requestedBy: command.requestedBy,
      reason: command.reason,
    };
    await this.#client.send(new UpdateCommand({
      TableName: this.tableName,
      Key: { reconciliationId: command.reconciliationId },
      UpdateExpression:
        "SET #status = :replaying, replayOperationId = :operationId, replayExecutionName = :executionName, attempts = attempts + :one, updatedAt = :updatedAt, replayAudit = list_append(if_not_exists(replayAudit, :empty), :entry)",
      ConditionExpression: "#status = :required",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":replaying": "REPLAYING",
        ":required": "RECONCILIATION_REQUIRED",
        ":operationId": command.operationId,
        ":executionName": replayExecutionName,
        ":one": 1,
        ":updatedAt": now,
        ":empty": [],
        ":entry": [audit],
      },
    }));
    return {
      ...record,
      status: "REPLAYING",
      replayOperationId: command.operationId,
      replayExecutionName,
      attempts: record.attempts + 1,
      replayAudit: [...(record.replayAudit ?? []), audit],
      updatedAt: now,
    };
  }

  async #reopen(
    existing: ReconciliationRecord,
    event: ReconciliationRequiredEvent,
    now: string,
  ): Promise<ReconciliationCommandOutcome> {
    await this.#client.send(new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: this.tableName,
            Key: { reconciliationId: existing.reconciliationId },
            UpdateExpression: "SET #status = :required, updatedAt = :updatedAt",
            ConditionExpression: "#status = :replaying",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":replaying": "REPLAYING",
              ":required": "RECONCILIATION_REQUIRED",
              ":updatedAt": now,
            },
          },
        },
        sagaStatusUpdate(this.sagaTableName, existing.checkoutId, "RECONCILIATION_REQUIRED", now),
        {
          Put: {
            TableName: this.outboxTableName,
            Item: event,
            ConditionExpression: "attribute_not_exists(eventId)",
          },
        },
      ],
    }));
    return outcome({ ...existing, status: "RECONCILIATION_REQUIRED", updatedAt: now });
  }

  public async resolve(
    command: ResolveReconciliationCommand,
  ): Promise<ReconciliationCommandOutcome> {
    const existing = await this.get(command.reconciliationId);
    if (existing === undefined) throw new Error("Reconciliation work was not found");
    if (
      existing.checkoutId !== command.checkoutId ||
      existing.correlationId !== command.correlationId
    ) {
      throw new Error("Reconciliation identity invariant violated");
    }
    if (existing.status === "RESOLVED") return outcome(existing);
    const now = this.#clock().toISOString();
    const event: ReconciliationResolvedEvent = {
      eventId: this.#eventId(),
      eventType: "ReconciliationResolved",
      eventVersion: "1.0",
      occurredAt: now,
      correlationId: command.correlationId,
      causationId: command.causationId,
      aggregateType: "Reconciliation",
      aggregateId: command.reconciliationId,
      payload: {
        checkoutId: command.checkoutId,
        status: "RESOLVED",
        attempts: existing.attempts,
      },
    };
    await this.#client.send(new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: this.tableName,
            Key: { reconciliationId: command.reconciliationId },
            UpdateExpression: "SET #status = :resolved, updatedAt = :updatedAt, resolvedAt = :updatedAt",
            ConditionExpression:
              "#status = :replaying AND checkoutId = :checkoutId AND correlationId = :correlationId",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":replaying": "REPLAYING",
              ":resolved": "RESOLVED",
              ":checkoutId": command.checkoutId,
              ":correlationId": command.correlationId,
              ":updatedAt": now,
            },
          },
        },
        sagaStatusUpdate(this.sagaTableName, command.checkoutId, "RESOLVED", now),
        {
          Put: {
            TableName: this.outboxTableName,
            Item: event,
            ConditionExpression: "attribute_not_exists(eventId)",
          },
        },
      ],
    }));
    return outcome({ ...existing, status: "RESOLVED", updatedAt: now });
  }

  public async failReplay(
    reconciliationId: string,
    operationId: string,
    reason: string,
  ): Promise<void> {
    const now = this.#clock().toISOString();
    await this.#client.send(new UpdateCommand({
      TableName: this.tableName,
      Key: { reconciliationId },
      UpdateExpression:
        "SET #status = :required, lastError = :reason, updatedAt = :updatedAt",
      ConditionExpression: "#status = :replaying AND replayOperationId = :operationId",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":required": "RECONCILIATION_REQUIRED",
        ":replaying": "REPLAYING",
        ":operationId": operationId,
        ":reason": reason.slice(0, 1024),
        ":updatedAt": now,
      },
    }));
  }

  public async get(reconciliationId: string): Promise<ReconciliationRecord | undefined> {
    const response = await this.#client.send(new GetCommand({
      TableName: this.tableName,
      Key: { reconciliationId },
      ConsistentRead: true,
    }));
    return response.Item as ReconciliationRecord | undefined;
  }

  async #sagaWorkflowVersion(checkoutId: string): Promise<string> {
    const response = await this.#client.send(new GetCommand({
      TableName: this.sagaTableName,
      Key: { recordKey: `SAGA#${checkoutId}` },
      ConsistentRead: true,
    }));
    const workflowVersionArn = (response.Item as { readonly workflowVersionArn?: unknown } | undefined)
      ?.workflowVersionArn;
    if (typeof workflowVersionArn !== "string" || workflowVersionArn.length === 0) {
      const error = new Error("Saga execution did not record its immutable workflow version");
      error.name = "SagaWorkflowVersionPendingError";
      throw error;
    }
    return workflowVersionArn;
  }
}

function sagaStatusUpdate(
  tableName: string,
  checkoutId: string,
  status: "RECONCILIATION_REQUIRED" | "RESOLVED",
  now: string,
) {
  return {
    Update: {
      TableName: tableName,
      Key: { recordKey: `SAGA#${checkoutId}` },
      UpdateExpression: "SET #status = :status, updatedAt = :updatedAt",
      ConditionExpression: "attribute_exists(recordKey)",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":status": status, ":updatedAt": now },
    },
  };
}

function outcome(record: ReconciliationRecord): ReconciliationCommandOutcome {
  return {
    schemaVersion: "1.0",
    reconciliationId: record.reconciliationId,
    checkoutId: record.checkoutId,
    status: record.status,
    attempts: record.attempts,
  };
}

function assertSameWork(
  existing: ReconciliationRecord,
  command: CreateReconciliationCommand,
): void {
  if (
    existing.operationId !== command.operationId ||
    existing.checkoutId !== command.checkoutId ||
    existing.correlationId !== command.correlationId ||
    existing.failedInvariant !== command.failedInvariant ||
    existing.requiredAction !== command.requiredAction
  ) {
    throw new Error("Reconciliation ID was reused for different work");
  }
}

export interface ReconciliationRepositoryDependencies {
  readonly client?: DynamoDBDocumentClient;
  readonly clock?: () => Date;
  readonly eventId?: () => string;
}

function isTransactionCancellation(error: unknown): boolean {
  return error instanceof Error && error.name === "TransactionCanceledException";
}

function executionName(operationId: string): string {
  const digest = createHash("sha256").update(operationId).digest("hex").slice(0, 64);
  return `replay-${digest}`;
}
