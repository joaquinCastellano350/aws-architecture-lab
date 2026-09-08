import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { validateOrderPendingEvent } from "@aws-architecture-lab/contracts";
import type { EventBridgeEvent, EventBridgeHandler } from "aws-lambda";

import { requiredEnvironment } from "./environment.js";

export interface AuditConsumerDependencies {
  readonly client: DynamoDBDocumentClient;
  readonly eventSource: string;
  readonly tableName: string;
}

export function createAuditConsumer(dependencies: AuditConsumerDependencies) {
  return async (delivery: EventBridgeEvent<string, unknown>): Promise<void> => {
    if (delivery.source !== dependencies.eventSource) {
      throw new Error(`Unsupported event source: ${delivery.source}`);
    }
    const validation = validateOrderPendingEvent({
      ...(typeof delivery.detail === "object" && delivery.detail !== null ? delivery.detail : {}),
      eventType: delivery["detail-type"],
    });
    if (!validation.ok) throw new Error(validation.error);

    try {
      await dependencies.client.send(new PutCommand({
        TableName: dependencies.tableName,
        Item: validation.value,
        ConditionExpression: "attribute_not_exists(eventId)",
      }));
      console.info(JSON.stringify({
        event: "OrderEventAudited",
        eventId: validation.value.eventId,
      }));
    } catch (error) {
      if (!isDuplicate(error)) throw error;
      console.info(JSON.stringify({
        event: "OrderEventDuplicateIgnored",
        eventId: validation.value.eventId,
      }));
    }
  };
}

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export const handler: EventBridgeHandler<string, unknown, void> = async (delivery) =>
  createAuditConsumer({
    client,
    eventSource: requiredEnvironment("EVENT_SOURCE"),
    tableName: requiredEnvironment("AUDIT_TABLE_NAME"),
  })(delivery);

function isDuplicate(error: unknown): boolean {
  return error instanceof Error && error.name === "ConditionalCheckFailedException";
}
