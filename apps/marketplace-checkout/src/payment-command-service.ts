import { randomUUID } from "node:crypto";

import type {
  PaymentCommand,
  PaymentCommandOutcome,
  PaymentEvent,
} from "@aws-architecture-lab/contracts";

import { stablePayloadHash } from "./domain-command.js";
import type {
  PaymentProvider,
  PaymentProviderMutationResult,
  PaymentProviderStatus,
} from "./payment-provider.js";

type PaymentMutationCommand = Exclude<PaymentCommand, { readonly commandType: "RetrievePayment" }>;

export interface PaymentOperationRecord {
  readonly recordKey: string;
  readonly recordType: "OPERATION";
  readonly operationId: string;
  readonly semanticKey: string;
  readonly commandType: PaymentMutationCommand["commandType"];
  readonly checkoutId: string;
  readonly paymentId: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly payloadHash: string;
  readonly state: "IN_PROGRESS" | "SUCCEEDED" | "FAILED";
  readonly result?: PaymentCommandOutcome;
  readonly providerReference?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PaymentOperationCompletion {
  readonly operationId: string;
  readonly payloadHash: string;
  readonly state: "SUCCEEDED" | "FAILED";
  readonly result: PaymentCommandOutcome;
  readonly providerReference?: string;
  readonly updatedAt: string;
  readonly event?: PaymentEvent;
}

export interface PaymentLedger {
  findOperation(operationId: string): Promise<PaymentOperationRecord | undefined>;
  findActiveOperation(paymentId: string): Promise<PaymentOperationRecord | undefined>;
  begin(operation: PaymentOperationRecord): Promise<PaymentOperationRecord>;
  complete(completion: PaymentOperationCompletion): Promise<PaymentCommandOutcome>;
}

export interface PaymentCommandServiceDependencies {
  readonly ledger: PaymentLedger;
  readonly provider: PaymentProvider;
  readonly clock?: () => Date;
  readonly eventId?: () => string;
}

export class PaymentCommandService {
  readonly #clock: () => Date;
  readonly #eventId: () => string;
  readonly #ledger: PaymentLedger;
  readonly #provider: PaymentProvider;

  public constructor(dependencies: PaymentCommandServiceDependencies) {
    this.#clock = dependencies.clock ?? (() => new Date());
    this.#eventId = dependencies.eventId ?? randomUUID;
    this.#ledger = dependencies.ledger;
    this.#provider = dependencies.provider;
  }

  public async execute(command: PaymentCommand): Promise<PaymentCommandOutcome> {
    if (command.commandType === "RetrievePayment") return this.#retrieve(command);

    const payloadHash = stablePayloadHash(command);
    const existing = await this.#ledger.findOperation(command.operationId);
    if (existing !== undefined) {
      assertPayloadHash(existing, payloadHash);
      if (existing.result !== undefined) return existing.result;
      const reconciled = await this.#reconcile(existing, command);
      if (reconciled !== undefined) return reconciled;
      return this.#invoke(command, existing);
    }

    const active = await this.#ledger.findActiveOperation(command.paymentId);
    if (active !== undefined) {
      const reconciled = await this.#reconcile(active);
      if (reconciled?.status === "RECONCILIATION_REQUIRED") {
        return outcome(command, "RECONCILIATION_REQUIRED");
      }
    }

    const now = this.#clock().toISOString();
    const proposed: PaymentOperationRecord = {
      recordKey: operationKey(command.operationId),
      recordType: "OPERATION",
      operationId: command.operationId,
      semanticKey: semanticOperationKey(command),
      commandType: command.commandType,
      checkoutId: command.checkoutId,
      paymentId: command.paymentId,
      correlationId: command.correlationId,
      causationId: command.causationId,
      payloadHash,
      state: "IN_PROGRESS",
      createdAt: now,
      updatedAt: now,
    };
    const started = await this.#ledger.begin(proposed);
    assertPayloadHash(started, payloadHash);
    if (started.result !== undefined) return started.result;
    if (started.operationId !== command.operationId) {
      return outcome(command, "RECONCILIATION_REQUIRED");
    }
    return this.#invoke(command, started);
  }

  async #invoke(
    command: PaymentMutationCommand,
    operation: PaymentOperationRecord,
  ): Promise<PaymentCommandOutcome> {
    let providerResult: PaymentProviderMutationResult;
    switch (command.commandType) {
      case "AuthorizePayment":
        providerResult = await this.#provider.authorize({
          operationKey: operation.semanticKey,
          paymentId: command.paymentId,
          amountMinor: command.amountMinor,
          currency: command.currency,
        });
        break;
      case "CapturePayment":
        providerResult = await this.#provider.capture({
          operationKey: operation.semanticKey,
          paymentId: command.paymentId,
        });
        break;
      case "CancelPayment":
        providerResult = await this.#provider.cancel({
          operationKey: operation.semanticKey,
          paymentId: command.paymentId,
        });
        break;
      case "RefundPayment":
        providerResult = await this.#provider.refund({
          operationKey: operation.semanticKey,
          paymentId: command.paymentId,
          amountMinor: command.amountMinor,
        });
        break;
    }
    return this.#recordProviderResult(operation, providerResult);
  }

  async #recordProviderResult(
    operation: PaymentOperationRecord,
    providerResult: PaymentProviderMutationResult,
  ): Promise<PaymentCommandOutcome> {
    const now = this.#clock().toISOString();
    if (providerResult.kind === "REJECTED") {
      return this.#ledger.complete({
        operationId: operation.operationId,
        payloadHash: operation.payloadHash,
        state: "FAILED",
        result: outcome(operation, "REJECTED", undefined, providerResult.rejectionCode),
        updatedAt: now,
      });
    }
    if (providerResult.status !== expectedStatus(operation.commandType)) {
      return outcome(operation, "RECONCILIATION_REQUIRED");
    }
    const result = outcome(
      operation,
      providerResult.status,
      providerResult.providerReference,
    );
    return this.#ledger.complete({
      operationId: operation.operationId,
      payloadHash: operation.payloadHash,
      state: "SUCCEEDED",
      result,
      providerReference: providerResult.providerReference,
      updatedAt: now,
      event: paymentEvent(operation, result, now, this.#eventId()),
    });
  }

  async #reconcile(
    operation: PaymentOperationRecord,
    retry?: PaymentMutationCommand,
  ): Promise<PaymentCommandOutcome | undefined> {
    const retrieved = await this.#provider.retrieve({ paymentId: operation.paymentId });
    const expected = expectedStatus(operation.commandType);
    if (retrieved.kind === "FOUND" && retrieved.status === expected) {
      return this.#recordProviderResult(operation, {
        kind: "APPLIED",
        providerReference: retrieved.providerReference,
        status: retrieved.status,
      });
    }
    if (
      retry?.operationId === operation.operationId &&
      ((retrieved.kind === "NOT_FOUND" && operation.commandType === "AuthorizePayment") ||
        (retrieved.kind === "FOUND" && retrieved.status === prerequisiteStatus(operation.commandType)))
    ) {
      return undefined;
    }
    return outcome(operation, "RECONCILIATION_REQUIRED");
  }

  async #retrieve(
    command: Extract<PaymentCommand, { readonly commandType: "RetrievePayment" }>,
  ): Promise<PaymentCommandOutcome> {
    const active = await this.#ledger.findActiveOperation(command.paymentId);
    if (active !== undefined) {
      const reconciled = await this.#reconcile(active);
      if (reconciled?.status === "RECONCILIATION_REQUIRED") {
        return outcome(command, "RECONCILIATION_REQUIRED");
      }
    }
    const retrieved = await this.#provider.retrieve({ paymentId: command.paymentId });
    return retrieved.kind === "NOT_FOUND"
      ? outcome(command, "NOT_FOUND")
      : outcome(command, retrieved.status, retrieved.providerReference);
  }
}

function semanticOperationKey(command: PaymentMutationCommand): string {
  const operation = command.commandType.replace("Payment", "").toLowerCase();
  return `payment:${command.paymentId}:${operation}`;
}

function expectedStatus(commandType: PaymentMutationCommand["commandType"]): PaymentProviderStatus {
  switch (commandType) {
    case "AuthorizePayment": return "AUTHORIZED";
    case "CapturePayment": return "CAPTURED";
    case "CancelPayment": return "CANCELLED";
    case "RefundPayment": return "REFUNDED";
  }
}

function prerequisiteStatus(
  commandType: PaymentMutationCommand["commandType"],
): PaymentProviderStatus | undefined {
  switch (commandType) {
    case "AuthorizePayment": return undefined;
    case "CapturePayment":
    case "CancelPayment": return "AUTHORIZED";
    case "RefundPayment": return "CAPTURED";
  }
}

function outcome(
  command: Pick<PaymentCommand, "operationId" | "checkoutId" | "paymentId">,
  status: PaymentCommandOutcome["status"],
  providerReference?: string,
  rejectionCode?: string,
): PaymentCommandOutcome {
  const base = {
    schemaVersion: "1.0",
    operationId: command.operationId,
    checkoutId: command.checkoutId,
    paymentId: command.paymentId,
  } as const;
  switch (status) {
    case "AUTHORIZED":
    case "CAPTURED":
    case "CANCELLED":
    case "REFUNDED":
      if (providerReference === undefined) {
        throw new Error(`Applied Payment outcome ${status} is missing its provider reference`);
      }
      return { ...base, status, providerReference };
    case "REJECTED":
      if (rejectionCode === undefined) {
        throw new Error("Rejected Payment outcome is missing its rejection code");
      }
      return { ...base, status, rejectionCode };
    case "NOT_FOUND":
    case "RECONCILIATION_REQUIRED":
      return { ...base, status };
  }
}

function paymentEvent(
  operation: PaymentOperationRecord,
  result: PaymentCommandOutcome,
  occurredAt: string,
  eventId: string,
): PaymentEvent {
  if (
    result.status === "REJECTED" ||
    result.status === "NOT_FOUND" ||
    result.status === "RECONCILIATION_REQUIRED"
  ) {
    throw new Error("Only an applied Payment outcome can produce a fact");
  }
  const eventType = `Payment${result.status[0]}${result.status.slice(1).toLowerCase()}` as
    PaymentEvent["eventType"];
  return {
    eventId,
    eventType,
    eventVersion: "1.0",
    occurredAt,
    correlationId: operation.correlationId,
    causationId: operation.causationId,
    aggregateType: "Payment",
    aggregateId: operation.paymentId,
    payload: {
      checkoutId: operation.checkoutId,
      paymentId: operation.paymentId,
      providerReference: result.providerReference,
      status: result.status as PaymentProviderStatus,
    },
  } as PaymentEvent;
}

function assertPayloadHash(operation: PaymentOperationRecord, payloadHash: string): void {
  if (operation.payloadHash !== payloadHash) {
    throw new Error("Payment operation ID was reused with a different payload");
  }
}

function operationKey(operationId: string): string {
  return `OPERATION#${operationId}`;
}
