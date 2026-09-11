import {
  GetCommand,
  PutCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";
import { describe, expect, it } from "vitest";

import {
  createPendingOrder,
  markOrderConfirmed,
  markOrderExpired,
  markOrderInventoryUnavailable,
} from "./dynamo-order-repository.js";

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
    const transaction = sent.find(
      (command): command is TransactWriteCommand => command instanceof TransactWriteCommand,
    );
    expect(transaction?.input.TransactItems).toEqual([
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

  it("records the terminal Inventory outcome and Order fact atomically", async () => {
    const sent: unknown[] = [];
    const client = {
      async send(command: unknown) {
        sent.push(command);
        return {};
      },
    } as unknown as DynamoDBDocumentClient;

    const order = await markOrderInventoryUnavailable(
      "orders",
      "order-outbox",
      {
        schemaVersion: "1.0",
        commandType: "MarkOrderInventoryUnavailable",
        operationId: "mark-inventory-unavailable-checkout-123",
        checkoutId: "checkout-123",
        correlationId: "corr-123",
        causationId: "execution-123",
      },
      {
        client,
        clock: () => new Date("2026-09-09T12:00:00.000Z"),
        eventId: () => "event-unavailable",
      },
    );

    expect(order.status).toBe("INVENTORY_UNAVAILABLE");
    const transaction = sent.find(
      (command): command is TransactWriteCommand => command instanceof TransactWriteCommand,
    );
    expect(transaction?.input.TransactItems).toEqual([
      {
        Update: expect.objectContaining({
          TableName: "orders",
          Key: { checkoutId: "checkout-123" },
          ConditionExpression: "#status = :pending AND correlationId = :correlationId",
        }),
      },
      {
        Put: expect.objectContaining({
          TableName: "orders",
          Item: expect.objectContaining({
            recordType: "OPERATION",
            operationId: "mark-inventory-unavailable-checkout-123",
            payloadHash: expect.any(String),
            state: "SUCCEEDED",
            result: order,
          }),
        }),
      },
      {
        Put: expect.objectContaining({
          TableName: "order-outbox",
          Item: expect.objectContaining({
            eventId: "event-unavailable",
            eventType: "OrderInventoryUnavailable",
            payload: { status: "INVENTORY_UNAVAILABLE" },
          }),
        }),
      },
    ]);
  });

  it("records a truthful expired Order and immutable fact atomically", async () => {
    const sent: unknown[] = [];
    const client = {
      async send(command: unknown) {
        sent.push(command);
        return {};
      },
    } as unknown as DynamoDBDocumentClient;

    const order = await markOrderExpired(
      "orders",
      "order-outbox",
      {
        schemaVersion: "1.0",
        commandType: "MarkOrderExpired",
        operationId: "expire-order-checkout-123",
        checkoutId: "checkout-123",
        correlationId: "corr-123",
        causationId: "inventory-released-event-123",
      },
      {
        client,
        clock: () => new Date("2026-09-09T12:05:00.000Z"),
        eventId: () => "event-expired",
      },
    );

    expect(order.status).toBe("EXPIRED");
    const transaction = sent.find(
      (command): command is TransactWriteCommand => command instanceof TransactWriteCommand,
    );
    expect(transaction?.input.TransactItems).toEqual([
      {
        Update: expect.objectContaining({
          TableName: "orders",
          Key: { checkoutId: "checkout-123" },
          ConditionExpression: "#status = :pending AND correlationId = :correlationId",
        }),
      },
      {
        Put: expect.objectContaining({
          TableName: "orders",
          Item: expect.objectContaining({
            recordType: "OPERATION",
            operationId: "expire-order-checkout-123",
            state: "SUCCEEDED",
            result: order,
          }),
        }),
      },
      {
        Put: expect.objectContaining({
          TableName: "order-outbox",
          Item: expect.objectContaining({
            eventId: "event-expired",
            eventType: "OrderExpired",
            payload: { status: "EXPIRED" },
          }),
        }),
      },
    ]);
  });

  it("confirms the customer-visible Order and publishes the committed fact atomically", async () => {
    const sent: unknown[] = [];
    const client = {
      async send(command: unknown) {
        sent.push(command);
        return {};
      },
    } as unknown as DynamoDBDocumentClient;

    const order = await markOrderConfirmed("orders", "order-outbox", {
      schemaVersion: "1.0",
      commandType: "MarkOrderConfirmed",
      operationId: "confirm-order-checkout-123",
      checkoutId: "checkout-123",
      correlationId: "corr-123",
      causationId: "fulfillment-handoff-123",
    }, {
      client,
      clock: () => new Date("2026-09-11T12:00:00.000Z"),
      eventId: () => "event-confirmed",
    });

    expect(order.status).toBe("CONFIRMED");
    const transaction = sent.find(
      (command): command is TransactWriteCommand => command instanceof TransactWriteCommand,
    );
    expect(transaction?.input.TransactItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        Update: expect.objectContaining({
          ConditionExpression: "#status = :pending AND correlationId = :correlationId",
        }),
      }),
      expect.objectContaining({
        Put: expect.objectContaining({
          TableName: "order-outbox",
          Item: expect.objectContaining({
            eventId: "event-confirmed",
            eventType: "OrderConfirmed",
            payload: { status: "CONFIRMED" },
          }),
        }),
      }),
    ]));
  });

  it("returns the recorded unavailable Order when the transition repeats", async () => {
    const existingOrder = {
      checkoutId: "checkout-123",
      correlationId: "corr-123",
      status: "INVENTORY_UNAVAILABLE" as const,
      createdAt: "2026-09-09T11:59:00.000Z",
      updatedAt: "2026-09-09T12:00:00.000Z",
    };
    const client = {
      async send(command: unknown) {
        if (command instanceof TransactWriteCommand) {
          throw transactionCancellation(0, 3);
        }
        if (command instanceof GetCommand) {
          return command.input.Key?.checkoutId === "checkout-123"
            ? { Item: existingOrder }
            : {};
        }
        if (command instanceof PutCommand) return {};
        throw new Error("Unexpected command");
      },
    } as unknown as DynamoDBDocumentClient;

    await expect(markOrderInventoryUnavailable(
      "orders",
      "order-outbox",
      {
        schemaVersion: "1.0",
        commandType: "MarkOrderInventoryUnavailable",
        operationId: "mark-inventory-unavailable-checkout-123",
        checkoutId: "checkout-123",
        correlationId: "corr-123",
        causationId: "execution-123",
      },
      { client },
    )).resolves.toEqual({
      schemaVersion: "1.0",
      checkoutId: "checkout-123",
      correlationId: "corr-123",
      status: "INVENTORY_UNAVAILABLE",
    });
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
          throw transactionCancellation(0, 2);
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

  it("does not misclassify a transient transaction cancellation as an Order replay", async () => {
    const client = {
      async send(command: unknown) {
        if (command instanceof TransactWriteCommand) {
          const error = transactionCancellation(0, 2);
          Object.assign(error, {
            CancellationReasons: [{ Code: "TransactionConflict" }, { Code: "None" }],
          });
          throw error;
        }
        throw new Error("Transient cancellation must be propagated before a read");
      },
    } as unknown as DynamoDBDocumentClient;

    await expect(createPendingOrder(
      "orders",
      "order-outbox",
      {
        schemaVersion: "1.0",
        checkoutId: "checkout-conflict",
        cartId: "cart-conflict",
        correlationId: "corr-conflict",
      },
      { client },
    )).rejects.toMatchObject({ name: "TransactionCanceledException" });
  });
});

function transactionCancellation(index: number, length: number): Error {
  const error = new Error("transaction cancelled");
  error.name = "TransactionCanceledException";
  Object.assign(error, {
    CancellationReasons: Array.from({ length }, (_, reasonIndex) => ({
      Code: reasonIndex === index ? "ConditionalCheckFailed" : "None",
    })),
  });
  return error;
}
