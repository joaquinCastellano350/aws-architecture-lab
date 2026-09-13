import {
  GetCommand,
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
        Put: expect.objectContaining({
          TableName: "fulfillment",
          Item: expect.objectContaining({
            recordType: "OPERATION",
            state: "FAILED",
            result: expect.objectContaining({ status: "CAPACITY_UNAVAILABLE" }),
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
  commandType: "ReserveFulfillment" | "HandoffFulfillment",
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
        if (this.reservationStatus !== "RESERVED") throw transactionFailure();
        this.reservationStatus = "HANDED_OFF";
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
