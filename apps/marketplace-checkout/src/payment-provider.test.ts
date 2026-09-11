import { describe, expect, it } from "vitest";

import {
  DeterministicPaymentProvider,
  PaymentProviderResponseLostError,
  PaymentProviderThrottledError,
  PaymentProviderTimeoutError,
} from "./payment-provider.js";

describe("Payment Provider contract", () => {
  providerContract(() => new DeterministicPaymentProvider());
});

function providerContract(createProvider: () => DeterministicPaymentProvider): void {
  it("authorizes for manual capture and applies each economic transition once", async () => {
    const provider = createProvider();

    await expect(provider.authorize(authorizeRequest())).resolves.toEqual({
      kind: "APPLIED",
      providerReference: "fake-payment-payment-123",
      status: "AUTHORIZED",
    });
    await expect(provider.capture(mutationRequest("capture:checkout-123"))).resolves.toEqual({
      kind: "APPLIED",
      providerReference: "fake-payment-payment-123",
      status: "CAPTURED",
    });
    await expect(provider.refund({
      ...mutationRequest("refund:checkout-123"),
      amountMinor: 1250,
    })).resolves.toEqual({
      kind: "APPLIED",
      providerReference: "fake-payment-payment-123",
      status: "REFUNDED",
    });

    expect(provider.mutationCount("capture:checkout-123")).toBe(1);
    await provider.capture(mutationRequest("capture:checkout-123"));
    expect(provider.mutationCount("capture:checkout-123")).toBe(1);
  });

  it("cancels an uncaptured authorization and rejects an illegal capture", async () => {
    const provider = createProvider();
    await provider.authorize(authorizeRequest());

    await expect(provider.cancel(mutationRequest("cancel:checkout-123"))).resolves.toEqual(
      expect.objectContaining({ kind: "APPLIED", status: "CANCELLED" }),
    );
    await expect(provider.capture(mutationRequest("capture:after-cancel"))).resolves.toEqual({
      kind: "REJECTED",
      rejectionCode: "PAYMENT_NOT_AUTHORIZED",
    });
  });

  it("returns a stable business rejection without creating a payment", async () => {
    const provider = new DeterministicPaymentProvider({
      failurePlan: { "authorize:checkout-123": ["BUSINESS_REJECTION"] },
    });

    const first = await provider.authorize(authorizeRequest());
    const replay = await provider.authorize(authorizeRequest());

    expect(first).toEqual({ kind: "REJECTED", rejectionCode: "PAYMENT_DECLINED" });
    expect(replay).toEqual(first);
    await expect(provider.retrieve({ paymentId: "payment-123" })).resolves.toEqual({
      kind: "NOT_FOUND",
    });
  });

  it.each([
    ["THROTTLE", PaymentProviderThrottledError],
    ["TIMEOUT", PaymentProviderTimeoutError],
  ] as const)("models %s before mutation", async (effect, expectedError) => {
    const provider = new DeterministicPaymentProvider({
      failurePlan: { "authorize:checkout-123": [effect] },
    });

    await expect(provider.authorize(authorizeRequest())).rejects.toBeInstanceOf(expectedError);
    expect(provider.mutationCount("authorize:checkout-123")).toBe(0);
    await expect(provider.authorize(authorizeRequest())).resolves.toEqual(
      expect.objectContaining({ kind: "APPLIED", status: "AUTHORIZED" }),
    );
  });

  it("recovers a commit whose response was lost without capturing twice", async () => {
    const provider = new DeterministicPaymentProvider({
      failurePlan: { "capture:checkout-123": ["COMMIT_THEN_LOST_RESPONSE"] },
    });
    await provider.authorize(authorizeRequest());

    await expect(provider.capture(mutationRequest("capture:checkout-123"))).rejects
      .toBeInstanceOf(PaymentProviderResponseLostError);
    await expect(provider.retrieve({ paymentId: "payment-123" })).resolves.toEqual({
      kind: "FOUND",
      providerReference: "fake-payment-payment-123",
      status: "CAPTURED",
    });
    await expect(provider.capture(mutationRequest("capture:checkout-123"))).resolves.toEqual(
      expect.objectContaining({ kind: "APPLIED", status: "CAPTURED" }),
    );
    expect(provider.mutationCount("capture:checkout-123")).toBe(1);
  });
}

function authorizeRequest() {
  return {
    operationKey: "authorize:checkout-123",
    paymentId: "payment-123",
    amountMinor: 1250,
    currency: "USD" as const,
  };
}

function mutationRequest(operationKey: string) {
  return { operationKey, paymentId: "payment-123" };
}
