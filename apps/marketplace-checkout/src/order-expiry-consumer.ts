import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  validateInventoryEvent,
  type MarkOrderExpiredCommand,
  type MarkOrderExpiredOutcome,
} from "@aws-architecture-lab/contracts";
import type { EventBridgeEvent, EventBridgeHandler } from "aws-lambda";

import { markOrderExpired } from "./dynamo-order-repository.js";
import { requiredEnvironment } from "./environment.js";

export interface OrderExpiryConsumerDependencies {
  readonly eventSource: string;
  readonly markExpired: (command: MarkOrderExpiredCommand) => Promise<MarkOrderExpiredOutcome>;
}

export function createOrderExpiryConsumer(dependencies: OrderExpiryConsumerDependencies) {
  return async (delivery: EventBridgeEvent<string, unknown>): Promise<void> => {
    if (delivery.source !== dependencies.eventSource) {
      throw new Error(`Unsupported event source: ${delivery.source}`);
    }
    const validation = validateInventoryEvent({
      ...(typeof delivery.detail === "object" && delivery.detail !== null ? delivery.detail : {}),
      eventType: delivery["detail-type"],
    });
    if (!validation.ok) throw new Error(validation.error);
    if (
      validation.value.eventType !== "InventoryReleased" ||
      validation.value.payload.releaseReason !== "CHECKOUT_EXPIRED"
    ) return;
    if (typeof validation.value.payload.checkoutId !== "string") {
      throw new Error("Expired Inventory release is missing checkoutId");
    }

    await dependencies.markExpired({
      schemaVersion: "1.0",
      commandType: "MarkOrderExpired",
      operationId: `consume-order-expiry-${validation.value.eventId}`,
      checkoutId: validation.value.payload.checkoutId,
      correlationId: validation.value.correlationId,
      causationId: validation.value.eventId,
    });
  };
}

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export const handler: EventBridgeHandler<string, unknown, void> = async (delivery) => {
  const orderTableName = requiredEnvironment("ORDER_TABLE_NAME");
  const orderOutboxTableName = requiredEnvironment("ORDER_OUTBOX_TABLE_NAME");
  return createOrderExpiryConsumer({
    eventSource: requiredEnvironment("EVENT_SOURCE"),
    markExpired: (command) => markOrderExpired(
      orderTableName,
      orderOutboxTableName,
      command,
      { client },
    ),
  })(delivery);
};
