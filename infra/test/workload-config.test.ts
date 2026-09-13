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
