// Generated from schemas/*-inventory-command*.v1.json. Do not edit by hand.

export interface ReserveInventoryCommand {
  readonly schemaVersion: "1.0";
  readonly commandType: "ReserveInventory";
  readonly operationId: string;
  readonly checkoutId: string;
  readonly reservationId: string;
  readonly itemId: string;
  readonly quantity: number;
  readonly expiresAt: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly [key: string]: unknown;
}

export interface CommitInventoryCommand {
  readonly schemaVersion: "1.0";
  readonly commandType: "CommitInventory";
  readonly operationId: string;
  readonly checkoutId: string;
  readonly reservationId: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly [key: string]: unknown;
}

export interface ReleaseInventoryCommand {
  readonly schemaVersion: "1.0";
  readonly commandType: "ReleaseInventory";
  readonly operationId: string;
  readonly checkoutId: string;
  readonly reservationId: string;
  readonly releaseReason?: "CHECKOUT_EXPIRED" | "COMPENSATION";
  readonly correlationId: string;
  readonly causationId: string;
  readonly [key: string]: unknown;
}

export interface InventoryCommandOutcome {
  readonly schemaVersion: "1.0";
  readonly operationId: string;
  readonly checkoutId: string;
  readonly reservationId: string;
  readonly status: "RESERVED" | "COMMITTED" | "RELEASED" | "OUT_OF_STOCK" | "RESERVATION_NOT_ACTIVE";
  readonly reservationStatus?: "RESERVED" | "COMMITTED" | "RELEASED";
  readonly [key: string]: unknown;
}

export type InventoryContractValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

export function validateReserveInventoryCommand(
  input: unknown,
): InventoryContractValidationResult<ReserveInventoryCommand> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["schemaVersion"] !== "string" || (input as Record<string, unknown>)["schemaVersion"] !== "1.0") ||
    (typeof (input as Record<string, unknown>)["commandType"] !== "string" || (input as Record<string, unknown>)["commandType"] !== "ReserveInventory") ||
    (typeof (input as Record<string, unknown>)["operationId"] !== "string" || String((input as Record<string, unknown>)["operationId"]).length < 1 || String((input as Record<string, unknown>)["operationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["checkoutId"] !== "string" || String((input as Record<string, unknown>)["checkoutId"]).length < 1 || String((input as Record<string, unknown>)["checkoutId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["reservationId"] !== "string" || String((input as Record<string, unknown>)["reservationId"]).length < 1 || String((input as Record<string, unknown>)["reservationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["itemId"] !== "string" || String((input as Record<string, unknown>)["itemId"]).length < 1 || String((input as Record<string, unknown>)["itemId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["quantity"] !== "number" || !Number.isInteger(Number((input as Record<string, unknown>)["quantity"])) || Number((input as Record<string, unknown>)["quantity"]) < 1 || Number((input as Record<string, unknown>)["quantity"]) > 1000) ||
    (typeof (input as Record<string, unknown>)["expiresAt"] !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test((input as Record<string, unknown>)["expiresAt"] as string) || Number.isNaN(Date.parse((input as Record<string, unknown>)["expiresAt"] as string))) ||
    (typeof (input as Record<string, unknown>)["correlationId"] !== "string" || String((input as Record<string, unknown>)["correlationId"]).length < 1 || String((input as Record<string, unknown>)["correlationId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["causationId"] !== "string" || String((input as Record<string, unknown>)["causationId"]).length < 1 || String((input as Record<string, unknown>)["causationId"]).length > 256)
  ) {
    return { ok: false, error: "Value does not match ReserveInventoryCommand" };
  }
  return { ok: true, value: input as ReserveInventoryCommand };
}

export function validateCommitInventoryCommand(
  input: unknown,
): InventoryContractValidationResult<CommitInventoryCommand> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["schemaVersion"] !== "string" || (input as Record<string, unknown>)["schemaVersion"] !== "1.0") ||
    (typeof (input as Record<string, unknown>)["commandType"] !== "string" || (input as Record<string, unknown>)["commandType"] !== "CommitInventory") ||
    (typeof (input as Record<string, unknown>)["operationId"] !== "string" || String((input as Record<string, unknown>)["operationId"]).length < 1 || String((input as Record<string, unknown>)["operationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["checkoutId"] !== "string" || String((input as Record<string, unknown>)["checkoutId"]).length < 1 || String((input as Record<string, unknown>)["checkoutId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["reservationId"] !== "string" || String((input as Record<string, unknown>)["reservationId"]).length < 1 || String((input as Record<string, unknown>)["reservationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["correlationId"] !== "string" || String((input as Record<string, unknown>)["correlationId"]).length < 1 || String((input as Record<string, unknown>)["correlationId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["causationId"] !== "string" || String((input as Record<string, unknown>)["causationId"]).length < 1 || String((input as Record<string, unknown>)["causationId"]).length > 256)
  ) {
    return { ok: false, error: "Value does not match CommitInventoryCommand" };
  }
  return { ok: true, value: input as CommitInventoryCommand };
}

export function validateReleaseInventoryCommand(
  input: unknown,
): InventoryContractValidationResult<ReleaseInventoryCommand> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["schemaVersion"] !== "string" || (input as Record<string, unknown>)["schemaVersion"] !== "1.0") ||
    (typeof (input as Record<string, unknown>)["commandType"] !== "string" || (input as Record<string, unknown>)["commandType"] !== "ReleaseInventory") ||
    (typeof (input as Record<string, unknown>)["operationId"] !== "string" || String((input as Record<string, unknown>)["operationId"]).length < 1 || String((input as Record<string, unknown>)["operationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["checkoutId"] !== "string" || String((input as Record<string, unknown>)["checkoutId"]).length < 1 || String((input as Record<string, unknown>)["checkoutId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["reservationId"] !== "string" || String((input as Record<string, unknown>)["reservationId"]).length < 1 || String((input as Record<string, unknown>)["reservationId"]).length > 256) ||
    ((input as Record<string, unknown>)["releaseReason"] !== undefined && (typeof (input as Record<string, unknown>)["releaseReason"] !== "string" || !["CHECKOUT_EXPIRED", "COMPENSATION"].includes((input as Record<string, unknown>)["releaseReason"] as string))) ||
    (typeof (input as Record<string, unknown>)["correlationId"] !== "string" || String((input as Record<string, unknown>)["correlationId"]).length < 1 || String((input as Record<string, unknown>)["correlationId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["causationId"] !== "string" || String((input as Record<string, unknown>)["causationId"]).length < 1 || String((input as Record<string, unknown>)["causationId"]).length > 256)
  ) {
    return { ok: false, error: "Value does not match ReleaseInventoryCommand" };
  }
  return { ok: true, value: input as ReleaseInventoryCommand };
}

export function validateInventoryCommandOutcome(
  input: unknown,
): InventoryContractValidationResult<InventoryCommandOutcome> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["schemaVersion"] !== "string" || (input as Record<string, unknown>)["schemaVersion"] !== "1.0") ||
    (typeof (input as Record<string, unknown>)["operationId"] !== "string" || String((input as Record<string, unknown>)["operationId"]).length < 1 || String((input as Record<string, unknown>)["operationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["checkoutId"] !== "string" || String((input as Record<string, unknown>)["checkoutId"]).length < 1 || String((input as Record<string, unknown>)["checkoutId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["reservationId"] !== "string" || String((input as Record<string, unknown>)["reservationId"]).length < 1 || String((input as Record<string, unknown>)["reservationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["status"] !== "string" || !["RESERVED", "COMMITTED", "RELEASED", "OUT_OF_STOCK", "RESERVATION_NOT_ACTIVE"].includes((input as Record<string, unknown>)["status"] as string)) ||
    ((input as Record<string, unknown>)["reservationStatus"] !== undefined && (typeof (input as Record<string, unknown>)["reservationStatus"] !== "string" || !["RESERVED", "COMMITTED", "RELEASED"].includes((input as Record<string, unknown>)["reservationStatus"] as string)))
  ) {
    return { ok: false, error: "Value does not match InventoryCommandOutcome" };
  }
  return { ok: true, value: input as InventoryCommandOutcome };
}
