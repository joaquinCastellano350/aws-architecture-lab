import type { MarketplaceCheckoutStackProps } from "./marketplace-checkout-stack.js";

export type MarketplaceCheckoutConfiguration = Pick<
  MarketplaceCheckoutStackProps,
  "lambdaReservedConcurrency"
>;

export function marketplaceCheckoutConfiguration(
  environment: NodeJS.ProcessEnv,
): MarketplaceCheckoutConfiguration {
  const rawReservedConcurrency = environment.LAMBDA_RESERVED_CONCURRENCY;
  if (rawReservedConcurrency === undefined) return {};

  const lambdaReservedConcurrency = Number(rawReservedConcurrency);
  if (
    !Number.isInteger(lambdaReservedConcurrency) ||
    lambdaReservedConcurrency < 1 ||
    lambdaReservedConcurrency > 10
  ) {
    throw new Error("LAMBDA_RESERVED_CONCURRENCY must be unset or an integer from 1 through 10.");
  }

  return { lambdaReservedConcurrency };
}
