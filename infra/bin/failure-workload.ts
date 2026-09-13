#!/usr/bin/env node
import { isRecord, runAwsJson } from "../lib/aws-cli.js";
import { executeAsyncCli, runEnvironmentPreflight } from "../lib/cli.js";
import { dynamoStringAttribute, pollUntil, stackOutput } from "../lib/workload-evidence.js";

type FailureEffect =
  | "BUSINESS_REJECTION"
  | "FAIL_BEFORE_MUTATION"
  | "THROTTLE"
  | "TIMEOUT"
  | "DUPLICATE_DELIVERY"
  | "AMBIGUOUS_COMPLETION";

interface EvidenceContext {
  readonly failurePlanTableName: string;
  readonly failureRoleEnvironment: NodeJS.ProcessEnv;
  readonly fulfillmentOutboxTableName: string;
  readonly fulfillmentTableName: string;
  readonly inventoryOutboxTableName: string;
  readonly inventoryTableName: string;
  readonly orderOutboxTableName: string;
  readonly orderTableName: string;
  readonly paymentOutboxTableName: string;
  readonly paymentTableName: string;
  readonly providerTableName: string;
  readonly runId: string;
  readonly workflowAliasArn: string;
}

await executeAsyncCli(async () => {
  const preflight = runEnvironmentPreflight();
  if (preflight.requestCeiling < 12) {
    throw new Error("CHECKOUT_REQUEST_CEILING must be at least 12 for the failure evidence suite.");
  }
  const context: EvidenceContext = {
    failurePlanTableName: stackOutput("FakePaymentFailurePlanTableName"),
    failureRoleEnvironment: assumeFailurePlanRole(stackOutput("FakePaymentFailurePlanRoleArn")),
    fulfillmentOutboxTableName: stackOutput("FulfillmentOutboxTableName"),
    fulfillmentTableName: stackOutput("FulfillmentTableName"),
    inventoryOutboxTableName: stackOutput("InventoryOutboxTableName"),
    inventoryTableName: stackOutput("InventoryTableName"),
    orderOutboxTableName: stackOutput("OrderOutboxTableName"),
    orderTableName: stackOutput("OrderTableName"),
    paymentOutboxTableName: stackOutput("PaymentOutboxTableName"),
    paymentTableName: stackOutput("PaymentTableName"),
    providerTableName: stackOutput("FakePaymentProviderTableName"),
    runId: Date.now().toString(),
    workflowAliasArn: stackOutput("CheckoutWorkflowAliasArn"),
  };

  await verifyInventoryRejection(context);
  await verifyPaymentPlan(context, "BUSINESS_REJECTION", "CANCELLED", 1);
  for (const effect of ["FAIL_BEFORE_MUTATION", "THROTTLE", "TIMEOUT"] as const) {
    await verifyPaymentPlan(context, effect, "CANCELLED", 3);
  }
  await verifyPaymentPlan(context, "AMBIGUOUS_COMPLETION", "CONFIRMED", 1);
  await verifyPaymentPlan(context, "DUPLICATE_DELIVERY", "CONFIRMED", 1);
  await verifyFulfillmentReservationFailure(context);
  await verifyCaptureFailure(context);
  await verifyAmbiguousCapture(context);
  await verifyInventoryCommitFailure(context);
  await verifyRefundRetryExhaustion(context);

  console.log(
    "Failure checks passed: pre-capture and post-capture branches, capture reconciliation, reverse-order compensation, replay without duplicate economic effects, durable ledgers and facts, and bounded workflow transitions.",
  );
});

async function verifyInventoryRejection(context: EvidenceContext): Promise<void> {
  const checkoutId = checkoutIdFor(context, "inventory-rejection");
  const executionArn = startWorkflow(context, checkoutId, 101);
  const history = await waitForExecution(executionArn);
  await waitForOrderStatus(context, checkoutId, "INVENTORY_UNAVAILABLE");
  assertStateVisits(history, "ReserveInventory", 1);
  assertStateVisits(history, "ReleaseCompensatingInventory", 0);
  assertStateVisits(history, "CancelPaymentAuthorization", 0);
  assertBoundedTransitions(history);
  assertOperationStatus(
    context.inventoryTableName,
    "recordKey",
    `OPERATION#reserve-${checkoutId}`,
    "OUT_OF_STOCK",
  );
  assertEvents(context.orderOutboxTableName, checkoutId, [
    "OrderPending",
    "OrderInventoryUnavailable",
  ]);
  assertEvents(context.inventoryOutboxTableName, checkoutId, []);
}

async function verifyPaymentPlan(
  context: EvidenceContext,
  effect: FailureEffect,
  terminalStatus: "CANCELLED" | "CONFIRMED",
  expectedProviderAttempts: number,
): Promise<void> {
  const checkoutId = checkoutIdFor(context, effect.toLowerCase().replaceAll("_", "-"));
  const semanticKey = `payment:payment-${checkoutId}:authorize`;
  const effects = terminalStatus === "CANCELLED" && effect !== "BUSINESS_REJECTION"
    ? [effect, effect, effect]
    : [effect];
  putFailurePlan(context, semanticKey, effects);
  try {
    const executionArn = startWorkflow(context, checkoutId);
    const history = await waitForExecution(executionArn);
    await waitForOrderStatus(context, checkoutId, terminalStatus);
    assertStateVisits(history, "AuthorizePayment", 1);
    assertBoundedTransitions(history);
    assertNumberAttribute(
      dynamoItem(
        context.providerTableName,
        "recordKey",
        `FAILURE_ATTEMPT#${semanticKey}`,
      ),
      "attemptCount",
      expectedProviderAttempts,
    );

    if (terminalStatus === "CANCELLED") {
      assertStateOrder(history, [
        "MarkOrderCompensating",
        "ReleaseCompensatingInventory",
        "MarkOrderCancelled",
      ]);
      assertStateVisits(history, "ReleaseCompensatingInventory", 1);
      assertStateVisits(history, "CancelPaymentAuthorization", 0);
      assertCompensatedInventoryAndOrder(context, checkoutId);
      assertEvents(context.inventoryOutboxTableName, checkoutId, [
        "InventoryReserved",
        "InventoryReleased",
      ]);
      assertEvents(context.orderOutboxTableName, checkoutId, [
        "OrderPending",
        "OrderCompensating",
        "OrderCancelled",
      ]);
      const expectedPaymentOperationState = effect === "BUSINESS_REJECTION"
        ? "FAILED"
        : "IN_PROGRESS";
      assertStringAttribute(
        dynamoItem(context.paymentTableName, "recordKey", `OPERATION#authorize-${checkoutId}`),
        "state",
        expectedPaymentOperationState,
      );
      if (effect === "BUSINESS_REJECTION") {
        assertOperationStatus(
          context.paymentTableName,
          "recordKey",
          `OPERATION#authorize-${checkoutId}`,
          "REJECTED",
        );
      }
      return;
    }

    assertStateVisits(history, "ReleaseCompensatingInventory", 0);
    assertOperationStatus(
      context.paymentTableName,
      "recordKey",
      `OPERATION#authorize-${checkoutId}`,
      "AUTHORIZED",
    );
    assertStringAttribute(
      dynamoItem(
        context.providerTableName,
        "recordKey",
        `PROVIDER_OPERATION#${semanticKey}`,
      ),
      "recordType",
      "PROVIDER_OPERATION",
    );
    assertEvents(context.paymentOutboxTableName, checkoutId, [
      "PaymentAuthorized",
      "PaymentCaptured",
    ]);
  } finally {
    deleteFailurePlan(context, semanticKey);
  }
}

async function verifyFulfillmentReservationFailure(context: EvidenceContext): Promise<void> {
  const checkoutId = checkoutIdFor(context, "fulfillment-rejection");
  const semanticKey = `fulfillment:fulfillment-${checkoutId}:reserve`;
  putFailurePlan(context, semanticKey, ["BUSINESS_REJECTION"]);
  try {
    const executionArn = startWorkflow(context, checkoutId);
    const history = await waitForExecution(executionArn);
    await waitForOrderStatus(context, checkoutId, "CANCELLED");
    assertStateVisits(history, "ReserveFulfillment", 1);
    assertStateVisits(history, "CancelPaymentAuthorization", 1);
    assertStateVisits(history, "ReleaseCompensatingInventory", 1);
    assertStateOrder(history, [
      "MarkOrderCompensating",
      "CancelPaymentAuthorization",
      "ReleaseCompensatingInventory",
      "MarkOrderCancelled",
    ]);
    assertBoundedTransitions(history);
    assertOperationStatus(
      context.fulfillmentTableName,
      "recordKey",
      `OPERATION#reserve-fulfillment-${checkoutId}`,
      "CAPACITY_UNAVAILABLE",
    );
    assertOperationStatus(
      context.paymentTableName,
      "recordKey",
      `OPERATION#compensate-payment-${checkoutId}`,
      "CANCELLED",
    );
    assertCompensatedInventoryAndOrder(context, checkoutId);
    assertEvents(context.paymentOutboxTableName, checkoutId, [
      "PaymentAuthorized",
      "PaymentCancelled",
    ]);
    assertEvents(context.inventoryOutboxTableName, checkoutId, [
      "InventoryReserved",
      "InventoryReleased",
    ]);
    assertEvents(context.orderOutboxTableName, checkoutId, [
      "OrderPending",
      "OrderCompensating",
      "OrderCancelled",
    ]);
  } finally {
    deleteFailurePlan(context, semanticKey);
  }
}

async function verifyCaptureFailure(context: EvidenceContext): Promise<void> {
  const checkoutId = checkoutIdFor(context, "capture-not-applied");
  const semanticKey = `payment:payment-${checkoutId}:capture`;
  const timing = { reservationExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString() };
  putFailurePlan(context, semanticKey, [
    "FAIL_BEFORE_MUTATION",
    "FAIL_BEFORE_MUTATION",
    "FAIL_BEFORE_MUTATION",
  ]);
  try {
    const executionArn = startWorkflow(context, checkoutId, 1, timing);
    const history = await waitForExecution(executionArn);
    await waitForOrderStatus(context, checkoutId, "CANCELLED");
    assertStateOrder(history, [
      "CapturePayment",
      "RetrievePaymentAfterCaptureFailure",
      "MarkOrderCompensating",
      "CancelFulfillmentReservation",
      "CancelPaymentAuthorization",
      "ReleaseCompensatingInventory",
      "MarkOrderCancelled",
    ]);
    assertStateVisits(history, "RefundCapturedPayment", 0);
    assertNumberAttribute(
      dynamoItem(context.providerTableName, "recordKey", `FAILURE_ATTEMPT#${semanticKey}`),
      "attemptCount",
      3,
    );
    assertOperationStatus(
      context.paymentTableName,
      "recordKey",
      `OPERATION#capture-${checkoutId}`,
      "REJECTED",
    );
    assertOperationStatus(
      context.fulfillmentTableName,
      "recordKey",
      `OPERATION#cancel-fulfillment-${checkoutId}`,
      "CANCELLED",
    );
    assertOperationStatus(
      context.paymentTableName,
      "recordKey",
      `OPERATION#compensate-payment-${checkoutId}`,
      "CANCELLED",
    );
    assertCompensatedInventoryAndOrder(context, checkoutId);
    assertCompensationFacts(context, checkoutId, ["PaymentAuthorized", "PaymentCancelled"]);

    await replayWorkflow(context, checkoutId, timing);
    assertNumberAttribute(
      dynamoItem(context.providerTableName, "recordKey", `FAILURE_ATTEMPT#${semanticKey}`),
      "attemptCount",
      3,
    );
    assertCompensationFacts(context, checkoutId, ["PaymentAuthorized", "PaymentCancelled"]);
  } finally {
    deleteFailurePlan(context, semanticKey);
  }
}

async function verifyAmbiguousCapture(context: EvidenceContext): Promise<void> {
  const checkoutId = checkoutIdFor(context, "capture-ambiguous");
  const semanticKey = `payment:payment-${checkoutId}:capture`;
  const timing = { reservationExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString() };
  putFailurePlan(context, semanticKey, ["AMBIGUOUS_COMPLETION"]);
  try {
    const executionArn = startWorkflow(context, checkoutId, 1, timing);
    const history = await waitForExecution(executionArn);
    await waitForOrderStatus(context, checkoutId, "CANCELLED");
    assertStateVisits(history, "CapturePayment", 1);
    assertStateVisits(history, "RetrievePaymentAfterCaptureFailure", 1);
    assertStateVisits(history, "RefundCapturedPayment", 1);
    assertNumberAttribute(
      dynamoItem(context.providerTableName, "recordKey", `FAILURE_ATTEMPT#${semanticKey}`),
      "attemptCount",
      1,
    );
    assertOperationStatus(
      context.paymentTableName,
      "recordKey",
      `OPERATION#capture-${checkoutId}`,
      "CAPTURED",
    );
    assertOperationStatus(
      context.paymentTableName,
      "recordKey",
      `OPERATION#refund-payment-${checkoutId}`,
      "REFUNDED",
    );
    assertCompensationFacts(context, checkoutId, [
      "PaymentAuthorized",
      "PaymentCaptured",
      "PaymentRefunded",
    ]);
    assertBoundedTransitions(history);

    await replayWorkflow(context, checkoutId, timing);
    assertCompensationFacts(context, checkoutId, [
      "PaymentAuthorized",
      "PaymentCaptured",
      "PaymentRefunded",
    ]);
  } finally {
    deleteFailurePlan(context, semanticKey);
  }
}

async function verifyInventoryCommitFailure(context: EvidenceContext): Promise<void> {
  const checkoutId = checkoutIdFor(context, "inventory-commit");
  const now = Date.now();
  const timing = {
    reservationExpiresAt: new Date(now + 15_000).toISOString(),
    inventoryCommitAt: new Date(now + 16_000).toISOString(),
  };
  const executionArn = startWorkflow(context, checkoutId, 1, timing);
  const history = await waitForExecution(executionArn);
  await waitForOrderStatus(context, checkoutId, "CANCELLED");
  assertStateOrder(history, [
    "CapturePayment",
    "CommitInventory",
    "MarkOrderCompensating",
    "RefundCapturedPayment",
    "CancelFulfillmentReservation",
    "ReleaseCompensatingInventory",
    "MarkOrderCancelled",
  ]);
  assertStateVisits(history, "CancelPaymentAuthorization", 0);
  assertOperationStatus(
    context.inventoryTableName,
    "recordKey",
    `OPERATION#commit-${checkoutId}`,
    "RESERVATION_NOT_ACTIVE",
  );
  assertOperationStatus(
    context.paymentTableName,
    "recordKey",
    `OPERATION#refund-payment-${checkoutId}`,
    "REFUNDED",
  );
  assertOperationStatus(
    context.fulfillmentTableName,
    "recordKey",
    `OPERATION#cancel-fulfillment-${checkoutId}`,
    "CANCELLED",
  );
  assertCompensatedInventoryAndOrder(context, checkoutId);
  assertCompensationFacts(context, checkoutId, [
    "PaymentAuthorized",
    "PaymentCaptured",
    "PaymentRefunded",
  ]);
  assertBoundedTransitions(history);

  await replayWorkflow(context, checkoutId, timing);
  assertCompensationFacts(context, checkoutId, [
    "PaymentAuthorized",
    "PaymentCaptured",
    "PaymentRefunded",
  ]);
}

async function verifyRefundRetryExhaustion(context: EvidenceContext): Promise<void> {
  const checkoutId = checkoutIdFor(context, "refund-exhaustion");
  const semanticKey = `payment:payment-${checkoutId}:refund`;
  const now = Date.now();
  const timing = {
    reservationExpiresAt: new Date(now + 15_000).toISOString(),
    inventoryCommitAt: new Date(now + 16_000).toISOString(),
  };
  putFailurePlan(context, semanticKey, [
    "FAIL_BEFORE_MUTATION",
    "FAIL_BEFORE_MUTATION",
    "FAIL_BEFORE_MUTATION",
  ]);
  try {
    const executionArn = startWorkflow(context, checkoutId, 1, timing);
    const failedHistory = await waitForExecution(executionArn, "FAILED");
    await waitForOrderStatus(context, checkoutId, "COMPENSATING");
    assertStateVisits(failedHistory, "RefundCapturedPayment", 1);
    assertNumberAttribute(
      dynamoItem(context.providerTableName, "recordKey", `FAILURE_ATTEMPT#${semanticKey}`),
      "attemptCount",
      3,
    );
    assertStringAttribute(
      dynamoItem(context.paymentTableName, "recordKey", `OPERATION#refund-payment-${checkoutId}`),
      "state",
      "IN_PROGRESS",
    );
    assertEvents(context.paymentOutboxTableName, checkoutId, [
      "PaymentAuthorized",
      "PaymentCaptured",
    ]);

    deleteFailurePlan(context, semanticKey);
    await replayWorkflow(context, checkoutId, timing);
    assertOperationStatus(
      context.paymentTableName,
      "recordKey",
      `OPERATION#refund-payment-${checkoutId}`,
      "REFUNDED",
    );
    assertCompensationFacts(context, checkoutId, [
      "PaymentAuthorized",
      "PaymentCaptured",
      "PaymentRefunded",
    ]);
  } finally {
    deleteFailurePlan(context, semanticKey);
  }
}

function assertCompensationFacts(
  context: EvidenceContext,
  checkoutId: string,
  paymentEvents: readonly string[],
): void {
  assertEvents(context.paymentOutboxTableName, checkoutId, paymentEvents);
  assertEvents(context.fulfillmentOutboxTableName, checkoutId, [
    "FulfillmentReserved",
    "FulfillmentCancelled",
  ]);
  assertEvents(context.inventoryOutboxTableName, checkoutId, [
    "InventoryReserved",
    "InventoryReleased",
  ]);
  assertEvents(context.orderOutboxTableName, checkoutId, [
    "OrderPending",
    "OrderCompensating",
    "OrderCancelled",
  ]);
}

function assertCompensatedInventoryAndOrder(
  context: EvidenceContext,
  checkoutId: string,
): void {
  assertOperationStatus(
    context.orderTableName,
    "checkoutId",
    `OPERATION#compensate-order-${checkoutId}`,
    "COMPENSATING",
  );
  assertOperationStatus(
    context.inventoryTableName,
    "recordKey",
    `OPERATION#compensate-inventory-${checkoutId}`,
    "RELEASED",
  );
  assertOperationStatus(
    context.orderTableName,
    "checkoutId",
    `OPERATION#cancel-order-${checkoutId}`,
    "CANCELLED",
  );
}

function startWorkflow(
  context: EvidenceContext,
  checkoutId: string,
  quantity = 1,
  options: {
    readonly executionName?: string;
    readonly inventoryCommitAt?: string;
    readonly reservationExpiresAt?: string;
  } = {},
): string {
  const response = runAwsJson([
    "stepfunctions",
    "start-execution",
    "--state-machine-arn",
    context.workflowAliasArn,
    "--name",
    options.executionName ?? checkoutId,
    "--input",
    JSON.stringify({
      checkoutId,
      cartId: `cart-${checkoutId}`,
      correlationId: `corr-${checkoutId}`,
      itemId: `item-${checkoutId}`,
      quantity,
      reservationExpiresAt:
        options.reservationExpiresAt ?? new Date(Date.now() + 5 * 60_000).toISOString(),
      ...(options.inventoryCommitAt === undefined
        ? {}
        : { inventoryCommitAt: options.inventoryCommitAt }),
    }),
  ]);
  if (!isRecord(response) || typeof response.executionArn !== "string") {
    throw new Error(`Step Functions did not start ${checkoutId}.`);
  }
  return response.executionArn;
}

async function replayWorkflow(
  context: EvidenceContext,
  checkoutId: string,
  timing: { readonly inventoryCommitAt?: string; readonly reservationExpiresAt: string },
): Promise<void> {
  const executionArn = startWorkflow(context, checkoutId, 1, {
    ...timing,
    executionName: `${checkoutId}-replay`,
  });
  const history = await waitForExecution(executionArn);
  assertBoundedTransitions(history);
}

async function waitForExecution(
  executionArn: string,
  expectedStatus = "SUCCEEDED",
): Promise<readonly Record<string, unknown>[]> {
  const status = await pollUntil(45_000, () => {
    const response = runAwsJson([
      "stepfunctions",
      "describe-execution",
      "--execution-arn",
      executionArn,
    ]);
    if (!isRecord(response) || typeof response.status !== "string") return undefined;
    return response.status === "RUNNING" ? undefined : response.status;
  });
  if (status !== expectedStatus) {
    throw new Error(
      `Failure evidence execution ended with ${status ?? "no terminal status"}; expected ${expectedStatus}.`,
    );
  }
  const response = runAwsJson([
    "stepfunctions",
    "get-execution-history",
    "--execution-arn",
    executionArn,
    "--max-results",
    "1000",
  ]);
  if (!isRecord(response) || !Array.isArray(response.events)) {
    throw new Error("Step Functions returned an unexpected execution history.");
  }
  return response.events.filter(isRecord);
}

async function waitForOrderStatus(
  context: EvidenceContext,
  checkoutId: string,
  expectedStatus: string,
): Promise<void> {
  const observed = await pollUntil(20_000, () => {
    const order = dynamoItem(context.orderTableName, "checkoutId", checkoutId);
    return dynamoStringAttribute(order, "status") === expectedStatus ? true : undefined;
  });
  if (observed === undefined) {
    throw new Error(`Order ${checkoutId} did not reach ${expectedStatus}.`);
  }
}

function assertStateVisits(
  history: readonly Record<string, unknown>[],
  stateName: string,
  expected: number,
): void {
  const count = enteredStateNames(history).filter((name) => name === stateName).length;
  if (count !== expected) {
    throw new Error(`Expected ${stateName} ${expected} time(s), observed ${count}.`);
  }
}

function assertStateOrder(
  history: readonly Record<string, unknown>[],
  expectedOrder: readonly string[],
): void {
  const states = enteredStateNames(history);
  let previous = -1;
  for (const state of expectedOrder) {
    const index = states.indexOf(state);
    if (index <= previous) {
      throw new Error(`Workflow did not visit ${expectedOrder.join(" -> ")} in order.`);
    }
    previous = index;
  }
}

function assertBoundedTransitions(history: readonly Record<string, unknown>[]): void {
  const count = history.filter(
    (event) => typeof event.type === "string" && event.type.endsWith("StateEntered"),
  ).length;
  if (count > 30) throw new Error(`Failure workflow used ${count} state transitions; expected <= 30.`);
}

function enteredStateNames(history: readonly Record<string, unknown>[]): string[] {
  return history.flatMap((event) => {
    if (event.type !== "TaskStateEntered") return [];
    const details = event.stateEnteredEventDetails;
    return isRecord(details) && typeof details.name === "string" ? [details.name] : [];
  });
}

function assertOperationStatus(
  tableName: string,
  keyName: string,
  keyValue: string,
  expectedStatus: string,
): void {
  const operation = dynamoItem(tableName, keyName, keyValue);
  const result = operation?.result;
  const resultMap = isRecord(result) && isRecord(result.M) ? result.M : undefined;
  assertStringAttribute(resultMap, "status", expectedStatus);
}

function assertEvents(
  tableName: string,
  checkoutId: string,
  expectedTypes: readonly string[],
): void {
  const response = runAwsJson([
    "dynamodb",
    "scan",
    "--table-name",
    tableName,
    "--consistent-read",
    "--filter-expression",
    "correlationId = :correlationId",
    "--expression-attribute-values",
    JSON.stringify({ ":correlationId": { S: `corr-${checkoutId}` } }),
  ]);
  if (!isRecord(response) || !Array.isArray(response.Items)) {
    throw new Error(`DynamoDB returned an unexpected outbox scan for ${checkoutId}.`);
  }
  const actualTypes = response.Items.filter(isRecord)
    .map((item) => dynamoStringAttribute(item, "eventType"))
    .filter((value): value is string => value !== undefined)
    .sort();
  const expected = [...expectedTypes].sort();
  if (JSON.stringify(actualTypes) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${tableName} facts ${expected.join(", ") || "none"}; observed ${actualTypes.join(", ") || "none"}.`,
    );
  }
}

function dynamoItem(
  tableName: string,
  keyName: string,
  keyValue: string,
): Record<string, unknown> | undefined {
  const response = runAwsJson([
    "dynamodb",
    "get-item",
    "--table-name",
    tableName,
    "--consistent-read",
    "--key",
    JSON.stringify({ [keyName]: { S: keyValue } }),
  ]);
  return isRecord(response) && isRecord(response.Item) ? response.Item : undefined;
}

function assertStringAttribute(
  item: Record<string, unknown> | undefined,
  name: string,
  expected: string,
): void {
  const actual = dynamoStringAttribute(item, name);
  if (actual !== expected) {
    throw new Error(`Expected ${name}=${expected}, received ${actual ?? "missing"}.`);
  }
}

function assertNumberAttribute(
  item: Record<string, unknown> | undefined,
  name: string,
  expected: number,
): void {
  const attribute = item?.[name];
  const actual = isRecord(attribute) && typeof attribute.N === "string"
    ? Number(attribute.N)
    : undefined;
  if (actual !== expected) {
    throw new Error(`Expected ${name}=${expected}, received ${actual ?? "missing"}.`);
  }
}

function putFailurePlan(
  context: EvidenceContext,
  semanticKey: string,
  effects: readonly FailureEffect[],
): void {
  runAwsJson([
    "dynamodb",
    "put-item",
    "--table-name",
    context.failurePlanTableName,
    "--item",
    JSON.stringify({
      recordKey: { S: `FAILURE_PLAN#${semanticKey}` },
      recordType: { S: "FAILURE_PLAN" },
      effects: { L: effects.map((effect) => ({ S: effect })) },
    }),
  ], context.failureRoleEnvironment);
}

function deleteFailurePlan(context: EvidenceContext, semanticKey: string): void {
  runAwsJson([
    "dynamodb",
    "delete-item",
    "--table-name",
    context.failurePlanTableName,
    "--key",
    JSON.stringify({ recordKey: { S: `FAILURE_PLAN#${semanticKey}` } }),
  ], context.failureRoleEnvironment);
}

function assumeFailurePlanRole(roleArn: string): NodeJS.ProcessEnv {
  const response = runAwsJson([
    "sts",
    "assume-role",
    "--role-arn",
    roleArn,
    "--role-session-name",
    `failure-evidence-${Date.now()}`,
  ]);
  const credentials = isRecord(response) && isRecord(response.Credentials)
    ? response.Credentials
    : undefined;
  if (
    credentials === undefined ||
    typeof credentials.AccessKeyId !== "string" ||
    typeof credentials.SecretAccessKey !== "string" ||
    typeof credentials.SessionToken !== "string"
  ) {
    throw new Error("STS returned invalid failure-plan role credentials.");
  }
  return {
    ...process.env,
    AWS_ACCESS_KEY_ID: credentials.AccessKeyId,
    AWS_SECRET_ACCESS_KEY: credentials.SecretAccessKey,
    AWS_SESSION_TOKEN: credentials.SessionToken,
  };
}

function checkoutIdFor(context: EvidenceContext, scenario: string): string {
  return `failure-${scenario}-${context.runId}`;
}
