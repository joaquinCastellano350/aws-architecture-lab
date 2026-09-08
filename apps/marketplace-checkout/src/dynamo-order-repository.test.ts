import { GetCommand, TransactWriteCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it } from "vitest";

import { createPendingOrder } from "./dynamo-order-repository.js";

describe("Order persistence", () => {
  it("commits the pending Order and immutable domain event in one transaction", async () => {
    const sent: unknown[] = [];
    const client = {
      async send(command: unknown) {
        sent.push(command);
        return {};
      },
    } as unknown as DynamoDBDocumentClient;

    const order = await createPendingOrder(
      "orders",
      "order-outbox",
      {
        schemaVersion: "1.0",
        checkoutId: "checkout-123",
        cartId: "cart-123",
        correlationId: "corr-123",
        causationId: "command-123",
      },
      {
        client,
        clock: () => new Date("2026-09-08T12:00:00.000Z"),
        eventId: () => "event-123",
      },
    );

    expect(order).toEqual({
      checkoutId: "checkout-123",
      correlationId: "corr-123",
      status: "PENDING",
      createdAt: "2026-09-08T12:00:00.000Z",
      updatedAt: "2026-09-08T12:00:00.000Z",
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toBeInstanceOf(TransactWriteCommand);
    expect((sent[0] as TransactWriteCommand).input.TransactItems).toEqual([
      {
        Put: {
          TableName: "orders",
          Item: order,
          ConditionExpression: "attribute_not_exists(checkoutId)",
        },
      },
      {
        Put: {
          TableName: "order-outbox",
          Item: {
            eventId: "event-123",
            eventType: "OrderPending",
            eventVersion: "1.0",
            occurredAt: "2026-09-08T12:00:00.000Z",
            correlationId: "corr-123",
            causationId: "command-123",
            aggregateType: "Order",
            aggregateId: "checkout-123",
            payload: { status: "PENDING" },
          },
          ConditionExpression: "attribute_not_exists(eventId)",
        },
      },
    ]);
  });

  it("returns the recorded Order when an idempotent command repeats", async () => {
    const existingOrder = {
      checkoutId: "checkout-123",
      correlationId: "corr-123",
      status: "PENDING" as const,
      createdAt: "2026-09-08T12:00:00.000Z",
      updatedAt: "2026-09-08T12:00:00.000Z",
    };
    const client = {
      async send(command: unknown) {
        if (command instanceof TransactWriteCommand) {
          const conflict = new Error("already committed");
          conflict.name = "TransactionCanceledException";
          throw conflict;
        }
        if (command instanceof GetCommand) return { Item: existingOrder };
        throw new Error("Unexpected command");
      },
    } as unknown as DynamoDBDocumentClient;

    await expect(createPendingOrder(
      "orders",
      "order-outbox",
      {
        schemaVersion: "1.0",
        checkoutId: "checkout-123",
        cartId: "cart-123",
        correlationId: "corr-123",
        causationId: "command-123",
      },
      { client },
    )).resolves.toEqual(existingOrder);
  });
});
