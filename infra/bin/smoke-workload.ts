#!/usr/bin/env node
import { Sha256 } from "@aws-crypto/sha256-js";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { HttpRequest } from "@smithy/protocol-http";
import { SignatureV4 } from "@smithy/signature-v4";

import { isRecord, runAwsJson } from "../lib/aws-cli.js";
import { executeAsyncCli, runEnvironmentPreflight } from "../lib/cli.js";
import { MARKETPLACE_CHECKOUT_STACK_NAME } from "../lib/foundation-config.js";

await executeAsyncCli(async () => {
  const report = runEnvironmentPreflight();
  const apiUrl = stackOutput("CheckoutApiUrl");
  const idempotencyKey = `smoke-${Date.now()}`;
  const requestBody = JSON.stringify({
    contractVersion: "1.0",
    cartId: `smoke-cart-${Date.now()}`,
    correlationId: `smoke-correlation-${Date.now()}`,
  });

  const submitted = await signedJsonRequest(apiUrl, report.region, "POST", "/checkouts", {
    body: requestBody,
    headers: { "Idempotency-Key": idempotencyKey },
  });
  if (submitted.status !== 202 || !isRecord(submitted.body) || typeof submitted.body.checkoutId !== "string" || typeof submitted.body.statusLocation !== "string") {
    throw new Error(`POST /checkouts failed: ${submitted.status} ${JSON.stringify(submitted.body)}`);
  }

  const repeated = await signedJsonRequest(apiUrl, report.region, "POST", "/checkouts", {
    body: requestBody,
    headers: { "Idempotency-Key": idempotencyKey },
  });
  if (!isRecord(repeated.body) || repeated.body.checkoutId !== submitted.body.checkoutId) {
    throw new Error("Repeated submission did not return the original Checkout.");
  }

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const observed = await signedJsonRequest(
      apiUrl,
      report.region,
      "GET",
      submitted.body.statusLocation,
    );
    if (
      observed.status === 200 &&
      isRecord(observed.body) &&
      observed.body.checkoutId === submitted.body.checkoutId &&
      observed.body.status === "PENDING"
    ) {
      console.log(`Smoke passed for ${submitted.body.checkoutId}: POST 202, idempotent replay, GET PENDING.`);
      return;
    }
    if (observed.status !== 404) {
      throw new Error(`GET checkout status failed: ${observed.status} ${JSON.stringify(observed.body)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Checkout did not expose a PENDING Order within 20 seconds.");
});

interface RequestOptions {
  readonly body?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

async function signedJsonRequest(
  apiUrl: string,
  region: string,
  method: string,
  resourcePath: string,
  options: RequestOptions = {},
): Promise<{ readonly status: number; readonly body: unknown }> {
  const url = new URL(apiUrl);
  url.pathname = `${url.pathname.replace(/\/$/, "")}${resourcePath}`;
  const headers: Record<string, string> = {
    host: url.host,
    accept: "application/json",
    ...(options.headers ?? {}),
  };
  if (options.body !== undefined) headers["content-type"] = "application/json";

  const signer = new SignatureV4({
    credentials: defaultProvider(),
    region,
    service: "execute-api",
    sha256: Sha256,
  });
  const port = url.port.length === 0 ? {} : { port: Number(url.port) };
  const requestBody = options.body === undefined ? {} : { body: options.body };
  const signed = await signer.sign(
    new HttpRequest({
      protocol: url.protocol,
      hostname: url.hostname,
      ...port,
      method,
      path: `${url.pathname}${url.search}`,
      headers,
      ...requestBody,
    }),
  );
  const response = await fetch(url, {
    method,
    headers: signed.headers,
    ...requestBody,
  });
  const text = await response.text();
  let responseBody: unknown = text;
  try {
    responseBody = JSON.parse(text);
  } catch {
    // Keep non-JSON responses intact for diagnostics.
  }
  return { status: response.status, body: responseBody };
}

function stackOutput(outputKey: string): string {
  const response = runAwsJson([
    "cloudformation",
    "describe-stacks",
    "--stack-name",
    MARKETPLACE_CHECKOUT_STACK_NAME,
  ]);
  if (!isRecord(response) || !Array.isArray(response.Stacks)) {
    throw new Error("CloudFormation returned an unexpected stack response.");
  }
  const stack = response.Stacks[0];
  if (!isRecord(stack) || !Array.isArray(stack.Outputs)) {
    throw new Error(`${MARKETPLACE_CHECKOUT_STACK_NAME} has no outputs.`);
  }
  const output = stack.Outputs.find(
    (candidate) => isRecord(candidate) && candidate.OutputKey === outputKey,
  );
  if (!isRecord(output) || typeof output.OutputValue !== "string") {
    throw new Error(`${MARKETPLACE_CHECKOUT_STACK_NAME} output ${outputKey} is missing.`);
  }
  return output.OutputValue;
}
