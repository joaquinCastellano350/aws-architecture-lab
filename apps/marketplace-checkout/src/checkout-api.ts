import { createHash, randomUUID } from "node:crypto";

import {
  checkoutApiPaths,
  checkoutIdFromStatusPath,
  checkoutStatusPath,
  idempotencyKeyHeaderName,
  validateCheckoutStatusResponse,
  validateIdempotencyKey,
  validateSubmitCheckoutRequest,
  validateSubmitCheckoutResponse,
  type CheckoutStatusResponse,
  type Problem,
  type SubmitCheckoutRequest,
  type SubmitCheckoutResponse,
} from "@aws-architecture-lab/contracts";

export interface ApiRequest {
  readonly httpMethod: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: string | null;
}

export interface ApiResponse {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface Admission {
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly checkoutId: string;
  readonly cartId: string;
  readonly correlationId: string;
  readonly itemId: string;
  readonly quantity: number;
  readonly reservationExpiresAt: string;
  readonly createdAt: string;
}

export interface SagaExecution {
  readonly checkoutId: string;
  readonly correlationId: string;
  readonly workflowVersionArn?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly executionArn?: string;
}

export interface Order {
  readonly checkoutId: string;
  readonly correlationId: string;
  readonly status: "PENDING" | "INVENTORY_UNAVAILABLE" | "EXPIRED" | "CANCELLED" | "CONFIRMED";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CheckoutPersistence {
  admit(admission: Admission, saga: SagaExecution): Promise<AdmittedCheckout>;
  markWorkflowStarted(checkoutId: string, execution: WorkflowExecution): Promise<void>;
  getOrder(checkoutId: string): Promise<Order | undefined>;
}

export interface AdmittedCheckout {
  readonly admission: Admission;
  readonly workflow?: WorkflowExecution;
}

export interface WorkflowInput {
  readonly checkoutId: string;
  readonly cartId: string;
  readonly correlationId: string;
  readonly itemId: string;
  readonly quantity: number;
  readonly reservationExpiresAt: string;
}

export interface WorkflowStarter {
  start(input: WorkflowInput): Promise<WorkflowExecution>;
}

export interface WorkflowExecution {
  readonly executionArn: string;
  readonly workflowVersionArn: string;
}

export interface CheckoutApplicationDependencies {
  readonly persistence: CheckoutPersistence;
  readonly workflow: WorkflowStarter;
  readonly clock?: () => Date;
  readonly checkoutId?: () => string;
}

export type SubmissionResult =
  | { readonly kind: "accepted"; readonly response: SubmitCheckoutResponse }
  | { readonly kind: "conflict" };

export class CheckoutApplication {
  readonly #clock: () => Date;
  readonly #checkoutId: () => string;
  readonly #persistence: CheckoutPersistence;
  readonly #workflow: WorkflowStarter;

  public constructor(dependencies: CheckoutApplicationDependencies) {
    this.#clock = dependencies.clock ?? (() => new Date());
    this.#checkoutId = dependencies.checkoutId ?? (() => `checkout-${randomUUID()}`);
    this.#persistence = dependencies.persistence;
    this.#workflow = dependencies.workflow;
  }

  public async submit(
    idempotencyKey: string,
    request: SubmitCheckoutRequest,
  ): Promise<SubmissionResult> {
    const payloadHash = stableHash(request);
    const itemId = request.itemId ?? "marketplace-demo-item";
    const quantity = request.quantity ?? 1;
    const now = this.#clock().toISOString();
    const reservationExpiresAt = new Date(Date.parse(now) + 5 * 60 * 1000).toISOString();
    const proposed: Admission = {
      idempotencyKey,
      payloadHash,
      checkoutId: this.#checkoutId(),
      cartId: request.cartId,
      correlationId: request.correlationId,
      itemId,
      quantity,
      reservationExpiresAt,
      createdAt: now,
    };
    const admitted = await this.#persistence.admit(proposed, {
      checkoutId: proposed.checkoutId,
      correlationId: request.correlationId,
      createdAt: now,
      updatedAt: now,
    });

    if (admitted.admission.payloadHash !== payloadHash) return { kind: "conflict" };

    if (admitted.workflow === undefined) {
      const execution = await this.#workflow.start({
        checkoutId: admitted.admission.checkoutId,
        cartId: admitted.admission.cartId,
        correlationId: admitted.admission.correlationId,
        itemId: admitted.admission.itemId,
        quantity: admitted.admission.quantity,
        reservationExpiresAt: admitted.admission.reservationExpiresAt,
      });
      await this.#persistence.markWorkflowStarted(admitted.admission.checkoutId, execution);
    }

    const statusLocation = checkoutStatusPath(admitted.admission.checkoutId);
    return {
      kind: "accepted",
      response: { checkoutId: admitted.admission.checkoutId, statusLocation },
    };
  }

  public async get(checkoutId: string): Promise<CheckoutStatusResponse | undefined> {
    const order = await this.#persistence.getOrder(checkoutId);
    if (order === undefined) return undefined;
    return {
      checkoutId: order.checkoutId,
      status: order.status,
      correlationId: order.correlationId,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }
}

export function createCheckoutApiHandler(application: CheckoutApplication) {
  return async (request: ApiRequest): Promise<ApiResponse> => {
    if (request.httpMethod === "POST" && request.path === checkoutApiPaths.submit) {
      const idempotencyKey = header(request.headers, idempotencyKeyHeaderName.toLowerCase());
      if (!validateIdempotencyKey(idempotencyKey)) {
        return problem(400, "urn:aws-architecture-lab:checkout:invalid-request", "Invalid checkout request", "Idempotency-Key header is required and must contain at most 128 characters");
      }

      const parsed = parseJson(request.body);
      const validation = validateSubmitCheckoutRequest(parsed);
      if (!validation.ok) {
        return problem(400, "urn:aws-architecture-lab:checkout:invalid-request", "Invalid checkout request", validation.error);
      }

      const result = await application.submit(idempotencyKey, validation.value);
      if (result.kind === "conflict") {
        return problem(409, "urn:aws-architecture-lab:checkout:idempotency-conflict", "Idempotency key was already used with a different request");
      }
      const response = validateSubmitCheckoutResponse(result.response);
      if (!response.ok) throw new Error(response.error);
      return json(202, response.value, { Location: response.value.statusLocation });
    }

    const checkoutId = checkoutIdFromStatusPath(request.path);
    if (request.httpMethod === "GET" && checkoutId !== undefined) {
      const checkout = await application.get(checkoutId);
      if (checkout === undefined) {
        return problem(404, "urn:aws-architecture-lab:checkout:not-found", "Checkout was not found");
      }
      const response = validateCheckoutStatusResponse(checkout);
      if (!response.ok) throw new Error(response.error);
      return json(200, response.value);
    }

    return problem(404, "urn:aws-architecture-lab:checkout:not-found", "Route was not found");
  };
}

function parseJson(body: string | null): unknown {
  if (body === null) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function header(headers: ApiRequest["headers"], name: string): string | undefined {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  return entry?.[1];
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function json(statusCode: number, body: unknown, extraHeaders: Record<string, string> = {}): ApiResponse {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  };
}

function problem(status: number, type: string, title: string, detail?: string): ApiResponse {
  const body: Problem = detail === undefined ? { type, title, status } : { type, title, status, detail };
  return {
    statusCode: status,
    headers: { "Content-Type": "application/problem+json" },
    body: JSON.stringify(body),
  };
}
