// Generated from schemas/*-fulfillment-command*.v1.json. Do not edit by hand.

export interface ReserveFulfillmentCommand {
  readonly schemaVersion: "1.0";
  readonly commandType: "ReserveFulfillment";
  readonly operationId: string;
  readonly checkoutId: string;
  readonly reservationId: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly [key: string]: unknown;
}

export interface HandoffFulfillmentCommand {
  readonly schemaVersion: "1.0";
  readonly commandType: "HandoffFulfillment";
  readonly operationId: string;
  readonly checkoutId: string;
  readonly reservationId: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly [key: string]: unknown;
}

export interface FulfillmentCommandOutcome {
  readonly schemaVersion: "1.0";
  readonly operationId: string;
  readonly checkoutId: string;
  readonly reservationId: string;
  readonly status: "RESERVED" | "HANDED_OFF" | "RESERVATION_NOT_ACTIVE";
  readonly reservationStatus?: "RESERVED" | "HANDED_OFF";
  readonly [key: string]: unknown;
}

export type FulfillmentCommand = ReserveFulfillmentCommand | HandoffFulfillmentCommand;

export type FulfillmentContractValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

export function validateReserveFulfillmentCommand(
  input: unknown,
): FulfillmentContractValidationResult<ReserveFulfillmentCommand> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["schemaVersion"] !== "string" || (input as Record<string, unknown>)["schemaVersion"] !== "1.0") ||
    (typeof (input as Record<string, unknown>)["commandType"] !== "string" || (input as Record<string, unknown>)["commandType"] !== "ReserveFulfillment") ||
    (typeof (input as Record<string, unknown>)["operationId"] !== "string" || String((input as Record<string, unknown>)["operationId"]).length < 1 || String((input as Record<string, unknown>)["operationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["checkoutId"] !== "string" || String((input as Record<string, unknown>)["checkoutId"]).length < 1 || String((input as Record<string, unknown>)["checkoutId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["reservationId"] !== "string" || String((input as Record<string, unknown>)["reservationId"]).length < 1 || String((input as Record<string, unknown>)["reservationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["correlationId"] !== "string" || String((input as Record<string, unknown>)["correlationId"]).length < 1 || String((input as Record<string, unknown>)["correlationId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["causationId"] !== "string" || String((input as Record<string, unknown>)["causationId"]).length < 1 || String((input as Record<string, unknown>)["causationId"]).length > 256)
  ) {
    return { ok: false, error: "Value does not match ReserveFulfillmentCommand" };
  }
  return { ok: true, value: input as ReserveFulfillmentCommand };
}

export function validateHandoffFulfillmentCommand(
  input: unknown,
): FulfillmentContractValidationResult<HandoffFulfillmentCommand> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["schemaVersion"] !== "string" || (input as Record<string, unknown>)["schemaVersion"] !== "1.0") ||
    (typeof (input as Record<string, unknown>)["commandType"] !== "string" || (input as Record<string, unknown>)["commandType"] !== "HandoffFulfillment") ||
    (typeof (input as Record<string, unknown>)["operationId"] !== "string" || String((input as Record<string, unknown>)["operationId"]).length < 1 || String((input as Record<string, unknown>)["operationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["checkoutId"] !== "string" || String((input as Record<string, unknown>)["checkoutId"]).length < 1 || String((input as Record<string, unknown>)["checkoutId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["reservationId"] !== "string" || String((input as Record<string, unknown>)["reservationId"]).length < 1 || String((input as Record<string, unknown>)["reservationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["correlationId"] !== "string" || String((input as Record<string, unknown>)["correlationId"]).length < 1 || String((input as Record<string, unknown>)["correlationId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["causationId"] !== "string" || String((input as Record<string, unknown>)["causationId"]).length < 1 || String((input as Record<string, unknown>)["causationId"]).length > 256)
  ) {
    return { ok: false, error: "Value does not match HandoffFulfillmentCommand" };
  }
  return { ok: true, value: input as HandoffFulfillmentCommand };
}

export function validateFulfillmentCommandOutcome(
  input: unknown,
): FulfillmentContractValidationResult<FulfillmentCommandOutcome> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["schemaVersion"] !== "string" || (input as Record<string, unknown>)["schemaVersion"] !== "1.0") ||
    (typeof (input as Record<string, unknown>)["operationId"] !== "string" || String((input as Record<string, unknown>)["operationId"]).length < 1 || String((input as Record<string, unknown>)["operationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["checkoutId"] !== "string" || String((input as Record<string, unknown>)["checkoutId"]).length < 1 || String((input as Record<string, unknown>)["checkoutId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["reservationId"] !== "string" || String((input as Record<string, unknown>)["reservationId"]).length < 1 || String((input as Record<string, unknown>)["reservationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["status"] !== "string" || !["RESERVED", "HANDED_OFF", "RESERVATION_NOT_ACTIVE"].includes((input as Record<string, unknown>)["status"] as string)) ||
    ((input as Record<string, unknown>)["reservationStatus"] !== undefined && (typeof (input as Record<string, unknown>)["reservationStatus"] !== "string" || !["RESERVED", "HANDED_OFF"].includes((input as Record<string, unknown>)["reservationStatus"] as string)))
  ) {
    return { ok: false, error: "Value does not match FulfillmentCommandOutcome" };
  }
  return { ok: true, value: input as FulfillmentCommandOutcome };
}
