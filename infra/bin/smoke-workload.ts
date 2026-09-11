#!/usr/bin/env node
import { Sha256 } from "@aws-crypto/sha256-js";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { HttpRequest } from "@smithy/protocol-http";
import { SignatureV4 } from "@smithy/signature-v4";

import { isRecord, runAwsJson } from "../lib/aws-cli.js";
import { executeAsyncCli, runEnvironmentPreflight } from "../lib/cli.js";
import { dynamoStringAttribute, pollUntil, stackOutput } from "../lib/workload-evidence.js";

await executeAsyncCli(async () => {
  const report = runEnvironmentPreflight();
  const apiUrl = stackOutput("CheckoutApiUrl");
  const eventBusName = stackOutput("CheckoutEventBusName");
  const auditTableName = stackOutput("OrderAuditTableName");
  const auditLogGroupName = stackOutput("OrderAuditConsumerLogGroupName");
  const eventSource = stackOutput("OrderEventSource");
  const orderPendingEventType = stackOutput("OrderPendingEventType");
  const inventoryTableName = stackOutput("InventoryTableName");
  const paymentTableName = stackOutput("PaymentTableName");
  const idempotencyKey = `smoke-${Date.now()}`;
  const correlationId = `smoke-correlation-${Date.now()}`;
  const requestBody = JSON.stringify({
    contractVersion: "1.0",
    cartId: `smoke-cart-${Date.now()}`,
    correlationId,
    itemId: `smoke-item-${Date.now()}`,
    quantity: 1,
  });

  const submitted = await signedJsonRequest(apiUrl, report.region, "POST", "/checkouts", {
    body: requestBody,
    headers: { "Idempotency-Key": idempotencyKey },
  });
  if (submitted.status !== 202 || !isRecord(submitted.body) || typeof submitted.body.checkoutId !== "string" || typeof submitted.body.statusLocation !== "string") {
    throw new Error(`POST /checkouts failed: ${submitted.status} ${JSON.stringify(submitted.body)}`);
  }
  const checkoutId = submitted.body.checkoutId;
  const statusLocation = submitted.body.statusLocation;

  const repeated = await signedJsonRequest(apiUrl, report.region, "POST", "/checkouts", {
    body: requestBody,
    headers: { "Idempotency-Key": idempotencyKey },
  });
  if (!isRecord(repeated.body) || repeated.body.checkoutId !== checkoutId) {
    throw new Error("Repeated submission did not return the original Checkout.");
  }

  const status = await pollUntil(20_000, async () => {
    const observed = await signedJsonRequest(
      apiUrl,
      report.region,
      "GET",
      statusLocation,
    );
    if (
      observed.status === 200 &&
      isRecord(observed.body) &&
      observed.body.checkoutId === checkoutId &&
      observed.body.status === "PENDING"
    ) {
      return observed;
    }
    if (observed.status !== 404) {
      throw new Error(`GET checkout status failed: ${observed.status} ${JSON.stringify(observed.body)}`);
    }
    return undefined;
  });
  if (status === undefined) {
    throw new Error("Checkout did not expose a PENDING Order within 20 seconds.");
  }

  await waitForReservedInventory(inventoryTableName, checkoutId, 20_000);
  await waitForPaymentAuthorization(paymentTableName, checkoutId, 20_000);

  const initialAudit = await waitForAuditedEvent(auditTableName, correlationId, 20_000);
  const eventId = stringAttribute(initialAudit, "eventId");
  const occurredAt = stringAttribute(initialAudit, "occurredAt");
  const causationId = stringAttribute(initialAudit, "causationId");
  const aggregateId = stringAttribute(initialAudit, "aggregateId");
  const duplicateDetail = {
    eventId,
    eventVersion: "1.0",
    occurredAt,
    correlationId,
    causationId,
    aggregateType: "Order",
    aggregateId,
    payload: { status: "PENDING" },
  };
  const distinctEventId = `${eventId}-smoke-distinct`;
  const distinctDetail = {
    ...duplicateDetail,
    eventId: distinctEventId,
    aggregateId: `${aggregateId}-smoke-distinct`,
  };
  const publication = runAwsJson([
    "events",
    "put-events",
    "--entries",
    JSON.stringify([
      {
        Source: eventSource,
        DetailType: orderPendingEventType,
        EventBusName: eventBusName,
        Detail: JSON.stringify(duplicateDetail),
      },
      {
        Source: eventSource,
        DetailType: orderPendingEventType,
        EventBusName: eventBusName,
        Detail: JSON.stringify(distinctDetail),
      },
    ]),
  ]);
  if (!isRecord(publication) || publication.FailedEntryCount !== 0) {
    throw new Error(`Duplicate publication probe failed: ${JSON.stringify(publication)}`);
  }
  await waitForAuditItem(auditTableName, distinctEventId, 20_000);
  await waitForDuplicateAuditLog(auditLogGroupName, eventId, 30_000);
  const originalAfterReplay = auditItem(auditTableName, eventId);
  if (JSON.stringify(originalAfterReplay) !== JSON.stringify(initialAudit)) {
    throw new Error("The duplicate delivery changed the original audit record.");
  }

  console.log(
    `Smoke passed for ${checkoutId}: POST 202, idempotent replay, GET PENDING, Inventory reserved, Payment authorized, transactional Order event observed, duplicate deduplicated, distinct event retained.`,
  );
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

async function waitForAuditedEvent(
  tableName: string,
  correlationId: string,
  timeoutMilliseconds: number,
): Promise<Record<string, unknown>> {
  const item = await pollUntil(timeoutMilliseconds, () => {
    const response = runAwsJson([
      "dynamodb",
      "scan",
      "--table-name",
      tableName,
      "--consistent-read",
      "--filter-expression",
      "correlationId = :correlationId",
      "--expression-attribute-values",
      JSON.stringify({ ":correlationId": { S: correlationId } }),
    ]);
    if (isRecord(response) && Array.isArray(response.Items)) {
      return response.Items.find(isRecord);
    }
    return undefined;
  });
  if (item !== undefined) return item;
  throw new Error("The committed Order event did not reach the audit consumer within 20 seconds.");
}

async function waitForAuditItem(
  tableName: string,
  eventId: string,
  timeoutMilliseconds: number,
): Promise<Record<string, unknown>> {
  const item = await pollUntil(timeoutMilliseconds, () => auditItem(tableName, eventId));
  if (item !== undefined) return item;
  throw new Error(`Distinct event ${eventId} did not reach the audit consumer within 20 seconds.`);
}

async function waitForDuplicateAuditLog(
  logGroupName: string,
  eventId: string,
  timeoutMilliseconds: number,
): Promise<void> {
  const observed = await pollUntil(timeoutMilliseconds, () => {
    const response = runAwsJson([
      "logs",
      "filter-log-events",
      "--log-group-name",
      logGroupName,
      "--filter-pattern",
      `{ $.event = "OrderEventDuplicateIgnored" && $.eventId = "${eventId}" }`,
      "--limit",
      "1",
    ]);
    return isRecord(response) && Array.isArray(response.events) && response.events.length > 0
      ? true
      : undefined;
  });
  if (observed === undefined) {
    throw new Error("The audit consumer did not report ignoring the duplicate delivery.");
  }
}

function auditItem(tableName: string, eventId: string): Record<string, unknown> | undefined {
  const response = runAwsJson([
    "dynamodb",
    "get-item",
    "--table-name",
    tableName,
    "--consistent-read",
    "--key",
    JSON.stringify({ eventId: { S: eventId } }),
  ]);
  return isRecord(response) && isRecord(response.Item) ? response.Item : undefined;
}

async function waitForReservedInventory(
  tableName: string,
  checkoutId: string,
  timeoutMilliseconds: number,
): Promise<void> {
  const reservationId = `reservation-${checkoutId}`;
  const observed = await pollUntil(timeoutMilliseconds, () => {
    const response = runAwsJson([
      "dynamodb",
      "get-item",
      "--table-name",
      tableName,
      "--consistent-read",
      "--key",
      JSON.stringify({ recordKey: { S: `RESERVATION#${reservationId}` } }),
    ]);
    if (!isRecord(response) || !isRecord(response.Item)) return undefined;
    const status = response.Item.status;
    return isRecord(status) && status.S === "RESERVED" ? true : undefined;
  });
  if (observed === undefined) {
    throw new Error("Checkout Inventory reservation was not created within 20 seconds.");
  }
}

async function waitForPaymentAuthorization(
  tableName: string,
  checkoutId: string,
  timeoutMilliseconds: number,
): Promise<void> {
  const observed = await pollUntil(timeoutMilliseconds, () => {
    const response = runAwsJson([
      "dynamodb",
      "get-item",
      "--table-name",
      tableName,
      "--consistent-read",
      "--key",
      JSON.stringify({ recordKey: { S: `PAYMENT#payment-${checkoutId}` } }),
    ]);
    if (!isRecord(response) || !isRecord(response.Item)) return undefined;
    const status = response.Item.status;
    return isRecord(status) && status.S === "AUTHORIZED" ? true : undefined;
  });
  if (observed === undefined) {
    throw new Error("Checkout Payment was not authorized within 20 seconds.");
  }
}

function stringAttribute(item: Record<string, unknown>, name: string): string {
  const value = dynamoStringAttribute(item, name);
  if (value === undefined) {
    throw new Error(`Audit event is missing string attribute ${name}.`);
  }
  return value;
}
