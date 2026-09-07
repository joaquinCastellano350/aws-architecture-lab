import { isRecord } from "./aws-cli.js";
import { EPHEMERAL_STACK_NAME_PREFIX, FOUNDATION_STACK_NAME } from "./foundation-config.js";
import type {
  DeployedBoundary,
  FoundationVerificationDependencies,
} from "./foundation-verification-types.js";
import {
  physicalIdForLogicalId,
  requireRecord,
} from "./verification-response.js";

const REQUIRED_BOUNDARY_DENIES = [
  "application-autoscaling:RegisterScalableTarget",
  "autoscaling:SetDesiredCapacity",
  "cloudformation:CreateChangeSet",
  "cloudformation:CreateStack",
  "cloudformation:ExecuteChangeSet",
  "cloudformation:UpdateStack",
  "lambda:PutFunctionConcurrency",
] as const;

export function verifyDeployedTemplate(
  stackResources: ReadonlyArray<Record<string, unknown>>,
  deployedBoundary: DeployedBoundary,
  dependencies: FoundationVerificationDependencies,
): void {
  const response = dependencies.runAwsJson([
    "cloudformation",
    "get-template",
    "--stack-name",
    FOUNDATION_STACK_NAME,
    "--template-stage",
    "Processed",
  ]);
  if (!isRecord(response)) {
    throw new Error("CloudFormation get-template returned an unexpected response.");
  }
  const template = parseTemplate(response.TemplateBody);
  const resources = requireRecord(template, "Resources");
  const action = firstResourceOfType(resources, "AWS::Budgets::BudgetsAction");
  const actionProperties = requireRecord(action, "Properties");
  const threshold = requireRecord(actionProperties, "ActionThreshold");
  if (threshold.Type !== "ABSOLUTE_VALUE" || threshold.Value !== 50) {
    throw new Error("The deployed template does not define the automatic USD 50 boundary.");
  }
  const definition = requireRecord(actionProperties, "Definition");
  const iamDefinition = requireRecord(definition, "IamActionDefinition");
  const boundaryPolicyId = requireRef(iamDefinition.PolicyArn);
  const roles = iamDefinition.Roles;
  if (!Array.isArray(roles) || roles.length !== 1) {
    throw new Error("The deployed cost boundary must target exactly one sandbox deployment role.");
  }
  const deploymentRoleId = requireRef(roles[0]);
  if (
    physicalIdForLogicalId(stackResources, boundaryPolicyId) !== deployedBoundary.policyArn ||
    physicalIdForLogicalId(stackResources, deploymentRoleId) !== deployedBoundary.roleName
  ) {
    throw new Error("The live budget action targets differ from the deployed template.");
  }

  const boundaryPolicy = requireResource(resources, boundaryPolicyId, "AWS::IAM::ManagedPolicy");
  const boundaryProperties = requireRecord(boundaryPolicy, "Properties");
  const boundaryDocument = requireRecord(boundaryProperties, "PolicyDocument");
  const deniedActions = policyActions(boundaryDocument, "Deny");
  for (const actionName of REQUIRED_BOUNDARY_DENIES) {
    if (!deniedActions.includes(actionName)) {
      throw new Error(`The deployed cost boundary does not deny ${actionName}.`);
    }
  }
  if (deniedActions.includes("cloudformation:DeleteStack")) {
    throw new Error("The deployed cost boundary blocks CloudFormation teardown.");
  }

  const deploymentRole = requireResource(resources, deploymentRoleId, "AWS::IAM::Role");
  const deploymentRoleProperties = requireRecord(deploymentRole, "Properties");
  if (!JSON.stringify(deploymentRoleProperties.ManagedPolicyArns).includes("ReadOnlyAccess")) {
    throw new Error("The sandbox deployment role does not preserve read access.");
  }
  const allowsTeardown = Object.values(resources)
    .filter(isRecord)
    .filter((resource) => resource.Type === "AWS::IAM::Policy")
    .some((resource) => {
      const properties = isRecord(resource.Properties) ? resource.Properties : {};
      const attachedRoles = Array.isArray(properties.Roles) ? properties.Roles : [];
      if (!attachedRoles.some((role) => optionalRef(role) === deploymentRoleId)) {
        return false;
      }
      const document = isRecord(properties.PolicyDocument) ? properties.PolicyDocument : {};
      const statements = Array.isArray(document.Statement)
        ? document.Statement.filter(isRecord)
        : [];
      return statements.some(
        (statement) =>
          statement.Effect === "Allow" &&
          actionValues(statement.Action).includes("cloudformation:DeleteStack") &&
          statement.Resource !== "*" &&
          JSON.stringify(statement.Resource).includes(EPHEMERAL_STACK_NAME_PREFIX),
      );
    });
  if (!allowsTeardown) {
    throw new Error("The sandbox deployment role does not preserve scoped CloudFormation teardown.");
  }

  const secrets = Object.values(resources)
    .filter(isRecord)
    .filter((resource) => resource.Type === "AWS::SecretsManager::Secret");
  for (const secret of secrets) {
    const secretProperties = requireRecord(secret, "Properties");
    if ("SecretString" in secretProperties || !isRecord(secretProperties.GenerateSecretString)) {
      throw new Error("The deployed template contains plaintext secret material.");
    }
  }
}

function parseTemplate(templateBody: unknown): Record<string, unknown> {
  if (isRecord(templateBody)) {
    return templateBody;
  }
  if (typeof templateBody === "string") {
    try {
      const parsed = JSON.parse(templateBody) as unknown;
      if (isRecord(parsed)) {
        return parsed;
      }
    } catch {
      // The lab synthesizes JSON; a non-JSON response is not the expected deployed template.
    }
  }
  throw new Error("CloudFormation response does not contain a JSON template body.");
}

function firstResourceOfType(
  resources: Record<string, unknown>,
  resourceType: string,
): Record<string, unknown> {
  const resource = Object.values(resources)
    .filter(isRecord)
    .find((candidate) => candidate.Type === resourceType);
  if (resource === undefined) {
    throw new Error(`Deployed template is missing resource type ${resourceType}.`);
  }
  return resource;
}

function requireResource(
  resources: Record<string, unknown>,
  logicalId: string,
  resourceType: string,
): Record<string, unknown> {
  const resource = resources[logicalId];
  if (!isRecord(resource) || resource.Type !== resourceType) {
    throw new Error(`Deployed template reference ${logicalId} is not ${resourceType}.`);
  }
  return resource;
}

function policyActions(document: Record<string, unknown>, effect: "Allow" | "Deny"): string[] {
  const statements = Array.isArray(document.Statement) ? document.Statement.filter(isRecord) : [];
  return statements
    .filter((statement) => statement.Effect === effect)
    .flatMap((statement) => actionValues(statement.Action));
}

function actionValues(actions: unknown): string[] {
  if (typeof actions === "string") {
    return [actions];
  }
  return Array.isArray(actions)
    ? actions.filter((action): action is string => typeof action === "string")
    : [];
}

function requireRef(value: unknown): string {
  const reference = optionalRef(value);
  if (reference === undefined) {
    throw new Error("Deployed template contains an unresolved foundation reference.");
  }
  return reference;
}

function optionalRef(value: unknown): string | undefined {
  return isRecord(value) && typeof value.Ref === "string" ? value.Ref : undefined;
}
