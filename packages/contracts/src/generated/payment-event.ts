// Generated from schemas/payment-*-event.v1.json. Do not edit by hand.

export interface PaymentAuthorizedEvent {
  readonly eventId: string;
  readonly eventType: "PaymentAuthorized";
  readonly eventVersion: "1.0";
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly aggregateType: "Payment";
  readonly aggregateId: string;
  readonly payload: { readonly checkoutId: string; readonly paymentId: string; readonly providerReference: string; readonly status: "AUTHORIZED"; readonly [key: string]: unknown };
  readonly [key: string]: unknown;
}

export interface PaymentCapturedEvent {
  readonly eventId: string;
  readonly eventType: "PaymentCaptured";
  readonly eventVersion: "1.0";
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly aggregateType: "Payment";
  readonly aggregateId: string;
  readonly payload: { readonly checkoutId: string; readonly paymentId: string; readonly providerReference: string; readonly status: "CAPTURED"; readonly [key: string]: unknown };
  readonly [key: string]: unknown;
}

export interface PaymentCancelledEvent {
  readonly eventId: string;
  readonly eventType: "PaymentCancelled";
  readonly eventVersion: "1.0";
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly aggregateType: "Payment";
  readonly aggregateId: string;
  readonly payload: { readonly checkoutId: string; readonly paymentId: string; readonly providerReference: string; readonly status: "CANCELLED"; readonly [key: string]: unknown };
  readonly [key: string]: unknown;
}

export interface PaymentRefundedEvent {
  readonly eventId: string;
  readonly eventType: "PaymentRefunded";
  readonly eventVersion: "1.0";
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly aggregateType: "Payment";
  readonly aggregateId: string;
  readonly payload: { readonly checkoutId: string; readonly paymentId: string; readonly providerReference: string; readonly status: "REFUNDED"; readonly [key: string]: unknown };
  readonly [key: string]: unknown;
}

export type PaymentEvent =
  PaymentAuthorizedEvent
  | PaymentCapturedEvent
  | PaymentCancelledEvent
  | PaymentRefundedEvent;

export type PaymentEventValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

export function validatePaymentAuthorizedEvent(
  input: unknown,
): PaymentEventValidationResult<PaymentAuthorizedEvent> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["eventId"] !== "string" || String((input as Record<string, unknown>)["eventId"]).length < 1) ||
    (typeof (input as Record<string, unknown>)["eventType"] !== "string" || (input as Record<string, unknown>)["eventType"] !== "PaymentAuthorized") ||
    (typeof (input as Record<string, unknown>)["eventVersion"] !== "string" || (input as Record<string, unknown>)["eventVersion"] !== "1.0") ||
    (typeof (input as Record<string, unknown>)["occurredAt"] !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test((input as Record<string, unknown>)["occurredAt"] as string) || Number.isNaN(Date.parse((input as Record<string, unknown>)["occurredAt"] as string))) ||
    (typeof (input as Record<string, unknown>)["correlationId"] !== "string" || String((input as Record<string, unknown>)["correlationId"]).length < 1) ||
    (typeof (input as Record<string, unknown>)["causationId"] !== "string" || String((input as Record<string, unknown>)["causationId"]).length < 1) ||
    (typeof (input as Record<string, unknown>)["aggregateType"] !== "string" || (input as Record<string, unknown>)["aggregateType"] !== "Payment") ||
    (typeof (input as Record<string, unknown>)["aggregateId"] !== "string" || String((input as Record<string, unknown>)["aggregateId"]).length < 1) ||
    (typeof (input as Record<string, unknown>)["payload"] !== "object" || (input as Record<string, unknown>)["payload"] === null || Array.isArray((input as Record<string, unknown>)["payload"]) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["checkoutId"] !== "string" || String(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["checkoutId"]).length < 1) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["paymentId"] !== "string" || String(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["paymentId"]).length < 1) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["providerReference"] !== "string" || String(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["providerReference"]).length < 1) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["status"] !== "string" || ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["status"] !== "AUTHORIZED"))
  ) {
    return { ok: false, error: "Value does not match PaymentAuthorizedEvent" };
  }
  return { ok: true, value: input as PaymentAuthorizedEvent };
}

export function validatePaymentCapturedEvent(
  input: unknown,
): PaymentEventValidationResult<PaymentCapturedEvent> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["eventId"] !== "string" || String((input as Record<string, unknown>)["eventId"]).length < 1) ||
    (typeof (input as Record<string, unknown>)["eventType"] !== "string" || (input as Record<string, unknown>)["eventType"] !== "PaymentCaptured") ||
    (typeof (input as Record<string, unknown>)["eventVersion"] !== "string" || (input as Record<string, unknown>)["eventVersion"] !== "1.0") ||
    (typeof (input as Record<string, unknown>)["occurredAt"] !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test((input as Record<string, unknown>)["occurredAt"] as string) || Number.isNaN(Date.parse((input as Record<string, unknown>)["occurredAt"] as string))) ||
    (typeof (input as Record<string, unknown>)["correlationId"] !== "string" || String((input as Record<string, unknown>)["correlationId"]).length < 1) ||
    (typeof (input as Record<string, unknown>)["causationId"] !== "string" || String((input as Record<string, unknown>)["causationId"]).length < 1) ||
    (typeof (input as Record<string, unknown>)["aggregateType"] !== "string" || (input as Record<string, unknown>)["aggregateType"] !== "Payment") ||
    (typeof (input as Record<string, unknown>)["aggregateId"] !== "string" || String((input as Record<string, unknown>)["aggregateId"]).length < 1) ||
    (typeof (input as Record<string, unknown>)["payload"] !== "object" || (input as Record<string, unknown>)["payload"] === null || Array.isArray((input as Record<string, unknown>)["payload"]) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["checkoutId"] !== "string" || String(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["checkoutId"]).length < 1) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["paymentId"] !== "string" || String(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["paymentId"]).length < 1) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["providerReference"] !== "string" || String(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["providerReference"]).length < 1) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["status"] !== "string" || ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["status"] !== "CAPTURED"))
  ) {
    return { ok: false, error: "Value does not match PaymentCapturedEvent" };
  }
  return { ok: true, value: input as PaymentCapturedEvent };
}

export function validatePaymentCancelledEvent(
  input: unknown,
): PaymentEventValidationResult<PaymentCancelledEvent> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["eventId"] !== "string" || String((input as Record<string, unknown>)["eventId"]).length < 1) ||
    (typeof (input as Record<string, unknown>)["eventType"] !== "string" || (input as Record<string, unknown>)["eventType"] !== "PaymentCancelled") ||
    (typeof (input as Record<string, unknown>)["eventVersion"] !== "string" || (input as Record<string, unknown>)["eventVersion"] !== "1.0") ||
    (typeof (input as Record<string, unknown>)["occurredAt"] !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test((input as Record<string, unknown>)["occurredAt"] as string) || Number.isNaN(Date.parse((input as Record<string, unknown>)["occurredAt"] as string))) ||
    (typeof (input as Record<string, unknown>)["correlationId"] !== "string" || String((input as Record<string, unknown>)["correlationId"]).length < 1) ||
    (typeof (input as Record<string, unknown>)["causationId"] !== "string" || String((input as Record<string, unknown>)["causationId"]).length < 1) ||
    (typeof (input as Record<string, unknown>)["aggregateType"] !== "string" || (input as Record<string, unknown>)["aggregateType"] !== "Payment") ||
    (typeof (input as Record<string, unknown>)["aggregateId"] !== "string" || String((input as Record<string, unknown>)["aggregateId"]).length < 1) ||
    (typeof (input as Record<string, unknown>)["payload"] !== "object" || (input as Record<string, unknown>)["payload"] === null || Array.isArray((input as Record<string, unknown>)["payload"]) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["checkoutId"] !== "string" || String(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["checkoutId"]).length < 1) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["paymentId"] !== "string" || String(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["paymentId"]).length < 1) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["providerReference"] !== "string" || String(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["providerReference"]).length < 1) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["status"] !== "string" || ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["status"] !== "CANCELLED"))
  ) {
    return { ok: false, error: "Value does not match PaymentCancelledEvent" };
  }
  return { ok: true, value: input as PaymentCancelledEvent };
}

export function validatePaymentRefundedEvent(
  input: unknown,
): PaymentEventValidationResult<PaymentRefundedEvent> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["eventId"] !== "string" || String((input as Record<string, unknown>)["eventId"]).length < 1) ||
    (typeof (input as Record<string, unknown>)["eventType"] !== "string" || (input as Record<string, unknown>)["eventType"] !== "PaymentRefunded") ||
    (typeof (input as Record<string, unknown>)["eventVersion"] !== "string" || (input as Record<string, unknown>)["eventVersion"] !== "1.0") ||
    (typeof (input as Record<string, unknown>)["occurredAt"] !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test((input as Record<string, unknown>)["occurredAt"] as string) || Number.isNaN(Date.parse((input as Record<string, unknown>)["occurredAt"] as string))) ||
    (typeof (input as Record<string, unknown>)["correlationId"] !== "string" || String((input as Record<string, unknown>)["correlationId"]).length < 1) ||
    (typeof (input as Record<string, unknown>)["causationId"] !== "string" || String((input as Record<string, unknown>)["causationId"]).length < 1) ||
    (typeof (input as Record<string, unknown>)["aggregateType"] !== "string" || (input as Record<string, unknown>)["aggregateType"] !== "Payment") ||
    (typeof (input as Record<string, unknown>)["aggregateId"] !== "string" || String((input as Record<string, unknown>)["aggregateId"]).length < 1) ||
    (typeof (input as Record<string, unknown>)["payload"] !== "object" || (input as Record<string, unknown>)["payload"] === null || Array.isArray((input as Record<string, unknown>)["payload"]) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["checkoutId"] !== "string" || String(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["checkoutId"]).length < 1) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["paymentId"] !== "string" || String(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["paymentId"]).length < 1) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["providerReference"] !== "string" || String(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["providerReference"]).length < 1) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["status"] !== "string" || ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["status"] !== "REFUNDED"))
  ) {
    return { ok: false, error: "Value does not match PaymentRefundedEvent" };
  }
  return { ok: true, value: input as PaymentRefundedEvent };
}

export function validatePaymentEvent(input: unknown): PaymentEventValidationResult<PaymentEvent> {
  const validatePaymentAuthorizedEventResult = validatePaymentAuthorizedEvent(input);
  const validatePaymentCapturedEventResult = validatePaymentCapturedEvent(input);
  const validatePaymentCancelledEventResult = validatePaymentCancelledEvent(input);
  const validatePaymentRefundedEventResult = validatePaymentRefundedEvent(input);
  if (validatePaymentAuthorizedEventResult.ok) return validatePaymentAuthorizedEventResult;
  if (validatePaymentCapturedEventResult.ok) return validatePaymentCapturedEventResult;
  if (validatePaymentCancelledEventResult.ok) return validatePaymentCancelledEventResult;
  if (validatePaymentRefundedEventResult.ok) return validatePaymentRefundedEventResult;
  return { ok: false, error: "Value does not match PaymentEvent" };
}
