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
  MarkOrderCancelledCommand,
  MarkOrderCancelledOutcome,
  MarkOrderCompensatingCommand,
  MarkOrderCompensatingOutcome,
  MarkOrderConfirmedCommand,
  MarkOrderConfirmedOutcome,
  MarkOrderExpiredCommand,
  MarkOrderExpiredOutcome,
  MarkOrderInventoryUnavailableCommand,
  MarkOrderInventoryUnavailableOutcome,
  MarkOrderReconciliationRequiredCommand,
  MarkOrderReconciliationRequiredOutcome,
  OrderExpiredEvent,
  OrderCancelledEvent,
  OrderCompensatingEvent,
  OrderConfirmedEvent,
  OrderInventoryUnavailableEvent,
  OrderPendingEvent,
  OrderReconciliationRequiredEvent,
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
  return transitionOrder(
    orderTableName,
    outboxTableName,
    input,
    "INVENTORY_UNAVAILABLE",
    dependencies,
  ) as Promise<MarkOrderInventoryUnavailableOutcome>;
}

export async function markOrderExpired(
  orderTableName: string,
  outboxTableName: string,
  input: MarkOrderExpiredCommand,
  dependencies: OrderRepositoryDependencies = {},
): Promise<MarkOrderExpiredOutcome> {
  return transitionOrder(
    orderTableName,
    outboxTableName,
    input,
    "EXPIRED",
    dependencies,
  ) as Promise<MarkOrderExpiredOutcome>;
}

export async function markOrderConfirmed(
  orderTableName: string,
  outboxTableName: string,
  input: MarkOrderConfirmedCommand,
  dependencies: OrderRepositoryDependencies = {},
): Promise<MarkOrderConfirmedOutcome> {
  return transitionOrder(
    orderTableName,
    outboxTableName,
    input,
    "CONFIRMED",
    dependencies,
    ["PENDING", "RECONCILIATION_REQUIRED"],
  ) as Promise<MarkOrderConfirmedOutcome>;
}

export async function markOrderCancelled(
  orderTableName: string,
  outboxTableName: string,
  input: MarkOrderCancelledCommand,
  dependencies: OrderRepositoryDependencies = {},
): Promise<MarkOrderCancelledOutcome> {
  return transitionOrder(
    orderTableName,
    outboxTableName,
    input,
    "CANCELLED",
    dependencies,
    ["COMPENSATING", "RECONCILIATION_REQUIRED"],
  ) as Promise<MarkOrderCancelledOutcome>;
}

export async function markOrderCompensating(
  orderTableName: string,
  outboxTableName: string,
  input: MarkOrderCompensatingCommand,
  dependencies: OrderRepositoryDependencies = {},
): Promise<MarkOrderCompensatingOutcome> {
  return transitionOrder(
    orderTableName,
    outboxTableName,
    input,
    "COMPENSATING",
    dependencies,
  ) as Promise<MarkOrderCompensatingOutcome>;
}

export async function markOrderReconciliationRequired(
  orderTableName: string,
  outboxTableName: string,
  input: MarkOrderReconciliationRequiredCommand,
  dependencies: OrderRepositoryDependencies = {},
): Promise<MarkOrderReconciliationRequiredOutcome> {
  return transitionOrder(
    orderTableName,
    outboxTableName,
    input,
    "RECONCILIATION_REQUIRED",
    dependencies,
    ["PENDING", "COMPENSATING"],
  ) as Promise<MarkOrderReconciliationRequiredOutcome>;
}

type OrderTransitionCommand =
  | MarkOrderInventoryUnavailableCommand
  | MarkOrderExpiredCommand
  | MarkOrderCompensatingCommand
  | MarkOrderCancelledCommand
  | MarkOrderReconciliationRequiredCommand
  | MarkOrderConfirmedCommand;
type OrderTransitionOutcome =
  | MarkOrderInventoryUnavailableOutcome
  | MarkOrderExpiredOutcome
  | MarkOrderCompensatingOutcome
  | MarkOrderCancelledOutcome
  | MarkOrderReconciliationRequiredOutcome
  | MarkOrderConfirmedOutcome;
type OrderTransitionEvent =
  | OrderInventoryUnavailableEvent
  | OrderExpiredEvent
  | OrderCompensatingEvent
  | OrderCancelledEvent
  | OrderReconciliationRequiredEvent
  | OrderConfirmedEvent;
type OrderStatus = Order["status"];
type RequiredOrderStatus = OrderStatus | readonly [OrderStatus, ...OrderStatus[]];

async function transitionOrder(
  orderTableName: string,
  outboxTableName: string,
  input: OrderTransitionCommand,
  status: OrderTransitionOutcome["status"],
  dependencies: OrderRepositoryDependencies,
  requiredStatus: RequiredOrderStatus = "PENDING",
): Promise<OrderTransitionOutcome> {
  const now = (dependencies.clock ?? (() => new Date()))();
  const eventId = (dependencies.eventId ?? randomUUID)();
  const outcome: OrderTransitionOutcome = {
    schemaVersion: "1.0",
    checkoutId: input.checkoutId,
    correlationId: input.correlationId,
    status,
  };
  const eventType = orderEventType(status);
  const event = {
    eventId,
    eventType,
    eventVersion: "1.0",
    occurredAt: now.toISOString(),
    correlationId: input.correlationId,
    causationId: input.causationId,
    aggregateType: "Order",
    aggregateId: input.checkoutId,
    payload: { status },
  } as OrderTransitionEvent;
  const client = dependencies.client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const payloadHash = stablePayloadHash(input);
  const recordedOperation = await getOrderOperation(client, orderTableName, input.operationId);
  if (recordedOperation !== undefined) {
    return recordedOrderOutcome(recordedOperation, payloadHash);
  }
  const operation = orderOperation(input.operationId, payloadHash, outcome, now.toISOString());
  const requiredStatuses = Array.isArray(requiredStatus) ? requiredStatus : [requiredStatus];
  const statusCondition = requiredStatuses.length === 1
    ? "#status = :requiredStatus"
    : `#status IN (${requiredStatuses.map((_, index) => `:requiredStatus${index}`).join(", ")})`;
  const requiredStatusValues = requiredStatuses.length === 1
    ? { ":requiredStatus": requiredStatuses[0] }
    : Object.fromEntries(requiredStatuses.map((value, index) => [`:requiredStatus${index}`, value]));
  try {
    await client.send(new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: orderTableName,
            Key: { checkoutId: input.checkoutId },
            UpdateExpression: "SET #status = :targetStatus, updatedAt = :updatedAt",
            ConditionExpression: `${statusCondition} AND correlationId = :correlationId`,
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ...requiredStatusValues,
              ":targetStatus": status,
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
      recorded?.status !== status ||
      recorded.correlationId !== input.correlationId
    ) {
      throw new Error("Order state invariant violated");
    }
    return recordCompletedOrderOperation(client, orderTableName, operation);
  }
}

function orderEventType(status: OrderTransitionOutcome["status"]): OrderTransitionEvent["eventType"] {
  switch (status) {
    case "INVENTORY_UNAVAILABLE": return "OrderInventoryUnavailable";
    case "EXPIRED": return "OrderExpired";
    case "COMPENSATING": return "OrderCompensating";
    case "RECONCILIATION_REQUIRED": return "OrderReconciliationRequired";
    case "CANCELLED": return "OrderCancelled";
    case "CONFIRMED": return "OrderConfirmed";
  }
}

interface OrderOperation {
  readonly checkoutId: string;
  readonly recordType: "OPERATION";
  readonly operationId: string;
  readonly payloadHash: string;
  readonly state: "SUCCEEDED";
  readonly result: OrderTransitionOutcome;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function orderOperation(
  operationId: string,
  payloadHash: string,
  result: OrderTransitionOutcome,
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
): Promise<OrderTransitionOutcome> {
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
): OrderTransitionOutcome {
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
