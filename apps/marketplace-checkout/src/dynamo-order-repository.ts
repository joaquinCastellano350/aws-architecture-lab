import { randomUUID } from "node:crypto";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import type {
  CreatePendingOrderCommand,
  MarkOrderInventoryUnavailableCommand,
  MarkOrderInventoryUnavailableOutcome,
  OrderInventoryUnavailableEvent,
  OrderPendingEvent,
} from "@aws-architecture-lab/contracts";

import type { Order } from "./checkout-api.js";
import { stablePayloadHash } from "./domain-command.js";

type PendingOrder = Order & { readonly status: "PENDING" };

export async function createPendingOrder(
  orderTableName: string,
  outboxTableName: string,
  input: CreatePendingOrderCommand,
  dependencies: OrderRepositoryDependencies = {},
): Promise<PendingOrder> {
  const now = (dependencies.clock ?? (() => new Date()))();
  const eventId = (dependencies.eventId ?? randomUUID)();
  const order: PendingOrder = {
    checkoutId: input.checkoutId,
    correlationId: input.correlationId,
    status: "PENDING",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  const event: OrderPendingEvent = {
    eventId,
    eventType: "OrderPending",
    eventVersion: "1.0",
    occurredAt: now.toISOString(),
    correlationId: input.correlationId,
    causationId: input.causationId ?? input.checkoutId,
    aggregateType: "Order",
    aggregateId: input.checkoutId,
    payload: { status: "PENDING" },
  };
  const client = dependencies.client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
  try {
    await client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: orderTableName,
              Item: order,
              ConditionExpression: "attribute_not_exists(checkoutId)",
            },
          },
          {
            Put: {
              TableName: outboxTableName,
              Item: event,
              ConditionExpression: "attribute_not_exists(eventId)",
            },
          },
        ],
      }),
    );
  } catch (error) {
    if (!hasConditionalFailureAt(error, 0)) throw error;
    const existing = await client.send(
      new GetCommand({
        TableName: orderTableName,
        Key: { checkoutId: input.checkoutId },
        ConsistentRead: true,
      }),
    );
    const recorded = existing.Item as Order | undefined;
    if (recorded?.correlationId !== input.correlationId) {
      throw new Error("Order identity invariant violated");
    }
    return { ...recorded, status: "PENDING" };
  }
  return order;
}

export async function markOrderInventoryUnavailable(
  orderTableName: string,
  outboxTableName: string,
  input: MarkOrderInventoryUnavailableCommand,
  dependencies: OrderRepositoryDependencies = {},
): Promise<MarkOrderInventoryUnavailableOutcome> {
  const now = (dependencies.clock ?? (() => new Date()))();
  const eventId = (dependencies.eventId ?? randomUUID)();
  const outcome: MarkOrderInventoryUnavailableOutcome = {
    schemaVersion: "1.0",
    checkoutId: input.checkoutId,
    correlationId: input.correlationId,
    status: "INVENTORY_UNAVAILABLE",
  };
  const event: OrderInventoryUnavailableEvent = {
    eventId,
    eventType: "OrderInventoryUnavailable",
    eventVersion: "1.0",
    occurredAt: now.toISOString(),
    correlationId: input.correlationId,
    causationId: input.causationId,
    aggregateType: "Order",
    aggregateId: input.checkoutId,
    payload: { status: "INVENTORY_UNAVAILABLE" },
  };
  const client = dependencies.client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const payloadHash = stablePayloadHash(input);
  const recordedOperation = await getOrderOperation(client, orderTableName, input.operationId);
  if (recordedOperation !== undefined) {
    return recordedOrderOutcome(recordedOperation, payloadHash);
  }
  const operation = orderOperation(input.operationId, payloadHash, outcome, now.toISOString());
  try {
    await client.send(new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: orderTableName,
            Key: { checkoutId: input.checkoutId },
            UpdateExpression: "SET #status = :unavailable, updatedAt = :updatedAt",
            ConditionExpression: "#status = :pending AND correlationId = :correlationId",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":pending": "PENDING",
              ":unavailable": "INVENTORY_UNAVAILABLE",
              ":correlationId": input.correlationId,
              ":updatedAt": now.toISOString(),
            },
          },
        },
        {
          Put: {
            TableName: orderTableName,
            Item: operation,
            ConditionExpression: "attribute_not_exists(checkoutId)",
          },
        },
        {
          Put: {
            TableName: outboxTableName,
            Item: event,
            ConditionExpression: "attribute_not_exists(eventId)",
          },
        },
      ],
    }));
    return outcome;
  } catch (error) {
    if (!isTransactionCancellation(error)) throw error;
    const concurrentOperation = await getOrderOperation(
      client,
      orderTableName,
      input.operationId,
    );
    if (concurrentOperation !== undefined) {
      return recordedOrderOutcome(concurrentOperation, payloadHash);
    }
    if (!hasConditionalFailureAt(error, 0) && !hasConditionalFailureAt(error, 1)) throw error;
    const existing = await client.send(new GetCommand({
      TableName: orderTableName,
      Key: { checkoutId: input.checkoutId },
      ConsistentRead: true,
    }));
    const recorded = existing.Item as Order | undefined;
    if (
      recorded?.status !== "INVENTORY_UNAVAILABLE" ||
      recorded.correlationId !== input.correlationId
    ) {
      throw new Error("Order state invariant violated");
    }
    return recordCompletedOrderOperation(client, orderTableName, operation);
  }
}

interface OrderOperation {
  readonly checkoutId: string;
  readonly recordType: "OPERATION";
  readonly operationId: string;
  readonly payloadHash: string;
  readonly state: "SUCCEEDED";
  readonly result: MarkOrderInventoryUnavailableOutcome;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function orderOperation(
  operationId: string,
  payloadHash: string,
  result: MarkOrderInventoryUnavailableOutcome,
  now: string,
): OrderOperation {
  return {
    checkoutId: orderOperationKey(operationId),
    recordType: "OPERATION",
    operationId,
    payloadHash,
    state: "SUCCEEDED",
    result,
    createdAt: now,
    updatedAt: now,
  };
}

async function getOrderOperation(
  client: DynamoDBDocumentClient,
  tableName: string,
  operationId: string,
): Promise<OrderOperation | undefined> {
  const response = await client.send(new GetCommand({
    TableName: tableName,
    Key: { checkoutId: orderOperationKey(operationId) },
    ConsistentRead: true,
  }));
  return response.Item as OrderOperation | undefined;
}

async function recordCompletedOrderOperation(
  client: DynamoDBDocumentClient,
  tableName: string,
  operation: OrderOperation,
): Promise<MarkOrderInventoryUnavailableOutcome> {
  try {
    await client.send(new PutCommand({
      TableName: tableName,
      Item: operation,
      ConditionExpression: "attribute_not_exists(checkoutId)",
    }));
    return operation.result;
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "ConditionalCheckFailedException") throw error;
    const concurrent = await getOrderOperation(client, tableName, operation.operationId);
    if (concurrent === undefined) throw error;
    return recordedOrderOutcome(concurrent, operation.payloadHash);
  }
}

function recordedOrderOutcome(
  operation: OrderOperation,
  payloadHash: string,
): MarkOrderInventoryUnavailableOutcome {
  if (operation.payloadHash !== payloadHash) {
    throw new Error("Order operation ID was reused with a different payload");
  }
  return operation.result;
}

function orderOperationKey(operationId: string): string {
  return `OPERATION#${operationId}`;
}

export interface OrderRepositoryDependencies {
  readonly client?: DynamoDBDocumentClient;
  readonly clock?: () => Date;
  readonly eventId?: () => string;
}

function isTransactionCancellation(error: unknown): boolean {
  return error instanceof Error && error.name === "TransactionCanceledException";
}

function hasConditionalFailureAt(error: unknown, index: number): boolean {
  if (!isTransactionCancellation(error)) return false;
  const reasons = (error as Error & {
    readonly CancellationReasons?: ReadonlyArray<{ readonly Code?: string }>;
  }).CancellationReasons;
  return reasons?.[index]?.Code === "ConditionalCheckFailed" && reasons.every(
    (reason) => reason.Code === "None" || reason.Code === "ConditionalCheckFailed",
  );
}
