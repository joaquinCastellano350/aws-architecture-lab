import type { MarketplaceCheckoutStackProps } from "./marketplace-checkout-stack.js";
import { requiredStripeEventBusName } from "./stripe-configuration.js";

export type MarketplaceCheckoutConfiguration = Pick<
  MarketplaceCheckoutStackProps,
  | "enableFakePaymentFailurePlans"
  | "lambdaReservedConcurrency"
  | "paymentProviderMode"
  | "stripeEventBusName"
>;

export function marketplaceCheckoutConfiguration(
  environment: NodeJS.ProcessEnv,
): MarketplaceCheckoutConfiguration {
  const profile = environment.WORKLOAD_PROFILE;
  if (profile !== undefined && profile !== "sandbox" && profile !== "production-reference") {
    throw new Error("WORKLOAD_PROFILE must be sandbox or production-reference.");
  }
  const profileConfiguration = profile === "production-reference"
    ? { enableFakePaymentFailurePlans: false as const }
    : {};
  const providerMode = environment.PAYMENT_PROVIDER_MODE;
  const providerConfiguration: MarketplaceCheckoutConfiguration = providerMode === "stripe-sandbox"
    ? {
        paymentProviderMode: "stripe-sandbox",
        stripeEventBusName: requiredStripeEventBusName(environment),
      }
    : {};
  const rawReservedConcurrency = environment.LAMBDA_RESERVED_CONCURRENCY;
  if (rawReservedConcurrency === undefined) {
    return { ...profileConfiguration, ...providerConfiguration };
  }

  const lambdaReservedConcurrency = Number(rawReservedConcurrency);
  if (
    !Number.isInteger(lambdaReservedConcurrency) ||
    lambdaReservedConcurrency < 1 ||
    lambdaReservedConcurrency > 10
  ) {
    throw new Error("LAMBDA_RESERVED_CONCURRENCY must be unset or an integer from 1 through 10.");
  }

  return { ...profileConfiguration, ...providerConfiguration, lambdaReservedConcurrency };
}
