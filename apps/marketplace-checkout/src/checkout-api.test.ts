import { describe, expect, it } from "vitest";

import {
  CheckoutApplication,
  createCheckoutApiHandler,
  type Admission,
  type AdmittedCheckout,
  type CheckoutPersistence,
  type Order,
  type SagaExecution,
  type WorkflowStarter,
} from "./checkout-api.js";

describe("asynchronous checkout API", () => {
  it("accepts a checkout and exposes its pending Order through the status location", async () => {
    const api = checkoutApi();

    const submitted = await api({
      httpMethod: "POST",
      path: "/checkouts",
      headers: { "Idempotency-Key": "client-request-1" },
      body: JSON.stringify(validRequest),
    });
    const submission = JSON.parse(submitted.body);
    const observed = await api({
      httpMethod: "GET",
      path: submission.statusLocation,
      headers: {},
      body: null,
    });

    expect(submitted.statusCode).toBe(202);
    expect(submitted.headers).toEqual({
      "Content-Type": "application/json",
      Location: submission.statusLocation,
    });
    expect(submission).toEqual({
      checkoutId: "checkout-fixed",
      statusLocation: "/checkouts/checkout-fixed",
    });
    expect(observed.statusCode).toBe(200);
    expect(JSON.parse(observed.body)).toEqual({
      checkoutId: "checkout-fixed",
      status: "PENDING",
      correlationId: "corr-123",
      createdAt: "2026-09-07T12:00:00.000Z",
      updatedAt: "2026-09-07T12:00:00.000Z",
    });
  });

  it("returns the original checkout when the idempotency key and payload repeat", async () => {
    const api = checkoutApi();
    const request = {
      httpMethod: "POST",
      path: "/checkouts",
      headers: { "idempotency-key": "client-request-1" },
      body: JSON.stringify(validRequest),
    };

    const first = await api(request);
    const repeated = await api(request);

    expect(repeated.statusCode).toBe(202);
    expect(repeated.body).toBe(first.body);
  });

  it("rejects reuse of an idempotency key with a different payload", async () => {
    const api = checkoutApi();
    const request = {
      httpMethod: "POST",
      path: "/checkouts",
      headers: { "Idempotency-Key": "client-request-1" },
      body: JSON.stringify(validRequest),
    };
    await api(request);

    const conflict = await api({
      ...request,
      body: JSON.stringify({ ...validRequest, cartId: "another-cart" }),
    });

    expect(conflict.statusCode).toBe(409);
    expect(JSON.parse(conflict.body)).toEqual({
      type: "urn:aws-architecture-lab:checkout:idempotency-conflict",
      title: "Idempotency key was already used with a different request",
      status: 409,
    });
  });

  it("rejects requests that do not match the OpenAPI contract", async () => {
    const response = await checkoutApi()({
      httpMethod: "POST",
      path: "/checkouts",
      headers: { "Idempotency-Key": "client-request-1" },
      body: JSON.stringify({ cartId: "cart-123" }),
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      type: "urn:aws-architecture-lab:checkout:invalid-request",
      title: "Invalid checkout request",
      status: 400,
      detail: "Request body does not match SubmitCheckoutRequest v1.0",
    });
  });

  it("keeps older v1 submissions compatible with deterministic lab inventory defaults", async () => {
    const api = checkoutApi({ itemId: "marketplace-demo-item", quantity: 1 });

    const response = await api({
      httpMethod: "POST",
      path: "/checkouts",
      headers: { "Idempotency-Key": "older-client-request" },
      body: JSON.stringify({
        contractVersion: "1.0",
        cartId: "cart-123",
        correlationId: "corr-123",
      }),
    });

    expect(response.statusCode).toBe(202);
  });
});

const validRequest = {
  contractVersion: "1.0",
  cartId: "cart-123",
  correlationId: "corr-123",
  itemId: "sku-123",
  quantity: 2,
} as const;

function checkoutApi(expectedInventory = { itemId: "sku-123", quantity: 2 }) {
  const persistence = new InMemoryCheckoutPersistence();
  let workflowStarted = false;
  const workflow: WorkflowStarter = {
    async start(input) {
      if (workflowStarted) throw new Error("A durable replay must not start a second workflow");
      workflowStarted = true;
      expect(input).toEqual(expect.objectContaining(expectedInventory));
      await persistence.createPendingOrder({
        checkoutId: input.checkoutId,
        correlationId: input.correlationId,
        createdAt: "2026-09-07T12:00:00.000Z",
        updatedAt: "2026-09-07T12:00:00.000Z",
        status: "PENDING",
      });
      return {
        executionArn: "arn:aws:states:us-east-1:111122223333:execution:Checkout:checkout-fixed",
        workflowVersionArn: "arn:aws:states:us-east-1:111122223333:stateMachine:Checkout:1",
      };
    },
  };
  const application = new CheckoutApplication({
    clock: () => new Date("2026-09-07T12:00:00.000Z"),
    checkoutId: () => "checkout-fixed",
    persistence,
    workflow,
  });
  return createCheckoutApiHandler(application);
}

class InMemoryCheckoutPersistence implements CheckoutPersistence {
  readonly #admissions = new Map<string, Admission>();
  readonly #orders = new Map<string, Order>();
  readonly #sagas = new Map<string, SagaExecution>();

  async admit(admission: Admission, saga: SagaExecution): Promise<AdmittedCheckout> {
    const existing = this.#admissions.get(admission.idempotencyKey);
    if (existing !== undefined) {
      const existingSaga = this.#sagas.get(existing.checkoutId);
      const workflow =
        existingSaga?.executionArn === undefined || existingSaga.workflowVersionArn === undefined
          ? {}
          : {
              workflow: {
                executionArn: existingSaga.executionArn,
                workflowVersionArn: existingSaga.workflowVersionArn,
              },
            };
      return { admission: existing, ...workflow };
    }
    this.#admissions.set(admission.idempotencyKey, admission);
    this.#sagas.set(saga.checkoutId, saga);
    return { admission };
  }

  async markWorkflowStarted(
    checkoutId: string,
    execution: { readonly executionArn: string; readonly workflowVersionArn: string },
  ): Promise<void> {
    const saga = this.#sagas.get(checkoutId);
    if (saga !== undefined) this.#sagas.set(checkoutId, { ...saga, ...execution });
  }

  async getOrder(checkoutId: string): Promise<Order | undefined> {
    return this.#orders.get(checkoutId);
  }

  async createPendingOrder(order: Order): Promise<void> {
    if (!this.#orders.has(order.checkoutId)) this.#orders.set(order.checkoutId, order);
  }
}
