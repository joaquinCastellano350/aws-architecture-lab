import {
  PaymentProviderThrottledError,
  PaymentProviderTimeoutError,
  PaymentProviderTransientError,
} from "./payment-provider.js";
import {
  StripePaymentRejectedError,
  type StripeClient,
  type StripePaymentIntent,
  type StripePaymentIntentStatus,
  type StripeRefund,
} from "./stripe-payment-provider.js";
import type { StripeApiKeySource } from "./stripe-api-key.js";

interface StripeHttpClientOptions {
  readonly apiBaseUrl?: string;
  readonly fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

interface StripePaymentIntentResponse {
  readonly id: string;
  readonly amount: number;
  readonly currency: string;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly status: StripePaymentIntentStatus;
  readonly latest_charge?: string | null | {
    readonly amount_refunded?: number;
    readonly refunded?: boolean;
  };
}

interface StripeRefundResponse {
  readonly id: string;
  readonly payment_intent: string;
  readonly status: StripeRefund["status"];
}

export class StripeHttpClient implements StripeClient {
  readonly #apiBaseUrl: string;
  readonly #fetch: (input: string, init?: RequestInit) => Promise<Response>;

  public constructor(
    private readonly apiKeySource: StripeApiKeySource,
    options: StripeHttpClientOptions = {},
  ) {
    this.#apiBaseUrl = options.apiBaseUrl ?? "https://api.stripe.com/v1";
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  public async createPaymentIntent(
    request: Parameters<StripeClient["createPaymentIntent"]>[0],
  ): Promise<StripePaymentIntent> {
    const response = await this.#request<StripePaymentIntentResponse>(
      "POST",
      "/payment_intents",
      {
        amount: request.amountMinor,
        capture_method: request.captureMethod,
        confirm: request.confirm,
        currency: request.currency,
        "metadata[paymentId]": request.metadata.paymentId,
        payment_method: request.paymentMethod,
        "payment_method_types[]": "card",
      },
      request.idempotencyKey,
    );
    return paymentIntent(response);
  }

  public async capturePaymentIntent(
    providerReference: string,
    request: Parameters<StripeClient["capturePaymentIntent"]>[1],
  ): Promise<StripePaymentIntent> {
    const response = await this.#request<StripePaymentIntentResponse>(
      "POST",
      `/payment_intents/${encodeURIComponent(providerReference)}/capture`,
      {},
      request.idempotencyKey,
    );
    return paymentIntent(response);
  }

  public async cancelPaymentIntent(
    providerReference: string,
    request: Parameters<StripeClient["cancelPaymentIntent"]>[1],
  ): Promise<StripePaymentIntent> {
    const response = await this.#request<StripePaymentIntentResponse>(
      "POST",
      `/payment_intents/${encodeURIComponent(providerReference)}/cancel`,
      {},
      request.idempotencyKey,
    );
    return paymentIntent(response);
  }

  public async createRefund(
    request: Parameters<StripeClient["createRefund"]>[0],
  ): Promise<StripeRefund> {
    const response = await this.#request<StripeRefundResponse>(
      "POST",
      "/refunds",
      {
        amount: request.amountMinor,
        "metadata[paymentId]": request.metadata.paymentId,
        payment_intent: request.providerReference,
      },
      request.idempotencyKey,
    );
    return {
      id: response.id,
      paymentIntent: response.payment_intent,
      status: response.status,
    };
  }

  public async retrievePaymentIntent(
    providerReference: string,
  ): Promise<StripePaymentIntent | undefined> {
    const response = await this.#request<StripePaymentIntentResponse | undefined>(
      "GET",
      `/payment_intents/${encodeURIComponent(providerReference)}?expand%5B%5D=latest_charge`,
      undefined,
      undefined,
      true,
    );
    return response === undefined ? undefined : paymentIntent(response);
  }

  public async findPaymentIntent(paymentId: string): Promise<StripePaymentIntent | undefined> {
    const query = `metadata['paymentId']:'${stripeSearchLiteral(paymentId)}'`;
    const search = new URLSearchParams({ query, limit: "1" });
    search.append("expand[]", "data.latest_charge");
    const response = await this.#request<{ readonly data: StripePaymentIntentResponse[] }>(
      "GET",
      `/payment_intents/search?${search.toString()}`,
    );
    const found = response.data[0];
    return found === undefined ? undefined : paymentIntent(found);
  }

  async #request<T>(
    method: "GET" | "POST",
    path: string,
    fields?: Readonly<Record<string, string | number | boolean>>,
    idempotencyKey?: string,
    allowNotFound = false,
  ): Promise<T> {
    const apiKey = await this.apiKeySource.getApiKey();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      ...(idempotencyKey === undefined ? {} : { "Idempotency-Key": idempotencyKey }),
    };
    const body = fields === undefined ? undefined : formBody(fields);
    if (body !== undefined) headers["Content-Type"] = "application/x-www-form-urlencoded";
    let response: Response;
    try {
      response = await this.#fetch(`${this.#apiBaseUrl}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new PaymentProviderTimeoutError();
      }
      throw new PaymentProviderTransientError();
    }
    if (allowNotFound && response.status === 404) return undefined as T;
    const payload = await response.json() as T | StripeErrorResponse;
    if (!response.ok) throw stripeError(response.status, payload);
    return payload as T;
  }
}

interface StripeErrorResponse {
  readonly error?: {
    readonly code?: string;
    readonly decline_code?: string;
    readonly type?: string;
  };
}

function stripeError(status: number, payload: unknown): Error {
  if (status === 429) return new PaymentProviderThrottledError();
  if (status === 408) return new PaymentProviderTimeoutError();
  if (status >= 500) return new PaymentProviderTransientError();
  const error = isStripeError(payload) ? payload.error : undefined;
  return new StripePaymentRejectedError(
    error?.decline_code ?? error?.code ?? "PAYMENT_PROVIDER_REJECTED",
  );
}

function isStripeError(payload: unknown): payload is StripeErrorResponse {
  return typeof payload === "object" && payload !== null && "error" in payload;
}

function formBody(fields: Readonly<Record<string, string | number | boolean>>): URLSearchParams {
  const form = new URLSearchParams();
  for (const [name, value] of Object.entries(fields)) form.set(name, String(value));
  return form;
}

function paymentIntent(response: StripePaymentIntentResponse): StripePaymentIntent {
  const latestCharge = typeof response.latest_charge === "object"
    ? response.latest_charge
    : undefined;
  return {
    id: response.id,
    amountMinor: response.amount,
    currency: response.currency,
    metadata: response.metadata ?? {},
    refunded: latestCharge?.refunded === true ||
      (latestCharge?.amount_refunded ?? 0) >= response.amount,
    status: response.status,
  };
}

function stripeSearchLiteral(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}
