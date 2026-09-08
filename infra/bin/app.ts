#!/usr/bin/env node
import { App, Tags } from "aws-cdk-lib";

import {
  FOUNDATION_STACK_NAME,
  MARKETPLACE_CHECKOUT_STACK_NAME,
} from "../lib/foundation-config.js";
import { MarketplaceCheckoutStack } from "../lib/marketplace-checkout-stack.js";
import { SandboxFoundationStack } from "../lib/sandbox-foundation-stack.js";
import { marketplaceCheckoutConfiguration } from "../lib/workload-config.js";

const app = new App();
const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION ?? "us-east-1";
const environment = account === undefined ? { region } : { account, region };

new SandboxFoundationStack(app, FOUNDATION_STACK_NAME, {
  description: "Long-lived, low-cost guardrails for the AWS architecture lab.",
  env: environment,
});

new MarketplaceCheckoutStack(app, MARKETPLACE_CHECKOUT_STACK_NAME, {
  description: "Ephemeral marketplace checkout Saga learning workload.",
  env: environment,
  ...marketplaceCheckoutConfiguration(process.env),
});

Tags.of(app).add("project", "aws-architecture-lab");
Tags.of(app).add("environment", "sandbox");
