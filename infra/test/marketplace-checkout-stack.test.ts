import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";

import { MarketplaceCheckoutStack } from "../lib/marketplace-checkout-stack.js";

const template = workloadTemplate();

describe("marketplace checkout walking skeleton", () => {
  it("protects both checkout API operations with IAM authorization", () => {
    template.hasResourceProperties("AWS::ApiGateway::RestApi", {
      Body: Match.objectLike({
        openapi: "3.0.3",
        paths: Match.objectLike({
          "/checkouts": Match.objectLike({
            post: Match.objectLike({
              security: [{ sigv4: [] }],
              "x-amazon-apigateway-integration": Match.objectLike({ type: "aws_proxy" }),
            }),
          }),
          "/checkouts/{checkoutId}": Match.objectLike({
            get: Match.objectLike({
              security: [{ sigv4: [] }],
              "x-amazon-apigateway-integration": Match.objectLike({ type: "aws_proxy" }),
            }),
          }),
        }),
      }),
    });
  });

  it("gives Order and Saga Execution separately owned durable records", () => {
    template.resourceCountIs("AWS::DynamoDB::Table", 2);
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      KeySchema: [{ AttributeName: "checkoutId", KeyType: "HASH" }],
      SSESpecification: { SSEEnabled: true },
      BillingMode: "PAY_PER_REQUEST",
      OnDemandThroughput: { MaxReadRequestUnits: 100, MaxWriteRequestUnits: 100 },
    });
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      KeySchema: [{ AttributeName: "recordKey", KeyType: "HASH" }],
      SSESpecification: { SSEEnabled: true },
      BillingMode: "PAY_PER_REQUEST",
      OnDemandThroughput: { MaxReadRequestUnits: 100, MaxWriteRequestUnits: 100 },
    });

    const tables = Object.values(template.findResources("AWS::DynamoDB::Table"));
    expect(tables).toHaveLength(2);
    for (const table of tables) {
      expect(table.DeletionPolicy).toBe("Delete");
      expect(table.UpdateReplacePolicy).toBe("Delete");
      expect(table.Properties?.PointInTimeRecoverySpecification).toBeUndefined();
      expect(table.Properties?.SSESpecification?.KMSMasterKeyId).toBeUndefined();
    }
  });

  it("starts new checkouts through LIVE targeting one immutable Standard workflow version", () => {
    template.hasResourceProperties("AWS::StepFunctions::StateMachine", {
      StateMachineType: "STANDARD",
      LoggingConfiguration: {
        IncludeExecutionData: false,
        Level: "ERROR",
        Destinations: Match.anyValue(),
      },
    });
    template.resourceCountIs("AWS::StepFunctions::StateMachineVersion", 1);
    template.resourceCountIs("AWS::Lambda::Version", 1);
    template.hasResourceProperties("AWS::StepFunctions::StateMachineAlias", {
      Name: "LIVE",
      RoutingConfiguration: [
        {
          StateMachineVersionArn: Match.anyValue(),
          Weight: 100,
        },
      ],
    });

    const functions = Object.values(template.findResources("AWS::Lambda::Function"));
    const apiFunction = functions.find(
      (resource) => resource.Properties?.Environment?.Variables?.WORKFLOW_ALIAS_ARN !== undefined,
    );
    expect(apiFunction?.Properties?.Environment?.Variables?.WORKFLOW_ALIAS_ARN).toBeDefined();
    expect(apiFunction?.Properties?.Environment?.Variables?.WORKFLOW_VERSION_ARN).toBeUndefined();
    expect(JSON.stringify(apiFunction?.Properties?.Environment?.Variables)).not.toMatch(
      /task.?token|payment.?method|provider.?payload/i,
    );

    for (const resourceType of ["AWS::StepFunctions::StateMachineVersion", "AWS::Lambda::Version"]) {
      const versions = Object.values(template.findResources(resourceType));
      expect(versions).toHaveLength(1);
      expect(versions[0]?.UpdateReplacePolicy).toBe("Retain");
      expect(versions[0]?.DeletionPolicy).toBe("Retain");
    }

    const policies = JSON.stringify(template.findResources("AWS::IAM::Policy"));
    expect(policies).toContain("states:StartExecution");
    expect(policies).toContain("states:DescribeExecution");
    expect(policies).toContain("lambda:InvokeFunction");
    expect(policies).toContain(":*");
  });

  it("uses short-lived logs and bounded API and Lambda capacity", () => {
    template.hasResourceProperties("AWS::ApiGateway::Stage", {
      MethodSettings: Match.arrayWith([
        Match.objectLike({
          DataTraceEnabled: false,
          HttpMethod: "*",
          ResourcePath: "/*",
          ThrottlingBurstLimit: 20,
          ThrottlingRateLimit: 10,
        }),
      ]),
    });
    template.allResourcesProperties("AWS::Logs::LogGroup", {
      RetentionInDays: 7,
    });

    const functions = Object.values(template.findResources("AWS::Lambda::Function"));
    expect(functions).toHaveLength(2);
    for (const fn of functions) {
      expect(fn.Properties?.ReservedConcurrentExecutions).toBeLessThanOrEqual(10);
    }
  });
});

function workloadTemplate(): Template {
  const app = new App();
  return Template.fromStack(new MarketplaceCheckoutStack(app, "Workload"));
}
