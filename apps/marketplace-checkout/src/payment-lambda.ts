import type { Handler } from "aws-lambda";
import type { PaymentCommandOutcome } from "@aws-architecture-lab/contracts";

import { DynamoDeterministicPaymentProvider } from "./dynamo-deterministic-payment-provider.js";
import { DynamoPaymentLedger } from "./dynamo-payment-ledger.js";
import { requiredEnvironment } from "./environment.js";
import { createPaymentCommandHandler } from "./payment-command-handler.js";
import { PaymentCommandService } from "./payment-command-service.js";
import { createStripeSandboxPaymentProvider } from "./stripe-payment-provider-runtime.js";

const ledger = new DynamoPaymentLedger(
  requiredEnvironment("PAYMENT_TABLE_NAME"),
  requiredEnvironment("PAYMENT_OUTBOX_TABLE_NAME"),
);
const providerMode = requiredEnvironment("PAYMENT_PROVIDER_MODE");
const provider = providerMode === "stripe-sandbox"
  ? createStripeSandboxPaymentProvider()
  : providerMode === "fake"
    ? new DynamoDeterministicPaymentProvider(
        requiredEnvironment("FAKE_PAYMENT_PROVIDER_TABLE_NAME"),
        process.env.FAKE_PAYMENT_FAILURE_PLAN_TABLE_NAME === undefined
          ? {}
          : { failurePlanTableName: process.env.FAKE_PAYMENT_FAILURE_PLAN_TABLE_NAME },
      )
    : (() => { throw new Error(`Unsupported PAYMENT_PROVIDER_MODE: ${providerMode}`); })();
const payment = new PaymentCommandService({ ledger, provider });

export const handler: Handler<unknown, PaymentCommandOutcome> =
  createPaymentCommandHandler(payment);
