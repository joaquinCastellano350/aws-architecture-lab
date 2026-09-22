import { describe, expect, it, vi } from "vitest";

import {
  SecretsManagerStripeApiKeySource,
} from "./stripe-api-key.js";
import { StripeHttpClient } from "./stripe-client.js";

describe("Stripe runtime client", () => {
  it("loads and caches a Stripe test key from Secrets Manager", async () => {
    const send = vi.fn(async () => ({ SecretString: JSON.stringify({ apiKey: "sk_test_example" }) }));
    const source = new SecretsManagerStripeApiKeySource("stripe-secret", { send });

    await expect(source.getApiKey()).resolves.toBe("sk_test_example");
    await expect(source.getApiKey()).resolves.toBe("sk_test_example");

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0].input).toEqual({ SecretId: "stripe-secret" });
  });

  it("refuses a non-test Stripe key", async () => {
    const source = new SecretsManagerStripeApiKeySource("stripe-secret", {
      send: vi.fn(async () => ({ SecretString: JSON.stringify({ apiKey: "sk_live_forbidden" }) })),
    });

    await expect(source.getApiKey()).rejects.toThrow("Stripe Sandbox test key");
  });

  it("sends manual-capture PaymentIntent fields and the operation idempotency key", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(paymentIntent()), {
      headers: { "content-type": "application/json" },
      status: 200,
    }));
    const client = new StripeHttpClient(
      { getApiKey: async () => "sk_test_example" },
      { fetch },
    );

    await client.createPaymentIntent({
      amountMinor: 1250,
      captureMethod: "manual",
      confirm: true,
      currency: "usd",
      idempotencyKey: "payment:payment-123:authorize",
      metadata: { paymentId: "payment-123" },
      paymentMethod: "pm_card_visa",
    });

    const [url, request] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://api.stripe.com/v1/payment_intents");
    expect(request?.headers).toEqual(expect.objectContaining({
      Authorization: "Bearer sk_test_example",
      "Idempotency-Key": "payment:payment-123:authorize",
    }));
    expect(request?.body?.toString()).toContain("capture_method=manual");
    expect(request?.body?.toString()).toContain("payment_method=pm_card_visa");
    expect(request?.body?.toString()).toContain("metadata%5BpaymentId%5D=payment-123");
  });
});

function paymentIntent() {
  return {
    id: "pi_payment-123",
    amount: 1250,
    currency: "usd",
    metadata: { paymentId: "payment-123" },
    status: "requires_capture",
    latest_charge: null,
  };
}
