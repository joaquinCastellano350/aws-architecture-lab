import { expect, it, vi } from "vitest";

import { verifyFoundation } from "../lib/verify-foundation.js";

it("verifies the deployed foundation guardrails without reading secret values", () => {
  const calls: string[] = [];
  const write = vi.fn();

  const report = verifyFoundation("123456789012", {
    runAwsJson: (args) => {
      const command = args.join(" ");
      calls.push(command);
      if (command.startsWith("cloudformation describe-stacks")) {
        return { Stacks: [{ StackStatus: "CREATE_COMPLETE" }] };
      }
      if (command.startsWith("cloudformation list-stack-resources")) {
        return {
          StackResourceSummaries: [
            { LogicalResourceId: "Budget", ResourceType: "AWS::Budgets::Budget" },
            { LogicalResourceId: "HardBoundary", ResourceType: "AWS::Budgets::BudgetsAction" },
            {
              PhysicalResourceId: "arn:aws:ce::123456789012:anomalymonitor/monitor-id",
              ResourceType: "AWS::CE::AnomalyMonitor",
            },
            {
              PhysicalResourceId: "arn:aws:ce::123456789012:anomalysubscription/subscription-id",
              ResourceType: "AWS::CE::AnomalySubscription",
            },
            {
              LogicalResourceId: "CostBoundary",
              PhysicalResourceId: "arn:aws:iam::123456789012:policy/cost-boundary",
              ResourceType: "AWS::IAM::ManagedPolicy",
            },
            { LogicalResourceId: "DeploymentPolicy", ResourceType: "AWS::IAM::Policy" },
            {
              LogicalResourceId: "DeploymentRole",
              PhysicalResourceId: "sandbox-deployment-role",
              ResourceType: "AWS::IAM::Role",
            },
            { LogicalResourceId: "BudgetActionRole", ResourceType: "AWS::IAM::Role" },
            { LogicalResourceId: "SandboxExecutionRole", ResourceType: "AWS::IAM::Role" },
            { LogicalResourceId: "Secret", ResourceType: "AWS::SecretsManager::Secret" },
          ],
        };
      }
      if (command.startsWith("cloudformation get-template")) {
        return { TemplateBody: deployedFoundationTemplate() };
      }
      if (command.startsWith("budgets describe-budget ")) {
        return {
          Budget: {
            BudgetLimit: { Amount: "30", Unit: "USD" },
            BudgetName: "aws-architecture-lab-monthly",
            BudgetType: "COST",
            TimeUnit: "MONTHLY",
          },
        };
      }
      if (command.startsWith("budgets describe-notifications-for-budget")) {
        return {
          Notifications: [
            budgetNotification("ACTUAL", 10),
            budgetNotification("ACTUAL", 20),
            budgetNotification("ACTUAL", 25),
            budgetNotification("ACTUAL", 30),
            budgetNotification("FORECASTED", 25),
          ],
        };
      }
      if (command.startsWith("budgets describe-budget-actions-for-budget")) {
        return {
          Actions: [
            {
              ActionThreshold: {
                ActionThresholdType: "ABSOLUTE_VALUE",
                ActionThresholdValue: 50,
              },
              ActionType: "APPLY_IAM_POLICY",
              ApprovalModel: "AUTOMATIC",
              Definition: {
                IamActionDefinition: {
                  PolicyArn: "arn:aws:iam::123456789012:policy/cost-boundary",
                  Roles: ["sandbox-deployment-role"],
                },
              },
              NotificationType: "ACTUAL",
            },
          ],
        };
      }
      if (command.startsWith("secretsmanager describe-secret")) {
        return {
          Name: "aws-architecture-lab/sandbox/stripe",
          Tags: [
            { Key: "environment", Value: "sandbox" },
            { Key: "project", Value: "aws-architecture-lab" },
          ],
        };
      }
      if (command.startsWith("ce get-anomaly-monitors")) {
        return {
          AnomalyMonitors: [{ MonitorDimension: "SERVICE", MonitorType: "DIMENSIONAL" }],
        };
      }
      if (command.startsWith("ce get-anomaly-subscriptions")) {
        return {
          AnomalySubscriptions: [
            {
              Frequency: "DAILY",
              ThresholdExpression: {
                Dimensions: {
                  Key: "ANOMALY_TOTAL_IMPACT_ABSOLUTE",
                  MatchOptions: ["GREATER_THAN_OR_EQUAL"],
                  Values: ["1"],
                },
              },
            },
          ],
        };
      }
      throw new Error(`Unexpected AWS CLI call: ${command}`);
    },
    write,
  });

  expect(report).toEqual({ resourceCount: 10, stackStatus: "CREATE_COMPLETE" });
  expect(calls.some((call) => call.includes("get-secret-value"))).toBe(false);
  expect(calls.some((call) => call.startsWith("cloudformation get-template"))).toBe(true);
  expect(calls.some((call) => call.startsWith("ce get-anomaly-subscriptions"))).toBe(true);
  expect(write).toHaveBeenCalledWith(
    "Foundation verification passed: CREATE_COMPLETE, 10 resources, no workload coupling.",
  );
});

function budgetNotification(notificationType: string, threshold: number): object {
  return {
    ComparisonOperator: "GREATER_THAN",
    NotificationType: notificationType,
    Threshold: threshold,
    ThresholdType: "ABSOLUTE_VALUE",
  };
}

function deployedFoundationTemplate(): object {
  return {
    Resources: {
      Budget: { Type: "AWS::Budgets::Budget" },
      BudgetActionRole: { Type: "AWS::IAM::Role" },
      CostBoundary: {
        Properties: {
          PolicyDocument: {
            Statement: [
              {
                Action: [
                  "application-autoscaling:RegisterScalableTarget",
                  "autoscaling:SetDesiredCapacity",
                  "cloudformation:CreateChangeSet",
                  "cloudformation:CreateStack",
                  "cloudformation:ExecuteChangeSet",
                  "cloudformation:UpdateStack",
                  "lambda:PutFunctionConcurrency",
                ],
                Effect: "Deny",
                Resource: "*",
              },
            ],
          },
        },
        Type: "AWS::IAM::ManagedPolicy",
      },
      DeploymentPolicy: {
        Properties: {
          PolicyDocument: {
            Statement: [
              {
                Action: ["cloudformation:DeleteStack"],
                Effect: "Allow",
                Resource:
                  "arn:aws:cloudformation:us-east-1:123456789012:stack/AwsArchitectureLab-Ephemeral-*/*",
              },
            ],
          },
          Roles: [{ Ref: "DeploymentRole" }],
        },
        Type: "AWS::IAM::Policy",
      },
      DeploymentRole: {
        Properties: {
          ManagedPolicyArns: ["arn:aws:iam::aws:policy/ReadOnlyAccess"],
        },
        Type: "AWS::IAM::Role",
      },
      HardBoundary: {
        Properties: {
          ActionThreshold: { Type: "ABSOLUTE_VALUE", Value: 50 },
          Definition: {
            IamActionDefinition: {
              PolicyArn: { Ref: "CostBoundary" },
              Roles: [{ Ref: "DeploymentRole" }],
            },
          },
        },
        Type: "AWS::Budgets::BudgetsAction",
      },
      Monitor: { Type: "AWS::CE::AnomalyMonitor" },
      SandboxExecutionRole: { Type: "AWS::IAM::Role" },
      Secret: {
        Properties: { GenerateSecretString: { GenerateStringKey: "apiKey" } },
        Type: "AWS::SecretsManager::Secret",
      },
      Subscription: { Type: "AWS::CE::AnomalySubscription" },
    },
  };
}
