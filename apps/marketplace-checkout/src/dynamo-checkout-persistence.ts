import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

import type {
  Admission,
  AdmittedCheckout,
  CheckoutPersistence,
  Order,
  SagaExecution,
  WorkflowExecution,
} from "./checkout-api.js";

export class DynamoCheckoutPersistence implements CheckoutPersistence {
  readonly #client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
  readonly #orderTableName: string;
  readonly #sagaTableName: string;

  public constructor(orderTableName: string, sagaTableName: string) {
    this.#orderTableName = orderTableName;
    this.#sagaTableName = sagaTableName;
  }

  public async admit(admission: Admission, saga: SagaExecution): Promise<AdmittedCheckout> {
    try {
      await this.#client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.#sagaTableName,
                Item: {
                  recordKey: admissionKey(admission.idempotencyKey),
                  recordType: "ADMISSION",
                  ...admission,
                },
                ConditionExpression: "attribute_not_exists(recordKey)",
              },
            },
            {
              Put: {
                TableName: this.#sagaTableName,
                Item: { recordKey: sagaKey(saga.checkoutId), recordType: "SAGA_EXECUTION", ...saga },
                ConditionExpression: "attribute_not_exists(recordKey)",
              },
            },
          ],
        }),
      );
      return { admission };
    } catch (error) {
      if (!isTransactionConflict(error)) throw error;
      const existing = await this.#client.send(
        new GetCommand({
          TableName: this.#sagaTableName,
          Key: { recordKey: admissionKey(admission.idempotencyKey) },
          ConsistentRead: true,
        }),
      );
      if (existing.Item === undefined) throw error;
      const recordedAdmission = existing.Item as Admission;
      const recordedSaga = await this.#client.send(
        new GetCommand({
          TableName: this.#sagaTableName,
          Key: { recordKey: sagaKey(recordedAdmission.checkoutId) },
          ConsistentRead: true,
        }),
      );
      const sagaExecution = recordedSaga.Item as SagaExecution | undefined;
      const workflow =
        sagaExecution?.executionArn === undefined || sagaExecution.workflowVersionArn === undefined
          ? {}
          : {
              workflow: {
                executionArn: sagaExecution.executionArn,
                workflowVersionArn: sagaExecution.workflowVersionArn,
              },
            };
      return { admission: recordedAdmission, ...workflow };
    }
  }

  public async markWorkflowStarted(
    checkoutId: string,
    execution: WorkflowExecution,
  ): Promise<void> {
    await this.#client.send(
      new UpdateCommand({
        TableName: this.#sagaTableName,
        Key: { recordKey: sagaKey(checkoutId) },
        UpdateExpression:
          "SET executionArn = :executionArn, workflowVersionArn = :workflowVersionArn, updatedAt = :updatedAt",
        ExpressionAttributeValues: {
          ":executionArn": execution.executionArn,
          ":workflowVersionArn": execution.workflowVersionArn,
          ":updatedAt": new Date().toISOString(),
        },
        ConditionExpression: "attribute_exists(recordKey)",
      }),
    );
  }

  public async getOrder(checkoutId: string): Promise<Order | undefined> {
    const result = await this.#client.send(
      new GetCommand({
        TableName: this.#orderTableName,
        Key: { checkoutId },
        ConsistentRead: true,
      }),
    );
    return result.Item as Order | undefined;
  }
}

function admissionKey(idempotencyKey: string): string {
  return `ADMISSION#${idempotencyKey}`;
}

function sagaKey(checkoutId: string): string {
  return `SAGA#${checkoutId}`;
}

function isTransactionConflict(error: unknown): boolean {
  return error instanceof Error && error.name === "TransactionCanceledException";
}
