import { PutEventsCommand, type EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { marshall } from "@aws-sdk/util-dynamodb";
import { describe, expect, it } from "vitest";

import { createOutboxPublisher } from "./outbox-publisher.js";

describe("domain outbox publisher", () => {
  it("routes event types through EventBridge and retries only failed stream records", async () => {
    const sent: unknown[] = [];
    const eventBridge = {
      async send(command: unknown) {
        sent.push(command);
        return {
          FailedEntryCount: 1,
          Entries: [{ EventId: "eventbridge-1" }, { ErrorCode: "InternalFailure" }],
        };
      },
    } as unknown as EventBridgeClient;
    const publish = createOutboxPublisher({
      eventBridge,
      eventBusName: "checkout-events",
      eventSource: "aws-architecture-lab.order",
    });

    const result = await publish({
      Records: [
        streamRecord("stream-1", orderPendingEvent("event-1", "checkout-1")),
        streamRecord("stream-2", orderPendingEvent("event-2", "checkout-2")),
      ],
    });

    expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "stream-2" }] });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toBeInstanceOf(PutEventsCommand);
    expect((sent[0] as PutEventsCommand).input).toEqual({
      Entries: [
        {
          Source: "aws-architecture-lab.order",
          DetailType: "OrderPending",
          EventBusName: "checkout-events",
          Time: new Date("2026-09-08T12:00:00.000Z"),
          Detail: JSON.stringify({
            eventId: "event-1",
            eventVersion: "1.0",
            occurredAt: "2026-09-08T12:00:00.000Z",
            correlationId: "corr-checkout-1",
            causationId: "command-checkout-1",
            aggregateType: "Order",
            aggregateId: "checkout-1",
            payload: { status: "PENDING" },
          }),
        },
        {
          Source: "aws-architecture-lab.order",
          DetailType: "OrderPending",
          EventBusName: "checkout-events",
          Time: new Date("2026-09-08T12:00:00.000Z"),
          Detail: JSON.stringify({
            eventId: "event-2",
            eventVersion: "1.0",
            occurredAt: "2026-09-08T12:00:00.000Z",
            correlationId: "corr-checkout-2",
            causationId: "command-checkout-2",
            aggregateType: "Order",
            aggregateId: "checkout-2",
            payload: { status: "PENDING" },
          }),
        },
      ],
    });
  });

  it("publishes versioned Inventory facts from the Inventory outbox", async () => {
    const sent: PutEventsCommand[] = [];
    const eventBridge = {
      async send(command: PutEventsCommand) {
        sent.push(command);
        return { Entries: [{ EventId: "eventbridge-inventory" }] };
      },
    } as unknown as EventBridgeClient;
    const publish = createOutboxPublisher({
      eventBridge,
      eventBusName: "checkout-events",
      eventSource: "aws-architecture-lab.inventory",
    });

    await expect(publish({ Records: [streamRecord("inventory-stream", inventoryEvent())] }))
      .resolves.toEqual({ batchItemFailures: [] });
    expect(sent[0]?.input.Entries?.[0]).toEqual(expect.objectContaining({
      Source: "aws-architecture-lab.inventory",
      DetailType: "InventoryReserved",
    }));
  });

  it("publishes versioned Payment facts from the Payment outbox", async () => {
    const sent: PutEventsCommand[] = [];
    const eventBridge = {
      async send(command: PutEventsCommand) {
        sent.push(command);
        return { Entries: [{ EventId: "eventbridge-payment" }] };
      },
    } as unknown as EventBridgeClient;
    const publish = createOutboxPublisher({
      eventBridge,
      eventBusName: "checkout-events",
      eventSource: "aws-architecture-lab.payment",
    });

    await expect(publish({ Records: [streamRecord("payment-stream", paymentEvent())] }))
      .resolves.toEqual({ batchItemFailures: [] });
    expect(sent[0]?.input.Entries?.[0]).toEqual(expect.objectContaining({
      Source: "aws-architecture-lab.payment",
      DetailType: "PaymentCaptured",
    }));
  });

  it("reports malformed records for retry without publishing them", async () => {
    const eventBridge = {
      async send() {
        throw new Error("Malformed records must not be published");
      },
    } as unknown as EventBridgeClient;
    const publish = createOutboxPublisher({
      eventBridge,
      eventBusName: "checkout-events",
      eventSource: "aws-architecture-lab.order",
    });

    await expect(publish({ Records: [streamRecord("stream-bad", { eventId: "bad" })] }))
      .resolves.toEqual({ batchItemFailures: [{ itemIdentifier: "stream-bad" }] });
  });
});

function streamRecord(eventID: string, event: Record<string, unknown>) {
  return {
    eventID: `event-id-${eventID}`,
    eventName: "INSERT" as const,
    eventSource: "aws:dynamodb",
    awsRegion: "us-east-1",
    eventSourceARN: "arn:aws:dynamodb:us-east-1:111122223333:table/outbox/stream/1",
    eventVersion: "1.1",
    dynamodb: {
      SequenceNumber: eventID,
      StreamViewType: "NEW_IMAGE",
      NewImage: marshall(event),
    },
  };
}

function orderPendingEvent(eventId: string, aggregateId: string) {
  return {
    eventId,
    eventType: "OrderPending",
    eventVersion: "1.0",
    occurredAt: "2026-09-08T12:00:00.000Z",
    correlationId: `corr-${aggregateId}`,
    causationId: `command-${aggregateId}`,
    aggregateType: "Order",
    aggregateId,
    payload: { status: "PENDING" },
  };
}

function inventoryEvent() {
  return {
    eventId: "inventory-event-1",
    eventType: "InventoryReserved",
    eventVersion: "1.0",
    occurredAt: "2026-09-09T12:00:00.000Z",
    correlationId: "corr-checkout-1",
    causationId: "execution-1",
    aggregateType: "InventoryReservation",
    aggregateId: "reservation-1",
    payload: {
      itemId: "sku-1",
      quantity: 1,
      status: "RESERVED",
      expiresAt: "2026-09-09T12:05:00.000Z",
    },
  };
}

function paymentEvent() {
  return {
    eventId: "payment-event-1",
    eventType: "PaymentCaptured",
    eventVersion: "1.0",
    occurredAt: "2026-09-10T12:00:00.000Z",
    correlationId: "corr-checkout-1",
    causationId: "execution-1",
    aggregateType: "Payment",
    aggregateId: "payment-1",
    payload: {
      checkoutId: "checkout-1",
      paymentId: "payment-1",
      providerReference: "fake-payment-payment-1",
      status: "CAPTURED",
    },
  };
}
