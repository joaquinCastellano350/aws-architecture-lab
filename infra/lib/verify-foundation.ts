import { runAwsJson } from "./aws-cli.js";
import { FOUNDATION_STACK_NAME } from "./foundation-config.js";
import {
  verifyBoundaryAction,
  verifyBudget,
  verifyBudgetNotifications,
  verifyCostAnomalyDetection,
  verifySecret,
} from "./foundation-service-verifiers.js";
import { verifyDeployedTemplate } from "./foundation-template-verifier.js";
import type {
  FoundationVerificationDependencies,
  FoundationVerificationReport,
} from "./foundation-verification-types.js";
import {
  firstRecord,
  requireRecordArray,
  requireString,
} from "./verification-response.js";

const REQUIRED_FOUNDATION_TYPES = [
  "AWS::Budgets::Budget",
  "AWS::Budgets::BudgetsAction",
  "AWS::CE::AnomalyMonitor",
  "AWS::CE::AnomalySubscription",
  "AWS::SecretsManager::Secret",
] as const;

const FOUNDATION_RESOURCE_TYPES = new Set([
  ...REQUIRED_FOUNDATION_TYPES,
  "AWS::CDK::Metadata",
  "AWS::IAM::ManagedPolicy",
  "AWS::IAM::Policy",
  "AWS::IAM::Role",
]);

export type {
  FoundationVerificationDependencies,
  FoundationVerificationReport,
} from "./foundation-verification-types.js";

export function verifyFoundation(
  account: string,
  dependencies: FoundationVerificationDependencies,
): FoundationVerificationReport {
  const stack = firstRecord(
    dependencies.runAwsJson([
      "cloudformation",
      "describe-stacks",
      "--stack-name",
      FOUNDATION_STACK_NAME,
    ]),
    "Stacks",
  );
  const stackStatus = requireString(stack, "StackStatus");
  if (stackStatus !== "CREATE_COMPLETE" && stackStatus !== "UPDATE_COMPLETE") {
    throw new Error(`Foundation stack is not healthy; current status is ${stackStatus}.`);
  }

  const stackResources = requireRecordArray(
    dependencies.runAwsJson([
      "cloudformation",
      "list-stack-resources",
      "--stack-name",
      FOUNDATION_STACK_NAME,
    ]),
    "StackResourceSummaries",
  );
  const resourceTypes = stackResources.map((resource) => requireString(resource, "ResourceType"));
  for (const requiredType of REQUIRED_FOUNDATION_TYPES) {
    if (!resourceTypes.includes(requiredType)) {
      throw new Error(`Foundation is missing deployed resource type ${requiredType}.`);
    }
  }
  const unexpectedType = resourceTypes.find(
    (resourceType) => !FOUNDATION_RESOURCE_TYPES.has(resourceType),
  );
  if (unexpectedType !== undefined) {
    throw new Error(`Foundation contains non-foundation resource type ${unexpectedType}.`);
  }

  verifyBudget(account, dependencies);
  verifyBudgetNotifications(account, dependencies);
  const boundary = verifyBoundaryAction(account, dependencies);
  verifyDeployedTemplate(stackResources, boundary, dependencies);
  verifyCostAnomalyDetection(stackResources, dependencies);
  verifySecret(dependencies);

  dependencies.write(
    `Foundation verification passed: ${stackStatus}, ${resourceTypes.length} resources, no workload coupling.`,
  );
  return { resourceCount: resourceTypes.length, stackStatus };
}

export function verifyDeployedFoundation(
  account: string,
  environment: NodeJS.ProcessEnv = process.env,
): FoundationVerificationReport {
  return verifyFoundation(account, {
    runAwsJson: (args) => runAwsJson(args, environment),
    write: (message) => console.log(message),
  });
}
