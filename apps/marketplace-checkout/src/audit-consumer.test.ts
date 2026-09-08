import { PutCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";

import { createAuditConsumer } from "./audit-consumer.js";

describe("Order audit consumer", () => {
  it("deduplicates repeated delivery by eventId without losing distinct events", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const audited = new Map<string, Record<string, unknown>>();
    const client = {
      async send(command: unknown) {
        if (!(command instanceof PutCommand)) throw new Error("Unexpected command");
        const item = command.input.Item as Record<string, unknown>;
        const eventId = item.eventId as string;
        if (audited.has(eventId)) {
          const duplicate = new Error("already observed");
          duplicate.name = "ConditionalCheckFailedException";
          throw duplicate;
        }
        audited.set(eventId, item);
        return {};
      },
    } as unknown as DynamoDBDocumentClient;
    const consume = createAuditConsumer({
      client,
      eventSource: "aws-architecture-lab.order",
      tableName: "order-audit",
    });

    await consume(delivery("delivery-1", "event-1", "checkout-1"));
    await consume(delivery("delivery-duplicate", "event-1", "checkout-1"));
    await consume(delivery("delivery-2", "event-2", "checkout-2"));

    expect([...audited.values()]).toEqual([
      {
        eventId: "event-1",
        eventType: "OrderPending",
        eventVersion: "1.0",
        occurredAt: "2026-09-08T12:00:00.000Z",
        correlationId: "corr-checkout-1",
        causationId: "command-checkout-1",
        aggregateType: "Order",
        aggregateId: "checkout-1",
        payload: { status: "PENDING" },
      },
      {
        eventId: "event-2",
        eventType: "OrderPending",
        eventVersion: "1.0",
        occurredAt: "2026-09-08T12:00:00.000Z",
        correlationId: "corr-checkout-2",
        causationId: "command-checkout-2",
        aggregateType: "Order",
        aggregateId: "checkout-2",
        payload: { status: "PENDING" },
      },
    ]);
    expect(log.mock.calls.map(([message]) => JSON.parse(message as string))).toEqual([
      { event: "OrderEventAudited", eventId: "event-1" },
      { event: "OrderEventDuplicateIgnored", eventId: "event-1" },
      { event: "OrderEventAudited", eventId: "event-2" },
    ]);
    log.mockRestore();
  });
});

function delivery(id: string, eventId: string, aggregateId: string) {
  return {
    id,
    version: "0",
    account: "111122223333",
    time: "2026-09-08T12:00:01.000Z",
    region: "us-east-1",
    resources: [],
    source: "aws-architecture-lab.order",
    "detail-type": "OrderPending" as const,
    detail: {
      eventId,
      eventVersion: "1.0",
      occurredAt: "2026-09-08T12:00:00.000Z",
      correlationId: `corr-${aggregateId}`,
      causationId: `command-${aggregateId}`,
      aggregateType: "Order",
      aggregateId,
      payload: { status: "PENDING" },
    },
  };
}
