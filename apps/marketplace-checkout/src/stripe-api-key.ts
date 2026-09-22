import {
  GetSecretValueCommand,
  SecretsManagerClient,
  type GetSecretValueCommandOutput,
} from "@aws-sdk/client-secrets-manager";

export const STRIPE_SANDBOX_SECRET_NAME = "aws-architecture-lab/sandbox/stripe";

export interface StripeApiKeySource {
  getApiKey(): Promise<string>;
}

interface SecretsManagerReader {
  send(command: GetSecretValueCommand): Promise<GetSecretValueCommandOutput>;
}

export class SecretsManagerStripeApiKeySource implements StripeApiKeySource {
  readonly #client: SecretsManagerReader;
  #key: Promise<string> | undefined;

  public constructor(
    private readonly secretId = STRIPE_SANDBOX_SECRET_NAME,
    client: SecretsManagerReader = new SecretsManagerClient({}),
  ) {
    this.#client = client;
  }

  public getApiKey(): Promise<string> {
    this.#key ??= this.#load();
    return this.#key;
  }

  async #load(): Promise<string> {
    const response = await this.#client.send(new GetSecretValueCommand({
      SecretId: this.secretId,
    }));
    if (response.SecretString === undefined) {
      throw new Error("Stripe Sandbox secret must contain a JSON SecretString");
    }
    let apiKey: unknown;
    try {
      apiKey = (JSON.parse(response.SecretString) as { readonly apiKey?: unknown }).apiKey;
    } catch {
      throw new Error("Stripe Sandbox secret must contain valid JSON");
    }
    if (typeof apiKey !== "string" || !apiKey.startsWith("sk_test_")) {
      throw new Error("Stripe Sandbox secret must contain a Stripe Sandbox test key");
    }
    return apiKey;
  }
}
