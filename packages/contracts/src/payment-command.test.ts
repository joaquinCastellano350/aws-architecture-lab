import { describe, expect, it } from "vitest";

import {
  validateAuthorizePaymentCommand,
  validateCancelPaymentCommand,
  validateCapturePaymentCommand,
  validatePaymentCommandOutcome,
  validateRefundPaymentCommand,
  validateRetrievePaymentCommand,
} from "./generated/payment-command.js";

describe("Payment command JSON schemas", () => {
  it("accepts provider-neutral authorize, capture, cancel, refund, and retrieve commands", () => {
    expect(validateAuthorizePaymentCommand({
      ...baseCommand("AuthorizePayment", "authorize-checkout-123"),
      amountMinor: 1250,
      currency: "USD",
    }).ok).toBe(true);
    expect(validateCapturePaymentCommand(
      baseCommand("CapturePayment", "capture-checkout-123"),
    ).ok).toBe(true);
    expect(validateCancelPaymentCommand(
      baseCommand("CancelPayment", "cancel-checkout-123"),
    ).ok).toBe(true);
    expect(validateRefundPaymentCommand({
      ...baseCommand("RefundPayment", "refund-checkout-123"),
      amountMinor: 1250,
    }).ok).toBe(true);
    expect(validateRetrievePaymentCommand(
      baseCommand("RetrievePayment", "retrieve-checkout-123"),
    ).ok).toBe(true);
  });

  it.each([
    "AUTHORIZED",
    "CAPTURED",
    "CANCELLED",
    "REFUNDED",
  ])("accepts the typed applied %s outcome", (status) => {
    expect(validatePaymentCommandOutcome({
      schemaVersion: "1.0",
      operationId: "payment-operation-checkout-123",
      checkoutId: "checkout-123",
      paymentId: "payment-checkout-123",
      status,
      providerReference: "fake-payment-checkout-123",
    }).ok).toBe(true);
  });

  it("accepts typed rejected, not-found, and reconciliation outcomes", () => {
    expect(validatePaymentCommandOutcome({
      schemaVersion: "1.0",
      operationId: "authorize-payment-123",
      checkoutId: "checkout-123",
      paymentId: "payment-123",
      status: "REJECTED",
      rejectionCode: "PAYMENT_DECLINED",
    }).ok).toBe(true);
    for (const status of ["NOT_FOUND", "RECONCILIATION_REQUIRED"]) {
      expect(validatePaymentCommandOutcome({
        schemaVersion: "1.0",
        operationId: "retrieve-payment-123",
        checkoutId: "checkout-123",
        paymentId: "payment-123",
        status,
      }).ok).toBe(true);
    }
  });

  it("rejects malformed commands and provider-specific statuses", () => {
    expect(validateAuthorizePaymentCommand({
      ...baseCommand("AuthorizePayment", "authorize-checkout-123"),
      amountMinor: 0,
      currency: "usd",
    }).ok).toBe(false);
    expect(validatePaymentCommandOutcome({
      schemaVersion: "1.0",
      operationId: "capture-checkout-123",
      checkoutId: "checkout-123",
      paymentId: "payment-checkout-123",
      status: "requires_capture",
    }).ok).toBe(false);
    expect(validatePaymentCommandOutcome({
      schemaVersion: "1.0",
      operationId: "capture-checkout-123",
      checkoutId: "checkout-123",
      paymentId: "payment-checkout-123",
      status: "CAPTURED",
    }).ok).toBe(false);
    expect(validatePaymentCommandOutcome({
      schemaVersion: "1.0",
      operationId: "authorize-checkout-123",
      checkoutId: "checkout-123",
      paymentId: "payment-checkout-123",
      status: "REJECTED",
    }).ok).toBe(false);
  });
});

function baseCommand(commandType: string, operationId: string) {
  return {
    schemaVersion: "1.0",
    commandType,
    operationId,
    checkoutId: "checkout-123",
    paymentId: "payment-checkout-123",
    correlationId: "correlation-123",
    causationId: "execution-123",
  };
}
