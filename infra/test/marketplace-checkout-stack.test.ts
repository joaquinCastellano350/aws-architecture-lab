import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";

import {
  MarketplaceCheckoutStack,
  type MarketplaceCheckoutStackProps,
} from "../lib/marketplace-checkout-stack.js";

const template = workloadTemplate();

describe("marketplace checkout Order and Inventory Saga", () => {
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
    template.resourceCountIs("AWS::DynamoDB::Table", 6);
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      KeySchema: [{ AttributeName: "checkoutId", KeyType: "HASH" }],
      SSESpecification: { SSEEnabled: true },
      BillingMode: "PAY_PER_REQUEST",
      OnDemandThroughput: { MaxReadRequestUnits: 100, MaxWriteRequestUnits: 100 },
    });
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      KeySchema: [{ AttributeName: "recordKey", KeyType: "HASH" }],
      AttributeDefinitions: Match.arrayWith([
        { AttributeName: "expiresAt", AttributeType: "S" },
      ]),
      SSESpecification: { SSEEnabled: true },
      BillingMode: "PAY_PER_REQUEST",
      OnDemandThroughput: { MaxReadRequestUnits: 100, MaxWriteRequestUnits: 100 },
    });

    const tables = Object.values(template.findResources("AWS::DynamoDB::Table"));
    expect(tables).toHaveLength(6);
    for (const table of tables) {
      expect(table.DeletionPolicy).toBe("Delete");
      expect(table.UpdateReplacePolicy).toBe("Delete");
      expect(table.Properties?.PointInTimeRecoverySpecification).toBeUndefined();
      expect(table.Properties?.SSESpecification?.KMSMasterKeyId).toBeUndefined();
    }
  });

  it("publishes the Order outbox through a retryable stream and deduplicating audit consumer", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      KeySchema: [{ AttributeName: "eventId", KeyType: "HASH" }],
      StreamSpecification: { StreamViewType: "NEW_IMAGE" },
    });
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      KeySchema: [{ AttributeName: "eventId", KeyType: "HASH" }],
      StreamSpecification: Match.absent(),
    });
    template.resourceCountIs("AWS::Events::EventBus", 1);
    template.hasResourceProperties("AWS::Events::Rule", {
      EventPattern: {
        source: ["aws-architecture-lab.order"],
        "detail-type": ["OrderPending"],
      },
      EventBusName: Match.anyValue(),
      Targets: Match.arrayWith([Match.objectLike({
        Arn: Match.anyValue(),
        RetryPolicy: {
          MaximumEventAgeInSeconds: 300,
          MaximumRetryAttempts: 2,
        },
      })]),
    });
    template.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      BatchSize: 10,
      BisectBatchOnFunctionError: true,
      FunctionResponseTypes: ["ReportBatchItemFailures"],
      MaximumRetryAttempts: 3,
      StartingPosition: "LATEST",
      DestinationConfig: {
        OnFailure: { Destination: Match.anyValue() },
      },
    });
    template.hasResourceProperties("AWS::SQS::Queue", {
      SqsManagedSseEnabled: true,
    });

    const functions = Object.values(template.findResources("AWS::Lambda::Function"));
    expect(functions.some((fn) => fn.Properties?.Environment?.Variables?.ORDER_OUTBOX_TABLE_NAME !== undefined)).toBe(true);
    expect(functions.some((fn) => fn.Properties?.Environment?.Variables?.EVENT_BUS_NAME !== undefined)).toBe(true);
    expect(functions.some((fn) => fn.Properties?.Environment?.Variables?.AUDIT_TABLE_NAME !== undefined)).toBe(true);

    const policies = JSON.stringify(template.findResources("AWS::IAM::Policy"));
    expect(policies).toContain("dynamodb:TransactWriteItems");
    expect(policies).toContain("events:PutEvents");
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
    template.resourceCountIs("AWS::Lambda::Version", 2);
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
      expect(versions).toHaveLength(resourceType === "AWS::Lambda::Version" ? 2 : 1);
      expect(versions[0]?.UpdateReplacePolicy).toBe("Retain");
      expect(versions[0]?.DeletionPolicy).toBe("Retain");
    }

    const policies = JSON.stringify(template.findResources("AWS::IAM::Policy"));
    expect(policies).toContain("states:StartExecution");
    expect(policies).toContain("states:DescribeExecution");
    expect(policies).toContain("lambda:InvokeFunction");
    expect(policies).toContain(":*");
  });

  it("coordinates Inventory only through typed commands and branches on business outcomes", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      KeySchema: [{ AttributeName: "recordKey", KeyType: "HASH" }],
      StreamSpecification: Match.absent(),
    });
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      KeySchema: [{ AttributeName: "eventId", KeyType: "HASH" }],
      StreamSpecification: { StreamViewType: "NEW_IMAGE" },
    });

    const functions = Object.values(template.findResources("AWS::Lambda::Function"));
    expect(functions.some((fn) =>
      fn.Properties?.Environment?.Variables?.INVENTORY_TABLE_NAME !== undefined &&
      fn.Properties?.Environment?.Variables?.INVENTORY_OUTBOX_TABLE_NAME !== undefined
    )).toBe(true);
    const commandFunctions = functions.filter((fn) =>
      fn.Properties?.FunctionName === "aws-architecture-lab-inventory-command" ||
      fn.Properties?.FunctionName === "aws-architecture-lab-order-command"
    );
    expect(commandFunctions).toHaveLength(2);
    expect(commandFunctions.every((fn) => fn.Properties?.Timeout === 3)).toBe(true);
    expect(functions.some((fn) =>
      fn.Properties?.Environment?.Variables?.EVENT_SOURCE === "aws-architecture-lab.inventory"
    )).toBe(true);

    const definition = JSON.stringify(
      Object.values(template.findResources("AWS::StepFunctions::StateMachine"))[0]?.Properties,
    );
    expect(definition).toContain("ReserveInventory");
    expect(definition).toContain("RESERVED");
    expect(definition).toContain("OUT_OF_STOCK");
    expect(definition).toContain("CommitInventory");
    expect(definition).toContain("InventoryCommitted");
    expect(definition).toContain("MarkOrderInventoryUnavailable");
    expect(definition).toContain("INVENTORY_UNAVAILABLE");
    expect(definition).toContain("TransactionConflictException");
    expect(definition).toContain("JitterStrategy");
    expect(definition).toContain("FULL");
    expect(definition).toContain("ReservationDeadlineReached");
    expect(definition).toContain("WaitForReservationDeadline");
    expect(definition).toContain("WaitForDeadlinePrecision");
    expect(definition).toContain("WaitUntilInventoryCommit");
    expect(definition).toContain("ReleaseExpiredInventory");
    expect(definition).toContain("CHECKOUT_EXPIRED");
    expect(definition).toContain("reservationStatus");
    expect(definition).toContain("MarkOrderExpired");
    expect(definition).toContain("EXPIRED");
    expect(definition).toContain("TimeoutSeconds");
    expect(definition).toContain("420");

    const stateMachine = Object.values(template.findResources("AWS::StepFunctions::StateMachine"))[0];
    const stateMachineRoleId = stateMachine?.Properties?.RoleArn?.["Fn::GetAtt"]?.[0];
    const coordinatorPolicies = Object.values(template.findResources("AWS::IAM::Policy"))
      .filter((policy) => JSON.stringify(policy.Properties?.Roles).includes(stateMachineRoleId));
    expect(JSON.stringify(coordinatorPolicies)).not.toContain("dynamodb:");
  });

  it("reconciles due reservations from an expiry index and uses TTL only for cleanup", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      KeySchema: [{ AttributeName: "recordKey", KeyType: "HASH" }],
      GlobalSecondaryIndexes: [Match.objectLike({
        IndexName: "ReservationExpiryIndex",
        KeySchema: [
          { AttributeName: "status", KeyType: "HASH" },
          { AttributeName: "expiresAt", KeyType: "RANGE" },
        ],
      })],
      TimeToLiveSpecification: {
        AttributeName: "cleanupAtEpochSeconds",
        Enabled: true,
      },
    });
    template.hasResourceProperties("AWS::Events::Rule", {
      ScheduleExpression: "rate(1 minute)",
      State: "ENABLED",
      Targets: Match.arrayWith([Match.objectLike({ Arn: Match.anyValue() })]),
    });

    const functions = Object.values(template.findResources("AWS::Lambda::Function"));
    const expiryWorker = functions.find((fn) =>
      fn.Properties?.Environment?.Variables?.INVENTORY_EXPIRY_INDEX_NAME !== undefined
    );
    expect(expiryWorker?.Properties?.Environment?.Variables).toEqual(expect.objectContaining({
      INVENTORY_EXPIRY_BATCH_LIMIT: "25",
      INVENTORY_EXPIRY_INDEX_NAME: "ReservationExpiryIndex",
    }));
    const policies = JSON.stringify(template.findResources("AWS::IAM::Policy"));
    expect(policies).toContain("dynamodb:Query");
    expect(policies).toContain("ReservationExpiryIndex");
  });

  it("repairs the customer-visible Order from an expired Inventory release fact", () => {
    template.hasResourceProperties("AWS::Events::Rule", {
      EventPattern: {
        source: ["aws-architecture-lab.inventory"],
        "detail-type": ["InventoryReleased"],
        detail: { payload: { releaseReason: ["CHECKOUT_EXPIRED"] } },
      },
      EventBusName: Match.anyValue(),
      Targets: Match.arrayWith([Match.objectLike({
        Arn: Match.anyValue(),
        DeadLetterConfig: { Arn: Match.anyValue() },
        RetryPolicy: { MaximumEventAgeInSeconds: 300, MaximumRetryAttempts: 2 },
      })]),
    });
  });

  it("authorizes workflow starts against the state machine and only through LIVE", () => {
    const stateMachineLogicalIds = Object.keys(
      template.findResources("AWS::StepFunctions::StateMachine"),
    );
    expect(stateMachineLogicalIds).toHaveLength(1);

    const startExecutionStatements = Object.values(template.findResources("AWS::IAM::Policy"))
      .flatMap((policy) => policy.Properties?.PolicyDocument?.Statement ?? [])
      .filter((statement) => statement.Action === "states:StartExecution");

    expect(startExecutionStatements).toEqual([
      {
        Action: "states:StartExecution",
        Effect: "Allow",
        Resource: { Ref: stateMachineLogicalIds[0] },
        Condition: {
          "ForAnyValue:StringEquals": {
            "states:StateMachineQualifier": ["LIVE"],
          },
        },
      },
    ]);
  });

  it("uses short-lived logs and bounded API capacity without reserving Lambda capacity by default", () => {
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
    expect(functions).toHaveLength(8);
    for (const fn of functions) {
      expect(fn.Properties?.ReservedConcurrentExecutions).toBeUndefined();
    }
  });

  it(
    "applies configured reserved concurrency to each Lambda",
    () => {
      const configuredTemplate = workloadTemplate({ lambdaReservedConcurrency: 3 });
      const functions = Object.values(configuredTemplate.findResources("AWS::Lambda::Function"));

      expect(functions).toHaveLength(8);
      for (const fn of functions) {
        expect(fn.Properties?.ReservedConcurrentExecutions).toBe(3);
      }
    },
    60_000,
  );

  it.each([0, -1, 1.5, 11])("rejects unsafe reserved concurrency %s", (value) => {
    expect(() => workloadTemplate({ lambdaReservedConcurrency: value })).toThrow(
      "lambdaReservedConcurrency must be an integer from 1 through 10 when set.",
    );
  });
});

function workloadTemplate(props: MarketplaceCheckoutStackProps = {}): Template {
  const app = new App();
  return Template.fromStack(new MarketplaceCheckoutStack(app, "Workload", props));
}
