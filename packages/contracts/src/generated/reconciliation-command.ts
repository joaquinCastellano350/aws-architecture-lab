// Generated from schemas/*-reconciliation-*.v1.json. Do not edit by hand.

export interface CreateReconciliationCommand {
  readonly schemaVersion: "1.0";
  readonly commandType: "CreateReconciliation";
  readonly operationId: string;
  readonly reconciliationId: string;
  readonly checkoutId: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly workflowVersionArn?: string;
  readonly failedInvariant: string;
  readonly requiredAction: "COMPENSATE_INVENTORY" | "COMPENSATE_PAYMENT_AUTHORIZATION" | "COMPENSATE_RESERVED_FULFILLMENT" | "COMPENSATE_CAPTURED_PAYMENT" | "RECOVER_FULFILLMENT_HANDOFF" | "CONFIRM_ORDER";
  readonly attempts: number;
  readonly lastError?: string;
  readonly [key: string]: unknown;
}

export interface ReplayReconciliationCommand {
  readonly schemaVersion: "1.0";
  readonly commandType: "ReplayReconciliation";
  readonly operationId: string;
  readonly reconciliationId: string;
  readonly requestedBy: string;
  readonly reason: string;
}

export interface ResolveReconciliationCommand {
  readonly schemaVersion: "1.0";
  readonly commandType: "ResolveReconciliation";
  readonly operationId: string;
  readonly reconciliationId: string;
  readonly checkoutId: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly [key: string]: unknown;
}

export interface ReconciliationCommandOutcome {
  readonly schemaVersion: "1.0";
  readonly reconciliationId: string;
  readonly checkoutId: string;
  readonly status: "RECONCILIATION_REQUIRED" | "REPLAYING" | "RESOLVED";
  readonly attempts: number;
  readonly [key: string]: unknown;
}

export type ReconciliationContractValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

export function validateCreateReconciliationCommand(
  input: unknown,
): ReconciliationContractValidationResult<CreateReconciliationCommand> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["schemaVersion"] !== "string" || (input as Record<string, unknown>)["schemaVersion"] !== "1.0") ||
    (typeof (input as Record<string, unknown>)["commandType"] !== "string" || (input as Record<string, unknown>)["commandType"] !== "CreateReconciliation") ||
    (typeof (input as Record<string, unknown>)["operationId"] !== "string" || String((input as Record<string, unknown>)["operationId"]).length < 1 || String((input as Record<string, unknown>)["operationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["reconciliationId"] !== "string" || String((input as Record<string, unknown>)["reconciliationId"]).length < 1 || String((input as Record<string, unknown>)["reconciliationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["checkoutId"] !== "string" || String((input as Record<string, unknown>)["checkoutId"]).length < 1 || String((input as Record<string, unknown>)["checkoutId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["correlationId"] !== "string" || String((input as Record<string, unknown>)["correlationId"]).length < 1 || String((input as Record<string, unknown>)["correlationId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["causationId"] !== "string" || String((input as Record<string, unknown>)["causationId"]).length < 1 || String((input as Record<string, unknown>)["causationId"]).length > 256) ||
    ((input as Record<string, unknown>)["workflowVersionArn"] !== undefined && (typeof (input as Record<string, unknown>)["workflowVersionArn"] !== "string" || String((input as Record<string, unknown>)["workflowVersionArn"]).length < 1 || String((input as Record<string, unknown>)["workflowVersionArn"]).length > 2048)) ||
    (typeof (input as Record<string, unknown>)["failedInvariant"] !== "string" || String((input as Record<string, unknown>)["failedInvariant"]).length < 1 || String((input as Record<string, unknown>)["failedInvariant"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["requiredAction"] !== "string" || !["COMPENSATE_INVENTORY", "COMPENSATE_PAYMENT_AUTHORIZATION", "COMPENSATE_RESERVED_FULFILLMENT", "COMPENSATE_CAPTURED_PAYMENT", "RECOVER_FULFILLMENT_HANDOFF", "CONFIRM_ORDER"].includes((input as Record<string, unknown>)["requiredAction"] as string)) ||
    (typeof (input as Record<string, unknown>)["attempts"] !== "number" || !Number.isInteger(Number((input as Record<string, unknown>)["attempts"])) || Number((input as Record<string, unknown>)["attempts"]) < 1 || Number((input as Record<string, unknown>)["attempts"]) > 100) ||
    ((input as Record<string, unknown>)["lastError"] !== undefined && (typeof (input as Record<string, unknown>)["lastError"] !== "string" || String((input as Record<string, unknown>)["lastError"]).length < 1 || String((input as Record<string, unknown>)["lastError"]).length > 1024))
  ) {
    return { ok: false, error: "Value does not match CreateReconciliationCommand" };
  }
  return { ok: true, value: input as CreateReconciliationCommand };
}

export function validateReplayReconciliationCommand(
  input: unknown,
): ReconciliationContractValidationResult<ReplayReconciliationCommand> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["schemaVersion"] !== "string" || (input as Record<string, unknown>)["schemaVersion"] !== "1.0") ||
    (typeof (input as Record<string, unknown>)["commandType"] !== "string" || (input as Record<string, unknown>)["commandType"] !== "ReplayReconciliation") ||
    (typeof (input as Record<string, unknown>)["operationId"] !== "string" || String((input as Record<string, unknown>)["operationId"]).length < 1 || String((input as Record<string, unknown>)["operationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["reconciliationId"] !== "string" || String((input as Record<string, unknown>)["reconciliationId"]).length < 1 || String((input as Record<string, unknown>)["reconciliationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["requestedBy"] !== "string" || String((input as Record<string, unknown>)["requestedBy"]).length < 1 || String((input as Record<string, unknown>)["requestedBy"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["reason"] !== "string" || String((input as Record<string, unknown>)["reason"]).length < 1 || String((input as Record<string, unknown>)["reason"]).length > 1024)
  ) {
    return { ok: false, error: "Value does not match ReplayReconciliationCommand" };
  }
  return { ok: true, value: input as ReplayReconciliationCommand };
}

export function validateResolveReconciliationCommand(
  input: unknown,
): ReconciliationContractValidationResult<ResolveReconciliationCommand> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["schemaVersion"] !== "string" || (input as Record<string, unknown>)["schemaVersion"] !== "1.0") ||
    (typeof (input as Record<string, unknown>)["commandType"] !== "string" || (input as Record<string, unknown>)["commandType"] !== "ResolveReconciliation") ||
    (typeof (input as Record<string, unknown>)["operationId"] !== "string" || String((input as Record<string, unknown>)["operationId"]).length < 1 || String((input as Record<string, unknown>)["operationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["reconciliationId"] !== "string" || String((input as Record<string, unknown>)["reconciliationId"]).length < 1 || String((input as Record<string, unknown>)["reconciliationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["checkoutId"] !== "string" || String((input as Record<string, unknown>)["checkoutId"]).length < 1 || String((input as Record<string, unknown>)["checkoutId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["correlationId"] !== "string" || String((input as Record<string, unknown>)["correlationId"]).length < 1 || String((input as Record<string, unknown>)["correlationId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["causationId"] !== "string" || String((input as Record<string, unknown>)["causationId"]).length < 1 || String((input as Record<string, unknown>)["causationId"]).length > 256)
  ) {
    return { ok: false, error: "Value does not match ResolveReconciliationCommand" };
  }
  return { ok: true, value: input as ResolveReconciliationCommand };
}

export function validateReconciliationCommandOutcome(
  input: unknown,
): ReconciliationContractValidationResult<ReconciliationCommandOutcome> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["schemaVersion"] !== "string" || (input as Record<string, unknown>)["schemaVersion"] !== "1.0") ||
    (typeof (input as Record<string, unknown>)["reconciliationId"] !== "string" || String((input as Record<string, unknown>)["reconciliationId"]).length < 1 || String((input as Record<string, unknown>)["reconciliationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["checkoutId"] !== "string" || String((input as Record<string, unknown>)["checkoutId"]).length < 1 || String((input as Record<string, unknown>)["checkoutId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["status"] !== "string" || !["RECONCILIATION_REQUIRED", "REPLAYING", "RESOLVED"].includes((input as Record<string, unknown>)["status"] as string)) ||
    (typeof (input as Record<string, unknown>)["attempts"] !== "number" || !Number.isInteger(Number((input as Record<string, unknown>)["attempts"])) || Number((input as Record<string, unknown>)["attempts"]) < 1 || Number((input as Record<string, unknown>)["attempts"]) > 100)
  ) {
    return { ok: false, error: "Value does not match ReconciliationCommandOutcome" };
  }
  return { ok: true, value: input as ReconciliationCommandOutcome };
}

