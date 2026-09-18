import type { EventBridgeHandler } from "aws-lambda";

import { DynamoPaymentLedger } from "./dynamo-payment-ledger.js";
import { requiredEnvironment } from "./environment.js";
import { PaymentCommandService } from "./payment-command-service.js";
import { createStripeEventReconciler } from "./stripe-event-reconciler.js";
import { createStripeSandboxPaymentProvider } from "./stripe-payment-provider-runtime.js";

if (requiredEnvironment("PAYMENT_PROVIDER_MODE") !== "stripe-sandbox") {
  throw new Error("Stripe event reconciliation requires stripe-sandbox mode");
}

const ledger = new DynamoPaymentLedger(
  requiredEnvironment("PAYMENT_TABLE_NAME"),
  requiredEnvironment("PAYMENT_OUTBOX_TABLE_NAME"),
);
const provider = createStripeSandboxPaymentProvider();
const payment = new PaymentCommandService({ ledger, provider });
const reconcile = createStripeEventReconciler({ payment, provider });

export const handler: EventBridgeHandler<string, unknown, void> = reconcile;
