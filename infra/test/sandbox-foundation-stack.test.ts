import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";

import { SandboxFoundationStack } from "../lib/sandbox-foundation-stack.js";

const template = foundationTemplate();

describe("sandbox foundation", () => {
  it(
    "notifies the owner at every agreed actual and forecast budget threshold",
    () => {
      template.hasResourceProperties("AWS::Budgets::Budget", {
        Budget: {
          BudgetLimit: { Amount: 30, Unit: "USD" },
          BudgetName: "aws-architecture-lab-monthly",
          BudgetType: "COST",
          TimeUnit: "MONTHLY",
        },
        NotificationsWithSubscribers: Match.arrayWith([
          budgetEmailNotification("ACTUAL", 10),
          budgetEmailNotification("ACTUAL", 20),
          budgetEmailNotification("ACTUAL", 25),
          budgetEmailNotification("ACTUAL", 30),
          budgetEmailNotification("FORECASTED", 25),
        ]),
      });
    },
    15_000,
  );

  it(
    "automatically blocks new deployments and scaling at USD 50 without blocking teardown",
    () => {
      template.hasResourceProperties("AWS::Budgets::BudgetsAction", {
        ActionThreshold: { Type: "ABSOLUTE_VALUE", Value: 50 },
        ActionType: "APPLY_IAM_POLICY",
        ApprovalModel: "AUTOMATIC",
        BudgetName: "aws-architecture-lab-monthly",
        Definition: {
          IamActionDefinition: {
            PolicyArn: Match.anyValue(),
            Roles: [Match.anyValue()],
          },
        },
        NotificationType: "ACTUAL",
      });

      template.hasResourceProperties("AWS::IAM::ManagedPolicy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            {
              Action: Match.arrayWith([
                "application-autoscaling:RegisterScalableTarget",
                "autoscaling:SetDesiredCapacity",
                "cloudformation:CreateStack",
                "cloudformation:UpdateStack",
                "lambda:PutFunctionConcurrency",
              ]),
              Effect: "Deny",
              Resource: "*",
            },
          ]),
        },
      });

      const policies = template.findResources("AWS::IAM::ManagedPolicy");
      const deniedActions = Object.values(policies).flatMap((resource) => {
        const statements = resource.Properties?.PolicyDocument?.Statement as
          | Array<{ Action?: string[]; Effect?: string }>
          | undefined;
        return (statements ?? [])
          .filter((statement) => statement.Effect === "Deny")
          .flatMap((statement) => statement.Action ?? []);
      });
      expect(deniedActions).not.toContain("cloudformation:DeleteStack");

      const inlinePolicies = template.findResources("AWS::IAM::Policy");
      const allowedActions = Object.values(inlinePolicies).flatMap((resource) => {
        const statements = resource.Properties?.PolicyDocument?.Statement as
          | Array<{ Action?: string | string[]; Effect?: string }>
          | undefined;
        return (statements ?? [])
          .filter((statement) => statement.Effect === "Allow")
          .flatMap((statement) =>
            typeof statement.Action === "string" ? [statement.Action] : (statement.Action ?? []),
          );
      });
      expect(allowedActions).toContain("cloudformation:DeleteStack");
      expect(JSON.stringify(template.toJSON())).toContain("ReadOnlyAccess");
      const teardownStatements = Object.values(inlinePolicies).flatMap((resource) => {
        const statements = resource.Properties?.PolicyDocument?.Statement as
          | Array<{ Action?: string | string[]; Effect?: string; Resource?: unknown }>
          | undefined;
        return (statements ?? []).filter((statement) => {
          const actions = typeof statement.Action === "string" ? [statement.Action] : statement.Action;
          return actions?.includes("cloudformation:DeleteStack") === true;
        });
      });
      expect(teardownStatements).toHaveLength(1);
      expect(teardownStatements[0]?.Resource).not.toBe("*");
      expect(JSON.stringify(teardownStatements[0]?.Resource)).toContain(
        "AwsArchitectureLab-Ephemeral-",
      );
    },
    15_000,
  );

  it(
    "alerts on a low absolute cost anomaly threshold",
    () => {
      template.hasResourceProperties("AWS::CE::AnomalyMonitor", {
        MonitorDimension: "SERVICE",
        MonitorName: "aws-architecture-lab-service-costs",
        MonitorType: "DIMENSIONAL",
      });
      template.hasResourceProperties("AWS::CE::AnomalySubscription", {
        Frequency: "DAILY",
        MonitorArnList: [Match.anyValue()],
        Subscribers: [{ Address: "owner@example.com", Type: "EMAIL" }],
        SubscriptionName: "aws-architecture-lab-daily-anomalies",
        ThresholdExpression:
          '{"Dimensions":{"Key":"ANOMALY_TOTAL_IMPACT_ABSOLUTE","MatchOptions":["GREATER_THAN_OR_EQUAL"],"Values":["1"]}}',
      });
    },
    15_000,
  );

  it(
    "creates an AWS-managed encrypted Stripe sandbox secret without plaintext material",
    () => {
      template.hasResourceProperties("AWS::SecretsManager::Secret", {
        Description: "Stripe Sandbox API key placeholder; populate it outside CloudFormation.",
        GenerateSecretString: {
          ExcludePunctuation: true,
          GenerateStringKey: "apiKey",
          PasswordLength: 32,
          SecretStringTemplate: "{}",
        },
        Name: "aws-architecture-lab/sandbox/stripe",
        Tags: Match.arrayWith([
          { Key: "environment", Value: "sandbox" },
          { Key: "project", Value: "aws-architecture-lab" },
        ]),
      });

      const secrets = Object.values(template.findResources("AWS::SecretsManager::Secret"));
      expect(secrets).toHaveLength(1);
      expect(secrets[0]?.Properties).not.toHaveProperty("KmsKeyId");
      expect(secrets[0]?.Properties).not.toHaveProperty("SecretString");
      expect(JSON.stringify(template.toJSON())).not.toMatch(/sk_(?:test|live)_/i);
    },
    15_000,
  );

  it(
    "tags cost resources and contains no workload resources",
    () => {
      const resourceTags = Match.arrayWith([
        { Key: "environment", Value: "sandbox" },
        { Key: "project", Value: "aws-architecture-lab" },
      ]);

      template.hasResourceProperties("AWS::Budgets::Budget", { ResourceTags: resourceTags });
      template.hasResourceProperties("AWS::Budgets::BudgetsAction", {
        ResourceTags: resourceTags,
      });
      template.hasResourceProperties("AWS::CE::AnomalyMonitor", { ResourceTags: resourceTags });
      template.hasResourceProperties("AWS::CE::AnomalySubscription", {
        ResourceTags: resourceTags,
      });

      const resourceTypes = Object.values(template.toJSON().Resources as Record<string, object>).map(
        (resource) => (resource as { Type: string }).Type,
      );
      const foundationResourceTypes = new Set([
        "AWS::Budgets::Budget",
        "AWS::Budgets::BudgetsAction",
        "AWS::CDK::Metadata",
        "AWS::CE::AnomalyMonitor",
        "AWS::CE::AnomalySubscription",
        "AWS::IAM::ManagedPolicy",
        "AWS::IAM::Policy",
        "AWS::IAM::Role",
        "AWS::SecretsManager::Secret",
      ]);
      expect(resourceTypes.filter((resourceType) => !foundationResourceTypes.has(resourceType))).toEqual(
        [],
      );
    },
    15_000,
  );

  it(
    "confines the budget action role trust to this account's budgets",
    () => {
      template.hasResourceProperties("AWS::IAM::Role", {
        AssumeRolePolicyDocument: {
          Statement: Match.arrayWith([
            {
              Action: "sts:AssumeRole",
              Condition: {
                ArnLike: {
                  "aws:SourceArn": Match.objectLike({ "Fn::Join": Match.anyValue() }),
                },
                StringEquals: { "aws:SourceAccount": Match.anyValue() },
              },
              Effect: "Allow",
              Principal: { Service: "budgets.amazonaws.com" },
            },
          ]),
        },
        Description: "Allows AWS Budgets to apply and remove the sandbox cost boundary.",
      });
    },
    15_000,
  );
});

function foundationTemplate(): Template {
  const app = new App();
  const stack = new SandboxFoundationStack(app, "Foundation", {
    notificationEmail: "owner@example.com",
  });
  return Template.fromStack(stack);
}

function budgetEmailNotification(notificationType: string, threshold: number): object {
  return {
    Notification: {
      ComparisonOperator: "GREATER_THAN",
      NotificationType: notificationType,
      Threshold: threshold,
      ThresholdType: "ABSOLUTE_VALUE",
    },
    Subscribers: [{ Address: "owner@example.com", SubscriptionType: "EMAIL" }],
  };
}
