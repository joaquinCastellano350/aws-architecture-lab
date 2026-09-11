// Generated from schemas/fulfillment-*-event.v1.json. Do not edit by hand.

export interface FulfillmentReservedEvent {
  readonly eventId: string;
  readonly eventType: "FulfillmentReserved";
  readonly eventVersion: "1.0";
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly aggregateType: "Fulfillment";
  readonly aggregateId: string;
  readonly payload: { readonly checkoutId: string; readonly reservationId: string; readonly status: "RESERVED"; readonly [key: string]: unknown };
  readonly [key: string]: unknown;
}

export interface FulfillmentHandedOffEvent {
  readonly eventId: string;
  readonly eventType: "FulfillmentHandedOff";
  readonly eventVersion: "1.0";
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly aggregateType: "Fulfillment";
  readonly aggregateId: string;
  readonly payload: { readonly checkoutId: string; readonly reservationId: string; readonly status: "HANDED_OFF"; readonly [key: string]: unknown };
  readonly [key: string]: unknown;
}

export type FulfillmentEventValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

export function validateFulfillmentReservedEvent(
  input: unknown,
): FulfillmentEventValidationResult<FulfillmentReservedEvent> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["eventId"] !== "string" || String((input as Record<string, unknown>)["eventId"]).length < 1 || String((input as Record<string, unknown>)["eventId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["eventType"] !== "string" || (input as Record<string, unknown>)["eventType"] !== "FulfillmentReserved") ||
    (typeof (input as Record<string, unknown>)["eventVersion"] !== "string" || (input as Record<string, unknown>)["eventVersion"] !== "1.0") ||
    (typeof (input as Record<string, unknown>)["occurredAt"] !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test((input as Record<string, unknown>)["occurredAt"] as string) || Number.isNaN(Date.parse((input as Record<string, unknown>)["occurredAt"] as string))) ||
    (typeof (input as Record<string, unknown>)["correlationId"] !== "string" || String((input as Record<string, unknown>)["correlationId"]).length < 1 || String((input as Record<string, unknown>)["correlationId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["causationId"] !== "string" || String((input as Record<string, unknown>)["causationId"]).length < 1 || String((input as Record<string, unknown>)["causationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["aggregateType"] !== "string" || (input as Record<string, unknown>)["aggregateType"] !== "Fulfillment") ||
    (typeof (input as Record<string, unknown>)["aggregateId"] !== "string" || String((input as Record<string, unknown>)["aggregateId"]).length < 1 || String((input as Record<string, unknown>)["aggregateId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["payload"] !== "object" || (input as Record<string, unknown>)["payload"] === null || Array.isArray((input as Record<string, unknown>)["payload"]) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["checkoutId"] !== "string" || String(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["checkoutId"]).length < 1 || String(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["checkoutId"]).length > 128) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["reservationId"] !== "string" || String(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["reservationId"]).length < 1 || String(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["reservationId"]).length > 256) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["status"] !== "string" || ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["status"] !== "RESERVED"))
  ) {
    return { ok: false, error: "Value does not match FulfillmentReservedEvent" };
  }
  return { ok: true, value: input as FulfillmentReservedEvent };
}

export function validateFulfillmentHandedOffEvent(
  input: unknown,
): FulfillmentEventValidationResult<FulfillmentHandedOffEvent> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["eventId"] !== "string" || String((input as Record<string, unknown>)["eventId"]).length < 1 || String((input as Record<string, unknown>)["eventId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["eventType"] !== "string" || (input as Record<string, unknown>)["eventType"] !== "FulfillmentHandedOff") ||
    (typeof (input as Record<string, unknown>)["eventVersion"] !== "string" || (input as Record<string, unknown>)["eventVersion"] !== "1.0") ||
    (typeof (input as Record<string, unknown>)["occurredAt"] !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test((input as Record<string, unknown>)["occurredAt"] as string) || Number.isNaN(Date.parse((input as Record<string, unknown>)["occurredAt"] as string))) ||
    (typeof (input as Record<string, unknown>)["correlationId"] !== "string" || String((input as Record<string, unknown>)["correlationId"]).length < 1 || String((input as Record<string, unknown>)["correlationId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["causationId"] !== "string" || String((input as Record<string, unknown>)["causationId"]).length < 1 || String((input as Record<string, unknown>)["causationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["aggregateType"] !== "string" || (input as Record<string, unknown>)["aggregateType"] !== "Fulfillment") ||
    (typeof (input as Record<string, unknown>)["aggregateId"] !== "string" || String((input as Record<string, unknown>)["aggregateId"]).length < 1 || String((input as Record<string, unknown>)["aggregateId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["payload"] !== "object" || (input as Record<string, unknown>)["payload"] === null || Array.isArray((input as Record<string, unknown>)["payload"]) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["checkoutId"] !== "string" || String(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["checkoutId"]).length < 1 || String(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["checkoutId"]).length > 128) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["reservationId"] !== "string" || String(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["reservationId"]).length < 1 || String(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["reservationId"]).length > 256) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["status"] !== "string" || ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["status"] !== "HANDED_OFF"))
  ) {
    return { ok: false, error: "Value does not match FulfillmentHandedOffEvent" };
  }
  return { ok: true, value: input as FulfillmentHandedOffEvent };
}
