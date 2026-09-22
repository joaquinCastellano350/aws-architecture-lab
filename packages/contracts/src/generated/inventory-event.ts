// Generated from schemas/inventory-*-event.v1.json. Do not edit by hand.

export interface InventoryReservedEvent {
  readonly eventId: string;
  readonly eventType: "InventoryReserved";
  readonly eventVersion: "1.0";
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly aggregateType: "InventoryReservation";
  readonly aggregateId: string;
  readonly payload: { readonly itemId: string; readonly quantity: number; readonly status: "RESERVED"; readonly expiresAt: string; readonly [key: string]: unknown };
  readonly [key: string]: unknown;
}

export interface InventoryCommittedEvent {
  readonly eventId: string;
  readonly eventType: "InventoryCommitted";
  readonly eventVersion: "1.0";
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly aggregateType: "InventoryReservation";
  readonly aggregateId: string;
  readonly payload: { readonly itemId: string; readonly quantity: number; readonly status: "COMMITTED"; readonly [key: string]: unknown };
  readonly [key: string]: unknown;
}

export interface InventoryReleasedEvent {
  readonly eventId: string;
  readonly eventType: "InventoryReleased";
  readonly eventVersion: "1.0";
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly aggregateType: "InventoryReservation";
  readonly aggregateId: string;
  readonly payload: { readonly checkoutId?: string; readonly itemId: string; readonly quantity: number; readonly status: "RELEASED"; readonly releaseReason?: "CHECKOUT_EXPIRED" | "COMPENSATION"; readonly [key: string]: unknown };
  readonly [key: string]: unknown;
}

export type InventoryEvent =
  InventoryReservedEvent
  | InventoryCommittedEvent
  | InventoryReleasedEvent;

export type InventoryEventValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

export function validateInventoryReservedEvent(
  input: unknown,
): InventoryEventValidationResult<InventoryReservedEvent> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["eventId"] !== "string" || String((input as Record<string, unknown>)["eventId"]).length < 1 || String((input as Record<string, unknown>)["eventId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["eventType"] !== "string" || (input as Record<string, unknown>)["eventType"] !== "InventoryReserved") ||
    (typeof (input as Record<string, unknown>)["eventVersion"] !== "string" || (input as Record<string, unknown>)["eventVersion"] !== "1.0") ||
    (typeof (input as Record<string, unknown>)["occurredAt"] !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test((input as Record<string, unknown>)["occurredAt"] as string) || Number.isNaN(Date.parse((input as Record<string, unknown>)["occurredAt"] as string))) ||
    (typeof (input as Record<string, unknown>)["correlationId"] !== "string" || String((input as Record<string, unknown>)["correlationId"]).length < 1 || String((input as Record<string, unknown>)["correlationId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["causationId"] !== "string" || String((input as Record<string, unknown>)["causationId"]).length < 1 || String((input as Record<string, unknown>)["causationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["aggregateType"] !== "string" || (input as Record<string, unknown>)["aggregateType"] !== "InventoryReservation") ||
    (typeof (input as Record<string, unknown>)["aggregateId"] !== "string" || String((input as Record<string, unknown>)["aggregateId"]).length < 1 || String((input as Record<string, unknown>)["aggregateId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["payload"] !== "object" || (input as Record<string, unknown>)["payload"] === null || Array.isArray((input as Record<string, unknown>)["payload"]) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["itemId"] !== "string" || String(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["itemId"]).length < 1 || String(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["itemId"]).length > 128) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["quantity"] !== "number" || !Number.isInteger(Number(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["quantity"])) || Number(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["quantity"]) < 1 || Number(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["quantity"]) > 1000) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["status"] !== "string" || ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["status"] !== "RESERVED") || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["expiresAt"] !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["expiresAt"] as string) || Number.isNaN(Date.parse(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["expiresAt"] as string))))
  ) {
    return { ok: false, error: "Value does not match InventoryReservedEvent" };
  }
  return { ok: true, value: input as InventoryReservedEvent };
}

export function validateInventoryCommittedEvent(
  input: unknown,
): InventoryEventValidationResult<InventoryCommittedEvent> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["eventId"] !== "string" || String((input as Record<string, unknown>)["eventId"]).length < 1 || String((input as Record<string, unknown>)["eventId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["eventType"] !== "string" || (input as Record<string, unknown>)["eventType"] !== "InventoryCommitted") ||
    (typeof (input as Record<string, unknown>)["eventVersion"] !== "string" || (input as Record<string, unknown>)["eventVersion"] !== "1.0") ||
    (typeof (input as Record<string, unknown>)["occurredAt"] !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test((input as Record<string, unknown>)["occurredAt"] as string) || Number.isNaN(Date.parse((input as Record<string, unknown>)["occurredAt"] as string))) ||
    (typeof (input as Record<string, unknown>)["correlationId"] !== "string" || String((input as Record<string, unknown>)["correlationId"]).length < 1 || String((input as Record<string, unknown>)["correlationId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["causationId"] !== "string" || String((input as Record<string, unknown>)["causationId"]).length < 1 || String((input as Record<string, unknown>)["causationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["aggregateType"] !== "string" || (input as Record<string, unknown>)["aggregateType"] !== "InventoryReservation") ||
    (typeof (input as Record<string, unknown>)["aggregateId"] !== "string" || String((input as Record<string, unknown>)["aggregateId"]).length < 1 || String((input as Record<string, unknown>)["aggregateId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["payload"] !== "object" || (input as Record<string, unknown>)["payload"] === null || Array.isArray((input as Record<string, unknown>)["payload"]) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["itemId"] !== "string" || String(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["itemId"]).length < 1 || String(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["itemId"]).length > 128) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["quantity"] !== "number" || !Number.isInteger(Number(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["quantity"])) || Number(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["quantity"]) < 1 || Number(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["quantity"]) > 1000) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["status"] !== "string" || ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["status"] !== "COMMITTED"))
  ) {
    return { ok: false, error: "Value does not match InventoryCommittedEvent" };
  }
  return { ok: true, value: input as InventoryCommittedEvent };
}

export function validateInventoryReleasedEvent(
  input: unknown,
): InventoryEventValidationResult<InventoryReleasedEvent> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["eventId"] !== "string" || String((input as Record<string, unknown>)["eventId"]).length < 1 || String((input as Record<string, unknown>)["eventId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["eventType"] !== "string" || (input as Record<string, unknown>)["eventType"] !== "InventoryReleased") ||
    (typeof (input as Record<string, unknown>)["eventVersion"] !== "string" || (input as Record<string, unknown>)["eventVersion"] !== "1.0") ||
    (typeof (input as Record<string, unknown>)["occurredAt"] !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test((input as Record<string, unknown>)["occurredAt"] as string) || Number.isNaN(Date.parse((input as Record<string, unknown>)["occurredAt"] as string))) ||
    (typeof (input as Record<string, unknown>)["correlationId"] !== "string" || String((input as Record<string, unknown>)["correlationId"]).length < 1 || String((input as Record<string, unknown>)["correlationId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["causationId"] !== "string" || String((input as Record<string, unknown>)["causationId"]).length < 1 || String((input as Record<string, unknown>)["causationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["aggregateType"] !== "string" || (input as Record<string, unknown>)["aggregateType"] !== "InventoryReservation") ||
    (typeof (input as Record<string, unknown>)["aggregateId"] !== "string" || String((input as Record<string, unknown>)["aggregateId"]).length < 1 || String((input as Record<string, unknown>)["aggregateId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["payload"] !== "object" || (input as Record<string, unknown>)["payload"] === null || Array.isArray((input as Record<string, unknown>)["payload"]) || (((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["checkoutId"] !== undefined && (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["checkoutId"] !== "string" || String(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["checkoutId"]).length < 1 || String(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["checkoutId"]).length > 128)) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["itemId"] !== "string" || String(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["itemId"]).length < 1 || String(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["itemId"]).length > 128) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["quantity"] !== "number" || !Number.isInteger(Number(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["quantity"])) || Number(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["quantity"]) < 1 || Number(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["quantity"]) > 1000) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["status"] !== "string" || ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["status"] !== "RELEASED") || (((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["releaseReason"] !== undefined && (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["releaseReason"] !== "string" || !["CHECKOUT_EXPIRED", "COMPENSATION"].includes(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["releaseReason"] as string))))
  ) {
    return { ok: false, error: "Value does not match InventoryReleasedEvent" };
  }
  return { ok: true, value: input as InventoryReleasedEvent };
}

export function validateInventoryEvent(input: unknown): InventoryEventValidationResult<InventoryEvent> {
  const validateInventoryReservedEventResult = validateInventoryReservedEvent(input);
  const validateInventoryCommittedEventResult = validateInventoryCommittedEvent(input);
  const validateInventoryReleasedEventResult = validateInventoryReleasedEvent(input);
  if (validateInventoryReservedEventResult.ok) return validateInventoryReservedEventResult;
  if (validateInventoryCommittedEventResult.ok) return validateInventoryCommittedEventResult;
  if (validateInventoryReleasedEventResult.ok) return validateInventoryReleasedEventResult;
  return { ok: false, error: "Value does not match InventoryEvent" };
}
