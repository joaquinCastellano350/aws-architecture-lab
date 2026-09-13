// Generated from openapi/checkout-api.json. Do not edit by hand.

export const checkoutApiVersion = "4.0.0";
export const checkoutApiPaths = {
  submit: "/checkouts",
  status: "/checkouts/{checkoutId}",
} as const;
export const idempotencyKeyHeaderName = "Idempotency-Key";

export interface SubmitCheckoutRequest {
  readonly contractVersion: "1.0";
  readonly cartId: string;
  readonly correlationId: string;
  readonly itemId?: string;
  readonly quantity?: number;
  readonly [key: string]: unknown;
}

export interface SubmitCheckoutResponse {
  readonly checkoutId: string;
  readonly statusLocation: string;
}

export interface CheckoutStatusResponse {
  readonly checkoutId: string;
  readonly status: "PENDING" | "INVENTORY_UNAVAILABLE" | "EXPIRED" | "CANCELLED" | "CONFIRMED";
  readonly correlationId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Problem {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail?: string;
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

export function checkoutStatusPath(checkoutId: string): string {
  return checkoutApiPaths.status.replace("{checkoutId}", encodeURIComponent(checkoutId));
}

export function checkoutIdFromStatusPath(path: string): string | undefined {
  const parts = checkoutApiPaths.status.split("{checkoutId}");
  const prefix = parts[0] ?? "";
  const suffix = parts[1] ?? "";
  if (!path.startsWith(prefix) || !path.endsWith(suffix)) return undefined;
  const encoded = path.slice(prefix.length, path.length - suffix.length);
  if (encoded.length === 0 || encoded.includes("/")) return undefined;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
}

export function validateIdempotencyKey(value: unknown): value is string {
  return !(typeof value !== "string" || String(value).length < 1 || String(value).length > 128);
}

export function validateSubmitCheckoutRequest(
  input: unknown,
): ValidationResult<SubmitCheckoutRequest> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["contractVersion"] !== "string" || !["1.0"].includes((input as Record<string, unknown>)["contractVersion"] as string)) ||
    (typeof (input as Record<string, unknown>)["cartId"] !== "string" || String((input as Record<string, unknown>)["cartId"]).length < 1 || String((input as Record<string, unknown>)["cartId"]).length > 128) ||
    (typeof (input as Record<string, unknown>)["correlationId"] !== "string" || String((input as Record<string, unknown>)["correlationId"]).length < 1 || String((input as Record<string, unknown>)["correlationId"]).length > 128) ||
    ((input as Record<string, unknown>)["itemId"] !== undefined && (typeof (input as Record<string, unknown>)["itemId"] !== "string" || String((input as Record<string, unknown>)["itemId"]).length < 1 || String((input as Record<string, unknown>)["itemId"]).length > 128)) ||
    ((input as Record<string, unknown>)["quantity"] !== undefined && (typeof (input as Record<string, unknown>)["quantity"] !== "number" || !Number.isInteger(Number((input as Record<string, unknown>)["quantity"])) || Number((input as Record<string, unknown>)["quantity"]) < 1 || Number((input as Record<string, unknown>)["quantity"]) > 1000))
  ) {
    return { ok: false, error: "Request body does not match SubmitCheckoutRequest v1.0" };
  }
  return { ok: true, value: input as SubmitCheckoutRequest };
}

export function validateSubmitCheckoutResponse(
  input: unknown,
): ValidationResult<SubmitCheckoutResponse> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["checkoutId"] !== "string") ||
    (typeof (input as Record<string, unknown>)["statusLocation"] !== "string")
  ) {
    return { ok: false, error: "Response does not match SubmitCheckoutResponse" };
  }
  return { ok: true, value: input as SubmitCheckoutResponse };
}

export function validateCheckoutStatusResponse(
  input: unknown,
): ValidationResult<CheckoutStatusResponse> {
  if (
    typeof input !== "object" ||
    input === null ||
    (typeof (input as Record<string, unknown>)["checkoutId"] !== "string") ||
    (typeof (input as Record<string, unknown>)["status"] !== "string" || !["PENDING", "INVENTORY_UNAVAILABLE", "EXPIRED", "CANCELLED", "CONFIRMED"].includes((input as Record<string, unknown>)["status"] as string)) ||
    (typeof (input as Record<string, unknown>)["correlationId"] !== "string") ||
    (typeof (input as Record<string, unknown>)["createdAt"] !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test((input as Record<string, unknown>)["createdAt"] as string) || Number.isNaN(Date.parse((input as Record<string, unknown>)["createdAt"] as string))) ||
    (typeof (input as Record<string, unknown>)["updatedAt"] !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test((input as Record<string, unknown>)["updatedAt"] as string) || Number.isNaN(Date.parse((input as Record<string, unknown>)["updatedAt"] as string)))
  ) {
    return { ok: false, error: "Response does not match CheckoutStatusResponse" };
  }
  return { ok: true, value: input as CheckoutStatusResponse };
}

