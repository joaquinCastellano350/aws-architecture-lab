import {
  GetCommand,
  PutCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";
import { describe, expect, it } from "vitest";

import { DynamoFulfillmentRepository } from "./dynamo-fulfillment-repository.js";

describe("Fulfillment persistence", () => {
  it("commits reservation and irreversible handoff with their outbox facts", async () => {
    const dynamo = new FulfillmentDynamoHarness();
    const fulfillment = repository(dynamo);

    await expect(fulfillment.execute(command("ReserveFulfillment", "reserve"))).resolves
      .toEqual(expect.objectContaining({ status: "RESERVED" }));
    await expect(fulfillment.execute(command("HandoffFulfillment", "handoff"))).resolves
      .toEqual(expect.objectContaining({ status: "HANDED_OFF" }));

    expect(dynamo.reservationStatus).toBe("HANDED_OFF");
    expect(dynamo.events.map(({ eventType }) => eventType)).toEqual([
      "FulfillmentReserved",
      "FulfillmentHandedOff",
    ]);
    expect(dynamo.commands.filter((item) => item instanceof TransactWriteCommand)).toHaveLength(2);
  });

  it("cancels a reversible reservation once and records a compensating fact", async () => {
    const dynamo = new FulfillmentDynamoHarness();
    const fulfillment = repository(dynamo);
    const cancel = command("CancelFulfillment", "compensate-fulfillment");

    await fulfillment.execute(command("ReserveFulfillment", "reserve"));
    const cancelled = await fulfillment.execute(cancel);
    const replay = await fulfillment.execute(cancel);

    expect(cancelled).toEqual(expect.objectContaining({ status: "CANCELLED" }));
    expect(replay).toEqual(cancelled);
    expect(dynamo.reservationStatus).toBe("CANCELLED");
    expect(dynamo.events.map(({ eventType }) => eventType)).toEqual([
      "FulfillmentReserved",
      "FulfillmentCancelled",
    ]);
    expect(dynamo.commands.filter((item) => item instanceof PutCommand)).toHaveLength(2);
    expect(dynamo.commands.filter((item) => item instanceof TransactWriteCommand)).toHaveLength(2);
  });

  it("records a typed rejection when cancellation reaches the irreversible pivot", async () => {
    const dynamo = new FulfillmentDynamoHarness();
    const fulfillment = repository(dynamo);
    const cancel = command("CancelFulfillment", "late-cancel");

    await fulfillment.execute(command("ReserveFulfillment", "reserve"));
    await fulfillment.execute(command("HandoffFulfillment", "handoff"));
    const rejected = await fulfillment.execute(cancel);

    expect(rejected).toEqual(expect.objectContaining({
      status: "RESERVATION_NOT_ACTIVE",
      reservationStatus: "HANDED_OFF",
    }));
    await expect(fulfillment.execute(cancel)).resolves.toEqual(rejected);
    expect(dynamo.events.map(({ eventType }) => eventType)).toEqual([
      "FulfillmentReserved",
      "FulfillmentHandedOff",
    ]);
  });

  it("returns the recorded outcome for duplicate delivery and rejects operation reuse", async () => {
    const dynamo = new FulfillmentDynamoHarness();
    const fulfillment = repository(dynamo);
    const reserve = command("ReserveFulfillment", "reserve-once");

    const first = await fulfillment.execute(reserve);
    const duplicate = await fulfillment.execute(reserve);

    expect(duplicate).toEqual(first);
    expect(dynamo.events).toHaveLength(1);
    await expect(fulfillment.execute({
      ...reserve,
      checkoutId: "different-checkout",
    })).rejects.toThrow("Fulfillment operation ID was reused with a different payload");
  });

  it("preserves transient transaction cancellation for the configured retry path", async () => {
    const conflict = new Error("transaction conflict");
    conflict.name = "TransactionCanceledException";
    Object.assign(conflict, { CancellationReasons: [{ Code: "TransactionConflict" }] });
    let gets = 0;
    const client = {
      async send(request: unknown) {
        if (request instanceof GetCommand) {
          gets += 1;
          return {};
        }
        if (request instanceof PutCommand) return {};
        if (request instanceof TransactWriteCommand) throw conflict;
        throw new Error("Unexpected DynamoDB command");
      },
    } as unknown as DynamoDBDocumentClient;
    const fulfillment = new DynamoFulfillmentRepository(
      "fulfillment",
      "fulfillment-outbox",
      { client },
    );

    await expect(fulfillment.execute(command("ReserveFulfillment", "reserve-conflict")))
      .rejects.toBe(conflict);
    expect(gets).toBe(2);
  });

  it("records a stable capacity rejection without reserving Fulfillment", async () => {
    const sent: unknown[] = [];
    const client = {
      async send(request: unknown) {
        sent.push(request);
        if (request instanceof GetCommand) {
          return request.input.TableName === "failure-plans"
            ? { Item: { effects: ["BUSINESS_REJECTION"] } }
            : {};
        }
        if (request instanceof PutCommand) return {};
        if (request instanceof TransactWriteCommand) return {};
        throw new Error("Unexpected DynamoDB command");
      },
    } as unknown as DynamoDBDocumentClient;
    const fulfillment = new DynamoFulfillmentRepository(
      "fulfillment",
      "fulfillment-outbox",
      { client, failurePlanTableName: "failure-plans" },
    );

    await expect(fulfillment.execute(command("ReserveFulfillment", "reserve-rejected")))
      .resolves.toEqual(expect.objectContaining({ status: "CAPACITY_UNAVAILABLE" }));
    const write = sent.find(
      (request): request is TransactWriteCommand => request instanceof TransactWriteCommand,
    );
    expect(write?.input.TransactItems).toEqual([
      expect.objectContaining({
        Update: expect.objectContaining({
          TableName: "fulfillment",
          ExpressionAttributeValues: expect.objectContaining({
            ":state": "FAILED",
            ":result": expect.objectContaining({ status: "CAPACITY_UNAVAILABLE" }),
          }),
        }),
      }),
    ]);
  });
});

function repository(client: FulfillmentDynamoHarness) {
  return new DynamoFulfillmentRepository("fulfillment", "fulfillment-outbox", {
    client: client as unknown as DynamoDBDocumentClient,
    clock: () => new Date("2026-09-11T12:00:00.000Z"),
    eventId: (() => {
      let sequence = 0;
      return () => `fulfillment-event-${++sequence}`;
    })(),
  });
}

function command(
  commandType: "ReserveFulfillment" | "CancelFulfillment" | "HandoffFulfillment",
  operationId: string,
) {
  return {
    schemaVersion: "1.0" as const,
    commandType,
    operationId,
    checkoutId: "checkout-123",
    reservationId: "fulfillment-checkout-123",
    correlationId: "corr-123",
    causationId: "execution-123",
  };
}

class FulfillmentDynamoHarness {
  readonly commands: unknown[] = [];
  readonly events: Record<string, unknown>[] = [];
  readonly #operations = new Map<string, Record<string, unknown>>();
  reservationStatus: string | undefined;

  async send(request: unknown): Promise<{ Item?: Record<string, unknown> }> {
    this.commands.push(request);
    if (request instanceof GetCommand) {
      const key = request.input.Key?.recordKey as string;
      if (key.startsWith("OPERATION#")) return { Item: this.#operations.get(key) };
      if (key.startsWith("RESERVATION#") && this.reservationStatus !== undefined) {
        return {
          Item: {
            recordKey: key,
            recordType: "RESERVATION",
            reservationId: "fulfillment-checkout-123",
            checkoutId: "checkout-123",
            correlationId: "corr-123",
            status: this.reservationStatus,
          },
        };
      }
      return {};
    }
    if (request instanceof PutCommand) {
      const record = request.input.Item as Record<string, unknown>;
      this.#operations.set(record.recordKey as string, structuredClone(record));
      return {};
    }
    if (!(request instanceof TransactWriteCommand)) {
      throw new Error("Unexpected DynamoDB command");
    }
    for (const item of request.input.TransactItems ?? []) {
      if (item.Put?.TableName === "fulfillment") {
        const record = item.Put.Item as Record<string, unknown>;
        if (record.recordType === "RESERVATION") this.reservationStatus = "RESERVED";
        if (record.recordType === "OPERATION") {
          this.#operations.set(record.recordKey as string, structuredClone(record));
        }
      }
      if (item.Put?.TableName === "fulfillment-outbox") {
        this.events.push(structuredClone(item.Put.Item as Record<string, unknown>));
      }
      if (item.Update?.TableName === "fulfillment") {
        const key = item.Update.Key?.recordKey as string;
        if (key.startsWith("OPERATION#")) {
          const operation = this.#operations.get(key);
          if (operation === undefined) throw transactionFailure();
          operation.state = item.Update.ExpressionAttributeValues?.[":state"];
          operation.result = structuredClone(
            item.Update.ExpressionAttributeValues?.[":result"] as Record<string, unknown>,
          );
          operation.updatedAt = item.Update.ExpressionAttributeValues?.[":updatedAt"];
        } else {
          if (this.reservationStatus !== "RESERVED") throw transactionFailure();
          this.reservationStatus = item.Update.ExpressionAttributeValues?.[":targetStatus"] as string;
        }
      }
    }
    return {};
  }
}

function transactionFailure(): Error {
  const error = new Error("transaction cancelled");
  error.name = "TransactionCanceledException";
  Object.assign(error, {
    CancellationReasons: [
      { Code: "ConditionalCheckFailed" },
      { Code: "None" },
      { Code: "None" },
    ],
  });
  return error;
}
