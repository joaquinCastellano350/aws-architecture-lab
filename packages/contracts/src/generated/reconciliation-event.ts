// Generated from schemas/reconciliation-*-event.v1.json. Do not edit by hand.

export interface ReconciliationRequiredEvent {
  readonly eventId: string;
  readonly eventType: "ReconciliationRequired";
  readonly eventVersion: "1.0";
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly aggregateType: "Reconciliation";
  readonly aggregateId: string;
  readonly payload: { readonly checkoutId: string; readonly status: "RECONCILIATION_REQUIRED"; readonly failedInvariant: string; readonly requiredAction: "COMPENSATE_INVENTORY" | "COMPENSATE_PAYMENT_AUTHORIZATION" | "COMPENSATE_RESERVED_FULFILLMENT" | "COMPENSATE_CAPTURED_PAYMENT" | "RECOVER_FULFILLMENT_HANDOFF" | "CONFIRM_ORDER"; readonly attempts: number; readonly workflowVersionArn: string; readonly [key: string]: unknown };
  readonly [key: string]: unknown;
}

export interface ReconciliationResolvedEvent {
  readonly eventId: string;
  readonly eventType: "ReconciliationResolved";
  readonly eventVersion: "1.0";
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly aggregateType: "Reconciliation";
  readonly aggregateId: string;
  readonly payload: { readonly checkoutId: string; readonly status: "RESOLVED"; readonly attempts: number; readonly [key: string]: unknown };
  readonly [key: string]: unknown;
}

export type ReconciliationEventValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

export function validateReconciliationRequiredEvent(
  input: unknown,
): ReconciliationEventValidationResult<ReconciliationRequiredEvent> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["eventId"] !== "string" || String((input as Record<string, unknown>)["eventId"]).length < 1 || String((input as Record<string, unknown>)["eventId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["eventType"] !== "string" || (input as Record<string, unknown>)["eventType"] !== "ReconciliationRequired") ||
    (typeof (input as Record<string, unknown>)["eventVersion"] !== "string" || (input as Record<string, unknown>)["eventVersion"] !== "1.0") ||
    (typeof (input as Record<string, unknown>)["occurredAt"] !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test((input as Record<string, unknown>)["occurredAt"] as string) || Number.isNaN(Date.parse((input as Record<string, unknown>)["occurredAt"] as string))) ||
    (typeof (input as Record<string, unknown>)["correlationId"] !== "string" || String((input as Record<string, unknown>)["correlationId"]).length < 1 || String((input as Record<string, unknown>)["correlationId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["causationId"] !== "string" || String((input as Record<string, unknown>)["causationId"]).length < 1 || String((input as Record<string, unknown>)["causationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["aggregateType"] !== "string" || (input as Record<string, unknown>)["aggregateType"] !== "Reconciliation") ||
    (typeof (input as Record<string, unknown>)["aggregateId"] !== "string" || String((input as Record<string, unknown>)["aggregateId"]).length < 1 || String((input as Record<string, unknown>)["aggregateId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["payload"] !== "object" || (input as Record<string, unknown>)["payload"] === null || Array.isArray((input as Record<string, unknown>)["payload"]) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["checkoutId"] !== "string" || String(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["checkoutId"]).length < 1 || String(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["checkoutId"]).length > 128) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["status"] !== "string" || ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["status"] !== "RECONCILIATION_REQUIRED") || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["failedInvariant"] !== "string" || String(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["failedInvariant"]).length < 1 || String(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["failedInvariant"]).length > 256) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["requiredAction"] !== "string" || !["COMPENSATE_INVENTORY", "COMPENSATE_PAYMENT_AUTHORIZATION", "COMPENSATE_RESERVED_FULFILLMENT", "COMPENSATE_CAPTURED_PAYMENT", "RECOVER_FULFILLMENT_HANDOFF", "CONFIRM_ORDER"].includes(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["requiredAction"] as string)) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["attempts"] !== "number" || !Number.isInteger(Number(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["attempts"])) || Number(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["attempts"]) < 1 || Number(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["attempts"]) > 100) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["workflowVersionArn"] !== "string" || String(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["workflowVersionArn"]).length < 1 || String(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["workflowVersionArn"]).length > 2048))
  ) {
    return { ok: false, error: "Value does not match ReconciliationRequiredEvent" };
  }
  return { ok: true, value: input as ReconciliationRequiredEvent };
}

export function validateReconciliationResolvedEvent(
  input: unknown,
): ReconciliationEventValidationResult<ReconciliationResolvedEvent> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["eventId"] !== "string" || String((input as Record<string, unknown>)["eventId"]).length < 1 || String((input as Record<string, unknown>)["eventId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["eventType"] !== "string" || (input as Record<string, unknown>)["eventType"] !== "ReconciliationResolved") ||
    (typeof (input as Record<string, unknown>)["eventVersion"] !== "string" || (input as Record<string, unknown>)["eventVersion"] !== "1.0") ||
    (typeof (input as Record<string, unknown>)["occurredAt"] !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test((input as Record<string, unknown>)["occurredAt"] as string) || Number.isNaN(Date.parse((input as Record<string, unknown>)["occurredAt"] as string))) ||
    (typeof (input as Record<string, unknown>)["correlationId"] !== "string" || String((input as Record<string, unknown>)["correlationId"]).length < 1 || String((input as Record<string, unknown>)["correlationId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["causationId"] !== "string" || String((input as Record<string, unknown>)["causationId"]).length < 1 || String((input as Record<string, unknown>)["causationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["aggregateType"] !== "string" || (input as Record<string, unknown>)["aggregateType"] !== "Reconciliation") ||
    (typeof (input as Record<string, unknown>)["aggregateId"] !== "string" || String((input as Record<string, unknown>)["aggregateId"]).length < 1 || String((input as Record<string, unknown>)["aggregateId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["payload"] !== "object" || (input as Record<string, unknown>)["payload"] === null || Array.isArray((input as Record<string, unknown>)["payload"]) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["checkoutId"] !== "string" || String(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["checkoutId"]).length < 1 || String(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["checkoutId"]).length > 128) || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["status"] !== "string" || ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["status"] !== "RESOLVED") || (typeof ((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["attempts"] !== "number" || !Number.isInteger(Number(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["attempts"])) || Number(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["attempts"]) < 1 || Number(((input as Record<string, unknown>)["payload"] as Record<string, unknown>)["attempts"]) > 100))
  ) {
    return { ok: false, error: "Value does not match ReconciliationResolvedEvent" };
  }
  return { ok: true, value: input as ReconciliationResolvedEvent };
}

