import { randomUUID } from "node:crypto";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type {
  CommitInventoryCommand,
  InventoryCommandOutcome,
  ReleaseInventoryCommand,
  ReserveInventoryCommand,
} from "@aws-architecture-lab/contracts";

import { stablePayloadHash } from "./domain-command.js";

export type InventoryCommand =
  | ReserveInventoryCommand
  | CommitInventoryCommand
  | ReleaseInventoryCommand;

export interface InventoryRepositoryDependencies {
  readonly client?: DynamoDBDocumentClient;
  readonly clock?: () => Date;
  readonly eventId?: () => string;
  readonly expiryIndexName?: string;
  readonly initialQuantity?: number;
}

interface InventoryOperation {
  readonly recordKey: string;
  readonly recordType: "OPERATION";
  readonly operationId: string;
  readonly payloadHash: string;
  readonly state: "IN_PROGRESS" | "SUCCEEDED" | "FAILED";
  readonly result?: InventoryCommandOutcome;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface InventoryReservation {
  readonly recordKey: string;
  readonly recordType: "RESERVATION";
  readonly reservationId: string;
  readonly checkoutId: string;
  readonly correlationId: string;
  readonly itemId: string;
  readonly quantity: number;
  readonly status: "RESERVED" | "COMMITTED" | "RELEASED";
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class DynamoInventoryRepository {
  readonly #client: DynamoDBDocumentClient;
  readonly #clock: () => Date;
  readonly #eventId: () => string;
  readonly #expiryIndexName: string;
  readonly #initialQuantity: number;
  readonly #inventoryTableName: string;
  readonly #outboxTableName: string;

  public constructor(
    inventoryTableName: string,
    outboxTableName: string,
    dependencies: InventoryRepositoryDependencies = {},
  ) {
    const initialQuantity = dependencies.initialQuantity ?? 100;
    if (!Number.isInteger(initialQuantity) || initialQuantity < 1) {
      throw new Error("initialQuantity must be a positive integer");
    }
    this.#inventoryTableName = inventoryTableName;
    this.#outboxTableName = outboxTableName;
    this.#client = dependencies.client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
    this.#clock = dependencies.clock ?? (() => new Date());
    this.#eventId = dependencies.eventId ?? randomUUID;
    this.#expiryIndexName = dependencies.expiryIndexName ?? "ReservationExpiryIndex";
    this.#initialQuantity = initialQuantity;
  }

  public async execute(command: InventoryCommand): Promise<InventoryCommandOutcome> {
    const payloadHash = stablePayloadHash(command);
    const recorded = await this.#startOperation(command, payloadHash);
    if (recorded !== undefined) return recorded;

    switch (command.commandType) {
      case "ReserveInventory":
        return this.#reserve(command, payloadHash);
      case "CommitInventory":
        return this.#finalize(command, payloadHash, "COMMITTED");
      case "ReleaseInventory":
        return this.#finalize(command, payloadHash, "RELEASED");
    }
  }

  public async findExpiredReservations(
    cutoff: string,
    limit: number,
  ): Promise<readonly InventoryReservation[]> {
    if (Number.isNaN(Date.parse(cutoff))) {
      throw new Error("cutoff must be an ISO date-time");
    }
    const normalizedCutoff = new Date(cutoff).toISOString();
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("limit must be an integer from 1 through 100");
    }
    const result = await this.#client.send(new QueryCommand({
      TableName: this.#inventoryTableName,
      IndexName: this.#expiryIndexName,
      KeyConditionExpression: "#status = :reserved AND expiresAt <= :cutoff",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":reserved": "RESERVED", ":cutoff": normalizedCutoff },
      Limit: limit,
    }));
    return (result.Items ?? []) as InventoryReservation[];
  }

  async #reserve(
    command: ReserveInventoryCommand,
    payloadHash: string,
  ): Promise<InventoryCommandOutcome> {
    const now = this.#clock().toISOString();
    const outcome = inventoryOutcome(command, "RESERVED");
    const reservation: InventoryReservation = {
      recordKey: reservationKey(command.reservationId),
      recordType: "RESERVATION",
      reservationId: command.reservationId,
      checkoutId: command.checkoutId,
      correlationId: command.correlationId,
      itemId: command.itemId,
      quantity: command.quantity,
      status: "RESERVED",
      expiresAt: new Date(command.expiresAt).toISOString(),
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.#client.send(new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: this.#inventoryTableName,
              Key: { recordKey: stockKey(command.itemId) },
              UpdateExpression: "SET recordType = if_not_exists(recordType, :recordType), itemId = if_not_exists(itemId, :itemId), initialQuantity = if_not_exists(initialQuantity, :initialQuantity), availableQuantity = if_not_exists(availableQuantity, :initialQuantity) - :quantity, updatedAt = :updatedAt",
              ConditionExpression: "(:initialQuantity >= :quantity AND attribute_not_exists(recordKey)) OR availableQuantity >= :quantity",
              ExpressionAttributeValues: {
                ":recordType": "STOCK",
                ":itemId": command.itemId,
                ":initialQuantity": this.#initialQuantity,
                ":quantity": command.quantity,
                ":updatedAt": now,
              },
            },
          },
          putRecord(this.#inventoryTableName, reservation),
          completeOperation(this.#inventoryTableName, command.operationId, payloadHash, outcome, "SUCCEEDED", now),
          putEvent(this.#outboxTableName, inventoryEvent(command, "RESERVED", now, this.#eventId(), {
            itemId: command.itemId,
            quantity: command.quantity,
            expiresAt: command.expiresAt,
          })),
        ],
      }));
      return outcome;
    } catch (error) {
      if (!isTransactionCancellation(error)) throw error;
      const replay = await this.#operation(command.operationId);
      if (replay !== undefined && replay.state !== "IN_PROGRESS") {
        return recordedOutcome(replay, payloadHash);
      }
      if (!hasConditionalFailureAt(error, 0) && !hasConditionalFailureAt(error, 1)) throw error;
      const reservationConflict = await this.#reservation(command.reservationId);
      if (reservationConflict !== undefined) {
        return this.#recordFailure(
          command,
          payloadHash,
          "RESERVATION_NOT_ACTIVE",
          now,
          reservationConflict.status,
        );
      }
      return this.#recordFailure(command, payloadHash, "OUT_OF_STOCK", now);
    }
  }

  async #finalize(
    command: CommitInventoryCommand | ReleaseInventoryCommand,
    payloadHash: string,
    target: "COMMITTED" | "RELEASED",
  ): Promise<InventoryCommandOutcome> {
    const now = this.#clock().toISOString();
    const reservation = await this.#reservation(command.reservationId);
    if (reservation === undefined || reservation.checkoutId !== command.checkoutId) {
      return this.#recordFailure(command, payloadHash, "RESERVATION_NOT_ACTIVE", now);
    }
    const releaseReason = command.commandType === "ReleaseInventory"
      ? command.releaseReason ?? "COMPENSATION"
      : undefined;
    const expiredRelease = releaseReason === "CHECKOUT_EXPIRED";
    if (target === "COMMITTED" && Date.parse(reservation.expiresAt) <= Date.parse(now)) {
      return this.#recordFailure(
        command,
        payloadHash,
        "RESERVATION_NOT_ACTIVE",
        now,
        reservation.status,
      );
    }
    if (expiredRelease && Date.parse(reservation.expiresAt) > Date.parse(now)) {
      return this.#recordFailure(
        command,
        payloadHash,
        "RESERVATION_NOT_ACTIVE",
        now,
        reservation.status,
      );
    }
    const outcome = inventoryOutcome(command, target);
    const transaction = [
      {
        Update: {
          TableName: this.#inventoryTableName,
          Key: { recordKey: reservation.recordKey },
          UpdateExpression: expiredRelease
            ? "SET #status = :status, updatedAt = :updatedAt, cleanupAtEpochSeconds = :cleanupAtEpochSeconds"
            : "SET #status = :status, updatedAt = :updatedAt",
          ConditionExpression: target === "COMMITTED"
            ? "#status = :reserved AND expiresAt > :now"
            : expiredRelease
              ? "#status = :reserved AND expiresAt <= :now"
              : "#status = :reserved",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":reserved": "RESERVED",
            ":status": target,
            ":updatedAt": now,
            ...(target === "COMMITTED" || expiredRelease ? { ":now": now } : {}),
            ...(expiredRelease
              ? { ":cleanupAtEpochSeconds": Math.floor(Date.parse(now) / 1000) + 7 * 24 * 60 * 60 }
              : {}),
          },
        },
      },
      ...(target === "RELEASED" ? [{
        Update: {
          TableName: this.#inventoryTableName,
          Key: { recordKey: stockKey(reservation.itemId) },
          UpdateExpression: "SET availableQuantity = availableQuantity + :quantity, updatedAt = :updatedAt",
          ConditionExpression: "attribute_exists(recordKey)",
          ExpressionAttributeValues: {
            ":quantity": reservation.quantity,
            ":updatedAt": now,
          },
        },
      }] : []),
      completeOperation(this.#inventoryTableName, command.operationId, payloadHash, outcome, "SUCCEEDED", now),
      putEvent(this.#outboxTableName, inventoryEvent(command, target, now, this.#eventId(), {
        checkoutId: command.checkoutId,
        itemId: reservation.itemId,
        quantity: reservation.quantity,
        ...(releaseReason === undefined
          ? {}
          : { releaseReason }),
      })),
    ];
    try {
      await this.#client.send(new TransactWriteCommand({ TransactItems: transaction }));
      return outcome;
    } catch (error) {
      if (!isTransactionCancellation(error)) throw error;
      const replay = await this.#operation(command.operationId);
      if (replay !== undefined && replay.state !== "IN_PROGRESS") {
        return recordedOutcome(replay, payloadHash);
      }
      if (!hasConditionalFailureAt(error, 0)) throw error;
      const latestReservation = await this.#reservation(command.reservationId);
      if (
        target === "COMMITTED" &&
        latestReservation?.status === "RESERVED" &&
        Date.parse(latestReservation.expiresAt) <= Date.parse(now)
      ) {
        return this.#recordFailure(
          command,
          payloadHash,
          "RESERVATION_NOT_ACTIVE",
          now,
          latestReservation.status,
        );
      }
      return this.#recordFailure(
        command,
        payloadHash,
        "RESERVATION_NOT_ACTIVE",
        now,
        latestReservation?.status,
      );
    }
  }

  async #recordFailure(
    command: InventoryCommand,
    payloadHash: string,
    status: "OUT_OF_STOCK" | "RESERVATION_NOT_ACTIVE",
    now: string,
    reservationStatus?: InventoryReservation["status"],
  ): Promise<InventoryCommandOutcome> {
    const outcome: InventoryCommandOutcome = {
      ...inventoryOutcome(command, status),
      ...(reservationStatus === undefined ? {} : { reservationStatus }),
    };
    try {
      await this.#client.send(new UpdateCommand({
        TableName: this.#inventoryTableName,
        Key: { recordKey: operationKey(command.operationId) },
        UpdateExpression: "SET #state = :failed, #result = :result, updatedAt = :updatedAt",
        ConditionExpression: "#state = :inProgress AND payloadHash = :payloadHash",
        ExpressionAttributeNames: { "#state": "state", "#result": "result" },
        ExpressionAttributeValues: {
          ":failed": "FAILED",
          ":inProgress": "IN_PROGRESS",
          ":payloadHash": payloadHash,
          ":result": outcome,
          ":updatedAt": now,
        },
      }));
      return outcome;
    } catch (error) {
      if (!isConditionalConflict(error)) throw error;
      const replay = await this.#operation(command.operationId);
      if (replay === undefined) throw error;
      return recordedOutcome(replay, payloadHash);
    }
  }

  async #startOperation(
    command: InventoryCommand,
    payloadHash: string,
  ): Promise<InventoryCommandOutcome | undefined> {
    const existing = await this.#operation(command.operationId);
    if (existing !== undefined) {
      assertPayloadHash(existing, payloadHash);
      return existing.state === "IN_PROGRESS" ? undefined : recordedOutcome(existing, payloadHash);
    }
    const now = this.#clock().toISOString();
    try {
      await this.#client.send(new PutCommand({
        TableName: this.#inventoryTableName,
        Item: {
          recordKey: operationKey(command.operationId),
          recordType: "OPERATION",
          operationId: command.operationId,
          payloadHash,
          state: "IN_PROGRESS",
          createdAt: now,
          updatedAt: now,
        } satisfies InventoryOperation,
        ConditionExpression: "attribute_not_exists(recordKey)",
      }));
      return undefined;
    } catch (error) {
      if (!isConditionalConflict(error)) throw error;
      const concurrent = await this.#operation(command.operationId);
      if (concurrent === undefined) throw error;
      assertPayloadHash(concurrent, payloadHash);
      return concurrent.state === "IN_PROGRESS"
        ? undefined
        : recordedOutcome(concurrent, payloadHash);
    }
  }

  async #operation(operationId: string): Promise<InventoryOperation | undefined> {
    const result = await this.#client.send(new GetCommand({
      TableName: this.#inventoryTableName,
      Key: { recordKey: operationKey(operationId) },
      ConsistentRead: true,
    }));
    return result.Item as InventoryOperation | undefined;
  }

  async #reservation(reservationId: string): Promise<InventoryReservation | undefined> {
    const result = await this.#client.send(new GetCommand({
      TableName: this.#inventoryTableName,
      Key: { recordKey: reservationKey(reservationId) },
      ConsistentRead: true,
    }));
    return result.Item as InventoryReservation | undefined;
  }
}

function completeOperation(
  tableName: string,
  operationId: string,
  payloadHash: string,
  result: InventoryCommandOutcome,
  state: "SUCCEEDED" | "FAILED",
  now: string,
) {
  return {
    Update: {
      TableName: tableName,
      Key: { recordKey: operationKey(operationId) },
      UpdateExpression: "SET #state = :state, #result = :result, updatedAt = :updatedAt",
      ConditionExpression: "#state = :inProgress AND payloadHash = :payloadHash",
      ExpressionAttributeNames: { "#state": "state", "#result": "result" },
      ExpressionAttributeValues: {
        ":state": state,
        ":inProgress": "IN_PROGRESS",
        ":payloadHash": payloadHash,
        ":result": result,
        ":updatedAt": now,
      },
    },
  };
}

function inventoryOutcome(
  command: InventoryCommand,
  status: InventoryCommandOutcome["status"],
): InventoryCommandOutcome {
  return {
    schemaVersion: "1.0",
    operationId: command.operationId,
    checkoutId: command.checkoutId,
    reservationId: command.reservationId,
    status,
  };
}

function inventoryEvent(
  command: InventoryCommand,
  status: "RESERVED" | "COMMITTED" | "RELEASED",
  occurredAt: string,
  eventId: string,
  payload: Readonly<Record<string, unknown>>,
) {
  return {
    eventId,
    eventType: `Inventory${status[0]}${status.slice(1).toLowerCase()}`,
    eventVersion: "1.0",
    occurredAt,
    correlationId: command.correlationId,
    causationId: command.causationId,
    aggregateType: "InventoryReservation",
    aggregateId: command.reservationId,
    payload: { ...payload, status },
  };
}

function putRecord<T extends object>(tableName: string, item: T) {
  return {
    Put: {
      TableName: tableName,
      Item: item,
      ConditionExpression: "attribute_not_exists(recordKey)",
    },
  };
}

function putEvent<T extends object>(tableName: string, item: T) {
  return {
    Put: {
      TableName: tableName,
      Item: item,
      ConditionExpression: "attribute_not_exists(eventId)",
    },
  };
}

function recordedOutcome(recorded: InventoryOperation, payloadHash: string): InventoryCommandOutcome {
  assertPayloadHash(recorded, payloadHash);
  if (recorded.result === undefined) throw new Error("Inventory operation is still in progress");
  return recorded.result;
}

function assertPayloadHash(recorded: InventoryOperation, payloadHash: string): void {
  if (recorded.payloadHash !== payloadHash) {
    throw new Error("Inventory operation ID was reused with a different payload");
  }
}

function stockKey(itemId: string): string {
  return `STOCK#${itemId}`;
}

function reservationKey(reservationId: string): string {
  return `RESERVATION#${reservationId}`;
}

function operationKey(operationId: string): string {
  return `OPERATION#${operationId}`;
}

function isTransactionCancellation(error: unknown): boolean {
  return error instanceof Error && error.name === "TransactionCanceledException";
}

function hasConditionalFailureAt(error: unknown, index: number): boolean {
  if (!isTransactionCancellation(error)) return false;
  const reasons = (error as Error & {
    readonly CancellationReasons?: ReadonlyArray<{ readonly Code?: string }>;
  }).CancellationReasons;
  return reasons?.[index]?.Code === "ConditionalCheckFailed" && reasons.every(
    (reason) => reason.Code === "None" || reason.Code === "ConditionalCheckFailed",
  );
}

function isConditionalConflict(error: unknown): boolean {
  return error instanceof Error && error.name === "ConditionalCheckFailedException";
}
