import { describe, expect, it, vi } from "vitest";

import { createPaymentCommandHandler } from "./payment-command-handler.js";

describe("Payment command handler", () => {
  it("accepts a versioned command and returns a typed business outcome", async () => {
    const execute = vi.fn().mockResolvedValue({
      schemaVersion: "1.0",
      operationId: "authorize-checkout-123",
      checkoutId: "checkout-123",
      paymentId: "payment-123",
      status: "AUTHORIZED",
      providerReference: "fake-payment-payment-123",
    });
    const handler = createPaymentCommandHandler({ execute });
    const command = {
      schemaVersion: "1.0",
      commandType: "AuthorizePayment",
      operationId: "authorize-checkout-123",
      checkoutId: "checkout-123",
      paymentId: "payment-123",
      amountMinor: 1250,
      currency: "USD",
      correlationId: "correlation-123",
      causationId: "execution-123",
    };

    await expect(handler(command)).resolves.toEqual(expect.objectContaining({
      status: "AUTHORIZED",
    }));
    expect(execute).toHaveBeenCalledWith(command);
  });

  it("rejects malformed and unsupported commands before invoking Payment", async () => {
    const execute = vi.fn();
    const handler = createPaymentCommandHandler({ execute });

    await expect(handler({ commandType: "ChargeCard" })).rejects.toThrow(
      "Unsupported Payment command",
    );
    await expect(handler({ commandType: "CapturePayment" })).rejects.toThrow(
      "Value does not match CapturePaymentCommand",
    );
    expect(execute).not.toHaveBeenCalled();
  });
});
