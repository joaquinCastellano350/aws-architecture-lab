import { randomUUID } from "node:crypto";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
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
  }

  public async execute(command: FulfillmentCommand): Promise<FulfillmentCommandOutcome> {
    const payloadHash = stablePayloadHash(command);
    const recorded = await this.#operation(command.operationId);
    if (recorded !== undefined) return recordedOutcome(recorded, payloadHash);

    const now = this.#clock().toISOString();
    const status = command.commandType === "ReserveFulfillment" ? "RESERVED" : "HANDED_OFF";
    const outcome: FulfillmentCommandOutcome = {
      schemaVersion: "1.0",
      operationId: command.operationId,
      checkoutId: command.checkoutId,
      reservationId: command.reservationId,
      status,
    };
    const operation: FulfillmentOperation = {
      recordKey: operationKey(command.operationId),
      recordType: "OPERATION",
      operationId: command.operationId,
      payloadHash,
      state: "SUCCEEDED",
      result: outcome,
      createdAt: now,
      updatedAt: now,
    };
    const eventType = status === "RESERVED" ? "FulfillmentReserved" : "FulfillmentHandedOff";
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
            UpdateExpression: "SET #status = :handedOff, updatedAt = :updatedAt",
            ConditionExpression:
              "#status = :reserved AND checkoutId = :checkoutId AND correlationId = :correlationId",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":reserved": "RESERVED",
              ":handedOff": "HANDED_OFF",
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
          {
            Put: {
              TableName: this.tableName,
              Item: operation,
              ConditionExpression: "attribute_not_exists(recordKey)",
            },
          },
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
      if (concurrent !== undefined) return recordedOutcome(concurrent, payloadHash);
      if (hasOnlyConditionalFailures(error)) {
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
}

interface FulfillmentOperation {
  readonly recordKey: string;
  readonly recordType: "OPERATION";
  readonly operationId: string;
  readonly payloadHash: string;
  readonly state: "SUCCEEDED";
  readonly result: FulfillmentCommandOutcome;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface FulfillmentRepositoryDependencies {
  readonly client?: DynamoDBDocumentClient;
  readonly clock?: () => Date;
  readonly eventId?: () => string;
}

function recordedOutcome(
  operation: FulfillmentOperation,
  payloadHash: string,
): FulfillmentCommandOutcome {
  if (operation.payloadHash !== payloadHash) {
    throw new Error("Fulfillment operation ID was reused with a different payload");
  }
  return operation.result;
}

function operationKey(operationId: string): string {
  return `OPERATION#${operationId}`;
}

function reservationKey(reservationId: string): string {
  return `RESERVATION#${reservationId}`;
}

function isTransactionCancellation(error: unknown): boolean {
  return error instanceof Error && error.name === "TransactionCanceledException";
}

function hasOnlyConditionalFailures(error: unknown): boolean {
  if (!isTransactionCancellation(error)) return false;
  const reasons = (error as Error & {
    readonly CancellationReasons?: ReadonlyArray<{ readonly Code?: string }>;
  }).CancellationReasons;
  return reasons?.some(({ Code }) => Code === "ConditionalCheckFailed") === true &&
    reasons.every(({ Code }) => Code === "None" || Code === "ConditionalCheckFailed");
}
