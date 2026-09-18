import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { SecretsManagerStripeApiKeySource } from "./stripe-api-key.js";
import { StripeHttpClient } from "./stripe-client.js";
import { createStripeEventReconciler } from "./stripe-event-reconciler.js";
import { StripePaymentProvider } from "./stripe-payment-provider.js";

const runStripeContract = process.env.RUN_STRIPE_SANDBOX_TESTS === "true";

describe.runIf(runStripeContract)("Stripe Sandbox Payment Provider contract", () => {
  it("authorizes, retrieves, captures, and refunds exactly one test PaymentIntent", async () => {
    const provider = stripeProvider();
    const paymentId = `contract-${randomUUID()}`;
    const authorize = {
      operationKey: `${paymentId}:authorize`,
      paymentId,
      amountMinor: 1250,
      currency: "USD" as const,
    };

    const authorized = await provider.authorize(authorize);
    expect(authorized).toEqual(expect.objectContaining({ kind: "APPLIED", status: "AUTHORIZED" }));
    expect(await provider.authorize(authorize)).toEqual(authorized);
    if (authorized.kind !== "APPLIED") throw new Error("Stripe authorization was rejected");

    await expect(provider.retrieve({
      paymentId,
      providerReference: authorized.providerReference,
    })).resolves.toEqual(authorizedToRetrieval(authorized));
    const captureRequest = {
      operationKey: `${paymentId}:capture`,
      paymentId,
      providerReference: authorized.providerReference,
    };
    const captured = await provider.capture(captureRequest);
    expect(captured).toEqual(expect.objectContaining({ status: "CAPTURED" }));
    await expect(provider.capture(captureRequest)).resolves.toEqual(captured);
    const refundRequest = {
      operationKey: `${paymentId}:refund`,
      paymentId,
      providerReference: authorized.providerReference,
      amountMinor: 1250,
    };
    const refunded = await provider.refund(refundRequest);
    expect(refunded).toEqual(expect.objectContaining({ status: "REFUNDED" }));
    await expect(provider.refund(refundRequest)).resolves.toEqual(refunded);
    await expect(provider.retrieve({
      paymentId,
      providerReference: authorized.providerReference,
    })).resolves.toEqual(expect.objectContaining({ status: "REFUNDED" }));

    const reconciledStates: unknown[] = [];
    const consume = createStripeEventReconciler({
      provider,
      payment: {
        reconcileProviderState: async (_eventPaymentId, state) => {
          reconciledStates.push(state);
          return "CONSISTENT";
        },
      },
    });
    const oldCaptureEvent = stripeDelivery(paymentId, authorized.providerReference);
    await consume(oldCaptureEvent);
    await consume(oldCaptureEvent);
    expect(reconciledStates).toEqual([
      expect.objectContaining({ status: "REFUNDED" }),
      expect.objectContaining({ status: "REFUNDED" }),
    ]);
  }, 30_000);

  it("cancels before capture and reports a Stripe test-card rejection", async () => {
    const provider = stripeProvider();
    const paymentId = `contract-${randomUUID()}`;
    const authorized = await provider.authorize({
      operationKey: `${paymentId}:authorize`,
      paymentId,
      amountMinor: 1250,
      currency: "USD",
    });
    if (authorized.kind !== "APPLIED") throw new Error("Stripe authorization was rejected");

    const cancelRequest = {
      operationKey: `${paymentId}:cancel`,
      paymentId,
      providerReference: authorized.providerReference,
    };
    const cancelled = await provider.cancel(cancelRequest);
    expect(cancelled).toEqual(expect.objectContaining({ status: "CANCELLED" }));
    await expect(provider.cancel(cancelRequest)).resolves.toEqual(cancelled);

    const rejected = stripeProvider("pm_card_visa_chargeDeclined");
    await expect(rejected.authorize({
      operationKey: `${paymentId}:decline`,
      paymentId: `${paymentId}-declined`,
      amountMinor: 1250,
      currency: "USD",
    })).resolves.toEqual(expect.objectContaining({
      kind: "REJECTED",
      rejectionCode: expect.any(String),
    }));
  }, 30_000);
});

function stripeProvider(paymentMethod?: string) {
  return new StripePaymentProvider(
    new StripeHttpClient(new SecretsManagerStripeApiKeySource()),
    paymentMethod === undefined ? {} : { paymentMethod },
  );
}

function authorizedToRetrieval(authorized: {
  readonly providerReference: string;
  readonly status: "AUTHORIZED";
}) {
  return {
    kind: "FOUND",
    providerReference: authorized.providerReference,
    status: authorized.status,
  };
}

function stripeDelivery(paymentId: string, providerReference: string) {
  return {
    version: "0",
    id: `eventbridge-${paymentId}`,
    "detail-type": "payment_intent.succeeded",
    source: "aws.partner/stripe.com/ed_test_contract",
    account: "123456789012",
    time: new Date().toISOString(),
    region: "us-east-1",
    resources: [],
    detail: {
      id: `evt-${paymentId}`,
      object: "event",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: providerReference,
          object: "payment_intent",
          metadata: { paymentId },
          status: "succeeded",
        },
      },
    },
  };
}
