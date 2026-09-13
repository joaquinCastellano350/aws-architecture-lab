import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import {
  validateInventoryEvent,
  validateOrderCancelledEvent,
  validateOrderConfirmedEvent,
  validateOrderExpiredEvent,
  validateOrderInventoryUnavailableEvent,
  validateOrderPendingEvent,
  validatePaymentEvent,
  type InventoryEvent,
  type OrderCancelledEvent,
  type OrderConfirmedEvent,
  type OrderExpiredEvent,
  type OrderInventoryUnavailableEvent,
  type OrderPendingEvent,
  type PaymentEvent,
} from "@aws-architecture-lab/contracts";
import type {
  DynamoDBBatchResponse,
  DynamoDBStreamEvent,
  DynamoDBStreamHandler,
} from "aws-lambda";

import { requiredEnvironment } from "./environment.js";

export interface OutboxPublisherDependencies {
  readonly eventBridge: EventBridgeClient;
  readonly eventBusName: string;
  readonly eventSource: string;
}

type DomainEvent =
  | InventoryEvent
  | OrderCancelledEvent
  | OrderConfirmedEvent
  | OrderExpiredEvent
  | OrderInventoryUnavailableEvent
  | OrderPendingEvent
  | PaymentEvent;

export function createOutboxPublisher(dependencies: OutboxPublisherDependencies) {
  return async (input: DynamoDBStreamEvent): Promise<DynamoDBBatchResponse> => {
    const failures = new Set<string>();
    const publishable: Array<{ readonly itemIdentifier: string; readonly event: DomainEvent }> = [];

    for (const record of input.Records) {
      if (record.eventName !== "INSERT") continue;
      const itemIdentifier = record.dynamodb?.SequenceNumber;
      if (itemIdentifier === undefined || record.dynamodb?.NewImage === undefined) continue;
      const validation = validateDomainEvent(
        dependencies.eventSource,
        unmarshall(record.dynamodb.NewImage as Parameters<typeof unmarshall>[0]),
      );
      if (!validation.ok) {
        failures.add(itemIdentifier);
        continue;
      }
      publishable.push({ itemIdentifier, event: validation.value });
    }

    for (let offset = 0; offset < publishable.length; offset += 10) {
      const batch = publishable.slice(offset, offset + 10);
      try {
        const response = await dependencies.eventBridge.send(new PutEventsCommand({
          Entries: batch.map(({ event }) => {
            const { eventType, ...detail } = event;
            return {
              Source: dependencies.eventSource,
              DetailType: eventType,
              EventBusName: dependencies.eventBusName,
              Time: new Date(event.occurredAt),
              Detail: JSON.stringify(detail),
            };
          }),
        }));
        for (const [index, result] of (response.Entries ?? []).entries()) {
          if (result?.ErrorCode !== undefined || result?.EventId === undefined) {
            const failed = batch[index];
            if (failed !== undefined) failures.add(failed.itemIdentifier);
          }
        }
        if ((response.Entries?.length ?? 0) < batch.length) {
          for (const unpublished of batch.slice(response.Entries?.length ?? 0)) {
            failures.add(unpublished.itemIdentifier);
          }
        }
      } catch {
        for (const unpublished of batch) failures.add(unpublished.itemIdentifier);
      }
    }

    return {
      batchItemFailures: [...failures].map((itemIdentifier) => ({ itemIdentifier })),
    };
  };
}

const eventBridge = new EventBridgeClient({});

export const handler: DynamoDBStreamHandler = async (event) => createOutboxPublisher({
  eventBridge,
  eventBusName: requiredEnvironment("EVENT_BUS_NAME"),
  eventSource: requiredEnvironment("EVENT_SOURCE"),
})(event);

function validateDomainEvent(
  eventSource: string,
  input: unknown,
): { readonly ok: true; readonly value: DomainEvent } | { readonly ok: false } {
  if (eventSource === "aws-architecture-lab.order") {
    for (const validate of [
      validateOrderPendingEvent,
      validateOrderInventoryUnavailableEvent,
      validateOrderExpiredEvent,
      validateOrderCancelledEvent,
      validateOrderConfirmedEvent,
    ]) {
      const result = validate(input);
      if (result.ok) return result;
    }
    return { ok: false };
  }
  if (eventSource === "aws-architecture-lab.inventory") return validateInventoryEvent(input);
  if (eventSource === "aws-architecture-lab.payment") return validatePaymentEvent(input);
  return { ok: false };
}
