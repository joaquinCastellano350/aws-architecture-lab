import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";
import { describe, expect, it } from "vitest";

import { DynamoInventoryRepository } from "./dynamo-inventory-repository.js";

describe("Inventory persistence", () => {
  it("allows exactly one checkout to reserve the final unit", async () => {
    const dynamo = new InventoryDynamoHarness(1);
    const inventory = repository(dynamo);

    const outcomes = await Promise.all([
      inventory.execute(reserveCommand("reserve-a", "reservation-a", "checkout-a")),
      inventory.execute(reserveCommand("reserve-b", "reservation-b", "checkout-b")),
    ]);

    expect(outcomes.map(({ status }) => status).sort()).toEqual(["OUT_OF_STOCK", "RESERVED"]);
    expect(dynamo.availableQuantity("sku-final")).toBe(0);
    expect(dynamo.recordsOfType("RESERVATION")).toHaveLength(1);
    expect(dynamo.recordsOfType("OPERATION")).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operationId: "reserve-a",
        payloadHash: expect.any(String),
        state: expect.stringMatching(/SUCCEEDED|FAILED/),
        result: expect.any(Object),
        createdAt: "2026-09-09T12:00:00.000Z",
        updatedAt: "2026-09-09T12:00:00.000Z",
      }),
      expect.objectContaining({
        operationId: "reserve-b",
        payloadHash: expect.any(String),
        state: expect.stringMatching(/SUCCEEDED|FAILED/),
        result: expect.any(Object),
      }),
    ]));
  });

  it("returns a stable result for an identical operation and rejects a changed payload", async () => {
    const dynamo = new InventoryDynamoHarness(2);
    const inventory = repository(dynamo);
    const command = reserveCommand("reserve-once", "reservation-once", "checkout-once");

    const first = await inventory.execute(command);
    const repeated = await inventory.execute(command);

    expect(repeated).toEqual(first);
    expect(dynamo.availableQuantity("sku-final")).toBe(1);
    expect(dynamo.events).toHaveLength(1);
    await expect(inventory.execute({ ...command, quantity: 2 })).rejects.toThrow(
      "Inventory operation ID was reused with a different payload",
    );
  });

  it("propagates transient transaction conflicts instead of recording false business outcomes", async () => {
    const dynamo = new InventoryDynamoHarness(1);
    const inventory = repository(dynamo);
    const command = reserveCommand("reserve-after-conflict", "reservation-after-conflict", "checkout-after-conflict");
    dynamo.failNextTransactionWith("TransactionConflict");

    await expect(inventory.execute(command)).rejects.toMatchObject({
      name: "TransactionCanceledException",
    });
    expect(dynamo.recordsOfType("OPERATION")).toEqual([
      expect.objectContaining({ operationId: command.operationId, state: "IN_PROGRESS" }),
    ]);
    await expect(inventory.execute(command)).resolves.toEqual(expect.objectContaining({
      status: "RESERVED",
    }));
    expect(dynamo.availableQuantity(command.itemId)).toBe(0);
  });

  it("records a stable rejection when a different operation reuses a reservation ID", async () => {
    const dynamo = new InventoryDynamoHarness(2);
    const inventory = repository(dynamo);
    await inventory.execute(reserveCommand("reserve-original", "reservation-shared", "checkout-original"));
    const conflicting = reserveCommand("reserve-conflicting", "reservation-shared", "checkout-conflicting");

    const first = await inventory.execute(conflicting);
    const repeated = await inventory.execute(conflicting);

    expect(first.status).toBe("RESERVATION_NOT_ACTIVE");
    expect(repeated).toEqual(first);
    expect(dynamo.events).toHaveLength(1);
    expect(dynamo.recordsOfType("OPERATION")).toContainEqual(expect.objectContaining({
      operationId: "reserve-conflicting",
      state: "FAILED",
      result: first,
    }));
  });

  it("lets only one competing commit or release finalize a reservation", async () => {
    const dynamo = new InventoryDynamoHarness(1);
    const inventory = repository(dynamo);
    await inventory.execute(reserveCommand("reserve-finalize", "reservation-finalize", "checkout-finalize"));

    const commit = transitionCommand("CommitInventory", "commit-finalize");
    const release = transitionCommand("ReleaseInventory", "release-finalize");
    const outcomes = await Promise.all([inventory.execute(commit), inventory.execute(release)]);

    expect(outcomes.map(({ status }) => status)).toEqual(["COMMITTED", "RESERVATION_NOT_ACTIVE"]);
    expect(outcomes[1]).toEqual(expect.objectContaining({ reservationStatus: "COMMITTED" }));
    expect(dynamo.availableQuantity("sku-final")).toBe(0);
    expect(dynamo.reservationStatus("reservation-finalize")).toBe("COMMITTED");
    expect(await inventory.execute(commit)).toEqual(outcomes[0]);
    expect(await inventory.execute(release)).toEqual(outcomes[1]);
  });

  it("rejects a commit after the business deadline and keeps the reservation releasable", async () => {
    const dynamo = new InventoryDynamoHarness(1);
    await repository(dynamo).execute(
      reserveCommand("reserve-deadline", "reservation-deadline", "checkout-deadline"),
    );
    const lateInventory = new DynamoInventoryRepository("inventory", "inventory-outbox", {
      client: dynamo as unknown as DynamoDBDocumentClient,
      clock: () => new Date("2026-09-09T12:06:00.000Z"),
      eventId: () => "inventory-event-after-deadline",
      initialQuantity: 1,
    });
    const commit = {
      ...transitionCommand("CommitInventory", "commit-after-deadline"),
      checkoutId: "checkout-deadline",
      reservationId: "reservation-deadline",
      correlationId: "corr-checkout-deadline",
    };

    const first = await lateInventory.execute(commit);
    const repeated = await lateInventory.execute(commit);

    expect(first.status).toBe("RESERVATION_NOT_ACTIVE");
    expect(first).toEqual(expect.objectContaining({ reservationStatus: "RESERVED" }));
    expect(repeated).toEqual(first);
    expect(dynamo.reservationStatus("reservation-deadline")).toBe("RESERVED");
    expect(dynamo.availableQuantity("sku-final")).toBe(0);
  });

  it("restores stock once when a release command is delivered repeatedly", async () => {
    const dynamo = new InventoryDynamoHarness(1);
    const inventory = repository(dynamo);
    await inventory.execute(reserveCommand("reserve-release", "reservation-release", "checkout-release"));
    const release = {
      ...transitionCommand("ReleaseInventory", "release-once"),
      reservationId: "reservation-release",
      checkoutId: "checkout-release",
    };

    const first = await inventory.execute(release);
    const repeated = await inventory.execute(release);

    expect(first.status).toBe("RELEASED");
    expect(repeated).toEqual(first);
    expect(dynamo.availableQuantity("sku-final")).toBe(1);
  });

  it("adds eventual-cleanup TTL only when expiry releases a reservation", async () => {
    const dynamo = new InventoryDynamoHarness(1);
    const inventory = repository(dynamo);
    await inventory.execute({
      ...reserveCommand("reserve-expired", "reservation-expired", "checkout-expired"),
      expiresAt: "2026-09-09T11:59:59.999Z",
    });

    await inventory.execute({
      ...transitionCommand("ReleaseInventory", "expire-sweep-reservation-expired"),
      checkoutId: "checkout-expired",
      reservationId: "reservation-expired",
      correlationId: "corr-checkout-expired",
      releaseReason: "CHECKOUT_EXPIRED",
    });

    const transaction = dynamo.commands.filter(
      (command): command is TransactWriteCommand => command instanceof TransactWriteCommand,
    ).at(-1);
    expect(transaction?.input.TransactItems?.[0]?.Update).toEqual(expect.objectContaining({
      ConditionExpression: "#status = :reserved AND expiresAt <= :now",
      UpdateExpression: expect.stringContaining("cleanupAtEpochSeconds = :cleanupAtEpochSeconds"),
      ExpressionAttributeValues: expect.objectContaining({
        ":cleanupAtEpochSeconds": 1_789_560_000,
      }),
    }));
    expect(dynamo.events.at(-1)).toEqual(expect.objectContaining({
      eventType: "InventoryReleased",
      payload: expect.objectContaining({
        checkoutId: "checkout-expired",
        releaseReason: "CHECKOUT_EXPIRED",
      }),
    }));
  });

  it("rejects an expiry release before the exact business deadline", async () => {
    const dynamo = new InventoryDynamoHarness(1);
    const inventory = repository(dynamo);
    await inventory.execute(
      reserveCommand("reserve-not-due", "reservation-not-due", "checkout-not-due"),
    );

    const outcome = await inventory.execute({
      ...transitionCommand("ReleaseInventory", "expire-sweep-reservation-not-due"),
      checkoutId: "checkout-not-due",
      reservationId: "reservation-not-due",
      correlationId: "corr-checkout-not-due",
      releaseReason: "CHECKOUT_EXPIRED",
    });

    expect(outcome).toEqual(expect.objectContaining({
      status: "RESERVATION_NOT_ACTIVE",
      reservationStatus: "RESERVED",
    }));
    expect(dynamo.reservationStatus("reservation-not-due")).toBe("RESERVED");
    expect(dynamo.availableQuantity("sku-final")).toBe(0);
    expect(dynamo.events).toHaveLength(1);
  });

  it("returns one stable result to concurrent duplicate commit and release deliveries", async () => {
    const dynamo = new InventoryDynamoHarness(2);
    const inventory = repository(dynamo);
    await inventory.execute(reserveCommand("reserve-commit-duplicate", "reservation-commit-duplicate", "checkout-commit-duplicate"));
    const commit = {
      ...transitionCommand("CommitInventory", "commit-duplicate"),
      reservationId: "reservation-commit-duplicate",
      checkoutId: "checkout-commit-duplicate",
      correlationId: "corr-checkout-commit-duplicate",
    };

    const commits = await Promise.all([inventory.execute(commit), inventory.execute(commit)]);
    expect(commits.map(({ status }) => status)).toEqual(["COMMITTED", "COMMITTED"]);

    await inventory.execute(reserveCommand("reserve-release-duplicate", "reservation-release-duplicate", "checkout-release-duplicate"));
    const release = {
      ...transitionCommand("ReleaseInventory", "release-duplicate"),
      reservationId: "reservation-release-duplicate",
      checkoutId: "checkout-release-duplicate",
      correlationId: "corr-checkout-release-duplicate",
    };
    const releases = await Promise.all([inventory.execute(release), inventory.execute(release)]);

    expect(releases.map(({ status }) => status)).toEqual(["RELEASED", "RELEASED"]);
    expect(dynamo.availableQuantity("sku-final")).toBe(1);
    expect(dynamo.events).toHaveLength(4);
  });

  it("uses conditional transactions for state, ledger, and outbox facts", async () => {
    const dynamo = new InventoryDynamoHarness(3);
    await repository(dynamo).execute(reserveCommand("reserve-atomic", "reservation-atomic", "checkout-atomic"));

    const transaction = dynamo.commands.find(
      (command): command is TransactWriteCommand => command instanceof TransactWriteCommand,
    );
    expect(transaction?.input.TransactItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        Update: expect.objectContaining({
          ConditionExpression: expect.stringContaining("availableQuantity >= :quantity"),
        }),
      }),
      expect.objectContaining({ Put: expect.objectContaining({ TableName: "inventory" }) }),
      expect.objectContaining({ Put: expect.objectContaining({
        TableName: "inventory-outbox",
        ConditionExpression: "attribute_not_exists(eventId)",
      }) }),
    ]));
    expect(transaction?.input.TransactItems?.[0]?.Update?.ConditionExpression)
      .toContain(":initialQuantity >= :quantity");
  });

  it("queries only RESERVED reservations whose business expiry is due", async () => {
    const sent: unknown[] = [];
    const client = {
      async send(command: unknown) {
        sent.push(command);
        if (command instanceof QueryCommand) {
          return {
            Items: [{
              recordKey: "RESERVATION#reservation-expired",
              recordType: "RESERVATION",
              reservationId: "reservation-expired",
              checkoutId: "checkout-expired",
              correlationId: "corr-expired",
              itemId: "sku-expired",
              quantity: 1,
              status: "RESERVED",
              expiresAt: "2026-09-09T11:59:00.000Z",
              createdAt: "2026-09-09T11:55:00.000Z",
              updatedAt: "2026-09-09T11:55:00.000Z",
            }],
          };
        }
        throw new Error("Unexpected DynamoDB command");
      },
    } as unknown as DynamoDBDocumentClient;
    const inventory = new DynamoInventoryRepository("inventory", "inventory-outbox", {
      client,
      expiryIndexName: "ReservationExpiryIndex",
    });

    await expect(inventory.findExpiredReservations("2026-09-09T12:00:00.000Z", 25)).resolves.toEqual([
      expect.objectContaining({ reservationId: "reservation-expired", status: "RESERVED" }),
    ]);
    expect(sent).toEqual([
      expect.objectContaining({
        input: expect.objectContaining({
          TableName: "inventory",
          IndexName: "ReservationExpiryIndex",
          KeyConditionExpression: "#status = :reserved AND expiresAt <= :cutoff",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":reserved": "RESERVED", ":cutoff": "2026-09-09T12:00:00.000Z" },
          Limit: 25,
        }),
      }),
    ]);
  });
});

function repository(client: InventoryDynamoHarness) {
  return new DynamoInventoryRepository("inventory", "inventory-outbox", {
    client: client as unknown as DynamoDBDocumentClient,
    clock: () => new Date("2026-09-09T12:00:00.000Z"),
    eventId: (() => {
      let sequence = 0;
      return () => `inventory-event-${++sequence}`;
    })(),
    initialQuantity: client.initialQuantity,
  });
}

function reserveCommand(operationId: string, reservationId: string, checkoutId: string) {
  return {
    schemaVersion: "1.0" as const,
    commandType: "ReserveInventory" as const,
    operationId,
    checkoutId,
    reservationId,
    itemId: "sku-final",
    quantity: 1,
    expiresAt: "2026-09-09T12:05:00.000Z",
    correlationId: `corr-${checkoutId}`,
    causationId: "execution-123",
  };
}

function transitionCommand(
  commandType: "CommitInventory" | "ReleaseInventory",
  operationId: string,
) {
  return {
    schemaVersion: "1.0" as const,
    commandType,
    operationId,
    checkoutId: "checkout-finalize",
    reservationId: "reservation-finalize",
    ...(commandType === "ReleaseInventory" ? { releaseReason: "COMPENSATION" as const } : {}),
    correlationId: "corr-checkout-finalize",
    causationId: "execution-123",
  };
}

class InventoryDynamoHarness {
  readonly commands: unknown[] = [];
  readonly events: Record<string, unknown>[] = [];
  readonly #records = new Map<string, Record<string, unknown>>();
  readonly initialQuantity: number;
  #nextTransactionFailure: string | undefined;

  constructor(initialQuantity: number) {
    this.initialQuantity = initialQuantity;
  }

  async send(command: unknown): Promise<{ Item?: Record<string, unknown> }> {
    this.commands.push(command);
    if (command instanceof GetCommand) {
      return { Item: this.#records.get(command.input.Key?.recordKey as string) };
    }
    if (command instanceof PutCommand) {
      const item = command.input.Item as Record<string, unknown>;
      const key = item.recordKey as string;
      if (this.#records.has(key)) throw conditionalFailure();
      this.#records.set(key, structuredClone(item));
      return {};
    }
    if (command instanceof UpdateCommand) {
      this.#update(this.#records, command.input);
      return {};
    }
    if (command instanceof TransactWriteCommand) {
      if (this.#nextTransactionFailure !== undefined) {
        const reason = this.#nextTransactionFailure;
        this.#nextTransactionFailure = undefined;
        throw transactionFailure(0, command.input.TransactItems?.length ?? 1, reason);
      }
      this.#transact(command);
      return {};
    }
    throw new Error("Unexpected DynamoDB command");
  }

  failNextTransactionWith(reason: string): void {
    this.#nextTransactionFailure = reason;
  }

  availableQuantity(itemId: string): number {
    return (this.#records.get(`STOCK#${itemId}`)?.availableQuantity as number | undefined)
      ?? this.initialQuantity;
  }

  reservationStatus(reservationId: string): unknown {
    return this.#records.get(`RESERVATION#${reservationId}`)?.status;
  }

  recordsOfType(recordType: string): Record<string, unknown>[] {
    return [...this.#records.values()].filter((record) => record.recordType === recordType);
  }

  #transact(command: TransactWriteCommand): void {
    const records = new Map(
      [...this.#records].map(([key, value]) => [key, structuredClone(value)]),
    );
    const events = this.events.map((event) => structuredClone(event));
    const operations = command.input.TransactItems ?? [];
    for (const [index, operation] of operations.entries()) {
      try {
        if (operation.Update !== undefined) this.#update(records, operation.Update);
        if (operation.Put !== undefined) {
          const item = operation.Put.Item as Record<string, unknown>;
          if (operation.Put.TableName === "inventory-outbox") {
            if (events.some((event) => event.eventId === item.eventId)) throw conditionalFailure();
            events.push(structuredClone(item));
          } else {
            const key = item.recordKey as string;
            if (records.has(key)) throw conditionalFailure();
            records.set(key, structuredClone(item));
          }
        }
      } catch {
        throw transactionFailure(index, operations.length);
      }
    }
    this.#records.clear();
    for (const [key, value] of records) this.#records.set(key, value);
    this.events.splice(0, this.events.length, ...events);
  }

  #update(records: Map<string, Record<string, unknown>>, update: NonNullable<NonNullable<TransactWriteCommand["input"]["TransactItems"]>[number]["Update"]>): void {
    const key = update.Key?.recordKey as string;
    const values = update.ExpressionAttributeValues as Record<string, unknown>;
    if (key.startsWith("OPERATION#")) {
      const operation = records.get(key);
      if (
        operation?.state !== "IN_PROGRESS" ||
        operation.payloadHash !== values[":payloadHash"]
      ) throw conditionalFailure();
      records.set(key, {
        ...operation,
        state: values[":state"] ?? values[":failed"],
        result: values[":result"],
        updatedAt: values[":updatedAt"],
      });
      return;
    }
    if (key.startsWith("STOCK#")) {
      const current = records.get(key);
      const available = (current?.availableQuantity as number | undefined) ?? this.initialQuantity;
      const quantity = values[":quantity"] as number;
      const change = update.UpdateExpression?.includes("+ :quantity") ? quantity : -quantity;
      if (change < 0 && available < quantity) throw conditionalFailure();
      records.set(key, {
        ...current,
        recordKey: key,
        recordType: "STOCK",
        itemId: values[":itemId"] ?? current?.itemId,
        availableQuantity: available + change,
        updatedAt: values[":updatedAt"],
      });
      return;
    }
    const reservation = records.get(key);
    if (reservation?.status !== "RESERVED") throw conditionalFailure();
    if (typeof values[":now"] === "string" && typeof reservation.expiresAt === "string") {
      const expiresAt = reservation.expiresAt;
      const now = values[":now"];
      if (update.ConditionExpression?.includes("expiresAt > :now") && expiresAt <= now) {
        throw conditionalFailure();
      }
      if (update.ConditionExpression?.includes("expiresAt <= :now") && expiresAt > now) {
        throw conditionalFailure();
      }
    }
    records.set(key, { ...reservation, status: values[":status"], updatedAt: values[":updatedAt"] });
  }
}

function conditionalFailure(): Error {
  const error = new Error("conditional check failed");
  error.name = "ConditionalCheckFailedException";
  return error;
}

function transactionFailure(
  index: number,
  length: number,
  reason = "ConditionalCheckFailed",
): Error {
  const error = new Error("transaction cancelled");
  error.name = "TransactionCanceledException";
  Object.assign(error, {
    CancellationReasons: Array.from({ length }, (_, reasonIndex) => ({
      Code: reasonIndex === index ? reason : "None",
    })),
  });
  return error;
}
