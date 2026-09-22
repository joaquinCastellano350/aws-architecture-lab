import { randomUUID } from "node:crypto";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import type {
  FulfillmentCommand,
  FulfillmentCommandOutcome,
} from "@aws-architecture-lab/contracts";

import { stablePayloadHash } from "./domain-command.js";

export class DynamoFulfillmentRepository {
  readonly #client: DynamoDBDocumentClient;
  readonly #clock: () => Date;
  readonly #eventId: () => string;
  readonly #failurePlanTableName: string | undefined;

  public constructor(
    readonly tableName: string,
    readonly outboxTableName: string,
    dependencies: FulfillmentRepositoryDependencies = {},
  ) {
    this.#client = dependencies.client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
    this.#clock = dependencies.clock ?? (() => new Date());
    this.#eventId = dependencies.eventId ?? randomUUID;
    this.#failurePlanTableName = dependencies.failurePlanTableName;
  }

  public async execute(command: FulfillmentCommand): Promise<FulfillmentCommandOutcome> {
    if (command.commandType === "RetrieveFulfillment") {
      const reservation = await this.#reservation(command.reservationId);
      if (
        reservation === undefined ||
        reservation.checkoutId !== command.checkoutId ||
        reservation.correlationId !== command.correlationId
      ) {
        return {
          schemaVersion: "1.0",
          operationId: command.operationId,
          checkoutId: command.checkoutId,
          reservationId: command.reservationId,
          status: "RESERVATION_NOT_ACTIVE",
        };
      }
      return {
        schemaVersion: "1.0",
        operationId: command.operationId,
        checkoutId: command.checkoutId,
        reservationId: command.reservationId,
        status: reservation.status,
      };
    }
    const payloadHash = stablePayloadHash(command);
    const recorded = await this.#startOperation(command.operationId, payloadHash);
    if (recorded !== undefined) return recorded;

    if (await this.#businessRejection(command)) {
      if (command.commandType === "ReserveFulfillment") {
        return this.#recordCapacityUnavailable(command, payloadHash);
      }
      if (command.commandType === "CancelFulfillment") {
        return this.#recordReservationNotActive(command, payloadHash, "RESERVED");
      }
    }

    const now = this.#clock().toISOString();
    const status = command.commandType === "ReserveFulfillment"
      ? "RESERVED"
      : command.commandType === "CancelFulfillment"
        ? "CANCELLED"
        : "HANDED_OFF";
    const outcome: FulfillmentCommandOutcome = {
      schemaVersion: "1.0",
      operationId: command.operationId,
      checkoutId: command.checkoutId,
      reservationId: command.reservationId,
      status,
    };
    const eventType = status === "RESERVED"
      ? "FulfillmentReserved"
      : status === "CANCELLED"
        ? "FulfillmentCancelled"
        : "FulfillmentHandedOff";
    const event = {
      eventId: this.#eventId(),
      eventType,
      eventVersion: "1.0",
      occurredAt: now,
      correlationId: command.correlationId,
      causationId: command.causationId,
      aggregateType: "Fulfillment",
      aggregateId: command.reservationId,
      payload: {
        checkoutId: command.checkoutId,
        reservationId: command.reservationId,
        status,
      },
    };
    const stateChange = command.commandType === "ReserveFulfillment"
      ? {
          Put: {
            TableName: this.tableName,
            Item: {
              recordKey: reservationKey(command.reservationId),
              recordType: "RESERVATION",
              reservationId: command.reservationId,
              checkoutId: command.checkoutId,
              correlationId: command.correlationId,
              status,
              createdAt: now,
              updatedAt: now,
            },
            ConditionExpression: "attribute_not_exists(recordKey)",
          },
        }
      : {
          Update: {
            TableName: this.tableName,
            Key: { recordKey: reservationKey(command.reservationId) },
            UpdateExpression: "SET #status = :targetStatus, updatedAt = :updatedAt",
            ConditionExpression:
              "#status = :reserved AND checkoutId = :checkoutId AND correlationId = :correlationId",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":reserved": "RESERVED",
              ":targetStatus": status,
              ":checkoutId": command.checkoutId,
              ":correlationId": command.correlationId,
              ":updatedAt": now,
            },
          },
        };
    try {
      await this.#client.send(new TransactWriteCommand({
        TransactItems: [
          stateChange,
          operationCompletionUpdate(
            this.tableName,
            command.operationId,
            payloadHash,
            outcome,
            "SUCCEEDED",
            now,
          ),
          {
            Put: {
              TableName: this.outboxTableName,
              Item: event,
              ConditionExpression: "attribute_not_exists(eventId)",
            },
          },
        ],
      }));
      return outcome;
    } catch (error) {
      if (!isTransactionCancellation(error)) throw error;
      const concurrent = await this.#operation(command.operationId);
      if (concurrent !== undefined && concurrent.state !== "IN_PROGRESS") {
        return recordedOutcome(concurrent, payloadHash);
      }
      if (hasOnlyConditionalFailures(error)) {
        if (command.commandType !== "ReserveFulfillment") {
          const reservation = await this.#reservation(command.reservationId);
          if (reservation !== undefined && reservation.status !== "RESERVED") {
            return this.#recordReservationNotActive(
              command,
              payloadHash,
              reservation.status,
            );
          }
        }
        throw new Error("Fulfillment state invariant violated");
      }
      throw error;
    }
  }

  async #operation(operationId: string): Promise<FulfillmentOperation | undefined> {
    const response = await this.#client.send(new GetCommand({
      TableName: this.tableName,
      Key: { recordKey: operationKey(operationId) },
      ConsistentRead: true,
    }));
    return response.Item as FulfillmentOperation | undefined;
  }

  async #startOperation(
    operationId: string,
    payloadHash: string,
  ): Promise<FulfillmentCommandOutcome | undefined> {
    const existing = await this.#operation(operationId);
    if (existing !== undefined) {
      assertPayloadHash(existing, payloadHash);
      return existing.state === "IN_PROGRESS" ? undefined : recordedOutcome(existing, payloadHash);
    }
    const now = this.#clock().toISOString();
    try {
      await this.#client.send(new PutCommand({
        TableName: this.tableName,
        Item: {
          recordKey: operationKey(operationId),
          recordType: "OPERATION",
          operationId,
          payloadHash,
          state: "IN_PROGRESS",
          createdAt: now,
          updatedAt: now,
        } satisfies FulfillmentOperation,
        ConditionExpression: "attribute_not_exists(recordKey)",
      }));
      return undefined;
    } catch (error) {
      if (!isConditionalConflict(error)) throw error;
      const concurrent = await this.#operation(operationId);
      if (concurrent === undefined) throw error;
      assertPayloadHash(concurrent, payloadHash);
      return concurrent.state === "IN_PROGRESS"
        ? undefined
        : recordedOutcome(concurrent, payloadHash);
    }
  }

  async #reservation(reservationId: string): Promise<FulfillmentReservation | undefined> {
    const response = await this.#client.send(new GetCommand({
      TableName: this.tableName,
      Key: { recordKey: reservationKey(reservationId) },
      ConsistentRead: true,
    }));
    return response.Item as FulfillmentReservation | undefined;
  }

  async #recordReservationNotActive(
    command: Exclude<FulfillmentCommand, { readonly commandType: "ReserveFulfillment" }>,
    payloadHash: string,
    reservationStatus: FulfillmentReservation["status"],
  ): Promise<FulfillmentCommandOutcome> {
    const result: FulfillmentCommandOutcome = {
      schemaVersion: "1.0",
      operationId: command.operationId,
      checkoutId: command.checkoutId,
      reservationId: command.reservationId,
      status: "RESERVATION_NOT_ACTIVE",
      reservationStatus,
    };
    return this.#recordFailedOperation(command.operationId, payloadHash, result);
  }

  async #businessRejection(command: FulfillmentCommand): Promise<boolean> {
    if (this.#failurePlanTableName === undefined) return false;
    const operation = command.commandType === "ReserveFulfillment"
      ? "reserve"
      : command.commandType === "CancelFulfillment"
        ? "cancel"
        : command.commandType === "HandoffFulfillment"
          ? "handoff"
          : "retrieve";
    const response = await this.#client.send(new GetCommand({
      TableName: this.#failurePlanTableName,
      Key: { recordKey: failurePlanKey(command.reservationId, operation) },
      ConsistentRead: true,
    }));
    const effects = (response.Item as { readonly effects?: unknown } | undefined)?.effects;
    if (effects === undefined) return false;
    if (!Array.isArray(effects) || effects.some((effect) => effect !== "BUSINESS_REJECTION")) {
      throw new Error("Fulfillment failure plan contains an unsupported effect");
    }
    return effects[0] === "BUSINESS_REJECTION";
  }

  async #recordCapacityUnavailable(
    command: Extract<FulfillmentCommand, { readonly commandType: "ReserveFulfillment" }>,
    payloadHash: string,
  ): Promise<FulfillmentCommandOutcome> {
    const result: FulfillmentCommandOutcome = {
      schemaVersion: "1.0",
      operationId: command.operationId,
      checkoutId: command.checkoutId,
      reservationId: command.reservationId,
      status: "CAPACITY_UNAVAILABLE",
    };
    return this.#recordFailedOperation(command.operationId, payloadHash, result);
  }

  async #recordFailedOperation(
    operationId: string,
    payloadHash: string,
    result: FulfillmentCommandOutcome,
  ): Promise<FulfillmentCommandOutcome> {
    const now = this.#clock().toISOString();
    try {
      await this.#client.send(new TransactWriteCommand({
        TransactItems: [operationCompletionUpdate(
          this.tableName,
          operationId,
          payloadHash,
          result,
          "FAILED",
          now,
        )],
      }));
      return result;
    } catch (error) {
      if (!isTransactionCancellation(error)) throw error;
      if (!hasOnlyConditionalFailures(error)) throw error;
      const concurrent = await this.#operation(operationId);
      if (concurrent === undefined || concurrent.state === "IN_PROGRESS") throw error;
      return recordedOutcome(concurrent, payloadHash);
    }
  }
}

interface FulfillmentOperation {
  readonly recordKey: string;
  readonly recordType: "OPERATION";
  readonly operationId: string;
  readonly payloadHash: string;
  readonly state: "IN_PROGRESS" | "SUCCEEDED" | "FAILED";
  readonly result?: FulfillmentCommandOutcome;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface FulfillmentReservation {
  readonly reservationId: string;
  readonly checkoutId: string;
  readonly correlationId: string;
  readonly status: "RESERVED" | "CANCELLED" | "HANDED_OFF";
}

export interface FulfillmentRepositoryDependencies {
  readonly client?: DynamoDBDocumentClient;
  readonly clock?: () => Date;
  readonly eventId?: () => string;
  readonly failurePlanTableName?: string;
}

function recordedOutcome(
  operation: FulfillmentOperation,
  payloadHash: string,
): FulfillmentCommandOutcome {
  assertPayloadHash(operation, payloadHash);
  if (operation.result === undefined) {
    throw new Error("Fulfillment operation is still in progress");
  }
  return operation.result;
}

function assertPayloadHash(operation: FulfillmentOperation, payloadHash: string): void {
  if (operation.payloadHash !== payloadHash) {
    throw new Error("Fulfillment operation ID was reused with a different payload");
  }
}

function operationCompletionUpdate(
  tableName: string,
  operationId: string,
  payloadHash: string,
  result: FulfillmentCommandOutcome,
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

function operationKey(operationId: string): string {
  return `OPERATION#${operationId}`;
}

function reservationKey(reservationId: string): string {
  return `RESERVATION#${reservationId}`;
}

function failurePlanKey(reservationId: string, operation: string): string {
  return `FAILURE_PLAN#fulfillment:${reservationId}:${operation}`;
}

function isTransactionCancellation(error: unknown): boolean {
  return error instanceof Error && error.name === "TransactionCanceledException";
}

function isConditionalConflict(error: unknown): boolean {
  return error instanceof Error && error.name === "ConditionalCheckFailedException";
}

function hasOnlyConditionalFailures(error: unknown): boolean {
  if (!isTransactionCancellation(error)) return false;
  const reasons = (error as Error & {
    readonly CancellationReasons?: ReadonlyArray<{ readonly Code?: string }>;
  }).CancellationReasons;
  return reasons?.some(({ Code }) => Code === "ConditionalCheckFailed") === true &&
    reasons.every(({ Code }) => Code === "None" || Code === "ConditionalCheckFailed");
}
