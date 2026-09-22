import { SecretsManagerStripeApiKeySource } from "./stripe-api-key.js";
import { StripeHttpClient } from "./stripe-client.js";
import { StripePaymentProvider } from "./stripe-payment-provider.js";

export function createStripeSandboxPaymentProvider(): StripePaymentProvider {
  return new StripePaymentProvider(
    new StripeHttpClient(new SecretsManagerStripeApiKeySource()),
  );
}
