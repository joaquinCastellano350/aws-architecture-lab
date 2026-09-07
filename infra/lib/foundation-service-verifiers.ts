import { isRecord } from "./aws-cli.js";
import { MONTHLY_BUDGET_NAME, STRIPE_SANDBOX_SECRET_NAME } from "./foundation-config.js";
import type {
  DeployedBoundary,
  FoundationVerificationDependencies,
} from "./foundation-verification-types.js";
import {
  firstRecord,
  physicalIdForType,
  requireRecord,
  requireRecordArray,
  requireString,
} from "./verification-response.js";

export function verifyBudget(
  account: string,
  dependencies: FoundationVerificationDependencies,
): void {
  const response = dependencies.runAwsJson([
    "budgets",
    "describe-budget",
    "--account-id",
    account,
    "--budget-name",
    MONTHLY_BUDGET_NAME,
  ]);
  const budget = requireRecord(response, "Budget");
  const limit = requireRecord(budget, "BudgetLimit");
  if (
    requireString(budget, "BudgetName") !== MONTHLY_BUDGET_NAME ||
    requireString(budget, "BudgetType") !== "COST" ||
    requireString(budget, "TimeUnit") !== "MONTHLY" ||
    Number(limit.Amount) !== 30 ||
    requireString(limit, "Unit") !== "USD"
  ) {
    throw new Error("Deployed monthly budget does not match the USD 30 sandbox guardrail.");
  }
}

export function verifyBudgetNotifications(
  account: string,
  dependencies: FoundationVerificationDependencies,
): void {
  const notifications = requireRecordArray(
    dependencies.runAwsJson([
      "budgets",
      "describe-notifications-for-budget",
      "--account-id",
      account,
      "--budget-name",
      MONTHLY_BUDGET_NAME,
    ]),
    "Notifications",
  );
  const actualThresholds = notificationThresholds(notifications, "ACTUAL");
  const forecastThresholds = notificationThresholds(notifications, "FORECASTED");
  if (
    JSON.stringify(actualThresholds) !== JSON.stringify([10, 20, 25, 30]) ||
    JSON.stringify(forecastThresholds) !== JSON.stringify([25])
  ) {
    throw new Error("Deployed budget notifications do not match the agreed thresholds.");
  }
}

export function verifyBoundaryAction(
  account: string,
  dependencies: FoundationVerificationDependencies,
): DeployedBoundary {
  const actions = requireRecordArray(
    dependencies.runAwsJson([
      "budgets",
      "describe-budget-actions-for-budget",
      "--account-id",
      account,
      "--budget-name",
      MONTHLY_BUDGET_NAME,
    ]),
    "Actions",
  );
  const boundaryAction = actions.find((action) => {
    const threshold = isRecord(action.ActionThreshold) ? action.ActionThreshold : {};
    const definition = isRecord(action.Definition) ? action.Definition : {};
    const iamDefinition = isRecord(definition.IamActionDefinition)
      ? definition.IamActionDefinition
      : {};
    return (
      action.ActionType === "APPLY_IAM_POLICY" &&
      action.ApprovalModel === "AUTOMATIC" &&
      action.NotificationType === "ACTUAL" &&
      threshold.ActionThresholdType === "ABSOLUTE_VALUE" &&
      threshold.ActionThresholdValue === 50 &&
      typeof iamDefinition.PolicyArn === "string" &&
      Array.isArray(iamDefinition.Roles) &&
      iamDefinition.Roles.some((role) => typeof role === "string" && role.length > 0)
    );
  });
  if (boundaryAction === undefined) {
    throw new Error("The automatic USD 50 IAM cost boundary is not deployed.");
  }
  const definition = requireRecord(boundaryAction, "Definition");
  const iamDefinition = requireRecord(definition, "IamActionDefinition");
  const roles = iamDefinition.Roles as unknown[];
  const roleName = roles.find((role): role is string => typeof role === "string" && role.length > 0);
  if (roleName === undefined) {
    throw new Error("The automatic USD 50 IAM cost boundary has no target role.");
  }
  return { policyArn: requireString(iamDefinition, "PolicyArn"), roleName };
}

export function verifyCostAnomalyDetection(
  stackResources: ReadonlyArray<Record<string, unknown>>,
  dependencies: FoundationVerificationDependencies,
): void {
  const monitorArn = physicalIdForType(stackResources, "AWS::CE::AnomalyMonitor");
  const monitor = firstRecord(
    dependencies.runAwsJson([
      "ce",
      "get-anomaly-monitors",
      "--monitor-arn-list",
      monitorArn,
    ]),
    "AnomalyMonitors",
  );
  if (monitor.MonitorType !== "DIMENSIONAL" || monitor.MonitorDimension !== "SERVICE") {
    throw new Error("The deployed cost anomaly monitor is not the service-level monitor.");
  }

  const subscriptionArn = physicalIdForType(stackResources, "AWS::CE::AnomalySubscription");
  const subscription = firstRecord(
    dependencies.runAwsJson([
      "ce",
      "get-anomaly-subscriptions",
      "--subscription-arn-list",
      subscriptionArn,
    ]),
    "AnomalySubscriptions",
  );
  const expression = requireRecord(subscription, "ThresholdExpression");
  const dimensions = requireRecord(expression, "Dimensions");
  if (
    subscription.Frequency !== "DAILY" ||
    dimensions.Key !== "ANOMALY_TOTAL_IMPACT_ABSOLUTE" ||
    JSON.stringify(dimensions.MatchOptions) !== JSON.stringify(["GREATER_THAN_OR_EQUAL"]) ||
    JSON.stringify(dimensions.Values) !== JSON.stringify(["1"])
  ) {
    throw new Error("The deployed cost anomaly subscription does not use the USD 1 threshold.");
  }
}

export function verifySecret(dependencies: FoundationVerificationDependencies): void {
  const secret = dependencies.runAwsJson([
    "secretsmanager",
    "describe-secret",
    "--secret-id",
    STRIPE_SANDBOX_SECRET_NAME,
  ]);
  if (!isRecord(secret) || secret.Name !== STRIPE_SANDBOX_SECRET_NAME) {
    throw new Error("The Stripe Sandbox secret placeholder is not deployed.");
  }
  if (
    typeof secret.KmsKeyId === "string" &&
    !secret.KmsKeyId.toLowerCase().includes("aws/secretsmanager")
  ) {
    throw new Error("The Stripe Sandbox secret is not using AWS-managed encryption.");
  }
  const tags = Array.isArray(secret.Tags) ? secret.Tags.filter(isRecord) : [];
  for (const [key, value] of [
    ["environment", "sandbox"],
    ["project", "aws-architecture-lab"],
  ]) {
    if (!tags.some((tag) => tag.Key === key && tag.Value === value)) {
      throw new Error(`The Stripe Sandbox secret is missing tag ${key}=${value}.`);
    }
  }
}

function notificationThresholds(
  notifications: ReadonlyArray<Record<string, unknown>>,
  notificationType: string,
): number[] {
  return notifications
    .filter(
      (notification) =>
        notification.NotificationType === notificationType &&
        notification.ComparisonOperator === "GREATER_THAN" &&
        notification.ThresholdType === "ABSOLUTE_VALUE",
    )
    .map((notification) => Number(notification.Threshold))
    .sort((left, right) => left - right);
}
