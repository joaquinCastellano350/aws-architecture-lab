import { describe, expect, it, vi } from "vitest";

import { runPreflight, type PreflightDependencies } from "../lib/preflight.js";

describe("sandbox deployment preflight", () => {
  it("accepts the dedicated us-east-1 sandbox with bounded fake-provider traffic", () => {
    const write = vi.fn();

    const report = runPreflight(validEnvironment({ CHECKOUT_REQUEST_CEILING: "9000" }), {
      ...validDependencies(),
      write,
    });

    expect(report).toEqual({
      account: "123456789012",
      providerMode: "fake",
      region: "us-east-1",
      requestCeiling: 9000,
    });
    expect(write).toHaveBeenCalledWith(
      "Preflight passed for 123456789012 in us-east-1 (fake, ceiling 9000).",
    );
  });

  it("rejects credentials for an account other than the dedicated sandbox", () => {
    expect(() =>
      runPreflight(validEnvironment(), validDependencies("999999999999")),
    ).toThrowError(
      "AWS credentials resolve to account 999999999999, expected sandbox account 123456789012.",
    );
  });

  it("rejects a deployment region other than us-east-1", () => {
    expect(() =>
      runPreflight(validEnvironment({ AWS_REGION: "sa-east-1" }), validDependencies()),
    ).toThrowError("AWS region must be us-east-1; received sa-east-1.");
  });

  it("rejects missing or unusable AWS credentials", () => {
    expect(() =>
      runPreflight(
        validEnvironment(),
        {
          getCallerIdentity: () => {
            throw new Error("Unable to locate credentials");
          },
          write: vi.fn(),
        },
      ),
    ).toThrowError("AWS credentials are missing or unusable: Unable to locate credentials");
  });

  it("rejects a provider mode that could move real money", () => {
    expect(() =>
      runPreflight(
        validEnvironment({ PAYMENT_PROVIDER_MODE: "stripe-live" }),
        validDependencies(),
      ),
    ).toThrowError(
      "PAYMENT_PROVIDER_MODE must be fake or stripe-sandbox; received stripe-live.",
    );
  });

  it("rejects an absent request ceiling", () => {
    expect(() =>
      runPreflight(validEnvironment({ CHECKOUT_REQUEST_CEILING: undefined }), validDependencies()),
    ).toThrowError("CHECKOUT_REQUEST_CEILING must be an integer from 1 through 9000.");
  });

  it("rejects missing budget notification configuration", () => {
    expect(() =>
      runPreflight(validEnvironment({ BUDGET_NOTIFICATION_EMAIL: undefined }), validDependencies()),
    ).toThrowError("BUDGET_NOTIFICATION_EMAIL must contain a valid email address.");
  });
});

function validEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    AWS_SANDBOX_ACCOUNT_ID: "123456789012",
    AWS_REGION: "us-east-1",
    BUDGET_NOTIFICATION_EMAIL: "owner@example.com",
    CHECKOUT_REQUEST_CEILING: "20",
    PAYMENT_PROVIDER_MODE: "fake",
    ...overrides,
  };
}

function validDependencies(account = "123456789012"): PreflightDependencies {
  return {
    getCallerIdentity: () => ({
      account,
      arn: `arn:aws:iam::${account}:user/architecture-lab`,
    }),
    write: vi.fn(),
  };
}
