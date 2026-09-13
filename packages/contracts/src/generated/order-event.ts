// Generated from schemas/order-*-event.v1.json. Do not edit by hand.

export interface OrderPendingEvent {
  readonly eventId: string;
  readonly eventType: "OrderPending";
  readonly eventVersion: "1.0";
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly aggregateType: "Order";
  readonly aggregateId: string;
  readonly payload: { readonly status: "PENDING"; readonly [key: string]: unknown };
  readonly [key: string]: unknown;
}

export interface OrderInventoryUnavailableEvent {
  readonly eventId: string;
  readonly eventType: "OrderInventoryUnavailable";
  readonly eventVersion: "1.0";
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly aggregateType: "Order";
  readonly aggregateId: string;
  readonly payload: { readonly status: "INVENTORY_UNAVAILABLE"; readonly [key: string]: unknown };
  readonly [key: string]: unknown;
}

export interface OrderExpiredEvent {
  readonly eventId: string;
  readonly eventType: "OrderExpired";
  readonly eventVersion: "1.0";
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly aggregateType: "Order";
  readonly aggregateId: string;
  readonly payload: { readonly status: "EXPIRED"; readonly [key: string]: unknown };
  readonly [key: string]: unknown;
}

export interface OrderConfirmedEvent {
  readonly eventId: string;
  readonly eventType: "OrderConfirmed";
  readonly eventVersion: "1.0";
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly aggregateType: "Order";
  readonly aggregateId: string;
  readonly payload: { readonly status: "CONFIRMED"; readonly [key: string]: unknown };
  readonly [key: string]: unknown;
}

export interface OrderCancelledEvent {
  readonly eventId: string;
  readonly eventType: "OrderCancelled";
  readonly eventVersion: "1.0";
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly aggregateType: "Order";
  readonly aggregateId: string;
  readonly payload: { readonly status: "CANCELLED"; readonly [key: string]: unknown };
  readonly [key: string]: unknown;
}

export type OrderEventValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

export function validateOrderPendingEvent(
  input: unknown,
): OrderEventValidationResult<OrderPendingEvent> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["eventId"] !== "string" || String((input as Record<string, unknown>)["eventId"]).length < 1 || String((input as Record<string, unknown>)["eventId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["eventType"] !== "string" || (input as Record<string, unknown>)["eventType"] !== "OrderPending") ||
    (typeof (input as Record<string, unknown>)["eventVersion"] !== "string" || (input as Record<string, unknown>)["eventVersion"] !== "1.0") ||
    (typeof (input as Record<string, unknown>)["occurredAt"] !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test((input as Record<string, unknown>)["occurredAt"] as string) || Number.isNaN(Date.parse((input as Record<string, unknown>)["occurredAt"] as string))) ||
    (typeof (input as Record<string, unknown>)["correlationId"] !== "string" || String((input as Record<string, unknown>)["correlationId"]).length < 1 || String((input as Record<string, unknown>)["correlationId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["causationId"] !== "string" || String((input as Record<string, unknown>)["causationId"]).length < 1 || String((input as Record<string, unknown>)["causationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["aggregateType"] !== "string" || (input as Record<string, unknown>)["aggregateType"] !== "Order") ||
    (typeof (input as Record<string, unknown>)["aggregateId"] !== "string" || String((input as Record<string, unknown>)["aggregateId"]).length < 1 || String((input as Record<string, unknown>)["aggregateId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["payload"] !== "object" || (input as Record<string, unknown>)["payload"] === null || Array.isArray((input as Record<string, unknown>)["payload"]) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["status"] !== "string" || ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["status"] !== "PENDING"))
  ) {
    return { ok: false, error: "Value does not match OrderPendingEvent" };
  }
  return { ok: true, value: input as OrderPendingEvent };
}

export function validateOrderInventoryUnavailableEvent(
  input: unknown,
): OrderEventValidationResult<OrderInventoryUnavailableEvent> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["eventId"] !== "string" || String((input as Record<string, unknown>)["eventId"]).length < 1 || String((input as Record<string, unknown>)["eventId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["eventType"] !== "string" || (input as Record<string, unknown>)["eventType"] !== "OrderInventoryUnavailable") ||
    (typeof (input as Record<string, unknown>)["eventVersion"] !== "string" || (input as Record<string, unknown>)["eventVersion"] !== "1.0") ||
    (typeof (input as Record<string, unknown>)["occurredAt"] !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test((input as Record<string, unknown>)["occurredAt"] as string) || Number.isNaN(Date.parse((input as Record<string, unknown>)["occurredAt"] as string))) ||
    (typeof (input as Record<string, unknown>)["correlationId"] !== "string" || String((input as Record<string, unknown>)["correlationId"]).length < 1 || String((input as Record<string, unknown>)["correlationId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["causationId"] !== "string" || String((input as Record<string, unknown>)["causationId"]).length < 1 || String((input as Record<string, unknown>)["causationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["aggregateType"] !== "string" || (input as Record<string, unknown>)["aggregateType"] !== "Order") ||
    (typeof (input as Record<string, unknown>)["aggregateId"] !== "string" || String((input as Record<string, unknown>)["aggregateId"]).length < 1 || String((input as Record<string, unknown>)["aggregateId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["payload"] !== "object" || (input as Record<string, unknown>)["payload"] === null || Array.isArray((input as Record<string, unknown>)["payload"]) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["status"] !== "string" || ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["status"] !== "INVENTORY_UNAVAILABLE"))
  ) {
    return { ok: false, error: "Value does not match OrderInventoryUnavailableEvent" };
  }
  return { ok: true, value: input as OrderInventoryUnavailableEvent };
}

export function validateOrderExpiredEvent(
  input: unknown,
): OrderEventValidationResult<OrderExpiredEvent> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["eventId"] !== "string" || String((input as Record<string, unknown>)["eventId"]).length < 1 || String((input as Record<string, unknown>)["eventId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["eventType"] !== "string" || (input as Record<string, unknown>)["eventType"] !== "OrderExpired") ||
    (typeof (input as Record<string, unknown>)["eventVersion"] !== "string" || (input as Record<string, unknown>)["eventVersion"] !== "1.0") ||
    (typeof (input as Record<string, unknown>)["occurredAt"] !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test((input as Record<string, unknown>)["occurredAt"] as string) || Number.isNaN(Date.parse((input as Record<string, unknown>)["occurredAt"] as string))) ||
    (typeof (input as Record<string, unknown>)["correlationId"] !== "string" || String((input as Record<string, unknown>)["correlationId"]).length < 1 || String((input as Record<string, unknown>)["correlationId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["causationId"] !== "string" || String((input as Record<string, unknown>)["causationId"]).length < 1 || String((input as Record<string, unknown>)["causationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["aggregateType"] !== "string" || (input as Record<string, unknown>)["aggregateType"] !== "Order") ||
    (typeof (input as Record<string, unknown>)["aggregateId"] !== "string" || String((input as Record<string, unknown>)["aggregateId"]).length < 1 || String((input as Record<string, unknown>)["aggregateId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["payload"] !== "object" || (input as Record<string, unknown>)["payload"] === null || Array.isArray((input as Record<string, unknown>)["payload"]) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["status"] !== "string" || ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["status"] !== "EXPIRED"))
  ) {
    return { ok: false, error: "Value does not match OrderExpiredEvent" };
  }
  return { ok: true, value: input as OrderExpiredEvent };
}

export function validateOrderConfirmedEvent(
  input: unknown,
): OrderEventValidationResult<OrderConfirmedEvent> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["eventId"] !== "string" || String((input as Record<string, unknown>)["eventId"]).length < 1 || String((input as Record<string, unknown>)["eventId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["eventType"] !== "string" || (input as Record<string, unknown>)["eventType"] !== "OrderConfirmed") ||
    (typeof (input as Record<string, unknown>)["eventVersion"] !== "string" || (input as Record<string, unknown>)["eventVersion"] !== "1.0") ||
    (typeof (input as Record<string, unknown>)["occurredAt"] !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test((input as Record<string, unknown>)["occurredAt"] as string) || Number.isNaN(Date.parse((input as Record<string, unknown>)["occurredAt"] as string))) ||
    (typeof (input as Record<string, unknown>)["correlationId"] !== "string" || String((input as Record<string, unknown>)["correlationId"]).length < 1 || String((input as Record<string, unknown>)["correlationId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["causationId"] !== "string" || String((input as Record<string, unknown>)["causationId"]).length < 1 || String((input as Record<string, unknown>)["causationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["aggregateType"] !== "string" || (input as Record<string, unknown>)["aggregateType"] !== "Order") ||
    (typeof (input as Record<string, unknown>)["aggregateId"] !== "string" || String((input as Record<string, unknown>)["aggregateId"]).length < 1 || String((input as Record<string, unknown>)["aggregateId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["payload"] !== "object" || (input as Record<string, unknown>)["payload"] === null || Array.isArray((input as Record<string, unknown>)["payload"]) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["status"] !== "string" || ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["status"] !== "CONFIRMED"))
  ) {
    return { ok: false, error: "Value does not match OrderConfirmedEvent" };
  }
  return { ok: true, value: input as OrderConfirmedEvent };
}

export function validateOrderCancelledEvent(
  input: unknown,
): OrderEventValidationResult<OrderCancelledEvent> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["eventId"] !== "string" || String((input as Record<string, unknown>)["eventId"]).length < 1 || String((input as Record<string, unknown>)["eventId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["eventType"] !== "string" || (input as Record<string, unknown>)["eventType"] !== "OrderCancelled") ||
    (typeof (input as Record<string, unknown>)["eventVersion"] !== "string" || (input as Record<string, unknown>)["eventVersion"] !== "1.0") ||
    (typeof (input as Record<string, unknown>)["occurredAt"] !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test((input as Record<string, unknown>)["occurredAt"] as string) || Number.isNaN(Date.parse((input as Record<string, unknown>)["occurredAt"] as string))) ||
    (typeof (input as Record<string, unknown>)["correlationId"] !== "string" || String((input as Record<string, unknown>)["correlationId"]).length < 1 || String((input as Record<string, unknown>)["correlationId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["causationId"] !== "string" || String((input as Record<string, unknown>)["causationId"]).length < 1 || String((input as Record<string, unknown>)["causationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["aggregateType"] !== "string" || (input as Record<string, unknown>)["aggregateType"] !== "Order") ||
    (typeof (input as Record<string, unknown>)["aggregateId"] !== "string" || String((input as Record<string, unknown>)["aggregateId"]).length < 1 || String((input as Record<string, unknown>)["aggregateId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["payload"] !== "object" || (input as Record<string, unknown>)["payload"] === null || Array.isArray((input as Record<string, unknown>)["payload"]) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["status"] !== "string" || ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["status"] !== "CANCELLED"))
  ) {
    return { ok: false, error: "Value does not match OrderCancelledEvent" };
  }
  return { ok: true, value: input as OrderCancelledEvent };
}
