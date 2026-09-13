import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

import { stablePayloadHash } from "./domain-command.js";
import type {
  AuthorizeProviderPayment,
  MutateProviderPayment,
  PaymentProvider,
  PaymentProviderMutationResult,
  PaymentProviderRetrievalResult,
  PaymentProviderStatus,
  PaymentProviderFailureEffect,
  RefundProviderPayment,
} from "./payment-provider.js";
import {
  PaymentProviderResponseLostError,
  PaymentProviderTransientError,
  PaymentProviderThrottledError,
  PaymentProviderTimeoutError,
} from "./payment-provider.js";

export interface DynamoDeterministicPaymentProviderDependencies {
  readonly client?: DynamoDBDocumentClient;
  readonly failurePlanTableName?: string;
}

interface ProviderPayment {
  readonly recordKey: string;
  readonly recordType: "PROVIDER_PAYMENT";
  readonly paymentId: string;
  readonly providerReference: string;
  readonly amountMinor: number;
  readonly currency: "USD";
  readonly status: PaymentProviderStatus;
}

interface ProviderOperation {
  readonly recordKey: string;
  readonly recordType: "PROVIDER_OPERATION";
  readonly operationKey: string;
  readonly payloadHash: string;
  readonly result: PaymentProviderMutationResult;
}

export class DynamoDeterministicPaymentProvider implements PaymentProvider {
  readonly #client: DynamoDBDocumentClient;
  readonly #failurePlanTableName: string | undefined;
  readonly #tableName: string;

  public constructor(
    tableName: string,
    dependencies: DynamoDeterministicPaymentProviderDependencies = {},
  ) {
    this.#tableName = tableName;
    this.#failurePlanTableName = dependencies.failurePlanTableName;
    this.#client = dependencies.client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  public async authorize(
    request: AuthorizeProviderPayment,
  ): Promise<PaymentProviderMutationResult> {
    const replay = await this.#replay(request);
    if (replay !== undefined) return replay;
    const planned = await this.#plannedFailure(request);
    if (isPlannedOutcome(planned)) return planned;
    const payment: ProviderPayment = {
      recordKey: paymentKey(request.paymentId),
      recordType: "PROVIDER_PAYMENT",
      paymentId: request.paymentId,
      providerReference: `fake-payment-${request.paymentId}`,
      amountMinor: request.amountMinor,
      currency: request.currency,
      status: "AUTHORIZED",
    };
    const result = applied(payment);
    return this.#transactMutation(request, result, {
      Put: {
        TableName: this.#tableName,
        Item: payment,
        ConditionExpression: "attribute_not_exists(recordKey)",
      },
    }, isAmbiguousCompletion(planned), planned === "DUPLICATE_DELIVERY");
  }

  public capture(request: MutateProviderPayment): Promise<PaymentProviderMutationResult> {
    return this.#transition(request, "AUTHORIZED", "CAPTURED", "PAYMENT_NOT_AUTHORIZED");
  }

  public cancel(request: MutateProviderPayment): Promise<PaymentProviderMutationResult> {
    return this.#transition(request, "AUTHORIZED", "CANCELLED", "PAYMENT_NOT_CANCELLABLE");
  }

  public async refund(request: RefundProviderPayment): Promise<PaymentProviderMutationResult> {
    const replay = await this.#replay(request);
    if (replay !== undefined) return replay;
    const planned = await this.#plannedFailure(request);
    if (isPlannedOutcome(planned)) return planned;
    const payment = await this.#payment(request.paymentId);
    if (payment?.status !== "CAPTURED" || request.amountMinor > payment.amountMinor) {
      return this.#recordRejection(request, "PAYMENT_NOT_REFUNDABLE");
    }
    return this.#transitionApplied(
      request,
      payment,
      "CAPTURED",
      "REFUNDED",
      isAmbiguousCompletion(planned),
      planned === "DUPLICATE_DELIVERY",
    );
  }

  public async retrieve(
    request: { readonly paymentId: string },
  ): Promise<PaymentProviderRetrievalResult> {
    const payment = await this.#payment(request.paymentId);
    return payment === undefined
      ? { kind: "NOT_FOUND" }
      : {
          kind: "FOUND",
          providerReference: payment.providerReference,
          status: payment.status,
        };
  }

  async #transition(
    request: MutateProviderPayment,
    requiredStatus: PaymentProviderStatus,
    targetStatus: PaymentProviderStatus,
    rejectionCode: string,
  ): Promise<PaymentProviderMutationResult> {
    const replay = await this.#replay(request);
    if (replay !== undefined) return replay;
    const planned = await this.#plannedFailure(request);
    if (isPlannedOutcome(planned)) return planned;
    const payment = await this.#payment(request.paymentId);
    if (payment?.status !== requiredStatus) return this.#recordRejection(request, rejectionCode);
    return this.#transitionApplied(
      request,
      payment,
      requiredStatus,
      targetStatus,
      isAmbiguousCompletion(planned),
      planned === "DUPLICATE_DELIVERY",
    );
  }

  #transitionApplied(
    request: MutateProviderPayment | RefundProviderPayment,
    payment: ProviderPayment,
    requiredStatus: PaymentProviderStatus,
    targetStatus: PaymentProviderStatus,
    loseResponse: boolean,
    duplicateDelivery: boolean,
  ): Promise<PaymentProviderMutationResult> {
    const result: PaymentProviderMutationResult = {
      kind: "APPLIED",
      providerReference: payment.providerReference,
      status: targetStatus,
    };
    return this.#transactMutation(request, result, {
      Update: {
        TableName: this.#tableName,
        Key: { recordKey: payment.recordKey },
        UpdateExpression: "SET #status = :targetStatus",
        ConditionExpression: "#status = :requiredStatus",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":requiredStatus": requiredStatus, ":targetStatus": targetStatus },
      },
    }, loseResponse, duplicateDelivery);
  }

  async #recordRejection(
    request: AuthorizeProviderPayment | MutateProviderPayment | RefundProviderPayment,
    rejectionCode: string,
  ): Promise<PaymentProviderMutationResult> {
    const result = { kind: "REJECTED" as const, rejectionCode };
    try {
      await this.#client.send(new PutCommand({
        TableName: this.#tableName,
        Item: providerOperation(request, result),
        ConditionExpression: "attribute_not_exists(recordKey)",
      }));
      return result;
    } catch (error) {
      if (!isConditionalConflict(error)) throw error;
      return this.#requiredReplay(request, error);
    }
  }

  async #transactMutation(
    request: AuthorizeProviderPayment | MutateProviderPayment | RefundProviderPayment,
    result: PaymentProviderMutationResult,
    mutation: Record<string, unknown>,
    loseResponse = false,
    duplicateDelivery = false,
  ): Promise<PaymentProviderMutationResult> {
    try {
      await this.#client.send(new TransactWriteCommand({
        TransactItems: [
          mutation,
          {
            Put: {
              TableName: this.#tableName,
              Item: providerOperation(request, result),
              ConditionExpression: "attribute_not_exists(recordKey)",
            },
          },
        ],
      }));
      if (loseResponse) throw new PaymentProviderResponseLostError();
      if (duplicateDelivery) {
        const replay = await this.#replay(request);
        if (replay === undefined) throw new Error("Duplicate provider delivery lost its result");
        return replay;
      }
      return result;
    } catch (error) {
      if (!isTransactionConflict(error)) throw error;
      return this.#requiredReplay(request, error);
    }
  }

  async #plannedFailure(
    request: AuthorizeProviderPayment | MutateProviderPayment | RefundProviderPayment,
  ): Promise<PaymentProviderFailureEffect | PaymentProviderMutationResult | undefined> {
    const effect = await this.#nextFailureEffect(request.operationKey);
    if (effect === undefined) return undefined;
    if (effect === "FAIL_BEFORE_MUTATION") throw new PaymentProviderTransientError();
    if (effect === "THROTTLE") throw new PaymentProviderThrottledError();
    if (effect === "TIMEOUT") throw new PaymentProviderTimeoutError();
    if (effect === "BUSINESS_REJECTION") {
      return this.#recordRejection(request, "PAYMENT_DECLINED");
    }
    return effect;
  }

  async #nextFailureEffect(
    operationKeyValue: string,
  ): Promise<PaymentProviderFailureEffect | undefined> {
    if (this.#failurePlanTableName === undefined) return undefined;
    const planResponse = await this.#client.send(new GetCommand({
      TableName: this.#failurePlanTableName,
      Key: { recordKey: failurePlanKey(operationKeyValue) },
      ConsistentRead: true,
    }));
    const plan = planResponse.Item as { readonly effects?: unknown } | undefined;
    if (plan === undefined) return undefined;
    if (!Array.isArray(plan.effects)) {
      throw new Error("Payment provider failure plan must contain an effects array");
    }
    const attemptResponse = await this.#client.send(new UpdateCommand({
      TableName: this.#tableName,
      Key: { recordKey: failureAttemptKey(operationKeyValue) },
      UpdateExpression: "SET recordType = if_not_exists(recordType, :recordType), operationKey = if_not_exists(operationKey, :operationKey), attemptCount = if_not_exists(attemptCount, :zero) + :one",
      ExpressionAttributeValues: {
        ":recordType": "FAILURE_ATTEMPT",
        ":operationKey": operationKeyValue,
        ":zero": 0,
        ":one": 1,
      },
      ReturnValues: "ALL_OLD",
    }));
    const previousAttempt = attemptResponse.Attributes?.attemptCount;
    const attempt = typeof previousAttempt === "number" ? previousAttempt : 0;
    const effect: unknown = plan.effects[attempt];
    if (effect === undefined) return undefined;
    if (!isFailureEffect(effect)) {
      throw new Error("Payment provider failure plan contains an unsupported effect");
    }
    return effect;
  }

  async #replay(
    request: AuthorizeProviderPayment | MutateProviderPayment | RefundProviderPayment,
  ): Promise<PaymentProviderMutationResult | undefined> {
    const response = await this.#client.send(new GetCommand({
      TableName: this.#tableName,
      Key: { recordKey: operationKey(request.operationKey) },
      ConsistentRead: true,
    }));
    const operation = response.Item as ProviderOperation | undefined;
    if (operation === undefined) return undefined;
    const payloadHash = stablePayloadHash(request);
    if (operation.payloadHash !== payloadHash) {
      throw new Error("Payment provider operation key was reused with a different payload");
    }
    return operation.result;
  }

  async #requiredReplay(
    request: AuthorizeProviderPayment | MutateProviderPayment | RefundProviderPayment,
    conflict: unknown,
  ): Promise<PaymentProviderMutationResult> {
    const replay = await this.#replay(request);
    if (replay === undefined) throw conflict;
    return replay;
  }

  async #payment(paymentId: string): Promise<ProviderPayment | undefined> {
    const response = await this.#client.send(new GetCommand({
      TableName: this.#tableName,
      Key: { recordKey: paymentKey(paymentId) },
      ConsistentRead: true,
    }));
    return response.Item as ProviderPayment | undefined;
  }
}

function providerOperation(
  request: AuthorizeProviderPayment | MutateProviderPayment | RefundProviderPayment,
  result: PaymentProviderMutationResult,
): ProviderOperation {
  return {
    recordKey: operationKey(request.operationKey),
    recordType: "PROVIDER_OPERATION",
    operationKey: request.operationKey,
    payloadHash: stablePayloadHash(request),
    result,
  };
}

function applied(payment: ProviderPayment): PaymentProviderMutationResult {
  return {
    kind: "APPLIED",
    providerReference: payment.providerReference,
    status: payment.status,
  };
}

function paymentKey(paymentId: string): string {
  return `PROVIDER_PAYMENT#${paymentId}`;
}

function operationKey(operationId: string): string {
  return `PROVIDER_OPERATION#${operationId}`;
}

function failurePlanKey(operationKeyValue: string): string {
  return `FAILURE_PLAN#${operationKeyValue}`;
}

function failureAttemptKey(operationKeyValue: string): string {
  return `FAILURE_ATTEMPT#${operationKeyValue}`;
}

function isFailureEffect(value: unknown): value is PaymentProviderFailureEffect {
  return value === "BUSINESS_REJECTION" ||
    value === "FAIL_BEFORE_MUTATION" ||
    value === "THROTTLE" ||
    value === "TIMEOUT" ||
    value === "DUPLICATE_DELIVERY" ||
    value === "AMBIGUOUS_COMPLETION" ||
    value === "COMMIT_THEN_LOST_RESPONSE";
}

function isAmbiguousCompletion(
  planned: PaymentProviderFailureEffect | PaymentProviderMutationResult | undefined,
): boolean {
  return planned === "AMBIGUOUS_COMPLETION" || planned === "COMMIT_THEN_LOST_RESPONSE";
}

function isPlannedOutcome(
  planned: PaymentProviderFailureEffect | PaymentProviderMutationResult | undefined,
): planned is PaymentProviderMutationResult {
  return typeof planned === "object";
}

function isConditionalConflict(error: unknown): boolean {
  return error instanceof Error && error.name === "ConditionalCheckFailedException";
}

function isTransactionConflict(error: unknown): boolean {
  return error instanceof Error && error.name === "TransactionCanceledException";
}
