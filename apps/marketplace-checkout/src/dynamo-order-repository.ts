import { randomUUID } from "node:crypto";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import type { CreatePendingOrderCommand, OrderPendingEvent } from "@aws-architecture-lab/contracts";

import type { Order } from "./checkout-api.js";

export async function createPendingOrder(
  orderTableName: string,
  outboxTableName: string,
  input: CreatePendingOrderCommand,
  dependencies: OrderRepositoryDependencies = {},
): Promise<Order> {
  const now = (dependencies.clock ?? (() => new Date()))();
  const eventId = (dependencies.eventId ?? randomUUID)();
  const order: Order = {
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
    if (!isTransactionConflict(error)) throw error;
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
    return recorded;
  }
  return order;
}

export interface OrderRepositoryDependencies {
  readonly client?: DynamoDBDocumentClient;
  readonly clock?: () => Date;
  readonly eventId?: () => string;
}

function isTransactionConflict(error: unknown): boolean {
  return error instanceof Error && error.name === "TransactionCanceledException";
}
