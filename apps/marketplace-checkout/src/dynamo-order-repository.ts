import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { CreatePendingOrderCommand } from "@aws-architecture-lab/contracts";

import type { Order } from "./checkout-api.js";

export async function createPendingOrder(
  tableName: string,
  input: CreatePendingOrderCommand,
  now = new Date(),
): Promise<Order> {
  const order: Order = {
    checkoutId: input.checkoutId,
    correlationId: input.correlationId,
    status: "PENDING",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  try {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: order,
        ConditionExpression: "attribute_not_exists(checkoutId)",
      }),
    );
  } catch (error) {
    if (!isConditionalConflict(error)) throw error;
    const existing = await client.send(
      new GetCommand({ TableName: tableName, Key: { checkoutId: input.checkoutId }, ConsistentRead: true }),
    );
    const recorded = existing.Item as Order | undefined;
    if (recorded?.correlationId !== input.correlationId) {
      throw new Error("Order identity invariant violated");
    }
    return recorded;
  }
  return order;
}

function isConditionalConflict(error: unknown): boolean {
  return error instanceof Error && error.name === "ConditionalCheckFailedException";
}
