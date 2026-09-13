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
import {
  AccountPrincipal,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { CfnVersion, Runtime, StartingPosition, type IFunction } from "aws-cdk-lib/aws-lambda";
import { DynamoEventSource, SqsDlq, SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
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
  IntegrationPattern,
  JsonPath,
  JitterType,
  LogLevel,
  StateMachine,
  StateMachineType,
  Succeed,
  TaskInput,
  Timeout,
  Wait,
  WaitTime,
} from "aws-cdk-lib/aws-stepfunctions";
import { LambdaInvoke, SqsSendMessage } from "aws-cdk-lib/aws-stepfunctions-tasks";
import type { Construct } from "constructs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const orderEventSource = "aws-architecture-lab.order";
const orderPendingEventType = "OrderPending";
const inventoryEventSource = "aws-architecture-lab.inventory";
const paymentEventSource = "aws-architecture-lab.payment";
const fulfillmentEventSource = "aws-architecture-lab.fulfillment";

export interface MarketplaceCheckoutStackProps extends StackProps {
  readonly enableFakePaymentFailurePlans?: boolean;
  readonly lambdaReservedConcurrency?: number;
}

export class MarketplaceCheckoutStack extends Stack {
  private readonly lambdaReservedConcurrency: number | undefined;

  public constructor(scope: Construct, id: string, props: MarketplaceCheckoutStackProps = {}) {
    const {
      enableFakePaymentFailurePlans = true,
      lambdaReservedConcurrency,
      ...stackProps
    } = props;
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
    const paymentTable = new Table(this, "Payments", {
      partitionKey: { name: "recordKey", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      maxReadRequestUnits: 100,
      maxWriteRequestUnits: 100,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const paymentOutboxTable = new Table(this, "PaymentOutbox", {
      partitionKey: { name: "eventId", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      maxReadRequestUnits: 100,
      maxWriteRequestUnits: 100,
      removalPolicy: RemovalPolicy.DESTROY,
      stream: StreamViewType.NEW_IMAGE,
    });
    const fulfillmentTable = new Table(this, "Fulfillment", {
      partitionKey: { name: "recordKey", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      maxReadRequestUnits: 100,
      maxWriteRequestUnits: 100,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const fulfillmentOutboxTable = new Table(this, "FulfillmentOutbox", {
      partitionKey: { name: "eventId", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      maxReadRequestUnits: 100,
      maxWriteRequestUnits: 100,
      removalPolicy: RemovalPolicy.DESTROY,
      stream: StreamViewType.NEW_IMAGE,
    });
    const fakePaymentProviderTable = new Table(this, "FakePaymentProvider", {
      partitionKey: { name: "recordKey", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      maxReadRequestUnits: 100,
      maxWriteRequestUnits: 100,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const fakePaymentFailurePlanTable = enableFakePaymentFailurePlans
      ? new Table(this, "FakePaymentFailurePlans", {
          partitionKey: { name: "recordKey", type: AttributeType.STRING },
          billingMode: BillingMode.PAY_PER_REQUEST,
          encryption: TableEncryption.AWS_MANAGED,
          maxReadRequestUnits: 100,
          maxWriteRequestUnits: 100,
          removalPolicy: RemovalPolicy.DESTROY,
        })
      : undefined;
    let fakePaymentFailurePlanRole: Role | undefined;
    if (fakePaymentFailurePlanTable !== undefined) {
      fakePaymentFailurePlanRole = new Role(this, "FakePaymentFailurePlanRole", {
        assumedBy: new AccountPrincipal(Aws.ACCOUNT_ID),
        description: "Narrow sandbox role for deterministic Payment provider failure plans.",
      });
      fakePaymentFailurePlanRole.addToPolicy(new PolicyStatement({
        actions: [
          "dynamodb:DeleteItem",
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
        ],
        resources: [fakePaymentFailurePlanTable.tableArn],
        conditions: {
          "ForAllValues:StringLike": {
            "dynamodb:LeadingKeys": ["FAILURE_PLAN#*"],
          },
        },
      }));
    }
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

    const failedPaymentOutboxRecords = new Queue(this, "PaymentOutboxFailureDestination", {
      encryption: QueueEncryption.SQS_MANAGED,
      retentionPeriod: Duration.days(4),
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const paymentOutboxPublisher = this.lambdaFunction(
      "PaymentOutboxPublisher",
      "outbox-publisher.ts",
      {
        EVENT_BUS_NAME: eventBus.eventBusName,
        EVENT_SOURCE: paymentEventSource,
      },
    );
    paymentOutboxPublisher.addEventSource(new DynamoEventSource(paymentOutboxTable as ITable, {
      batchSize: 10,
      bisectBatchOnError: true,
      onFailure: new SqsDlq(failedPaymentOutboxRecords),
      reportBatchItemFailures: true,
      retryAttempts: 3,
      startingPosition: StartingPosition.LATEST,
    }));
    eventBus.grantPutEventsTo(paymentOutboxPublisher);

    const failedFulfillmentOutboxRecords = new Queue(
      this,
      "FulfillmentOutboxFailureDestination",
      {
        encryption: QueueEncryption.SQS_MANAGED,
        retentionPeriod: Duration.days(4),
        removalPolicy: RemovalPolicy.DESTROY,
      },
    );
    const fulfillmentOutboxPublisher = this.lambdaFunction(
      "FulfillmentOutboxPublisher",
      "outbox-publisher.ts",
      {
        EVENT_BUS_NAME: eventBus.eventBusName,
        EVENT_SOURCE: fulfillmentEventSource,
      },
    );
    fulfillmentOutboxPublisher.addEventSource(
      new DynamoEventSource(fulfillmentOutboxTable as ITable, {
        batchSize: 10,
        bisectBatchOnError: true,
        onFailure: new SqsDlq(failedFulfillmentOutboxRecords),
        reportBatchItemFailures: true,
        retryAttempts: 3,
        startingPosition: StartingPosition.LATEST,
      }),
    );
    eventBus.grantPutEventsTo(fulfillmentOutboxPublisher);

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

    const paymentFunction = this.lambdaFunction(
      "PaymentCommand",
      "payment-lambda.ts",
      {
        FAKE_PAYMENT_PROVIDER_TABLE_NAME: fakePaymentProviderTable.tableName,
        ...(fakePaymentFailurePlanTable === undefined
          ? {}
          : { FAKE_PAYMENT_FAILURE_PLAN_TABLE_NAME: fakePaymentFailurePlanTable.tableName }),
        PAYMENT_OUTBOX_TABLE_NAME: paymentOutboxTable.tableName,
        PAYMENT_TABLE_NAME: paymentTable.tableName,
      },
      Duration.seconds(10),
    );
    paymentTable.grantReadWriteData(paymentFunction);
    paymentOutboxTable.grantWriteData(paymentFunction);
    fakePaymentProviderTable.grantReadWriteData(paymentFunction);
    fakePaymentFailurePlanTable?.grantReadData(paymentFunction);
    paymentFunction.addToRolePolicy(new PolicyStatement({
      actions: ["dynamodb:TransactWriteItems"],
      resources: [
        paymentTable.tableArn,
        paymentOutboxTable.tableArn,
        fakePaymentProviderTable.tableArn,
      ],
    }));
    const paymentFunctionVersion = paymentFunction.currentVersion;
    const cfnPaymentFunctionVersion = paymentFunctionVersion.node.defaultChild as CfnVersion;
    retainAcrossDeployments(cfnPaymentFunctionVersion);

    const fulfillmentFunction = this.lambdaFunction(
      "FulfillmentCommand",
      "fulfillment-lambda.ts",
      {
        ...(fakePaymentFailurePlanTable === undefined
          ? {}
          : { FULFILLMENT_FAILURE_PLAN_TABLE_NAME: fakePaymentFailurePlanTable.tableName }),
        FULFILLMENT_OUTBOX_TABLE_NAME: fulfillmentOutboxTable.tableName,
        FULFILLMENT_TABLE_NAME: fulfillmentTable.tableName,
      },
      Duration.seconds(3),
    );
    fulfillmentTable.grantReadWriteData(fulfillmentFunction);
    fulfillmentOutboxTable.grantWriteData(fulfillmentFunction);
    fakePaymentFailurePlanTable?.grantReadData(fulfillmentFunction);
    fulfillmentFunction.addToRolePolicy(new PolicyStatement({
      actions: ["dynamodb:TransactWriteItems"],
      resources: [fulfillmentTable.tableArn, fulfillmentOutboxTable.tableArn],
    }));
    const fulfillmentFunctionVersion = fulfillmentFunction.currentVersion;
    const cfnFulfillmentFunctionVersion =
      fulfillmentFunctionVersion.node.defaultChild as CfnVersion;
    retainAcrossDeployments(cfnFulfillmentFunctionVersion);

    const failedFulfillmentWork = new Queue(this, "FulfillmentWorkDeadLetterQueue", {
      encryption: QueueEncryption.SQS_MANAGED,
      retentionPeriod: Duration.days(4),
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const fulfillmentQueue = new Queue(this, "FulfillmentWorkQueue", {
      deadLetterQueue: { queue: failedFulfillmentWork, maxReceiveCount: 3 },
      encryption: QueueEncryption.SQS_MANAGED,
      retentionPeriod: Duration.days(4),
      visibilityTimeout: Duration.seconds(60),
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const fulfillmentWorkerRole = new Role(this, "FulfillmentWorkerRole", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      description: "Isolated SQS and Step Functions callback role for Fulfillment handoff.",
    });
    const fulfillmentWorker = this.lambdaFunction(
      "FulfillmentWorker",
      "fulfillment-worker-lambda.ts",
      {
        FULFILLMENT_FUNCTION_ARN: fulfillmentFunctionVersion.functionArn,
      },
      Duration.seconds(30),
      fulfillmentWorkerRole,
    );
    fulfillmentFunctionVersion.grantInvoke(fulfillmentWorkerRole);
    fulfillmentWorker.addToRolePolicy(new PolicyStatement({
      actions: [
        "states:SendTaskHeartbeat",
        "states:SendTaskSuccess",
        "states:SendTaskFailure",
      ],
      resources: ["*"],
    }));
    const fulfillmentWorkerVersion = fulfillmentWorker.currentVersion;
    const cfnFulfillmentWorkerVersion =
      fulfillmentWorkerVersion.node.defaultChild as CfnVersion;
    retainAcrossDeployments(cfnFulfillmentWorkerVersion);
    fulfillmentWorkerVersion.addEventSource(new SqsEventSource(fulfillmentQueue, {
      batchSize: 10,
      maxConcurrency: 2,
      reportBatchItemFailures: true,
    }));

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
    const authorizePayment = new LambdaInvoke(this, "AuthorizePayment", {
      lambdaFunction: paymentFunctionVersion as IFunction,
      payload: TaskInput.fromObject({
        schemaVersion: "1.0",
        commandType: "AuthorizePayment",
        operationId: JsonPath.format("authorize-{}", JsonPath.stringAt("$.checkoutId")),
        checkoutId: JsonPath.stringAt("$.checkoutId"),
        paymentId: JsonPath.format("payment-{}", JsonPath.stringAt("$.checkoutId")),
        amountMinor: 1250,
        currency: "USD",
        correlationId: JsonPath.stringAt("$.correlationId"),
        causationId: JsonPath.stringAt("$$.Execution.Id"),
      }),
      payloadResponseOnly: true,
      resultPath: "$.paymentAuthorization",
      retryOnServiceExceptions: false,
    });
    this.addPaymentCommandRetry(authorizePayment);
    const reserveFulfillment = new LambdaInvoke(this, "ReserveFulfillment", {
      lambdaFunction: fulfillmentFunctionVersion as IFunction,
      payload: TaskInput.fromObject({
        schemaVersion: "1.0",
        commandType: "ReserveFulfillment",
        operationId: JsonPath.format(
          "reserve-fulfillment-{}",
          JsonPath.stringAt("$.checkoutId"),
        ),
        checkoutId: JsonPath.stringAt("$.checkoutId"),
        reservationId: JsonPath.format(
          "fulfillment-{}",
          JsonPath.stringAt("$.checkoutId"),
        ),
        correlationId: JsonPath.stringAt("$.correlationId"),
        causationId: JsonPath.stringAt("$$.Execution.Id"),
      }),
      payloadResponseOnly: true,
      resultPath: "$.fulfillmentReservation",
      retryOnServiceExceptions: false,
    });
    this.addInternalCommandRetry(reserveFulfillment);
    const capturePayment = new LambdaInvoke(this, "CapturePayment", {
      lambdaFunction: paymentFunctionVersion as IFunction,
      payload: TaskInput.fromObject({
        schemaVersion: "1.0",
        commandType: "CapturePayment",
        operationId: JsonPath.format("capture-{}", JsonPath.stringAt("$.checkoutId")),
        checkoutId: JsonPath.stringAt("$.checkoutId"),
        paymentId: JsonPath.stringAt("$.paymentAuthorization.paymentId"),
        correlationId: JsonPath.stringAt("$.correlationId"),
        causationId: JsonPath.stringAt("$$.Execution.Id"),
      }),
      payloadResponseOnly: true,
      resultPath: "$.paymentCapture",
      retryOnServiceExceptions: false,
    });
    this.addPaymentCommandRetry(capturePayment);
    const handoffFulfillment = new SqsSendMessage(this, "HandoffFulfillment", {
      queue: fulfillmentQueue,
      integrationPattern: IntegrationPattern.WAIT_FOR_TASK_TOKEN,
      heartbeatTimeout: Timeout.duration(Duration.minutes(1)),
      taskTimeout: Timeout.duration(Duration.minutes(5)),
      messageBody: TaskInput.fromObject({
        taskToken: JsonPath.taskToken,
        command: {
          schemaVersion: "1.0",
          commandType: "HandoffFulfillment",
          operationId: JsonPath.format(
            "handoff-fulfillment-{}",
            JsonPath.stringAt("$.checkoutId"),
          ),
          checkoutId: JsonPath.stringAt("$.checkoutId"),
          reservationId: JsonPath.stringAt("$.fulfillmentReservation.reservationId"),
          correlationId: JsonPath.stringAt("$.correlationId"),
          causationId: JsonPath.stringAt("$$.Execution.Id"),
        },
      }),
      resultPath: "$.fulfillmentHandoff",
    });
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
    const cancelPaymentAuthorization = new LambdaInvoke(this, "CancelPaymentAuthorization", {
      lambdaFunction: paymentFunctionVersion as IFunction,
      payload: TaskInput.fromObject({
        schemaVersion: "1.0",
        commandType: "CancelPayment",
        operationId: JsonPath.format("compensate-payment-{}", JsonPath.stringAt("$.checkoutId")),
        checkoutId: JsonPath.stringAt("$.checkoutId"),
        paymentId: JsonPath.format("payment-{}", JsonPath.stringAt("$.checkoutId")),
        correlationId: JsonPath.stringAt("$.correlationId"),
        causationId: JsonPath.stringAt("$$.Execution.Id"),
      }),
      payloadResponseOnly: true,
      resultPath: "$.paymentCancellation",
      retryOnServiceExceptions: false,
    });
    this.addPaymentCommandRetry(cancelPaymentAuthorization);
    const releaseCompensatingInventory = new LambdaInvoke(
      this,
      "ReleaseCompensatingInventory",
      {
        lambdaFunction: inventoryFunctionVersion as IFunction,
        payload: TaskInput.fromObject({
          schemaVersion: "1.0",
          commandType: "ReleaseInventory",
          operationId: JsonPath.format(
            "compensate-inventory-{}",
            JsonPath.stringAt("$.checkoutId"),
          ),
          checkoutId: JsonPath.stringAt("$.checkoutId"),
          reservationId: JsonPath.stringAt("$.inventoryReservation.reservationId"),
          releaseReason: "COMPENSATION",
          correlationId: JsonPath.stringAt("$.correlationId"),
          causationId: JsonPath.stringAt("$$.Execution.Id"),
        }),
        payloadResponseOnly: true,
        resultPath: "$.inventoryCompensation",
        retryOnServiceExceptions: false,
      },
    );
    this.addInternalCommandRetry(releaseCompensatingInventory);
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
    const markOrderCancelled = new LambdaInvoke(this, "MarkOrderCancelled", {
      lambdaFunction: orderFunctionVersion as IFunction,
      payload: TaskInput.fromObject({
        schemaVersion: "1.0",
        commandType: "MarkOrderCancelled",
        operationId: JsonPath.format("cancel-order-{}", JsonPath.stringAt("$.checkoutId")),
        checkoutId: JsonPath.stringAt("$.checkoutId"),
        correlationId: JsonPath.stringAt("$.correlationId"),
        causationId: JsonPath.stringAt("$$.Execution.Id"),
      }),
      payloadResponseOnly: true,
      resultPath: "$.order",
      retryOnServiceExceptions: false,
    });
    this.addInternalCommandRetry(markOrderCancelled);
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
    const markOrderConfirmed = new LambdaInvoke(this, "MarkOrderConfirmed", {
      lambdaFunction: orderFunctionVersion as IFunction,
      payload: TaskInput.fromObject({
        schemaVersion: "1.0",
        commandType: "MarkOrderConfirmed",
        operationId: JsonPath.format(
          "confirm-order-{}",
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
    this.addInternalCommandRetry(markOrderConfirmed);
    const orderExpired = new Succeed(this, "OrderExpired");
    const checkoutCancelled = new Succeed(this, "CheckoutCancelled");
    const checkoutConfirmed = new Succeed(this, "CheckoutConfirmed");
    markOrderCancelled.next(new Choice(this, "OrderCancellationOutcome")
      .when(Condition.stringEquals("$.order.status", "CANCELLED"), checkoutCancelled)
      .otherwise(new Fail(this, "OrderCancellationRejected", {
        cause: "Order returned an unsupported cancellation outcome.",
        error: "OrderInvariantViolation",
      })));
    releaseCompensatingInventory.next(new Choice(this, "CompensatingInventoryReleaseOutcome")
      .when(
        Condition.stringEquals("$.inventoryCompensation.status", "RELEASED"),
        markOrderCancelled,
      )
      .when(Condition.and(
        Condition.stringEquals(
          "$.inventoryCompensation.status",
          "RESERVATION_NOT_ACTIVE",
        ),
        Condition.stringEquals("$.inventoryCompensation.reservationStatus", "RELEASED"),
      ), markOrderCancelled)
      .otherwise(new Fail(this, "CompensatingInventoryReleaseRejected", {
        cause: "Inventory release was not confirmed, so the Order remains pending.",
        error: "InventoryCompensationFailure",
      })));
    cancelPaymentAuthorization.next(new Choice(this, "PaymentCancellationOutcome")
      .when(
        Condition.stringEquals("$.paymentCancellation.status", "CANCELLED"),
        releaseCompensatingInventory,
      )
      .otherwise(new Fail(this, "PaymentCancellationRejected", {
        cause: "Payment cancellation was not confirmed, so later compensation did not run.",
        error: "PaymentCompensationFailure",
      })));
    markOrderConfirmed.next(new Choice(this, "OrderConfirmationOutcome")
      .when(Condition.stringEquals("$.order.status", "CONFIRMED"), checkoutConfirmed)
      .otherwise(new Fail(this, "OrderConfirmationRejected", {
        cause: "Order returned an unsupported confirmation outcome.",
        error: "OrderInvariantViolation",
      })));
    handoffFulfillment.next(new Choice(this, "FulfillmentHandoffOutcome")
      .when(
        Condition.stringEquals("$.fulfillmentHandoff.status", "HANDED_OFF"),
        markOrderConfirmed,
      )
      .otherwise(new Fail(this, "FulfillmentHandoffRejected", {
        cause: "Fulfillment returned an unsupported handoff outcome.",
        error: "FulfillmentInvariantViolation",
      })));
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
      ), handoffFulfillment)
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
      .when(Condition.stringEquals("$.inventoryCommit.status", "COMMITTED"), handoffFulfillment)
      .when(Condition.and(
        Condition.stringEquals("$.inventoryCommit.status", "RESERVATION_NOT_ACTIVE"),
        Condition.stringEquals("$.inventoryCommit.reservationStatus", "COMMITTED"),
      ), handoffFulfillment)
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
    capturePayment.next(new Choice(this, "PaymentCaptureOutcome")
      .when(Condition.stringEquals("$.paymentCapture.status", "CAPTURED"), inventoryCommitTiming)
      .otherwise(new Fail(this, "PaymentCaptureRejected", {
        cause: "Payment returned an unsupported capture outcome.",
        error: "PaymentCaptureFailure",
      })));
    const fulfillmentReservationRejected = new Fail(this, "FulfillmentReservationRejected", {
      cause: "Fulfillment returned an unsupported reservation outcome.",
      error: "FulfillmentInvariantViolation",
    });
    const fulfillmentCapacityOutcome = new Choice(this, "FulfillmentCapacityOutcome")
      .when(
        Condition.stringEquals("$.fulfillmentReservation.status", "RESERVED"),
        capturePayment,
      )
      .when(
        Condition.stringEquals("$.fulfillmentReservation.status", "CAPACITY_UNAVAILABLE"),
        cancelPaymentAuthorization,
      )
      .otherwise(fulfillmentReservationRejected);
    reserveFulfillment.next(fulfillmentCapacityOutcome);
    authorizePayment.next(new Choice(this, "PaymentAuthorizationOutcome")
      .when(
        Condition.stringEquals("$.paymentAuthorization.status", "AUTHORIZED"),
        reserveFulfillment,
      )
      .when(
        Condition.stringEquals("$.paymentAuthorization.status", "REJECTED"),
        releaseCompensatingInventory,
      )
      .otherwise(new Fail(this, "PaymentAuthorizationRejected", {
        cause: "Payment returned an unsupported authorization outcome.",
        error: "PaymentAuthorizationFailure",
      })));
    authorizePayment.addCatch(releaseCompensatingInventory, {
      errors: [
        "PaymentProviderTransientError",
        "PaymentProviderThrottledError",
        "PaymentProviderTimeoutError",
      ],
      resultPath: "$.paymentAuthorizationError",
    });
    reserveInventory.next(new Choice(this, "InventoryReservationOutcome")
      .when(
        Condition.stringEquals("$.inventoryReservation.status", "RESERVED"),
        authorizePayment,
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
    stateMachine.addToRolePolicy(
      new PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: [`${paymentFunction.functionArn}:*`],
      }),
    );
    stateMachine.addToRolePolicy(
      new PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: [`${fulfillmentFunction.functionArn}:*`],
      }),
    );

    const workflowVersion = new CfnStateMachineVersion(this, "CheckoutWorkflowVersion", {
      description:
        "Immutable marketplace checkout Order, Inventory, Payment, and Fulfillment workflow.",
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
    new CfnOutput(this, "OrderOutboxTableName", { value: orderOutboxTable.tableName });
    new CfnOutput(this, "InventoryTableName", { value: inventoryTable.tableName });
    new CfnOutput(this, "InventoryOutboxTableName", { value: inventoryOutboxTable.tableName });
    new CfnOutput(this, "InventoryEventSource", { value: inventoryEventSource });
    new CfnOutput(this, "InventoryCommandFunctionName", { value: inventoryFunction.functionName });
    new CfnOutput(this, "InventoryExpiryWorkerFunctionName", {
      value: inventoryExpiryWorker.functionName,
    });
    new CfnOutput(this, "PaymentTableName", { value: paymentTable.tableName });
    new CfnOutput(this, "PaymentOutboxTableName", { value: paymentOutboxTable.tableName });
    new CfnOutput(this, "PaymentEventSource", { value: paymentEventSource });
    new CfnOutput(this, "PaymentCommandFunctionName", { value: paymentFunction.functionName });
    new CfnOutput(this, "FulfillmentTableName", { value: fulfillmentTable.tableName });
    new CfnOutput(this, "FulfillmentEventSource", { value: fulfillmentEventSource });
    new CfnOutput(this, "FulfillmentCommandFunctionName", {
      value: fulfillmentFunction.functionName,
    });
    new CfnOutput(this, "FulfillmentQueueUrl", { value: fulfillmentQueue.queueUrl });
    new CfnOutput(this, "FulfillmentWorkerFunctionName", {
      value: fulfillmentWorker.functionName,
    });
    new CfnOutput(this, "FakePaymentProviderTableName", {
      value: fakePaymentProviderTable.tableName,
    });
    if (fakePaymentFailurePlanRole !== undefined && fakePaymentFailurePlanTable !== undefined) {
      new CfnOutput(this, "FakePaymentFailurePlanTableName", {
        value: fakePaymentFailurePlanTable.tableName,
      });
      new CfnOutput(this, "FakePaymentFailurePlanRoleArn", {
        value: fakePaymentFailurePlanRole.roleArn,
      });
    }
  }

  private lambdaFunction(
    id: string,
    entryFile: string,
    environment: Record<string, string>,
    timeout: Duration = Duration.seconds(10),
    role?: Role,
  ): NodejsFunction {
    const functionName = `aws-architecture-lab-${id.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()}`;
    const logGroup = new LogGroup(this, `${id}Logs`, {
      logGroupName: `/aws/lambda/${functionName}`,
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const fn = new NodejsFunction(this, id, {
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
      ...(role === undefined ? {} : { role }),
      ...(this.lambdaReservedConcurrency === undefined
        ? {}
        : { reservedConcurrentExecutions: this.lambdaReservedConcurrency }),
      timeout,
    });
    if (role !== undefined) logGroup.grantWrite(role);
    return fn;
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

  private addPaymentCommandRetry(task: LambdaInvoke): void {
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
        "PaymentProviderThrottledError",
        "PaymentProviderTimeoutError",
        "PaymentProviderTransientError",
        "PaymentProviderResponseLostError",
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
