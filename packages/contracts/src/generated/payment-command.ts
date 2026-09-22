// Generated from schemas/*-payment-command*.v1.json. Do not edit by hand.

export interface AuthorizePaymentCommand {
  readonly schemaVersion: "1.0";
  readonly commandType: "AuthorizePayment";
  readonly operationId: string;
  readonly checkoutId: string;
  readonly paymentId: string;
  readonly amountMinor: number;
  readonly currency: "USD";
  readonly correlationId: string;
  readonly causationId: string;
  readonly [key: string]: unknown;
}

export interface CapturePaymentCommand {
  readonly schemaVersion: "1.0";
  readonly commandType: "CapturePayment";
  readonly operationId: string;
  readonly checkoutId: string;
  readonly paymentId: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly [key: string]: unknown;
}

export interface CancelPaymentCommand {
  readonly schemaVersion: "1.0";
  readonly commandType: "CancelPayment";
  readonly operationId: string;
  readonly checkoutId: string;
  readonly paymentId: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly [key: string]: unknown;
}

export interface RefundPaymentCommand {
  readonly schemaVersion: "1.0";
  readonly commandType: "RefundPayment";
  readonly operationId: string;
  readonly checkoutId: string;
  readonly paymentId: string;
  readonly amountMinor: number;
  readonly correlationId: string;
  readonly causationId: string;
  readonly [key: string]: unknown;
}

export interface RetrievePaymentCommand {
  readonly schemaVersion: "1.0";
  readonly commandType: "RetrievePayment";
  readonly operationId: string;
  readonly checkoutId: string;
  readonly paymentId: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly [key: string]: unknown;
}

export interface PaymentAppliedOutcome {
  readonly schemaVersion: "1.0";
  readonly operationId: string;
  readonly checkoutId: string;
  readonly paymentId: string;
  readonly status: "AUTHORIZED" | "CAPTURED" | "CANCELLED" | "REFUNDED";
  readonly providerReference: string;
  readonly [key: string]: unknown;
}

export interface PaymentRejectedOutcome {
  readonly schemaVersion: "1.0";
  readonly operationId: string;
  readonly checkoutId: string;
  readonly paymentId: string;
  readonly status: "REJECTED";
  readonly rejectionCode: string;
  readonly [key: string]: unknown;
}

export interface PaymentNotFoundOutcome {
  readonly schemaVersion: "1.0";
  readonly operationId: string;
  readonly checkoutId: string;
  readonly paymentId: string;
  readonly status: "NOT_FOUND";
  readonly [key: string]: unknown;
}

export interface PaymentReconciliationRequiredOutcome {
  readonly schemaVersion: "1.0";
  readonly operationId: string;
  readonly checkoutId: string;
  readonly paymentId: string;
  readonly status: "RECONCILIATION_REQUIRED";
  readonly [key: string]: unknown;
}

export type PaymentCommand =
  | AuthorizePaymentCommand
  | CapturePaymentCommand
  | CancelPaymentCommand
  | RefundPaymentCommand
  | RetrievePaymentCommand;

export type PaymentCommandOutcome =
  PaymentAppliedOutcome
  | PaymentRejectedOutcome
  | PaymentNotFoundOutcome
  | PaymentReconciliationRequiredOutcome;

export type PaymentContractValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

export function validateAuthorizePaymentCommand(
  input: unknown,
): PaymentContractValidationResult<AuthorizePaymentCommand> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["schemaVersion"] !== "string" || (input as Record<string, unknown>)["schemaVersion"] !== "1.0") ||
    (typeof (input as Record<string, unknown>)["commandType"] !== "string" || (input as Record<string, unknown>)["commandType"] !== "AuthorizePayment") ||
    (typeof (input as Record<string, unknown>)["operationId"] !== "string" || String((input as Record<string, unknown>)["operationId"]).length < 1 || String((input as Record<string, unknown>)["operationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["checkoutId"] !== "string" || String((input as Record<string, unknown>)["checkoutId"]).length < 1 || String((input as Record<string, unknown>)["checkoutId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["paymentId"] !== "string" || String((input as Record<string, unknown>)["paymentId"]).length < 1 || String((input as Record<string, unknown>)["paymentId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["amountMinor"] !== "number" || !Number.isInteger(Number((input as Record<string, unknown>)["amountMinor"])) || Number((input as Record<string, unknown>)["amountMinor"]) < 1 || Number((input as Record<string, unknown>)["amountMinor"]) > 1000000) ||
    (typeof (input as Record<string, unknown>)["currency"] !== "string" || !["USD"].includes((input as Record<string, unknown>)["currency"] as string)) ||
    (typeof (input as Record<string, unknown>)["correlationId"] !== "string" || String((input as Record<string, unknown>)["correlationId"]).length < 1 || String((input as Record<string, unknown>)["correlationId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["causationId"] !== "string" || String((input as Record<string, unknown>)["causationId"]).length < 1 || String((input as Record<string, unknown>)["causationId"]).length > 256)
  ) {
    return { ok: false, error: "Value does not match AuthorizePaymentCommand" };
  }
  return { ok: true, value: input as AuthorizePaymentCommand };
}

export function validateCapturePaymentCommand(
  input: unknown,
): PaymentContractValidationResult<CapturePaymentCommand> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["schemaVersion"] !== "string" || (input as Record<string, unknown>)["schemaVersion"] !== "1.0") ||
    (typeof (input as Record<string, unknown>)["commandType"] !== "string" || (input as Record<string, unknown>)["commandType"] !== "CapturePayment") ||
    (typeof (input as Record<string, unknown>)["operationId"] !== "string" || String((input as Record<string, unknown>)["operationId"]).length < 1 || String((input as Record<string, unknown>)["operationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["checkoutId"] !== "string" || String((input as Record<string, unknown>)["checkoutId"]).length < 1 || String((input as Record<string, unknown>)["checkoutId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["paymentId"] !== "string" || String((input as Record<string, unknown>)["paymentId"]).length < 1 || String((input as Record<string, unknown>)["paymentId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["correlationId"] !== "string" || String((input as Record<string, unknown>)["correlationId"]).length < 1 || String((input as Record<string, unknown>)["correlationId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["causationId"] !== "string" || String((input as Record<string, unknown>)["causationId"]).length < 1 || String((input as Record<string, unknown>)["causationId"]).length > 256)
  ) {
    return { ok: false, error: "Value does not match CapturePaymentCommand" };
  }
  return { ok: true, value: input as CapturePaymentCommand };
}

export function validateCancelPaymentCommand(
  input: unknown,
): PaymentContractValidationResult<CancelPaymentCommand> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["schemaVersion"] !== "string" || (input as Record<string, unknown>)["schemaVersion"] !== "1.0") ||
    (typeof (input as Record<string, unknown>)["commandType"] !== "string" || (input as Record<string, unknown>)["commandType"] !== "CancelPayment") ||
    (typeof (input as Record<string, unknown>)["operationId"] !== "string" || String((input as Record<string, unknown>)["operationId"]).length < 1 || String((input as Record<string, unknown>)["operationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["checkoutId"] !== "string" || String((input as Record<string, unknown>)["checkoutId"]).length < 1 || String((input as Record<string, unknown>)["checkoutId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["paymentId"] !== "string" || String((input as Record<string, unknown>)["paymentId"]).length < 1 || String((input as Record<string, unknown>)["paymentId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["correlationId"] !== "string" || String((input as Record<string, unknown>)["correlationId"]).length < 1 || String((input as Record<string, unknown>)["correlationId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["causationId"] !== "string" || String((input as Record<string, unknown>)["causationId"]).length < 1 || String((input as Record<string, unknown>)["causationId"]).length > 256)
  ) {
    return { ok: false, error: "Value does not match CancelPaymentCommand" };
  }
  return { ok: true, value: input as CancelPaymentCommand };
}

export function validateRefundPaymentCommand(
  input: unknown,
): PaymentContractValidationResult<RefundPaymentCommand> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["schemaVersion"] !== "string" || (input as Record<string, unknown>)["schemaVersion"] !== "1.0") ||
    (typeof (input as Record<string, unknown>)["commandType"] !== "string" || (input as Record<string, unknown>)["commandType"] !== "RefundPayment") ||
    (typeof (input as Record<string, unknown>)["operationId"] !== "string" || String((input as Record<string, unknown>)["operationId"]).length < 1 || String((input as Record<string, unknown>)["operationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["checkoutId"] !== "string" || String((input as Record<string, unknown>)["checkoutId"]).length < 1 || String((input as Record<string, unknown>)["checkoutId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["paymentId"] !== "string" || String((input as Record<string, unknown>)["paymentId"]).length < 1 || String((input as Record<string, unknown>)["paymentId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["amountMinor"] !== "number" || !Number.isInteger(Number((input as Record<string, unknown>)["amountMinor"])) || Number((input as Record<string, unknown>)["amountMinor"]) < 1 || Number((input as Record<string, unknown>)["amountMinor"]) > 1000000) ||
    (typeof (input as Record<string, unknown>)["correlationId"] !== "string" || String((input as Record<string, unknown>)["correlationId"]).length < 1 || String((input as Record<string, unknown>)["correlationId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["causationId"] !== "string" || String((input as Record<string, unknown>)["causationId"]).length < 1 || String((input as Record<string, unknown>)["causationId"]).length > 256)
  ) {
    return { ok: false, error: "Value does not match RefundPaymentCommand" };
  }
  return { ok: true, value: input as RefundPaymentCommand };
}

export function validateRetrievePaymentCommand(
  input: unknown,
): PaymentContractValidationResult<RetrievePaymentCommand> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["schemaVersion"] !== "string" || (input as Record<string, unknown>)["schemaVersion"] !== "1.0") ||
    (typeof (input as Record<string, unknown>)["commandType"] !== "string" || (input as Record<string, unknown>)["commandType"] !== "RetrievePayment") ||
    (typeof (input as Record<string, unknown>)["operationId"] !== "string" || String((input as Record<string, unknown>)["operationId"]).length < 1 || String((input as Record<string, unknown>)["operationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["checkoutId"] !== "string" || String((input as Record<string, unknown>)["checkoutId"]).length < 1 || String((input as Record<string, unknown>)["checkoutId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["paymentId"] !== "string" || String((input as Record<string, unknown>)["paymentId"]).length < 1 || String((input as Record<string, unknown>)["paymentId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["correlationId"] !== "string" || String((input as Record<string, unknown>)["correlationId"]).length < 1 || String((input as Record<string, unknown>)["correlationId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["causationId"] !== "string" || String((input as Record<string, unknown>)["causationId"]).length < 1 || String((input as Record<string, unknown>)["causationId"]).length > 256)
  ) {
    return { ok: false, error: "Value does not match RetrievePaymentCommand" };
  }
  return { ok: true, value: input as RetrievePaymentCommand };
}

export function validatePaymentAppliedOutcome(
  input: unknown,
): PaymentContractValidationResult<PaymentAppliedOutcome> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["schemaVersion"] !== "string" || (input as Record<string, unknown>)["schemaVersion"] !== "1.0") ||
    (typeof (input as Record<string, unknown>)["operationId"] !== "string" || String((input as Record<string, unknown>)["operationId"]).length < 1 || String((input as Record<string, unknown>)["operationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["checkoutId"] !== "string" || String((input as Record<string, unknown>)["checkoutId"]).length < 1 || String((input as Record<string, unknown>)["checkoutId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["paymentId"] !== "string" || String((input as Record<string, unknown>)["paymentId"]).length < 1 || String((input as Record<string, unknown>)["paymentId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["status"] !== "string" || !["AUTHORIZED", "CAPTURED", "CANCELLED", "REFUNDED"].includes((input as Record<string, unknown>)["status"] as string)) ||
    (typeof (input as Record<string, unknown>)["providerReference"] !== "string" || String((input as Record<string, unknown>)["providerReference"]).length < 1 || String((input as Record<string, unknown>)["providerReference"]).length > 256)
  ) {
    return { ok: false, error: "Value does not match PaymentAppliedOutcome" };
  }
  return { ok: true, value: input as PaymentAppliedOutcome };
}

export function validatePaymentRejectedOutcome(
  input: unknown,
): PaymentContractValidationResult<PaymentRejectedOutcome> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["schemaVersion"] !== "string" || (input as Record<string, unknown>)["schemaVersion"] !== "1.0") ||
    (typeof (input as Record<string, unknown>)["operationId"] !== "string" || String((input as Record<string, unknown>)["operationId"]).length < 1 || String((input as Record<string, unknown>)["operationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["checkoutId"] !== "string" || String((input as Record<string, unknown>)["checkoutId"]).length < 1 || String((input as Record<string, unknown>)["checkoutId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["paymentId"] !== "string" || String((input as Record<string, unknown>)["paymentId"]).length < 1 || String((input as Record<string, unknown>)["paymentId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["status"] !== "string" || (input as Record<string, unknown>)["status"] !== "REJECTED") ||
    (typeof (input as Record<string, unknown>)["rejectionCode"] !== "string" || String((input as Record<string, unknown>)["rejectionCode"]).length < 1 || String((input as Record<string, unknown>)["rejectionCode"]).length > 128)
  ) {
    return { ok: false, error: "Value does not match PaymentRejectedOutcome" };
  }
  return { ok: true, value: input as PaymentRejectedOutcome };
}

export function validatePaymentNotFoundOutcome(
  input: unknown,
): PaymentContractValidationResult<PaymentNotFoundOutcome> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["schemaVersion"] !== "string" || (input as Record<string, unknown>)["schemaVersion"] !== "1.0") ||
    (typeof (input as Record<string, unknown>)["operationId"] !== "string" || String((input as Record<string, unknown>)["operationId"]).length < 1 || String((input as Record<string, unknown>)["operationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["checkoutId"] !== "string" || String((input as Record<string, unknown>)["checkoutId"]).length < 1 || String((input as Record<string, unknown>)["checkoutId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["paymentId"] !== "string" || String((input as Record<string, unknown>)["paymentId"]).length < 1 || String((input as Record<string, unknown>)["paymentId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["status"] !== "string" || (input as Record<string, unknown>)["status"] !== "NOT_FOUND")
  ) {
    return { ok: false, error: "Value does not match PaymentNotFoundOutcome" };
  }
  return { ok: true, value: input as PaymentNotFoundOutcome };
}

export function validatePaymentReconciliationRequiredOutcome(
  input: unknown,
): PaymentContractValidationResult<PaymentReconciliationRequiredOutcome> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["schemaVersion"] !== "string" || (input as Record<string, unknown>)["schemaVersion"] !== "1.0") ||
    (typeof (input as Record<string, unknown>)["operationId"] !== "string" || String((input as Record<string, unknown>)["operationId"]).length < 1 || String((input as Record<string, unknown>)["operationId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["checkoutId"] !== "string" || String((input as Record<string, unknown>)["checkoutId"]).length < 1 || String((input as Record<string, unknown>)["checkoutId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["paymentId"] !== "string" || String((input as Record<string, unknown>)["paymentId"]).length < 1 || String((input as Record<string, unknown>)["paymentId"]).length > 256) ||
    (typeof (input as Record<string, unknown>)["status"] !== "string" || (input as Record<string, unknown>)["status"] !== "RECONCILIATION_REQUIRED")
  ) {
    return { ok: false, error: "Value does not match PaymentReconciliationRequiredOutcome" };
  }
  return { ok: true, value: input as PaymentReconciliationRequiredOutcome };
}

export function validatePaymentCommandOutcome(
  input: unknown,
): PaymentContractValidationResult<PaymentCommandOutcome> {
  const validatePaymentAppliedOutcomeResult = validatePaymentAppliedOutcome(input);
  const validatePaymentRejectedOutcomeResult = validatePaymentRejectedOutcome(input);
  const validatePaymentNotFoundOutcomeResult = validatePaymentNotFoundOutcome(input);
  const validatePaymentReconciliationRequiredOutcomeResult = validatePaymentReconciliationRequiredOutcome(input);
  if (validatePaymentAppliedOutcomeResult.ok) return validatePaymentAppliedOutcomeResult;
  if (validatePaymentRejectedOutcomeResult.ok) return validatePaymentRejectedOutcomeResult;
  if (validatePaymentNotFoundOutcomeResult.ok) return validatePaymentNotFoundOutcomeResult;
  if (validatePaymentReconciliationRequiredOutcomeResult.ok) return validatePaymentReconciliationRequiredOutcomeResult;
  return { ok: false, error: "Value does not match PaymentCommandOutcome" };
}
