import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ArnFormat,
  Aws,
  CfnDeletionPolicy,
  CfnOutput,
  Duration,
  Fn,
  RemovalPolicy,
  Stack,
  Tags,
  type StackProps,
} from "aws-cdk-lib";
import { ApiDefinition, MethodLoggingLevel, SpecRestApi } from "aws-cdk-lib/aws-apigateway";
import { Dashboard, GraphWidget } from "aws-cdk-lib/aws-cloudwatch";
import {
  AttributeType,
  BillingMode,
  ProjectionType,
  StreamViewType,
  Table,
  TableEncryption,
  type ITable,
} from "aws-cdk-lib/aws-dynamodb";
import { EventBus, Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction as EventBridgeLambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { CfnVersion, Runtime, StartingPosition, type IFunction } from "aws-cdk-lib/aws-lambda";
import { DynamoEventSource, SqsDlq } from "aws-cdk-lib/aws-lambda-event-sources";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import {
  CfnStateMachineAlias,
  CfnStateMachineVersion,
  Choice,
  Condition,
  DefinitionBody,
  Fail,
  JsonPath,
  JitterType,
  LogLevel,
  StateMachine,
  StateMachineType,
  Succeed,
  TaskInput,
  Wait,
  WaitTime,
} from "aws-cdk-lib/aws-stepfunctions";
import { LambdaInvoke } from "aws-cdk-lib/aws-stepfunctions-tasks";
import type { Construct } from "constructs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const orderEventSource = "aws-architecture-lab.order";
const orderPendingEventType = "OrderPending";
const inventoryEventSource = "aws-architecture-lab.inventory";

export interface MarketplaceCheckoutStackProps extends StackProps {
  readonly lambdaReservedConcurrency?: number;
}

export class MarketplaceCheckoutStack extends Stack {
  private readonly lambdaReservedConcurrency: number | undefined;

  public constructor(scope: Construct, id: string, props: MarketplaceCheckoutStackProps = {}) {
    const { lambdaReservedConcurrency, ...stackProps } = props;
    super(scope, id, stackProps);

    if (
      lambdaReservedConcurrency !== undefined &&
      (!Number.isInteger(lambdaReservedConcurrency) ||
        lambdaReservedConcurrency < 1 ||
        lambdaReservedConcurrency > 10)
    ) {
      throw new Error("lambdaReservedConcurrency must be an integer from 1 through 10 when set.");
    }
    this.lambdaReservedConcurrency = lambdaReservedConcurrency;

    Tags.of(this).add("project", "aws-architecture-lab");
    Tags.of(this).add("environment", "sandbox");

    const orderTable = new Table(this, "Orders", {
      partitionKey: { name: "checkoutId", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      maxReadRequestUnits: 100,
      maxWriteRequestUnits: 100,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const sagaTable = new Table(this, "SagaExecutions", {
      partitionKey: { name: "recordKey", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      maxReadRequestUnits: 100,
      maxWriteRequestUnits: 100,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const orderOutboxTable = new Table(this, "OrderOutbox", {
      partitionKey: { name: "eventId", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      maxReadRequestUnits: 100,
      maxWriteRequestUnits: 100,
      removalPolicy: RemovalPolicy.DESTROY,
      stream: StreamViewType.NEW_IMAGE,
    });
    const auditTable = new Table(this, "OrderAudit", {
      partitionKey: { name: "eventId", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      maxReadRequestUnits: 100,
      maxWriteRequestUnits: 100,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const inventoryTable = new Table(this, "Inventory", {
      partitionKey: { name: "recordKey", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      maxReadRequestUnits: 100,
      maxWriteRequestUnits: 100,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: "cleanupAtEpochSeconds",
    });
    const inventoryExpiryIndexName = "ReservationExpiryIndex";
    inventoryTable.addGlobalSecondaryIndex({
      indexName: inventoryExpiryIndexName,
      partitionKey: { name: "status", type: AttributeType.STRING },
      sortKey: { name: "expiresAt", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });
    const inventoryOutboxTable = new Table(this, "InventoryOutbox", {
      partitionKey: { name: "eventId", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      maxReadRequestUnits: 100,
      maxWriteRequestUnits: 100,
      removalPolicy: RemovalPolicy.DESTROY,
      stream: StreamViewType.NEW_IMAGE,
    });
    const eventBus = new EventBus(this, "CheckoutEvents", {
      eventBusName: "aws-architecture-lab-marketplace-checkout",
    });
    const failedOutboxRecords = new Queue(this, "OrderOutboxFailureDestination", {
      encryption: QueueEncryption.SQS_MANAGED,
      retentionPeriod: Duration.days(4),
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const outboxPublisher = this.lambdaFunction("OrderOutboxPublisher", "outbox-publisher.ts", {
      EVENT_BUS_NAME: eventBus.eventBusName,
      EVENT_SOURCE: orderEventSource,
    });
    // The stream-enabled Table satisfies ITable at runtime; TS 7 exact optional
    // properties exposes an upstream declaration mismatch on tableStreamArn.
    outboxPublisher.addEventSource(new DynamoEventSource(orderOutboxTable as ITable, {
      batchSize: 10,
      bisectBatchOnError: true,
      onFailure: new SqsDlq(failedOutboxRecords),
      reportBatchItemFailures: true,
      retryAttempts: 3,
      startingPosition: StartingPosition.LATEST,
    }));
    eventBus.grantPutEventsTo(outboxPublisher);

    const failedInventoryOutboxRecords = new Queue(this, "InventoryOutboxFailureDestination", {
      encryption: QueueEncryption.SQS_MANAGED,
      retentionPeriod: Duration.days(4),
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const inventoryOutboxPublisher = this.lambdaFunction(
      "InventoryOutboxPublisher",
      "outbox-publisher.ts",
      {
        EVENT_BUS_NAME: eventBus.eventBusName,
        EVENT_SOURCE: inventoryEventSource,
      },
    );
    inventoryOutboxPublisher.addEventSource(new DynamoEventSource(inventoryOutboxTable as ITable, {
      batchSize: 10,
      bisectBatchOnError: true,
      onFailure: new SqsDlq(failedInventoryOutboxRecords),
      reportBatchItemFailures: true,
      retryAttempts: 3,
      startingPosition: StartingPosition.LATEST,
    }));
    eventBus.grantPutEventsTo(inventoryOutboxPublisher);

    const auditConsumer = this.lambdaFunction("OrderAuditConsumer", "audit-consumer.ts", {
      AUDIT_TABLE_NAME: auditTable.tableName,
      EVENT_SOURCE: orderEventSource,
    });
    auditTable.grantWriteData(auditConsumer);
    new Rule(this, "OrderPendingAuditRule", {
      eventBus,
      eventPattern: {
        source: [orderEventSource],
        detailType: [orderPendingEventType],
      },
      targets: [new EventBridgeLambdaFunction(auditConsumer, {
        maxEventAge: Duration.minutes(5),
        retryAttempts: 2,
      })],
    });

    const orderFunction = this.lambdaFunction(
      "OrderCommand",
      "order-lambda.ts",
      {
        ORDER_TABLE_NAME: orderTable.tableName,
        ORDER_OUTBOX_TABLE_NAME: orderOutboxTable.tableName,
      },
      Duration.seconds(3),
    );
    orderTable.grantReadWriteData(orderFunction);
    orderOutboxTable.grantWriteData(orderFunction);
    orderFunction.addToRolePolicy(new PolicyStatement({
      actions: ["dynamodb:TransactWriteItems"],
      resources: [orderTable.tableArn, orderOutboxTable.tableArn],
    }));
    const orderFunctionVersion = orderFunction.currentVersion;
    const cfnOrderFunctionVersion = orderFunctionVersion.node.defaultChild as CfnVersion;
    retainAcrossDeployments(cfnOrderFunctionVersion);

    const inventoryFunction = this.lambdaFunction(
      "InventoryCommand",
      "inventory-lambda.ts",
      {
        INVENTORY_INITIAL_QUANTITY: "100",
        INVENTORY_OUTBOX_TABLE_NAME: inventoryOutboxTable.tableName,
        INVENTORY_TABLE_NAME: inventoryTable.tableName,
      },
      Duration.seconds(3),
    );
    inventoryTable.grantReadWriteData(inventoryFunction);
    inventoryOutboxTable.grantWriteData(inventoryFunction);
    inventoryFunction.addToRolePolicy(new PolicyStatement({
      actions: ["dynamodb:TransactWriteItems"],
      resources: [inventoryTable.tableArn, inventoryOutboxTable.tableArn],
    }));
    const inventoryFunctionVersion = inventoryFunction.currentVersion;
    const cfnInventoryFunctionVersion = inventoryFunctionVersion.node.defaultChild as CfnVersion;
    retainAcrossDeployments(cfnInventoryFunctionVersion);

    const inventoryExpiryWorker = this.lambdaFunction(
      "InventoryExpiryWorker",
      "inventory-expiry-lambda.ts",
      {
        INVENTORY_EXPIRY_BATCH_LIMIT: "25",
        INVENTORY_EXPIRY_INDEX_NAME: inventoryExpiryIndexName,
        INVENTORY_OUTBOX_TABLE_NAME: inventoryOutboxTable.tableName,
        INVENTORY_TABLE_NAME: inventoryTable.tableName,
      },
      Duration.seconds(10),
    );
    inventoryOutboxTable.grantWriteData(inventoryExpiryWorker);
    inventoryExpiryWorker.addToRolePolicy(new PolicyStatement({
      actions: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"],
      resources: [inventoryTable.tableArn],
    }));
    inventoryExpiryWorker.addToRolePolicy(new PolicyStatement({
      actions: ["dynamodb:Query"],
      resources: [`${inventoryTable.tableArn}/index/${inventoryExpiryIndexName}`],
    }));
    inventoryExpiryWorker.addToRolePolicy(new PolicyStatement({
      actions: ["dynamodb:TransactWriteItems"],
      resources: [inventoryTable.tableArn, inventoryOutboxTable.tableArn],
    }));
    new Rule(this, "InventoryExpirySchedule", {
      schedule: Schedule.rate(Duration.minutes(1)),
      targets: [new EventBridgeLambdaFunction(inventoryExpiryWorker, {
        maxEventAge: Duration.minutes(5),
        retryAttempts: 2,
      })],
    });

    const orderExpiryConsumer = this.lambdaFunction(
      "OrderExpiryConsumer",
      "order-expiry-consumer.ts",
      {
        EVENT_SOURCE: inventoryEventSource,
        ORDER_OUTBOX_TABLE_NAME: orderOutboxTable.tableName,
        ORDER_TABLE_NAME: orderTable.tableName,
      },
    );
    orderTable.grantReadWriteData(orderExpiryConsumer);
    orderOutboxTable.grantWriteData(orderExpiryConsumer);
    orderExpiryConsumer.addToRolePolicy(new PolicyStatement({
      actions: ["dynamodb:TransactWriteItems"],
      resources: [orderTable.tableArn, orderOutboxTable.tableArn],
    }));
    const failedOrderExpiryEvents = new Queue(this, "OrderExpiryFailureDestination", {
      encryption: QueueEncryption.SQS_MANAGED,
      retentionPeriod: Duration.days(4),
      removalPolicy: RemovalPolicy.DESTROY,
    });
    new Rule(this, "ExpiredInventoryReleaseRule", {
      eventBus,
      eventPattern: {
        source: [inventoryEventSource],
        detailType: ["InventoryReleased"],
        detail: { payload: { releaseReason: ["CHECKOUT_EXPIRED"] } },
      },
      targets: [new EventBridgeLambdaFunction(orderExpiryConsumer, {
        deadLetterQueue: failedOrderExpiryEvents,
        maxEventAge: Duration.minutes(5),
        retryAttempts: 2,
      })],
    });

    const workflowLogGroup = new LogGroup(this, "CheckoutWorkflowLogs", {
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const createPendingOrder = new LambdaInvoke(this, "CreatePendingOrder", {
      // CDK's Version implements IFunction at runtime; TS 7 exact optional properties exposes
      // an upstream declaration mismatch on the inherited role property.
      lambdaFunction: orderFunctionVersion as IFunction,
      payload: TaskInput.fromObject({
        schemaVersion: "1.0",
        checkoutId: JsonPath.stringAt("$.checkoutId"),
        cartId: JsonPath.stringAt("$.cartId"),
        correlationId: JsonPath.stringAt("$.correlationId"),
        causationId: JsonPath.stringAt("$$.Execution.Id"),
      }),
      payloadResponseOnly: true,
      resultPath: "$.order",
      retryOnServiceExceptions: false,
    });
    this.addInternalCommandRetry(createPendingOrder);
    const reserveInventory = new LambdaInvoke(this, "ReserveInventory", {
      lambdaFunction: inventoryFunctionVersion as IFunction,
      payload: TaskInput.fromObject({
        schemaVersion: "1.0",
        commandType: "ReserveInventory",
        operationId: JsonPath.format("reserve-{}", JsonPath.stringAt("$.checkoutId")),
        checkoutId: JsonPath.stringAt("$.checkoutId"),
        reservationId: JsonPath.format("reservation-{}", JsonPath.stringAt("$.checkoutId")),
        itemId: JsonPath.stringAt("$.itemId"),
        quantity: JsonPath.numberAt("$.quantity"),
        expiresAt: JsonPath.stringAt("$.reservationExpiresAt"),
        correlationId: JsonPath.stringAt("$.correlationId"),
        causationId: JsonPath.stringAt("$$.Execution.Id"),
      }),
      payloadResponseOnly: true,
      resultPath: "$.inventoryReservation",
      retryOnServiceExceptions: false,
    });
    this.addInternalCommandRetry(reserveInventory);
    const commitInventory = new LambdaInvoke(this, "CommitInventory", {
      lambdaFunction: inventoryFunctionVersion as IFunction,
      payload: TaskInput.fromObject({
        schemaVersion: "1.0",
        commandType: "CommitInventory",
        operationId: JsonPath.format("commit-{}", JsonPath.stringAt("$.checkoutId")),
        checkoutId: JsonPath.stringAt("$.checkoutId"),
        reservationId: JsonPath.stringAt("$.inventoryReservation.reservationId"),
        correlationId: JsonPath.stringAt("$.correlationId"),
        causationId: JsonPath.stringAt("$$.Execution.Id"),
      }),
      payloadResponseOnly: true,
      resultPath: "$.inventoryCommit",
      retryOnServiceExceptions: false,
    });
    this.addInternalCommandRetry(commitInventory);
    const releaseExpiredInventory = new LambdaInvoke(this, "ReleaseExpiredInventory", {
      lambdaFunction: inventoryFunctionVersion as IFunction,
      payload: TaskInput.fromObject({
        schemaVersion: "1.0",
        commandType: "ReleaseInventory",
        operationId: JsonPath.format("expire-workflow-{}", JsonPath.stringAt("$.inventoryReservation.reservationId")),
        checkoutId: JsonPath.stringAt("$.checkoutId"),
        reservationId: JsonPath.stringAt("$.inventoryReservation.reservationId"),
        releaseReason: "CHECKOUT_EXPIRED",
        correlationId: JsonPath.stringAt("$.correlationId"),
        causationId: JsonPath.stringAt("$$.Execution.Id"),
      }),
      payloadResponseOnly: true,
      resultPath: "$.inventoryRelease",
      retryOnServiceExceptions: false,
    });
    this.addInternalCommandRetry(releaseExpiredInventory);
    const inventoryCommitted = new Succeed(this, "InventoryCommitted");
    const inventoryUnavailable = new Succeed(this, "InventoryUnavailable");
    const markOrderInventoryUnavailable = new LambdaInvoke(this, "MarkOrderInventoryUnavailable", {
      lambdaFunction: orderFunctionVersion as IFunction,
      payload: TaskInput.fromObject({
        schemaVersion: "1.0",
        commandType: "MarkOrderInventoryUnavailable",
        operationId: JsonPath.format(
          "mark-inventory-unavailable-{}",
          JsonPath.stringAt("$.checkoutId"),
        ),
        checkoutId: JsonPath.stringAt("$.checkoutId"),
        correlationId: JsonPath.stringAt("$.correlationId"),
        causationId: JsonPath.stringAt("$$.Execution.Id"),
      }),
      payloadResponseOnly: true,
      resultPath: "$.order",
      retryOnServiceExceptions: false,
    });
    this.addInternalCommandRetry(markOrderInventoryUnavailable);
    const markOrderExpired = new LambdaInvoke(this, "MarkOrderExpired", {
      lambdaFunction: orderFunctionVersion as IFunction,
      payload: TaskInput.fromObject({
        schemaVersion: "1.0",
        commandType: "MarkOrderExpired",
        operationId: JsonPath.format("expire-order-workflow-{}", JsonPath.stringAt("$.inventoryReservation.reservationId")),
        checkoutId: JsonPath.stringAt("$.checkoutId"),
        correlationId: JsonPath.stringAt("$.correlationId"),
        causationId: JsonPath.stringAt("$$.Execution.Id"),
      }),
      payloadResponseOnly: true,
      resultPath: "$.order",
      retryOnServiceExceptions: false,
    });
    this.addInternalCommandRetry(markOrderExpired);
    const orderExpired = new Succeed(this, "OrderExpired");
    markOrderExpired.next(new Choice(this, "OrderExpiryOutcome")
      .when(Condition.stringEquals("$.order.status", "EXPIRED"), orderExpired)
      .otherwise(new Fail(this, "OrderExpiryOutcomeRejected", {
        cause: "Order returned an unsupported expiry outcome.",
        error: "OrderInvariantViolation",
      })));
    releaseExpiredInventory.next(new Choice(this, "ExpiredInventoryReleaseOutcome")
      .when(Condition.stringEquals("$.inventoryRelease.status", "RELEASED"), markOrderExpired)
      .when(Condition.and(
        Condition.stringEquals("$.inventoryRelease.status", "RESERVATION_NOT_ACTIVE"),
        Condition.stringEquals("$.inventoryRelease.reservationStatus", "RELEASED"),
      ), markOrderExpired)
      .when(Condition.and(
        Condition.stringEquals("$.inventoryRelease.status", "RESERVATION_NOT_ACTIVE"),
        Condition.stringEquals("$.inventoryRelease.reservationStatus", "COMMITTED"),
      ), inventoryCommitted)
      .otherwise(new Fail(this, "ExpiredInventoryReleaseRejected", {
        cause: "Inventory returned an unsupported expiry release outcome.",
        error: "InventoryInvariantViolation",
      })));
    markOrderInventoryUnavailable.next(new Choice(this, "OrderInventoryOutcome")
      .when(
        Condition.stringEquals("$.order.status", "INVENTORY_UNAVAILABLE"),
        inventoryUnavailable,
      )
      .otherwise(new Fail(this, "OrderInventoryOutcomeRejected", {
        cause: "Order returned an unsupported Inventory-unavailable outcome.",
        error: "OrderInvariantViolation",
      })));
    const invalidInventoryCommit = new Fail(this, "InventoryCommitRejected", {
      cause: "A reserved Inventory record could not be committed.",
      error: "InventoryInvariantViolation",
    });
    commitInventory.next(new Choice(this, "InventoryCommitOutcome")
      .when(Condition.stringEquals("$.inventoryCommit.status", "COMMITTED"), inventoryCommitted)
      .when(Condition.and(
        Condition.stringEquals("$.inventoryCommit.status", "RESERVATION_NOT_ACTIVE"),
        Condition.stringEquals("$.inventoryCommit.reservationStatus", "COMMITTED"),
      ), inventoryCommitted)
      .when(
        Condition.stringEquals("$.inventoryCommit.status", "RESERVATION_NOT_ACTIVE"),
        releaseExpiredInventory,
      )
      .otherwise(invalidInventoryCommit));
    const reservationDeadlineReached = new Choice(this, "ReservationDeadlineReached")
      .when(
        Condition.timestampLessThanEqualsJsonPath(
          "$.reservationExpiresAt",
          "$$.State.EnteredTime",
        ),
        releaseExpiredInventory,
      )
      .otherwise(commitInventory);
    const waitForReservationDeadline = new Wait(this, "WaitForReservationDeadline", {
      time: WaitTime.timestampPath("$.reservationExpiresAt"),
    });
    const waitForDeadlinePrecision = new Wait(this, "WaitForDeadlinePrecision", {
      time: WaitTime.duration(Duration.seconds(1)),
    });
    waitForReservationDeadline.next(waitForDeadlinePrecision);
    waitForDeadlinePrecision.next(releaseExpiredInventory);
    commitInventory.addCatch(waitForReservationDeadline, {
      resultPath: "$.inventoryCommitError",
    });
    const waitUntilInventoryCommit = new Wait(this, "WaitUntilInventoryCommit", {
      time: WaitTime.timestampPath("$.inventoryCommitAt"),
    });
    waitUntilInventoryCommit.next(reservationDeadlineReached);
    const inventoryCommitTiming = new Choice(this, "InventoryCommitTiming")
      .when(Condition.isPresent("$.inventoryCommitAt"), waitUntilInventoryCommit)
      .otherwise(reservationDeadlineReached);
    reserveInventory.next(new Choice(this, "InventoryReservationOutcome")
      .when(
        Condition.stringEquals("$.inventoryReservation.status", "RESERVED"),
        inventoryCommitTiming,
      )
      .when(
        Condition.stringEquals("$.inventoryReservation.status", "OUT_OF_STOCK"),
        markOrderInventoryUnavailable,
      )
      .otherwise(new Fail(this, "InventoryReservationRejected", {
        cause: "Inventory returned an unsupported reservation outcome.",
        error: "InventoryInvariantViolation",
      })));
    const workflowDefinition = createPendingOrder.next(reserveInventory);
    const stateMachine = new StateMachine(this, "CheckoutWorkflow", {
      definitionBody: DefinitionBody.fromChainable(workflowDefinition),
      logs: {
        destination: workflowLogGroup,
        includeExecutionData: false,
        level: LogLevel.ERROR,
      },
      stateMachineType: StateMachineType.STANDARD,
      stateMachineName: "aws-architecture-lab-marketplace-checkout",
      timeout: Duration.minutes(7),
    });
    stateMachine.addToRolePolicy(
      new PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: [`${orderFunction.functionArn}:*`],
      }),
    );
    stateMachine.addToRolePolicy(
      new PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: [`${inventoryFunction.functionArn}:*`],
      }),
    );

    const workflowVersion = new CfnStateMachineVersion(this, "CheckoutWorkflowVersion", {
      description: "Immutable marketplace checkout Order and Inventory workflow.",
      stateMachineArn: stateMachine.stateMachineArn,
      stateMachineRevisionId: stateMachine.stateMachineRevisionId,
    });
    retainAcrossDeployments(workflowVersion);
    const workflowAlias = new CfnStateMachineAlias(this, "CheckoutWorkflowLiveAlias", {
      name: "LIVE",
      description: "Stable admission point for new marketplace checkouts.",
      stateMachineArn: stateMachine.stateMachineArn,
      routingConfiguration: [{ stateMachineVersionArn: workflowVersion.attrArn, weight: 100 }],
    });

    const apiFunction = this.lambdaFunction("CheckoutApi", "api-lambda.ts", {
      ORDER_TABLE_NAME: orderTable.tableName,
      SAGA_TABLE_NAME: sagaTable.tableName,
      WORKFLOW_ALIAS_ARN: workflowAlias.attrArn,
    });
    orderTable.grantReadData(apiFunction);
    sagaTable.grantReadWriteData(apiFunction);
    apiFunction.addToRolePolicy(
      new PolicyStatement({
        actions: ["states:StartExecution"],
        resources: [stateMachine.stateMachineArn],
        conditions: {
          "ForAnyValue:StringEquals": {
            "states:StateMachineQualifier": ["LIVE"],
          },
        },
      }),
    );
    apiFunction.addToRolePolicy(
      new PolicyStatement({
        actions: ["states:DescribeExecution"],
        resources: [
          this.formatArn({
            arnFormat: ArnFormat.COLON_RESOURCE_NAME,
            resource: "execution",
            resourceName: `${stateMachine.stateMachineName}:*`,
            service: "states",
          }),
        ],
      }),
    );

    const api = new SpecRestApi(this, "CheckoutApiGateway", {
      apiDefinition: ApiDefinition.fromInline(
        checkoutOpenApi(lambdaIntegrationUri(apiFunction.functionArn)),
      ),
      cloudWatchRole: false,
      deployOptions: {
        dataTraceEnabled: false,
        loggingLevel: MethodLoggingLevel.OFF,
        metricsEnabled: true,
        throttlingBurstLimit: 20,
        throttlingRateLimit: 10,
      },
    });
    apiFunction.addPermission("AllowApiGatewayInvoke", {
      principal: new ServicePrincipal("apigateway.amazonaws.com"),
      sourceArn: api.arnForExecuteApi(),
    });

    const dashboard = new Dashboard(this, "CheckoutOutcomeDashboard", {
      dashboardName: "aws-architecture-lab-marketplace-checkout",
    });
    dashboard.addWidgets(
      new GraphWidget({
        title: "Checkout API outcomes",
        left: [api.metricCount(), api.metricClientError(), api.metricServerError()],
      }),
      new GraphWidget({
        title: "Checkout workflow outcomes",
        left: [stateMachine.metricStarted(), stateMachine.metricSucceeded(), stateMachine.metricFailed()],
      }),
    );

    new CfnOutput(this, "CheckoutApiUrl", { value: api.url });
    new CfnOutput(this, "CheckoutWorkflowAliasArn", { value: workflowAlias.attrArn });
    new CfnOutput(this, "CheckoutWorkflowVersionArn", { value: workflowVersion.attrArn });
    new CfnOutput(this, "CheckoutEventBusName", { value: eventBus.eventBusName });
    new CfnOutput(this, "OrderAuditTableName", { value: auditTable.tableName });
    new CfnOutput(this, "OrderAuditConsumerLogGroupName", {
      value: auditConsumer.logGroup.logGroupName,
    });
    new CfnOutput(this, "OrderEventSource", { value: orderEventSource });
    new CfnOutput(this, "OrderPendingEventType", { value: orderPendingEventType });
    new CfnOutput(this, "OrderTableName", { value: orderTable.tableName });
    new CfnOutput(this, "InventoryTableName", { value: inventoryTable.tableName });
    new CfnOutput(this, "InventoryEventSource", { value: inventoryEventSource });
    new CfnOutput(this, "InventoryCommandFunctionName", { value: inventoryFunction.functionName });
    new CfnOutput(this, "InventoryExpiryWorkerFunctionName", {
      value: inventoryExpiryWorker.functionName,
    });
  }

  private lambdaFunction(
    id: string,
    entryFile: string,
    environment: Record<string, string>,
    timeout: Duration = Duration.seconds(10),
  ): NodejsFunction {
    const functionName = `aws-architecture-lab-${id.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()}`;
    const logGroup = new LogGroup(this, `${id}Logs`, {
      logGroupName: `/aws/lambda/${functionName}`,
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    return new NodejsFunction(this, id, {
      entry: repositoryPath("apps", "marketplace-checkout", "src", entryFile),
      runtime: Runtime.NODEJS_24_X,
      bundling: {
        bundleAwsSDK: true,
        format: OutputFormat.ESM,
        mainFields: ["module", "main"],
        sourceMap: true,
      },
      environment,
      functionName,
      handler: "handler",
      logGroup,
      memorySize: 256,
      ...(this.lambdaReservedConcurrency === undefined
        ? {}
        : { reservedConcurrentExecutions: this.lambdaReservedConcurrency }),
      timeout,
    });
  }

  private addInternalCommandRetry(task: LambdaInvoke): void {
    task.addRetry({
      errors: [
        "Lambda.ServiceException",
        "Lambda.AWSLambdaException",
        "Lambda.SdkClientException",
        "TransactionCanceledException",
        "TransactionConflictException",
        "ProvisionedThroughputExceededException",
        "ThrottlingException",
        "InternalServerError",
      ],
      interval: Duration.seconds(1),
      maxAttempts: 2,
      backoffRate: 2,
      jitterStrategy: JitterType.FULL,
    });
  }
}

function retainAcrossDeployments(resource: CfnVersion | CfnStateMachineVersion): void {
  resource.cfnOptions.updateReplacePolicy = CfnDeletionPolicy.RETAIN;
  resource.cfnOptions.deletionPolicy = CfnDeletionPolicy.RETAIN;
}

type OpenApiOperation = Record<string, unknown> & {
  "x-amazon-apigateway-integration"?: Record<string, unknown>;
};

interface CheckoutOpenApi {
  readonly openapi: string;
  readonly paths: Record<string, Record<string, OpenApiOperation>>;
  readonly [key: string]: unknown;
}

function checkoutOpenApi(integrationUri: string): CheckoutOpenApi {
  const source = readFileSync(
    repositoryPath("packages", "contracts", "openapi", "checkout-api.json"),
    "utf8",
  );
  const document = JSON.parse(source) as CheckoutOpenApi;
  for (const [pathName, methodName] of [
    ["/checkouts", "post"],
    ["/checkouts/{checkoutId}", "get"],
  ] as const) {
    const operation = document.paths[pathName]?.[methodName];
    if (operation === undefined) throw new Error(`OpenAPI operation ${methodName} ${pathName} is missing`);
    operation["x-amazon-apigateway-integration"] = {
      type: "aws_proxy",
      httpMethod: "POST",
      uri: integrationUri,
    };
  }
  return document;
}

function lambdaIntegrationUri(functionArn: string): string {
  return Fn.join("", [
    "arn:",
    Aws.PARTITION,
    ":apigateway:",
    Aws.REGION,
    ":lambda:path/2015-03-31/functions/",
    functionArn,
    "/invocations",
  ]);
}

function repositoryPath(...segments: string[]): string {
  const roots = [
    process.cwd(),
    path.resolve(process.cwd(), ".."),
    path.resolve(currentDirectory, "..", ".."),
    path.resolve(currentDirectory, "..", "..", ".."),
  ];
  for (const root of roots) {
    const candidate = path.join(root, ...segments);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Could not locate repository path: ${segments.join("/")}`);
}
