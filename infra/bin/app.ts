#!/usr/bin/env node
import { App, Tags } from "aws-cdk-lib";

import { MarketplaceCheckoutStack } from "../lib/marketplace-checkout-stack.js";
import { SandboxFoundationStack } from "../lib/sandbox-foundation-stack.js";

const app = new App();
const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION ?? "us-east-1";
const environment = account === undefined ? { region } : { account, region };

new SandboxFoundationStack(app, "AwsArchitectureLab-SandboxFoundation", {
  description: "Long-lived, low-cost guardrails for the AWS architecture lab.",
  env: environment,
});

new MarketplaceCheckoutStack(app, "AwsArchitectureLab-MarketplaceCheckout", {
  description: "Ephemeral marketplace checkout Saga learning workload.",
  env: environment,
});

Tags.of(app).add("project", "aws-architecture-lab");
Tags.of(app).add("environment", "sandbox");
