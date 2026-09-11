import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import type { PaymentCommandOutcome } from "@aws-architecture-lab/contracts";

import type {
  PaymentLedger,
  PaymentOperationCompletion,
  PaymentOperationRecord,
} from "./payment-command-service.js";

export interface DynamoPaymentLedgerDependencies {
  readonly client?: DynamoDBDocumentClient;
}

interface PaymentRecord {
  readonly recordKey: string;
  readonly recordType: "PAYMENT";
  readonly paymentId: string;
  readonly checkoutId: string;
  readonly status?: PaymentCommandOutcome["status"];
  readonly activeOperationId?: string;
  readonly providerReference?: string;
  readonly updatedAt: string;
}

export class DynamoPaymentLedger implements PaymentLedger {
  readonly #client: DynamoDBDocumentClient;
  readonly #outboxTableName: string;
  readonly #paymentTableName: string;

  public constructor(
    paymentTableName: string,
    outboxTableName: string,
    dependencies: DynamoPaymentLedgerDependencies = {},
  ) {
    this.#paymentTableName = paymentTableName;
    this.#outboxTableName = outboxTableName;
    this.#client = dependencies.client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  public async findOperation(operationId: string): Promise<PaymentOperationRecord | undefined> {
    const result = await this.#client.send(new GetCommand({
      TableName: this.#paymentTableName,
      Key: { recordKey: operationKey(operationId) },
      ConsistentRead: true,
    }));
    return result.Item as PaymentOperationRecord | undefined;
  }

  public async findActiveOperation(paymentId: string): Promise<PaymentOperationRecord | undefined> {
    const result = await this.#client.send(new GetCommand({
      TableName: this.#paymentTableName,
      Key: { recordKey: paymentKey(paymentId) },
      ConsistentRead: true,
    }));
    const payment = result.Item as PaymentRecord | undefined;
    return payment?.activeOperationId === undefined
      ? undefined
      : this.findOperation(payment.activeOperationId);
  }

  public async begin(operation: PaymentOperationRecord): Promise<PaymentOperationRecord> {
    const existing = await this.findOperation(operation.operationId);
    if (existing !== undefined) return existing;
    try {
      await this.#client.send(new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.#paymentTableName,
              Item: operation,
              ConditionExpression: "attribute_not_exists(recordKey)",
            },
          },
          {
            Update: {
              TableName: this.#paymentTableName,
              Key: { recordKey: paymentKey(operation.paymentId) },
              UpdateExpression: "SET recordType = if_not_exists(recordType, :recordType), paymentId = if_not_exists(paymentId, :paymentId), checkoutId = if_not_exists(checkoutId, :checkoutId), activeOperationId = :operationId, updatedAt = :updatedAt",
              ConditionExpression: "attribute_not_exists(activeOperationId) AND (attribute_not_exists(checkoutId) OR checkoutId = :checkoutId)",
              ExpressionAttributeValues: {
                ":recordType": "PAYMENT",
                ":paymentId": operation.paymentId,
                ":checkoutId": operation.checkoutId,
                ":operationId": operation.operationId,
                ":updatedAt": operation.updatedAt,
              },
            },
          },
        ],
      }));
      return operation;
    } catch (error) {
      if (!isTransactionConflict(error)) throw error;
      const concurrent = await this.findOperation(operation.operationId);
      if (concurrent !== undefined) return concurrent;
      const active = await this.findActiveOperation(operation.paymentId);
      if (active !== undefined) return active;
      throw error;
    }
  }

  public async complete(
    completion: PaymentOperationCompletion,
  ): Promise<PaymentCommandOutcome> {
    const operation = await this.findOperation(completion.operationId);
    if (operation === undefined) throw new Error("Payment operation is missing");
    const paymentUpdate = completion.state === "SUCCEEDED"
      ? "SET #status = :status, providerReference = :providerReference, updatedAt = :updatedAt REMOVE activeOperationId"
      : "SET updatedAt = :updatedAt REMOVE activeOperationId";
    const operationUpdate = completion.providerReference === undefined
      ? "SET #state = :state, #result = :result, updatedAt = :updatedAt"
      : "SET #state = :state, #result = :result, providerReference = :providerReference, updatedAt = :updatedAt";
    const transactItems = [
      {
        Update: {
          TableName: this.#paymentTableName,
          Key: { recordKey: operation.recordKey },
          UpdateExpression: operationUpdate,
          ConditionExpression: "#state = :inProgress AND payloadHash = :payloadHash",
          ExpressionAttributeNames: { "#state": "state", "#result": "result" },
          ExpressionAttributeValues: {
            ":state": completion.state,
            ":inProgress": "IN_PROGRESS",
            ":payloadHash": completion.payloadHash,
            ":result": completion.result,
            ":updatedAt": completion.updatedAt,
            ...(completion.providerReference === undefined
              ? {}
              : { ":providerReference": completion.providerReference }),
          },
        },
      },
      {
        Update: {
          TableName: this.#paymentTableName,
          Key: { recordKey: paymentKey(operation.paymentId) },
          UpdateExpression: paymentUpdate,
          ConditionExpression: "activeOperationId = :operationId",
          ...(completion.state === "SUCCEEDED"
            ? { ExpressionAttributeNames: { "#status": "status" } }
            : {}),
          ExpressionAttributeValues: {
            ":operationId": operation.operationId,
            ":updatedAt": completion.updatedAt,
            ...(completion.state === "SUCCEEDED"
              ? {
                  ":status": completion.result.status,
                  ":providerReference": completion.providerReference,
                }
              : {}),
          },
        },
      },
      ...(completion.event === undefined
        ? []
        : [{
            Put: {
              TableName: this.#outboxTableName,
              Item: completion.event,
              ConditionExpression: "attribute_not_exists(eventId)",
            },
          }]),
    ];
    try {
      await this.#client.send(new TransactWriteCommand({ TransactItems: transactItems }));
      return completion.result;
    } catch (error) {
      if (!isTransactionConflict(error)) throw error;
      const concurrent = await this.findOperation(completion.operationId);
      if (concurrent?.result === undefined) throw error;
      if (concurrent.payloadHash !== completion.payloadHash) {
        throw new Error("Payment operation ID was reused with a different payload");
      }
      return concurrent.result;
    }
  }
}

function operationKey(operationId: string): string {
  return `OPERATION#${operationId}`;
}

function paymentKey(paymentId: string): string {
  return `PAYMENT#${paymentId}`;
}

function isTransactionConflict(error: unknown): boolean {
  return error instanceof Error && error.name === "TransactionCanceledException";
}
