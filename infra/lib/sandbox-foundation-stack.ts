import {
  ArnFormat,
  CfnOutput,
  CfnParameter,
  RemovalPolicy,
  Stack,
  Tags,
  type StackProps,
} from "aws-cdk-lib";
import { CfnBudget, CfnBudgetsAction } from "aws-cdk-lib/aws-budgets";
import { CfnAnomalyMonitor, CfnAnomalySubscription } from "aws-cdk-lib/aws-ce";
import {
  AccountPrincipal,
  Effect,
  ManagedPolicy,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";

import {
  EPHEMERAL_STACK_NAME_PREFIX,
  MONTHLY_BUDGET_NAME,
  STRIPE_SANDBOX_SECRET_NAME,
} from "./foundation-config.js";

export interface SandboxFoundationStackProps extends StackProps {
  readonly notificationEmail?: string;
}

export class SandboxFoundationStack extends Stack {
  public constructor(scope: Construct, id: string, props: SandboxFoundationStackProps = {}) {
    super(scope, id, props);

    Tags.of(this).add("project", "aws-architecture-lab");
    Tags.of(this).add("environment", "sandbox");

    const notificationEmail =
      props.notificationEmail ??
      new CfnParameter(this, "BudgetNotificationEmail", {
        allowedPattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
        constraintDescription: "must be a valid email address",
        description: "Email address that receives sandbox budget and anomaly alerts.",
        type: "String",
      }).valueAsString;

    const monthlyBudget = new CfnBudget(this, "MonthlyOperatingBudget", {
      budget: {
        budgetLimit: { amount: 30, unit: "USD" },
        budgetName: MONTHLY_BUDGET_NAME,
        budgetType: "COST",
        timeUnit: "MONTHLY",
      },
      notificationsWithSubscribers: [
        budgetEmailNotification(notificationEmail, "ACTUAL", 10),
        budgetEmailNotification(notificationEmail, "ACTUAL", 20),
        budgetEmailNotification(notificationEmail, "ACTUAL", 25),
        budgetEmailNotification(notificationEmail, "ACTUAL", 30),
        budgetEmailNotification(notificationEmail, "FORECASTED", 25),
      ],
      resourceTags: [
        { key: "environment", value: "sandbox" },
        { key: "project", value: "aws-architecture-lab" },
      ],
    });

    const cloudFormationExecutionRole = new Role(this, "SandboxCloudFormationExecutionRole", {
      assumedBy: new ServicePrincipal("cloudformation.amazonaws.com"),
      description: "CloudFormation execution role for resources admitted to the sandbox.",
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName("AdministratorAccess")],
    });

    const deploymentRole = new Role(this, "SandboxDeploymentRole", {
      assumedBy: new AccountPrincipal(this.account),
      description: "Human entry point for admitting, reading, and tearing down sandbox resources.",
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName("ReadOnlyAccess")],
    });
    const ephemeralStackArn = this.formatArn({
      arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
      resource: "stack",
      resourceName: `${EPHEMERAL_STACK_NAME_PREFIX}*/*`,
      service: "cloudformation",
    });
    deploymentRole.addToPolicy(
      new PolicyStatement({
        actions: [
          "cloudformation:CreateChangeSet",
          "cloudformation:CreateStack",
          "cloudformation:DeleteStack",
          "cloudformation:ExecuteChangeSet",
          "cloudformation:UpdateStack",
        ],
        resources: [ephemeralStackArn],
      }),
    );
    deploymentRole.addToPolicy(
      new PolicyStatement({
        actions: ["cloudformation:Describe*", "cloudformation:Get*", "cloudformation:List*"],
        resources: ["*"],
      }),
    );
    deploymentRole.addToPolicy(
      new PolicyStatement({
        actions: ["iam:PassRole"],
        conditions: { StringEquals: { "iam:PassedToService": "cloudformation.amazonaws.com" } },
        resources: [cloudFormationExecutionRole.roleArn],
      }),
    );

    const costBoundaryPolicy = new ManagedPolicy(this, "CostBoundaryPolicy", {
      description: "Stops new deployments and scale increases after the sandbox reaches USD 50.",
      statements: [
        new PolicyStatement({
          actions: [
            "apigateway:PATCH",
            "apigateway:POST",
            "apigateway:PUT",
            "application-autoscaling:PutScalingPolicy",
            "application-autoscaling:RegisterScalableTarget",
            "autoscaling:SetDesiredCapacity",
            "autoscaling:UpdateAutoScalingGroup",
            "cloudformation:CreateChangeSet",
            "cloudformation:CreateStack",
            "cloudformation:ExecuteChangeSet",
            "cloudformation:UpdateStack",
            "dynamodb:UpdateTable",
            "dynamodb:UpdateTableReplicaAutoScaling",
            "ecs:UpdateService",
            "lambda:PutFunctionConcurrency",
            "lambda:PutProvisionedConcurrencyConfig",
            "states:UpdateStateMachine",
          ],
          effect: Effect.DENY,
          resources: ["*"],
        }),
      ],
    });

    const budgetActionRole = new Role(this, "BudgetActionRole", {
      assumedBy: new ServicePrincipal("budgets.amazonaws.com").withConditions({
        ArnLike: {
          "aws:SourceArn": this.formatArn({
            region: "",
            resource: "budget",
            resourceName: "*",
            service: "budgets",
          }),
        },
        StringEquals: { "aws:SourceAccount": this.account },
      }),
      description: "Allows AWS Budgets to apply and remove the sandbox cost boundary.",
    });
    budgetActionRole.addToPolicy(
      new PolicyStatement({
        actions: ["iam:AttachRolePolicy", "iam:DetachRolePolicy"],
        resources: [deploymentRole.roleArn],
      }),
    );

    const boundaryAction = new CfnBudgetsAction(this, "ApplyCostBoundary", {
      actionThreshold: { type: "ABSOLUTE_VALUE", value: 50 },
      actionType: "APPLY_IAM_POLICY",
      approvalModel: "AUTOMATIC",
      budgetName: MONTHLY_BUDGET_NAME,
      definition: {
        iamActionDefinition: {
          policyArn: costBoundaryPolicy.managedPolicyArn,
          roles: [deploymentRole.roleName],
        },
      },
      executionRoleArn: budgetActionRole.roleArn,
      notificationType: "ACTUAL",
      subscribers: [{ address: notificationEmail, type: "EMAIL" }],
    });
    boundaryAction.node.addDependency(monthlyBudget);

    const anomalyMonitor = new CfnAnomalyMonitor(this, "ServiceCostAnomalyMonitor", {
      monitorDimension: "SERVICE",
      monitorName: "aws-architecture-lab-service-costs",
      monitorType: "DIMENSIONAL",
    });
    new CfnAnomalySubscription(this, "DailyCostAnomalySubscription", {
      frequency: "DAILY",
      monitorArnList: [anomalyMonitor.attrMonitorArn],
      subscribers: [{ address: notificationEmail, type: "EMAIL" }],
      subscriptionName: "aws-architecture-lab-daily-anomalies",
      thresholdExpression: JSON.stringify({
        Dimensions: {
          Key: "ANOMALY_TOTAL_IMPACT_ABSOLUTE",
          MatchOptions: ["GREATER_THAN_OR_EQUAL"],
          Values: ["1"],
        },
      }),
    });

    const stripeSandboxSecret = new Secret(this, "StripeSandboxSecret", {
      description: "Stripe Sandbox API key placeholder; populate it outside CloudFormation.",
      generateSecretString: {
        excludePunctuation: true,
        generateStringKey: "apiKey",
        passwordLength: 32,
        secretStringTemplate: "{}",
      },
      removalPolicy: RemovalPolicy.RETAIN,
      secretName: STRIPE_SANDBOX_SECRET_NAME,
    });

    new CfnOutput(this, "SandboxDeploymentRoleArn", { value: deploymentRole.roleArn });
    new CfnOutput(this, "StripeSandboxSecretArn", { value: stripeSandboxSecret.secretArn });
    new CfnOutput(this, "SandboxCloudFormationExecutionRoleArn", {
      value: cloudFormationExecutionRole.roleArn,
    });
  }
}

function budgetEmailNotification(
  address: string,
  notificationType: "ACTUAL" | "FORECASTED",
  threshold: number,
): CfnBudget.NotificationWithSubscribersProperty {
  return {
    notification: {
      comparisonOperator: "GREATER_THAN",
      notificationType,
      threshold,
      thresholdType: "ABSOLUTE_VALUE",
    },
    subscribers: [{ address, subscriptionType: "EMAIL" }],
  };
}
