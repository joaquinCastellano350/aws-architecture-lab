import { describe, expect, it } from "vitest";

import {
  checkoutApiPaths,
  checkoutIdFromStatusPath,
  checkoutStatusPath,
  idempotencyKeyHeaderName,
  validateCheckoutStatusResponse,
  validateIdempotencyKey,
  validateSubmitCheckoutRequest,
  validateSubmitCheckoutResponse,
  type SubmitCheckoutRequest,
} from "./generated/checkout-api.js";

describe("checkout OpenAPI contract", () => {
  it("accepts a versioned checkout submission and tolerates additive fields", () => {
    const request = {
      contractVersion: "1.0",
      cartId: "cart-123",
      correlationId: "corr-123",
      futureField: "ignored by this consumer",
    } as const;

    const result = validateSubmitCheckoutRequest(request);

    expect(result).toEqual({
      ok: true,
      value: request satisfies SubmitCheckoutRequest,
    });
  });

  it.each([
    {},
    { contractVersion: "2.0", cartId: "cart-123", correlationId: "corr-123" },
    { contractVersion: "1.0", cartId: "", correlationId: "corr-123" },
    { contractVersion: "1.0", cartId: "cart-123" },
  ])("rejects malformed submissions without accepting partial data", (request) => {
    expect(validateSubmitCheckoutRequest(request)).toEqual({
      ok: false,
      error: "Request body does not match SubmitCheckoutRequest v1.0",
    });
  });

  it("generates routes, header validation, and response validation from OpenAPI", () => {
    expect(checkoutApiPaths.submit).toBe("/checkouts");
    expect(idempotencyKeyHeaderName).toBe("Idempotency-Key");
    expect(validateIdempotencyKey("request-123")).toBe(true);
    expect(validateIdempotencyKey("")).toBe(false);
    expect(checkoutStatusPath("checkout/123")).toBe("/checkouts/checkout%2F123");
    expect(checkoutIdFromStatusPath("/checkouts/checkout%2F123")).toBe("checkout/123");
    expect(validateSubmitCheckoutResponse({
      checkoutId: "checkout-123",
      statusLocation: "/checkouts/checkout-123",
    }).ok).toBe(true);
    expect(validateCheckoutStatusResponse({
      checkoutId: "checkout-123",
      status: "PENDING",
      correlationId: "corr-123",
      createdAt: "2026-09-07T12:00:00.000Z",
      updatedAt: "2026-09-07T12:00:00.000Z",
    }).ok).toBe(true);
    expect(validateCheckoutStatusResponse({
      checkoutId: "checkout-123",
      status: "PENDING",
      correlationId: "corr-123",
      createdAt: "not-a-date",
      updatedAt: "2026-09-07T12:00:00.000Z",
    }).ok).toBe(false);
  });
});
