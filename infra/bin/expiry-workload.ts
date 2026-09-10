#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { isRecord, runAwsJson, runAwsJsonAsync } from "../lib/aws-cli.js";
import { executeAsyncCli, runEnvironmentPreflight } from "../lib/cli.js";
import {
  dynamoStringAttribute,
  pollUntil,
  stackOutput,
} from "../lib/workload-evidence.js";

await executeAsyncCli(async () => {
  const preflight = runEnvironmentPreflight();
  if (preflight.requestCeiling < 4) {
    throw new Error("CHECKOUT_REQUEST_CEILING must be at least 4 for the expiry evidence suite.");
  }
  const inventoryFunctionName = stackOutput("InventoryCommandFunctionName");
  const expiryWorkerFunctionName = stackOutput("InventoryExpiryWorkerFunctionName");
  const inventoryTableName = stackOutput("InventoryTableName");
  const workflowAliasArn = stackOutput("CheckoutWorkflowAliasArn");
  const runId = Date.now().toString();

  await verifyWorkflowDeadline(workflowAliasArn, runId);
  await verifyAbandonedReservation({
    expiryWorkerFunctionName,
    inventoryTableName,
    runId,
    workflowAliasArn,
  });
  await verifyDuplicateRelease(inventoryFunctionName, inventoryTableName, runId);
  await verifyCommitExpiryRace(
    expiryWorkerFunctionName,
    inventoryFunctionName,
    inventoryTableName,
    runId,
    workflowAliasArn,
  );

  console.log(
    "Expiry checks passed: workflow deadline, abandoned reservation, duplicate sweeps, duplicate release, and commit-versus-expiry race.",
  );
});

async function verifyWorkflowDeadline(workflowAliasArn: string, runId: string): Promise<void> {
  const checkoutId = `expiry-workflow-${runId}`;
  const reservationExpiresAt = wholeSecondDeadline(5_000).toISOString();
  startWorkflow(workflowAliasArn, checkoutId, {
    ...workflowInput(checkoutId, reservationExpiresAt),
    inventoryCommitAt: reservationExpiresAt,
  });
  await waitForOrderStatus(checkoutId, "EXPIRED", 30_000);
}

interface AbandonedReservationInputs {
  readonly expiryWorkerFunctionName: string;
  readonly inventoryTableName: string;
  readonly runId: string;
  readonly workflowAliasArn: string;
}

async function verifyAbandonedReservation(inputs: AbandonedReservationInputs): Promise<void> {
  const checkoutId = `expiry-abandoned-${inputs.runId}`;
  const expiresAt = new Date(Date.now() + 8_000);
  const executionArn = startWorkflow(inputs.workflowAliasArn, checkoutId, {
    ...workflowInput(checkoutId, expiresAt.toISOString()),
    inventoryCommitAt: new Date(expiresAt.getTime() + 60_000).toISOString(),
  });
  await waitForReservationStatus(inputs.inventoryTableName, checkoutId, "RESERVED", 20_000);
  runAwsJson([
    "stepfunctions",
    "stop-execution",
    "--execution-arn",
    executionArn,
    "--error",
    "ExpiryEvidenceAbandoned",
    "--cause",
    "Deployed expiry evidence intentionally abandoned this execution after reservation.",
  ]);
  await pauseUntil(expiresAt.getTime());
  await waitForExpiryIndex(inputs.inventoryTableName, checkoutId, new Date().toISOString(), 20_000);

  const [firstSweep, duplicateSweep] = await Promise.all([
    invokeExpiryWorker(inputs.expiryWorkerFunctionName, `first-${inputs.runId}`),
    invokeExpiryWorker(inputs.expiryWorkerFunctionName, `duplicate-${inputs.runId}`),
  ]);
  assertSweepAttempted([firstSweep, duplicateSweep], `reservation-${checkoutId}`);
  await waitForReservationStatus(inputs.inventoryTableName, checkoutId, "RELEASED", 20_000);
  await waitForOrderStatus(checkoutId, "EXPIRED", 30_000);

  assertAvailableQuantity(inputs.inventoryTableName, `item-${checkoutId}`, 100);
}

async function verifyDuplicateRelease(
  inventoryFunctionName: string,
  inventoryTableName: string,
  runId: string,
): Promise<void> {
  const checkoutId = `expiry-duplicate-release-${runId}`;
  const correlationId = `corr-${checkoutId}`;
  const expiresAt = wholeSecondDeadline(2_000);
  await invokeLambda(
    inventoryFunctionName,
    reserveCommand(checkoutId, correlationId, expiresAt.toISOString()),
  );
  await pauseUntil(expiresAt.getTime());
  const release = releaseCommand(checkoutId, correlationId);
  const [first, second] = await Promise.all([
    invokeLambda(inventoryFunctionName, release),
    invokeLambda(inventoryFunctionName, release),
  ]);
  if (inventoryStatus(first) !== "RELEASED" || inventoryStatus(second) !== "RELEASED") {
    throw new Error("Duplicate expiry releases did not return the stable RELEASED result.");
  }
  await waitForReservationStatus(inventoryTableName, checkoutId, "RELEASED", 10_000);
  assertAvailableQuantity(inventoryTableName, `item-${checkoutId}`, 100);
}

async function verifyCommitExpiryRace(
  expiryWorkerFunctionName: string,
  inventoryFunctionName: string,
  inventoryTableName: string,
  runId: string,
  workflowAliasArn: string,
): Promise<void> {
  const checkoutId = `expiry-race-${runId}`;
  const correlationId = `corr-${checkoutId}`;
  const expiresAt = wholeSecondDeadline(6_000);
  const executionArn = startWorkflow(workflowAliasArn, checkoutId, {
    ...workflowInput(checkoutId, expiresAt.toISOString()),
    inventoryCommitAt: new Date(expiresAt.getTime() - 1_000).toISOString(),
  });
  await waitForReservationStatus(inventoryTableName, checkoutId, "RESERVED", 20_000);
  await waitForExpiryIndex(
    inventoryTableName,
    checkoutId,
    expiresAt.toISOString(),
    20_000,
  );
  const commit = {
    schemaVersion: "1.0",
    commandType: "CommitInventory",
    operationId: `commit-${checkoutId}`,
    checkoutId,
    reservationId: `reservation-${checkoutId}`,
    correlationId,
    causationId: `expiry-test-${runId}`,
  };
  await Promise.all([
    pauseUntil(expiresAt.getTime()).then(() =>
      invokeExpiryWorker(expiryWorkerFunctionName, `race-${runId}`)
    ),
    waitForSuccessfulExecution(executionArn, 30_000),
  ]);
  const finalStatus = await waitForAnyReservationStatus(
    inventoryTableName,
    checkoutId,
    ["COMMITTED", "RELEASED"],
    20_000,
  );
  const expectedCommitStatus = finalStatus === "COMMITTED"
    ? "COMMITTED"
    : "RESERVATION_NOT_ACTIVE";
  const replay = await invokeLambda(inventoryFunctionName, {
    ...commit,
    causationId: executionArn,
  });
  if (inventoryStatus(replay) !== expectedCommitStatus) {
    throw new Error(
      `Commit-versus-expiry disagreed with the final reservation state: ${inventoryStatus(replay)} / ${finalStatus}`,
    );
  }
  await waitForOrderStatus(checkoutId, finalStatus === "RELEASED" ? "EXPIRED" : "PENDING", 30_000);
  const expectedQuantity = finalStatus === "COMMITTED" ? 99 : 100;
  assertAvailableQuantity(inventoryTableName, `item-${checkoutId}`, expectedQuantity);
}

function assertSweepAttempted(responses: readonly unknown[], reservationId: string): void {
  const attempted = responses.some((response) => {
    const reservationIds = isRecord(response) ? response.attemptedReservationIds : undefined;
    return Array.isArray(reservationIds) && reservationIds.includes(reservationId);
  });
  if (!attempted) {
    throw new Error(`Duplicate expiry sweeps did not attempt ${reservationId}: ${JSON.stringify(responses)}`);
  }
}

function reserveCommand(checkoutId: string, correlationId: string, expiresAt: string) {
  return {
    schemaVersion: "1.0",
    commandType: "ReserveInventory",
    operationId: `reserve-${checkoutId}`,
    checkoutId,
    reservationId: `reservation-${checkoutId}`,
    itemId: `item-${checkoutId}`,
    quantity: 1,
    expiresAt,
    correlationId,
    causationId: `expiry-test-${checkoutId}`,
  };
}

function releaseCommand(checkoutId: string, correlationId: string) {
  const operationId = `expire-sweep-reservation-${checkoutId}`;
  return {
    schemaVersion: "1.0",
    commandType: "ReleaseInventory",
    operationId,
    checkoutId,
    reservationId: `reservation-${checkoutId}`,
    releaseReason: "CHECKOUT_EXPIRED",
    correlationId,
    causationId: operationId,
  };
}

function workflowInput(checkoutId: string, reservationExpiresAt: string) {
  return {
    checkoutId,
    cartId: `cart-${checkoutId}`,
    correlationId: `corr-${checkoutId}`,
    itemId: `item-${checkoutId}`,
    quantity: 1,
    reservationExpiresAt,
  };
}

function wholeSecondDeadline(minimumDelayMilliseconds: number): Date {
  return new Date(Math.ceil((Date.now() + minimumDelayMilliseconds) / 1_000) * 1_000);
}

function startWorkflow(
  workflowAliasArn: string,
  executionName: string,
  input: Readonly<Record<string, unknown>>,
): string {
  const response = runAwsJson([
    "stepfunctions",
    "start-execution",
    "--state-machine-arn",
    workflowAliasArn,
    "--name",
    executionName,
    "--input",
    JSON.stringify(input),
  ]);
  if (!isRecord(response) || typeof response.executionArn !== "string") {
    throw new Error(`Step Functions did not start ${executionName}.`);
  }
  return response.executionArn;
}

async function invokeExpiryWorker(functionName: string, id: string): Promise<unknown> {
  return invokeLambda(functionName, {
    id,
    version: "0",
    account: "000000000000",
    time: new Date().toISOString(),
    region: "us-east-1",
    resources: [],
    source: "aws.events",
    "detail-type": "Scheduled Event",
    detail: {},
  });
}

async function invokeLambda(functionName: string, payload: unknown): Promise<unknown> {
  const directory = mkdtempSync(path.join(tmpdir(), "aws-architecture-lab-expiry-"));
  const responsePath = path.join(directory, "response.json");
  try {
    const metadata = await runAwsJsonAsync([
      "lambda",
      "invoke",
      "--function-name",
      functionName,
      "--cli-binary-format",
      "raw-in-base64-out",
      "--payload",
      JSON.stringify(payload),
      responsePath,
    ]);
    if (!isRecord(metadata) || metadata.StatusCode !== 200 || metadata.FunctionError !== undefined) {
      throw new Error(`Lambda ${functionName} failed: ${JSON.stringify(metadata)}`);
    }
    const response = JSON.parse(readFileSync(responsePath, "utf8")) as unknown;
    if (isRecord(response) && typeof response.errorMessage === "string") {
      throw new Error(`Lambda ${functionName} failed: ${response.errorMessage}`);
    }
    return response;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function inventoryStatus(response: unknown): string | undefined {
  return isRecord(response) && typeof response.status === "string" ? response.status : undefined;
}

async function waitForOrderStatus(
  checkoutId: string,
  expectedStatus: string,
  timeoutMilliseconds: number,
): Promise<void> {
  const orderTableName = stackOutput("OrderTableName");
  const observed = await pollUntil(timeoutMilliseconds, () => {
    const item = dynamoItem(orderTableName, { checkoutId: { S: checkoutId } });
    return stringAttribute(item, "status") === expectedStatus ? true : undefined;
  });
  if (observed === undefined) throw new Error(`Order ${checkoutId} did not reach ${expectedStatus}.`);
}

async function waitForSuccessfulExecution(
  executionArn: string,
  timeoutMilliseconds: number,
): Promise<void> {
  const status = await pollUntil(timeoutMilliseconds, () => {
    const response = runAwsJson([
      "stepfunctions",
      "describe-execution",
      "--execution-arn",
      executionArn,
    ]);
    if (!isRecord(response) || typeof response.status !== "string") return undefined;
    return response.status === "RUNNING" ? undefined : response.status;
  });
  if (status !== "SUCCEEDED") {
    throw new Error(`Checkout execution ended with ${status ?? "no terminal status"}.`);
  }
}

async function waitForReservationStatus(
  tableName: string,
  checkoutId: string,
  expectedStatus: string,
  timeoutMilliseconds: number,
): Promise<void> {
  await waitForAnyReservationStatus(tableName, checkoutId, [expectedStatus], timeoutMilliseconds);
}

async function waitForAnyReservationStatus(
  tableName: string,
  checkoutId: string,
  expectedStatuses: readonly string[],
  timeoutMilliseconds: number,
): Promise<string> {
  const observed = await pollUntil(timeoutMilliseconds, () => {
    const item = dynamoItem(tableName, {
      recordKey: { S: `RESERVATION#reservation-${checkoutId}` },
    });
    const status = stringAttribute(item, "status");
    return status !== undefined && expectedStatuses.includes(status) ? status : undefined;
  });
  if (observed === undefined) {
    throw new Error(`Reservation for ${checkoutId} did not reach ${expectedStatuses.join(" or ")}.`);
  }
  return observed;
}

function assertAvailableQuantity(tableName: string, itemId: string, expected: number): void {
  const item = dynamoItem(tableName, { recordKey: { S: `STOCK#${itemId}` } });
  const quantity = numberAttribute(item, "availableQuantity");
  if (quantity !== expected) {
    throw new Error(`Expected ${itemId} availability ${expected}, received ${quantity ?? "missing"}.`);
  }
}

function dynamoItem(
  tableName: string,
  key: Readonly<Record<string, unknown>>,
): Record<string, unknown> | undefined {
  const response = runAwsJson([
    "dynamodb",
    "get-item",
    "--table-name",
    tableName,
    "--consistent-read",
    "--key",
    JSON.stringify(key),
  ]);
  return isRecord(response) && isRecord(response.Item) ? response.Item : undefined;
}

async function waitForExpiryIndex(
  tableName: string,
  checkoutId: string,
  cutoff: string,
  timeoutMilliseconds: number,
): Promise<void> {
  const recordKey = `RESERVATION#reservation-${checkoutId}`;
  const observed = await pollUntil(timeoutMilliseconds, () => {
    const response = runAwsJson([
      "dynamodb",
      "query",
      "--table-name",
      tableName,
      "--index-name",
      "ReservationExpiryIndex",
      "--key-condition-expression",
      "#status = :reserved AND expiresAt <= :cutoff",
      "--expression-attribute-names",
      JSON.stringify({ "#status": "status" }),
      "--expression-attribute-values",
      JSON.stringify({
        ":reserved": { S: "RESERVED" },
        ":cutoff": { S: cutoff },
      }),
    ]);
    if (!isRecord(response) || !Array.isArray(response.Items)) return undefined;
    return response.Items.some(
      (item) => isRecord(item) && stringAttribute(item, "recordKey") === recordKey,
    ) ? true : undefined;
  });
  if (observed === undefined) {
    throw new Error(`Reservation for ${checkoutId} did not appear in the expiry index.`);
  }
}

async function pauseUntil(epochMilliseconds: number): Promise<void> {
  const delay = epochMilliseconds - Date.now();
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
}

function stringAttribute(item: Record<string, unknown> | undefined, name: string): string | undefined {
  return dynamoStringAttribute(item, name);
}

function numberAttribute(item: Record<string, unknown> | undefined, name: string): number | undefined {
  const attribute = item?.[name];
  return isRecord(attribute) && typeof attribute.N === "string" ? Number(attribute.N) : undefined;
}
