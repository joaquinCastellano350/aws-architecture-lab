// Generated from schemas/create-pending-order-*.v1.json. Do not edit by hand.

export interface CreatePendingOrderCommand {
  readonly schemaVersion: "1.0";
  readonly checkoutId: string;
  readonly cartId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly [key: string]: unknown;
}

export interface CreatePendingOrderOutcome {
  readonly schemaVersion: "1.0";
  readonly checkoutId: string;
  readonly correlationId: string;
  readonly status: "PENDING";
  readonly [key: string]: unknown;
}

export interface MarkOrderInventoryUnavailableCommand {
  readonly schemaVersion: "1.0";
  readonly commandType: "MarkOrderInventoryUnavailable";
  readonly operationId: string;
  readonly checkoutId: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly [key: string]: unknown;
}

export interface MarkOrderInventoryUnavailableOutcome {
  readonly schemaVersion: "1.0";
  readonly checkoutId: string;
  readonly correlationId: string;
  readonly status: "INVENTORY_UNAVAILABLE";
  readonly [key: string]: unknown;
}

export type OrderContractValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

export function validateCreatePendingOrderCommand(
  input: unknown,
): OrderContractValidationResult<CreatePendingOrderCommand> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["schemaVersion"] !== "string" || !["1.0"].includes((input as Record<string, unknown>)["schemaVersion"] as string)) ||
    (typeof (input as Record<string, unknown>)["checkoutId"] !== "string" || String((input as Record<string, unknown>)["checkoutId"]).length < 1 || String((input as Record<string, unknown>)["checkoutId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["cartId"] !== "string" || String((input as Record<string, unknown>)["cartId"]).length < 1 || String((input as Record<string, unknown>)["cartId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["correlationId"] !== "string" || String((input as Record<string, unknown>)["correlationId"]).length < 1 || String((input as Record<string, unknown>)["correlationId"]).length > 128) ||
    ((input as Record<string, unknown>)["causationId"] !== undefined && (typeof (input as Record<string, unknown>)["causationId"] !== "string" || String((input as Record<string, unknown>)["causationId"]).length < 1 || String((input as Record<string, unknown>)["causationId"]).length > 256))
  ) {
    return { ok: false, error: "Value does not match CreatePendingOrderCommand" };
  }
  return { ok: true, value: input as CreatePendingOrderCommand };
}

export function validateCreatePendingOrderOutcome(
  input: unknown,
): OrderContractValidationResult<CreatePendingOrderOutcome> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["schemaVersion"] !== "string" || !["1.0"].includes((input as Record<string, unknown>)["schemaVersion"] as string)) ||
    (typeof (input as Record<string, unknown>)["checkoutId"] !== "string" || String((input as Record<string, unknown>)["checkoutId"]).length < 1 || String((input as Record<string, unknown>)["checkoutId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["correlationId"] !== "string" || String((input as Record<string, unknown>)["correlationId"]).length < 1 || String((input as Record<string, unknown>)["correlationId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["status"] !== "string" || !["PENDING"].includes((input as Record<string, unknown>)["status"] as string))
  ) {
    return { ok: false, error: "Value does not match CreatePendingOrderOutcome" };
  }
  return { ok: true, value: input as CreatePendingOrderOutcome };
}

export function validateMarkOrderInventoryUnavailableCommand(
  input: unknown,
): OrderContractValidationResult<MarkOrderInventoryUnavailableCommand> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["schemaVersion"] !== "string" || (input as Record<string, unknown>)["schemaVersion"] !== "1.0") ||
    (typeof (input as Record<string, unknown>)["commandType"] !== "string" || (input as Record<string, unknown>)["commandType"] !== "MarkOrderInventoryUnavailable") ||
    (typeof (input as Record<string, unknown>)["operationId"] !== "string" || String((input as Record<string, unknown>)["operationId"]).length < 1 || String((input as Record<string, unknown>)["operationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["checkoutId"] !== "string" || String((input as Record<string, unknown>)["checkoutId"]).length < 1 || String((input as Record<string, unknown>)["checkoutId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["correlationId"] !== "string" || String((input as Record<string, unknown>)["correlationId"]).length < 1 || String((input as Record<string, unknown>)["correlationId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["causationId"] !== "string" || String((input as Record<string, unknown>)["causationId"]).length < 1 || String((input as Record<string, unknown>)["causationId"]).length > 256)
  ) {
    return { ok: false, error: "Value does not match MarkOrderInventoryUnavailableCommand" };
  }
  return { ok: true, value: input as MarkOrderInventoryUnavailableCommand };
}

export function validateMarkOrderInventoryUnavailableOutcome(
  input: unknown,
): OrderContractValidationResult<MarkOrderInventoryUnavailableOutcome> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["schemaVersion"] !== "string" || (input as Record<string, unknown>)["schemaVersion"] !== "1.0") ||
    (typeof (input as Record<string, unknown>)["checkoutId"] !== "string" || String((input as Record<string, unknown>)["checkoutId"]).length < 1 || String((input as Record<string, unknown>)["checkoutId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["correlationId"] !== "string" || String((input as Record<string, unknown>)["correlationId"]).length < 1 || String((input as Record<string, unknown>)["correlationId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["status"] !== "string" || (input as Record<string, unknown>)["status"] !== "INVENTORY_UNAVAILABLE")
  ) {
    return { ok: false, error: "Value does not match MarkOrderInventoryUnavailableOutcome" };
  }
  return { ok: true, value: input as MarkOrderInventoryUnavailableOutcome };
}

