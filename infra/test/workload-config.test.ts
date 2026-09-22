import { describe, expect, it } from "vitest";

import { marketplaceCheckoutConfiguration } from "../lib/workload-config.js";

describe("marketplace checkout configuration", () => {
  it("omits reserved concurrency when the environment variable is unset", () => {
    expect(marketplaceCheckoutConfiguration({})).toEqual({});
  });

  it("parses reserved concurrency when explicitly configured", () => {
    expect(
      marketplaceCheckoutConfiguration({ LAMBDA_RESERVED_CONCURRENCY: "3" }),
    ).toEqual({ lambdaReservedConcurrency: 3 });
  });

  it("selects an executable production-reference profile without failure plans", () => {
    expect(marketplaceCheckoutConfiguration({ WORKLOAD_PROFILE: "production-reference" }))
      .toEqual({ enableFakePaymentFailurePlans: false });
  });

  it("configures Stripe Sandbox only with its EventBridge partner bus", () => {
    expect(marketplaceCheckoutConfiguration({
      PAYMENT_PROVIDER_MODE: "stripe-sandbox",
      STRIPE_EVENT_BUS_NAME: "aws.partner/stripe.com/ed_test_123",
    })).toEqual({
      paymentProviderMode: "stripe-sandbox",
      stripeEventBusName: "aws.partner/stripe.com/ed_test_123",
    });
  });

  it("rejects Stripe Sandbox without its EventBridge partner bus", () => {
    expect(() => marketplaceCheckoutConfiguration({ PAYMENT_PROVIDER_MODE: "stripe-sandbox" }))
      .toThrow("STRIPE_EVENT_BUS_NAME is required for stripe-sandbox");
  });

  it("rejects an unknown workload profile", () => {
    expect(() => marketplaceCheckoutConfiguration({ WORKLOAD_PROFILE: "production" }))
      .toThrow("WORKLOAD_PROFILE must be sandbox or production-reference.");
  });

  it.each(["", "0", "1.5", "11", "not-a-number"])(
    "rejects unsafe reserved concurrency %j",
    (value) => {
      expect(() =>
        marketplaceCheckoutConfiguration({ LAMBDA_RESERVED_CONCURRENCY: value }),
      ).toThrow("LAMBDA_RESERVED_CONCURRENCY must be unset or an integer from 1 through 10.");
    },
  );
});
