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
import {
  Alarm,
  ComparisonOperator,
  Dashboard,
  GraphWidget,
  TreatMissingData,
} from "aws-cdk-lib/aws-cloudwatch";
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
import { SqsDestination } from "aws-cdk-lib/aws-lambda-destinations";
import { FilterPattern, LogGroup, MetricFilter, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
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
  Pass,
  Result,
  StateMachine,
  StateMachineType,
  Succeed,
  TaskInput,
  Timeout,
  Wait,
  WaitTime,
  type IChainable,
} from "aws-cdk-lib/aws-stepfunctions";
import { LambdaInvoke, SqsSendMessage } from "aws-cdk-lib/aws-stepfunctions-tasks";
import {
  reconciliationRecoveryPlan,
  type CreateReconciliationCommand,
  type ReconciliationRequiredAction,
  type ReconciliationWorkflowStep,
} from "@aws-architecture-lab/contracts";
import type { Construct } from "constructs";

import { STRIPE_SANDBOX_SECRET_NAME } from "./foundation-config.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const orderEventSource = "aws-architecture-lab.order";
const orderPendingEventType = "OrderPending";
const inventoryEventSource = "aws-architecture-lab.inventory";
const paymentEventSource = "aws-architecture-lab.payment";
const fulfillmentEventSource = "aws-architecture-lab.fulfillment";
const reconciliationEventSource = "aws-architecture-lab.reconciliation";
const internalCommandTransientErrors = [
  "Lambda.ServiceException",
  "Lambda.AWSLambdaException",
  "Lambda.SdkClientException",
  "TransactionCanceledException",
  "TransactionConflictException",
  "ProvisionedThroughputExceededException",
  "ThrottlingException",
  "InternalServerError",
  "SagaWorkflowVersionPendingError",
];
const paymentCommandTransientErrors = [
  ...internalCommandTransientErrors,
  "PaymentProviderThrottledError",
  "PaymentProviderTimeoutError",
  "PaymentProviderTransientError",
  "PaymentProviderResponseLostError",
];

export interface MarketplaceCheckoutStackProps extends StackProps {
  readonly enableFakePaymentFailurePlans?: boolean;
  readonly lambdaReservedConcurrency?: number;
  readonly paymentProviderMode?: "fake" | "stripe-sandbox";
  readonly stripeEventBusName?: string;
}

export class MarketplaceCheckoutStack extends Stack {
  private readonly lambdaReservedConcurrency: number | undefined;

  public constructor(scope: Construct, id: string, props: MarketplaceCheckoutStackProps = {}) {
    const {
      enableFakePaymentFailurePlans = true,
      lambdaReservedConcurrency,
      paymentProviderMode = "fake",
      stripeEventBusName,
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
    if (paymentProviderMode === "stripe-sandbox" && stripeEventBusName === undefined) {
      throw new Error("stripeEventBusName is required when paymentProviderMode is stripe-sandbox.");
    }

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
    const reconciliationTable = new Table(this, "Reconciliations", {
      partitionKey: { name: "reconciliationId", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      maxReadRequestUnits: 100,
      maxWriteRequestUnits: 100,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const reconciliationOutboxTable = new Table(this, "ReconciliationOutbox", {
      partitionKey: { name: "eventId", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      maxReadRequestUnits: 100,
      maxWriteRequestUnits: 100,
      removalPolicy: RemovalPolicy.DESTROY,
      stream: StreamViewType.NEW_IMAGE,
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

    const failedReconciliationOutboxRecords = new Queue(
      this,
      "ReconciliationOutboxFailureDestination",
      {
        encryption: QueueEncryption.SQS_MANAGED,
        retentionPeriod: Duration.days(4),
        removalPolicy: RemovalPolicy.DESTROY,
      },
    );
    const reconciliationOutboxPublisher = this.lambdaFunction(
      "ReconciliationOutboxPublisher",
      "outbox-publisher.ts",
      {
        EVENT_BUS_NAME: eventBus.eventBusName,
        EVENT_SOURCE: reconciliationEventSource,
      },
    );
    reconciliationOutboxPublisher.addEventSource(
      new DynamoEventSource(reconciliationOutboxTable as ITable, {
        batchSize: 10,
        bisectBatchOnError: true,
        onFailure: new SqsDlq(failedReconciliationOutboxRecords),
        reportBatchItemFailures: true,
        retryAttempts: 3,
        startingPosition: StartingPosition.LATEST,
      }),
    );
    eventBus.grantPutEventsTo(reconciliationOutboxPublisher);

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
        ...(fakePaymentFailurePlanTable === undefined
          ? {}
          : { INVENTORY_FAILURE_PLAN_TABLE_NAME: fakePaymentFailurePlanTable.tableName }),
      },
      Duration.seconds(3),
    );
    inventoryTable.grantReadWriteData(inventoryFunction);
    inventoryOutboxTable.grantWriteData(inventoryFunction);
    fakePaymentFailurePlanTable?.grantReadData(inventoryFunction);
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
        PAYMENT_PROVIDER_MODE: paymentProviderMode,
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
    if (paymentProviderMode === "stripe-sandbox") {
      Secret.fromSecretNameV2(
        this,
        "StripeSandboxSecret",
        STRIPE_SANDBOX_SECRET_NAME,
      ).grantRead(paymentFunction);
    }
    const paymentFunctionVersion = paymentFunction.currentVersion;
    const cfnPaymentFunctionVersion = paymentFunctionVersion.node.defaultChild as CfnVersion;
    retainAcrossDeployments(cfnPaymentFunctionVersion);

    if (paymentProviderMode === "stripe-sandbox" && stripeEventBusName !== undefined) {
      const stripeEvents = EventBus.fromEventBusName(
        this,
        "StripePartnerEvents",
        stripeEventBusName,
      );
      const failedStripeEvents = new Queue(this, "StripeEventReconciliationDeadLetterQueue", {
        encryption: QueueEncryption.SQS_MANAGED,
        retentionPeriod: Duration.days(4),
        removalPolicy: RemovalPolicy.DESTROY,
      });
      const stripeEventReconciler = this.lambdaFunction(
        "StripeEventReconciler",
        "stripe-event-lambda.ts",
        {
          PAYMENT_OUTBOX_TABLE_NAME: paymentOutboxTable.tableName,
          PAYMENT_PROVIDER_MODE: paymentProviderMode,
          PAYMENT_TABLE_NAME: paymentTable.tableName,
        },
        Duration.seconds(10),
      );
      paymentTable.grantReadWriteData(stripeEventReconciler);
      paymentOutboxTable.grantWriteData(stripeEventReconciler);
      stripeEventReconciler.addToRolePolicy(new PolicyStatement({
        actions: ["dynamodb:TransactWriteItems"],
        resources: [paymentTable.tableArn, paymentOutboxTable.tableArn],
      }));
      Secret.fromSecretNameV2(
        this,
        "StripeEventReconcilerSecret",
        STRIPE_SANDBOX_SECRET_NAME,
      ).grantRead(stripeEventReconciler);
      stripeEventReconciler.configureAsyncInvoke({
        maxEventAge: Duration.minutes(5),
        onFailure: new SqsDestination(failedStripeEvents),
        retryAttempts: 2,
      });
      new Rule(this, "StripeProviderEventRule", {
        eventBus: stripeEvents,
        eventPattern: {
          detail: {
            type: [{ prefix: "payment_intent." }, { prefix: "refund." }],
          },
        },
        targets: [new EventBridgeLambdaFunction(stripeEventReconciler, {
          deadLetterQueue: failedStripeEvents,
          maxEventAge: Duration.minutes(5),
          retryAttempts: 2,
        })],
      });
      const divergenceMetric = new MetricFilter(this, "ProviderDivergenceMetric", {
        logGroup: stripeEventReconciler.logGroup,
        filterPattern: FilterPattern.literal('{ $.eventType = "ProviderDivergence" }'),
        metricNamespace: "AWSArchitectureLab/MarketplaceCheckout",
        metricName: "ProviderDivergence",
        metricValue: "1",
        defaultValue: 0,
      });
      new Alarm(this, "ProviderDivergenceAlarm", {
        alarmName: "aws-architecture-lab-marketplace-checkout-provider-divergence",
        alarmDescription: "Action required: investigate Stripe provider divergence.",
        metric: divergenceMetric.metric({ period: Duration.minutes(1) }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      });
    }

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

    const reconciliationFunction = this.lambdaFunction(
      "ReconciliationCommand",
      "reconciliation-lambda.ts",
      {
        RECONCILIATION_OUTBOX_TABLE_NAME: reconciliationOutboxTable.tableName,
        RECONCILIATION_TABLE_NAME: reconciliationTable.tableName,
        SAGA_TABLE_NAME: sagaTable.tableName,
      },
      Duration.seconds(3),
    );
    reconciliationTable.grantReadWriteData(reconciliationFunction);
    sagaTable.grantReadWriteData(reconciliationFunction);
    reconciliationOutboxTable.grantWriteData(reconciliationFunction);
    reconciliationFunction.addToRolePolicy(new PolicyStatement({
      actions: ["dynamodb:TransactWriteItems"],
      resources: [
        reconciliationTable.tableArn,
        sagaTable.tableArn,
        reconciliationOutboxTable.tableArn,
      ],
    }));
    const reconciliationFunctionVersion = reconciliationFunction.currentVersion;
    const cfnReconciliationFunctionVersion =
      reconciliationFunctionVersion.node.defaultChild as CfnVersion;
    retainAcrossDeployments(cfnReconciliationFunctionVersion);

    const reconciliationReplay = this.lambdaFunction(
      "ReconciliationReplay",
      "reconciliation-replay-lambda.ts",
      {
        RECONCILIATION_OUTBOX_TABLE_NAME: reconciliationOutboxTable.tableName,
        RECONCILIATION_TABLE_NAME: reconciliationTable.tableName,
        SAGA_TABLE_NAME: sagaTable.tableName,
      },
    );
    reconciliationTable.grantReadWriteData(reconciliationReplay);
    const reconciliationRequiredMetric = new MetricFilter(this, "ReconciliationRequiredMetric", {
      logGroup: reconciliationFunction.logGroup,
      filterPattern: FilterPattern.literal('{ $.event = "ReconciliationRequired" }'),
      metricNamespace: "AWSArchitectureLab/MarketplaceCheckout",
      metricName: "ReconciliationRequired",
      metricValue: "1",
      defaultValue: 0,
    });
    const reconciliationRequiredAlarm = new Alarm(this, "ReconciliationRequiredAlarm", {
      alarmName: "aws-architecture-lab-marketplace-checkout-reconciliation-required",
      alarmDescription:
        "Action required: inspect the reconciliation record and use the audited replay command.",
      metric: reconciliationRequiredMetric.metric({ period: Duration.minutes(1) }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });

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
    this.addPaymentCommandRetry(capturePayment, { retryResponseLoss: false });
    const retrievePaymentAfterCaptureFailure = new LambdaInvoke(
      this,
      "RetrievePaymentAfterCaptureFailure",
      {
        lambdaFunction: paymentFunctionVersion as IFunction,
        payload: TaskInput.fromObject({
          schemaVersion: "1.0",
          commandType: "RetrievePayment",
          operationId: JsonPath.format(
            "reconcile-capture-{}",
            JsonPath.stringAt("$.checkoutId"),
          ),
          checkoutId: JsonPath.stringAt("$.checkoutId"),
          paymentId: JsonPath.format("payment-{}", JsonPath.stringAt("$.checkoutId")),
          correlationId: JsonPath.stringAt("$.correlationId"),
          causationId: JsonPath.stringAt("$$.Execution.Id"),
        }),
        payloadResponseOnly: true,
        resultPath: "$.paymentCaptureReconciliation",
        retryOnServiceExceptions: false,
      },
    );
    this.addPaymentCommandRetry(retrievePaymentAfterCaptureFailure);
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
    const retrieveFulfillmentAfterHandoffFailure = new LambdaInvoke(
      this,
      "RetrieveFulfillmentAfterHandoffFailure",
      {
        lambdaFunction: fulfillmentFunctionVersion as IFunction,
        payload: TaskInput.fromObject({
          schemaVersion: "1.0",
          commandType: "RetrieveFulfillment",
          operationId: JsonPath.format(
            "reconcile-fulfillment-handoff-{}",
            JsonPath.stringAt("$.checkoutId"),
          ),
          checkoutId: JsonPath.stringAt("$.checkoutId"),
          reservationId: JsonPath.stringAt("$.fulfillmentReservation.reservationId"),
          correlationId: JsonPath.stringAt("$.correlationId"),
          causationId: JsonPath.stringAt("$$.Execution.Id"),
        }),
        payloadResponseOnly: true,
        resultPath: "$.fulfillmentHandoffReconciliation",
        retryOnServiceExceptions: false,
      },
    );
    this.addInternalCommandRetry(retrieveFulfillmentAfterHandoffFailure);
    const replayOperationId = JsonPath.stringAt("$.reconciliationReplay.operationId");
    const compensationTaskPair = (
      normalId: string,
      normalOperationId: string,
      create: (id: string, operationId: string) => LambdaInvoke,
      addRetry: (task: LambdaInvoke) => void,
    ) => {
      const normal = create(normalId, normalOperationId);
      const replay = create(`Replay${normalId}`, replayOperationId);
      addRetry(normal);
      addRetry(replay);
      return { normal, replay };
    };
    const paymentCancellationTask = (id: string, operationId: string) => new LambdaInvoke(
      this,
      id,
      {
        lambdaFunction: paymentFunctionVersion as IFunction,
        payload: TaskInput.fromObject({
          schemaVersion: "1.0",
          commandType: "CancelPayment",
          operationId,
          checkoutId: JsonPath.stringAt("$.checkoutId"),
          paymentId: JsonPath.stringAt("$.paymentAuthorization.paymentId"),
          correlationId: JsonPath.stringAt("$.correlationId"),
          causationId: JsonPath.stringAt("$$.Execution.Id"),
        }),
        payloadResponseOnly: true,
        resultPath: "$.paymentCancellation",
        retryOnServiceExceptions: false,
      },
    );
    const refundTask = (id: string, operationId: string) => new LambdaInvoke(this, id, {
      lambdaFunction: paymentFunctionVersion as IFunction,
      payload: TaskInput.fromObject({
        schemaVersion: "1.0",
        commandType: "RefundPayment",
        operationId,
        checkoutId: JsonPath.stringAt("$.checkoutId"),
        paymentId: JsonPath.stringAt("$.paymentAuthorization.paymentId"),
        amountMinor: 1250,
        correlationId: JsonPath.stringAt("$.correlationId"),
        causationId: JsonPath.stringAt("$$.Execution.Id"),
      }),
      payloadResponseOnly: true,
      resultPath: "$.paymentRefund",
      retryOnServiceExceptions: false,
    });
    const fulfillmentCancellationTask = (id: string, operationId: string) => new LambdaInvoke(
      this,
      id,
      {
        lambdaFunction: fulfillmentFunctionVersion as IFunction,
        payload: TaskInput.fromObject({
          schemaVersion: "1.0",
          commandType: "CancelFulfillment",
          operationId,
          checkoutId: JsonPath.stringAt("$.checkoutId"),
          reservationId: JsonPath.stringAt("$.fulfillmentReservation.reservationId"),
          correlationId: JsonPath.stringAt("$.correlationId"),
          causationId: JsonPath.stringAt("$$.Execution.Id"),
        }),
        payloadResponseOnly: true,
        resultPath: "$.fulfillmentCancellation",
        retryOnServiceExceptions: false,
      },
    );
    const inventoryReleaseTask = (id: string, operationId: string) => new LambdaInvoke(
      this,
      id,
      {
        lambdaFunction: inventoryFunctionVersion as IFunction,
        payload: TaskInput.fromObject({
          schemaVersion: "1.0",
          commandType: "ReleaseInventory",
          operationId,
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
    const {
      normal: cancelPaymentAuthorization,
      replay: replayCancelPaymentAuthorization,
    } = compensationTaskPair(
      "CancelPaymentAuthorization",
      JsonPath.format("compensate-payment-{}", JsonPath.stringAt("$.checkoutId")),
      paymentCancellationTask,
      (task) => this.addPaymentCommandRetry(task),
    );
    const {
      normal: refundCapturedPayment,
      replay: replayRefundCapturedPayment,
    } = compensationTaskPair(
      "RefundCapturedPayment",
      JsonPath.format("refund-payment-{}", JsonPath.stringAt("$.checkoutId")),
      refundTask,
      (task) => this.addPaymentCommandRetry(task),
    );
    const {
      normal: cancelFulfillmentReservation,
      replay: replayCancelFulfillmentReservation,
    } = compensationTaskPair(
      "CancelFulfillmentReservation",
      JsonPath.format("cancel-fulfillment-{}", JsonPath.stringAt("$.checkoutId")),
      fulfillmentCancellationTask,
      (task) => this.addInternalCommandRetry(task),
    );
    const {
      normal: releaseCompensatingInventory,
      replay: replayReleaseCompensatingInventory,
    } = compensationTaskPair(
      "ReleaseCompensatingInventory",
      JsonPath.format("compensate-inventory-{}", JsonPath.stringAt("$.checkoutId")),
      inventoryReleaseTask,
      (task) => this.addInternalCommandRetry(task),
    );
    const markOrderCompensating = new LambdaInvoke(this, "MarkOrderCompensating", {
      lambdaFunction: orderFunctionVersion as IFunction,
      payload: TaskInput.fromObject({
        schemaVersion: "1.0",
        commandType: "MarkOrderCompensating",
        operationId: JsonPath.format(
          "compensate-order-{}",
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
    this.addInternalCommandRetry(markOrderCompensating);
    const markOrderReconciliationRequired = new LambdaInvoke(
      this,
      "MarkOrderReconciliationRequired",
      {
        lambdaFunction: orderFunctionVersion as IFunction,
        payload: TaskInput.fromObject({
          schemaVersion: "1.0",
          commandType: "MarkOrderReconciliationRequired",
          operationId: JsonPath.format(
            "mark-order-reconciliation-{}",
            JsonPath.stringAt("$.checkoutId"),
          ),
          checkoutId: JsonPath.stringAt("$.checkoutId"),
          correlationId: JsonPath.stringAt("$.correlationId"),
          causationId: JsonPath.stringAt("$$.Execution.Id"),
        }),
        payloadResponseOnly: true,
        resultPath: "$.order",
        retryOnServiceExceptions: false,
      },
    );
    this.addInternalCommandRetry(markOrderReconciliationRequired);
    const createReconciliation = new LambdaInvoke(this, "CreateReconciliation", {
      lambdaFunction: reconciliationFunctionVersion as IFunction,
      payload: TaskInput.fromObject({
        schemaVersion: "1.0",
        commandType: "CreateReconciliation",
        operationId: JsonPath.format("reconcile-{}", JsonPath.stringAt("$.checkoutId")),
        reconciliationId: JsonPath.format(
          "reconciliation-{}",
          JsonPath.stringAt("$.checkoutId"),
        ),
        checkoutId: JsonPath.stringAt("$.checkoutId"),
        correlationId: JsonPath.stringAt("$.correlationId"),
        causationId: JsonPath.stringAt("$$.Execution.Id"),
        failedInvariant: JsonPath.stringAt("$.reconciliation.failedInvariant"),
        requiredAction: JsonPath.stringAt("$.reconciliation.requiredAction"),
        attempts: JsonPath.numberAt("$.reconciliation.attempts"),
      }),
      payloadResponseOnly: true,
      resultPath: "$.reconciliationResult",
      retryOnServiceExceptions: false,
    });
    this.addInternalCommandRetry(createReconciliation);
    const resolveReconciliation = new LambdaInvoke(this, "ResolveReconciliation", {
      lambdaFunction: reconciliationFunctionVersion as IFunction,
      payload: TaskInput.fromObject({
        schemaVersion: "1.0",
        commandType: "ResolveReconciliation",
        operationId: JsonPath.format(
          "resolve-{}",
          JsonPath.stringAt("$.reconciliationReplay.reconciliationId"),
        ),
        reconciliationId: JsonPath.stringAt("$.reconciliationReplay.reconciliationId"),
        checkoutId: JsonPath.stringAt("$.checkoutId"),
        correlationId: JsonPath.stringAt("$.correlationId"),
        causationId: JsonPath.stringAt("$$.Execution.Id"),
      }),
      payloadResponseOnly: true,
      resultPath: "$.reconciliationResult",
      retryOnServiceExceptions: false,
    });
    this.addInternalCommandRetry(resolveReconciliation);

    const reconciliationStart = (
      id: string,
      metadata: Pick<CreateReconciliationCommand, "failedInvariant" | "requiredAction">,
      attempts: number,
    ) => new Pass(this, id, {
      result: Result.fromObject({ ...metadata, attempts }),
      resultPath: "$.reconciliation",
    });
    const reconciliationPair = (
      id: string,
      metadata: Pick<CreateReconciliationCommand, "failedInvariant" | "requiredAction">,
    ) => ({
      rejected: reconciliationStart(`Reconcile${id}`, metadata, 1),
      exhausted: reconciliationStart(`Reconcile${id}Exhausted`, metadata, 3),
    });
    const {
      rejected: reconcileInventoryRelease,
      exhausted: reconcileInventoryReleaseExhausted,
    } = reconciliationPair("InventoryRelease", {
      failedInvariant: "RESERVED_INVENTORY_MUST_BE_RELEASED",
      requiredAction: "COMPENSATE_INVENTORY",
    });
    const {
      rejected: reconcilePaymentCancellation,
      exhausted: reconcilePaymentCancellationExhausted,
    } = reconciliationPair("PaymentCancellation", {
      failedInvariant: "PAYMENT_AUTHORIZATION_MUST_BE_CANCELLED",
      requiredAction: "COMPENSATE_PAYMENT_AUTHORIZATION",
    });
    const {
      rejected: reconcileFulfillmentCancellation,
      exhausted: reconcileFulfillmentCancellationExhausted,
    } = reconciliationPair("FulfillmentCancellation", {
      failedInvariant: "RESERVED_FULFILLMENT_MUST_BE_CANCELLED",
      requiredAction: "COMPENSATE_RESERVED_FULFILLMENT",
    });
    const {
      rejected: reconcileCapturedFulfillmentCancellation,
      exhausted: reconcileCapturedFulfillmentCancellationExhausted,
    } = reconciliationPair("CapturedFulfillmentCancellation", {
      failedInvariant: "RESERVED_FULFILLMENT_MUST_BE_CANCELLED",
      requiredAction: "COMPENSATE_CAPTURED_PAYMENT",
    });
    const {
      rejected: reconcilePaymentRefund,
      exhausted: reconcilePaymentRefundExhausted,
    } = reconciliationPair("PaymentRefund", {
      failedInvariant: "CAPTURED_PAYMENT_MUST_BE_REFUNDED",
      requiredAction: "COMPENSATE_CAPTURED_PAYMENT",
    });
    const {
      rejected: reconcileFulfillmentHandoff,
      exhausted: reconcileFulfillmentHandoffExhausted,
    } = reconciliationPair("FulfillmentHandoff", {
      failedInvariant: "FULFILLMENT_HANDOFF_MUST_BE_CONFIRMED",
      requiredAction: "RECOVER_FULFILLMENT_HANDOFF",
    });
    const {
      rejected: reconcileOrderConfirmation,
      exhausted: reconcileOrderConfirmationExhausted,
    } = reconciliationPair("OrderConfirmation", {
      failedInvariant: "HANDED_OFF_FULFILLMENT_MUST_CONFIRM_ORDER",
      requiredAction: "CONFIRM_ORDER",
    });
    for (const reconciliation of [
      reconcileInventoryRelease,
      reconcilePaymentCancellation,
      reconcileFulfillmentCancellation,
      reconcileCapturedFulfillmentCancellation,
      reconcilePaymentRefund,
      reconcileFulfillmentHandoff,
      reconcileOrderConfirmation,
      reconcileInventoryReleaseExhausted,
      reconcilePaymentCancellationExhausted,
      reconcileFulfillmentCancellationExhausted,
      reconcileCapturedFulfillmentCancellationExhausted,
      reconcilePaymentRefundExhausted,
      reconcileFulfillmentHandoffExhausted,
      reconcileOrderConfirmationExhausted,
    ]) {
      reconciliation.next(markOrderReconciliationRequired);
    }
    const beginInventoryCompensation = new Pass(this, "BeginInventoryCompensation", {
      result: Result.fromObject({ kind: "INVENTORY_ONLY" }),
      resultPath: "$.compensation",
    });
    const beginPaymentAuthorizationCompensation = new Pass(
      this,
      "BeginPaymentAuthorizationCompensation",
      {
        result: Result.fromObject({ kind: "PAYMENT_AUTHORIZATION" }),
        resultPath: "$.compensation",
      },
    );
    const beginReservedFulfillmentCompensation = new Pass(
      this,
      "BeginReservedFulfillmentCompensation",
      {
        result: Result.fromObject({ kind: "RESERVED_FULFILLMENT" }),
        resultPath: "$.compensation",
      },
    );
    const beginCapturedPaymentCompensation = new Pass(
      this,
      "BeginCapturedPaymentCompensation",
      {
        result: Result.fromObject({ kind: "CAPTURED_PAYMENT" }),
        resultPath: "$.compensation",
      },
    );
    for (const compensationStart of [
      beginInventoryCompensation,
      beginPaymentAuthorizationCompensation,
      beginReservedFulfillmentCompensation,
      beginCapturedPaymentCompensation,
    ]) {
      compensationStart.next(markOrderCompensating);
    }
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
    const checkoutCancelled = new Succeed(this, "CheckoutCancelled");
    const checkoutConfirmed = new Succeed(this, "CheckoutConfirmed");
    const checkoutReconciliationRequired = new Succeed(
      this,
      "CheckoutReconciliationRequired",
    );
    const checkoutReconciliationResolved = new Succeed(this, "CheckoutReconciliationResolved");
    markOrderReconciliationRequired.next(
      new Choice(this, "OrderReconciliationRequiredOutcome")
        .when(
          Condition.stringEquals("$.order.status", "RECONCILIATION_REQUIRED"),
          createReconciliation,
        )
        .otherwise(new Fail(this, "OrderReconciliationRequiredRejected", {
          cause: "Order did not expose unresolved reconciliation work.",
          error: "OrderInvariantViolation",
        })),
    );
    createReconciliation.next(new Choice(this, "ReconciliationCreationOutcome")
      .when(
        Condition.stringEquals(
          "$.reconciliationResult.status",
          "RECONCILIATION_REQUIRED",
        ),
        checkoutReconciliationRequired,
      )
      .otherwise(new Fail(this, "ReconciliationCreationRejected", {
        cause: "Reconciliation work was not durably created.",
        error: "ReconciliationInvariantViolation",
      })));
    resolveReconciliation.next(new Choice(this, "ReconciliationResolutionOutcome")
      .when(
        Condition.stringEquals("$.reconciliationResult.status", "RESOLVED"),
        checkoutReconciliationResolved,
      )
      .otherwise(new Fail(this, "ReconciliationResolutionRejected", {
        cause: "Reconciliation work was not durably resolved.",
        error: "ReconciliationInvariantViolation",
      })));
    const finishCancelledCheckout = new Choice(this, "FinishCancelledCheckout")
      .when(Condition.isPresent("$.reconciliationReplay"), resolveReconciliation)
      .otherwise(checkoutCancelled);
    const finishConfirmedCheckout = new Choice(this, "FinishConfirmedCheckout")
      .when(Condition.isPresent("$.reconciliationReplay"), resolveReconciliation)
      .otherwise(checkoutConfirmed);
    const compensationPlan = new Choice(this, "CompensationPlan")
      .when(
        Condition.stringEquals("$.compensation.kind", "INVENTORY_ONLY"),
        releaseCompensatingInventory,
      )
      .when(
        Condition.stringEquals("$.compensation.kind", "PAYMENT_AUTHORIZATION"),
        cancelPaymentAuthorization,
      )
      .when(
        Condition.stringEquals("$.compensation.kind", "RESERVED_FULFILLMENT"),
        cancelFulfillmentReservation,
      )
      .when(
        Condition.stringEquals("$.compensation.kind", "CAPTURED_PAYMENT"),
        refundCapturedPayment,
      )
      .otherwise(new Fail(this, "CompensationPlanRejected", {
        cause: "The Saga selected an unsupported compensation plan.",
        error: "SagaInvariantViolation",
      }));
    markOrderCompensating.next(new Choice(this, "OrderCompensatingOutcome")
      .when(Condition.stringEquals("$.order.status", "COMPENSATING"), compensationPlan)
      .otherwise(new Fail(this, "OrderCompensatingRejected", {
        cause: "Order did not confirm that compensation is in progress.",
        error: "OrderInvariantViolation",
      })));
    markOrderCancelled.next(new Choice(this, "OrderCancellationOutcome")
      .when(Condition.stringEquals("$.order.status", "CANCELLED"), finishCancelledCheckout)
      .otherwise(new Fail(this, "OrderCancellationRejected", {
        cause: "Order returned an unsupported cancellation outcome.",
        error: "OrderInvariantViolation",
      })));
    const compensatingInventoryReleaseOutcome = new Choice(
      this,
      "CompensatingInventoryReleaseOutcome",
    )
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
      .otherwise(reconcileInventoryRelease);
    for (const task of [releaseCompensatingInventory, replayReleaseCompensatingInventory]) {
      task.next(compensatingInventoryReleaseOutcome);
      task.addCatch(reconcileInventoryReleaseExhausted, {
        errors: internalCommandTransientErrors,
        resultPath: "$.inventoryCompensationError",
      });
    }
    const paymentCancellationOutcome = new Choice(this, "PaymentCancellationOutcome")
      .when(
        Condition.stringEquals("$.paymentCancellation.status", "CANCELLED"),
        releaseCompensatingInventory,
      )
      .otherwise(reconcilePaymentCancellation);
    for (const task of [cancelPaymentAuthorization, replayCancelPaymentAuthorization]) {
      task.next(paymentCancellationOutcome);
      task.addCatch(reconcilePaymentCancellationExhausted, {
        errors: paymentCommandTransientErrors,
        resultPath: "$.paymentCancellationError",
      });
    }
    const paymentRefundOutcome = new Choice(this, "PaymentRefundOutcome")
      .when(
        Condition.stringEquals("$.paymentRefund.status", "REFUNDED"),
        cancelFulfillmentReservation,
      )
      .otherwise(reconcilePaymentRefund);
    for (const task of [refundCapturedPayment, replayRefundCapturedPayment]) {
      task.next(paymentRefundOutcome);
      task.addCatch(reconcilePaymentRefundExhausted, {
        errors: paymentCommandTransientErrors,
        resultPath: "$.paymentRefundError",
      });
    }
    const reconcileFulfillmentCancellationPlan = new Choice(
      this,
      "ReconcileFulfillmentCancellationPlan",
    )
      .when(
        Condition.stringEquals("$.compensation.kind", "CAPTURED_PAYMENT"),
        reconcileCapturedFulfillmentCancellation,
      )
      .otherwise(reconcileFulfillmentCancellation);
    const reconcileFulfillmentCancellationExhaustedPlan = new Choice(
      this,
      "ReconcileFulfillmentCancellationExhaustedPlan",
    )
      .when(
        Condition.stringEquals("$.compensation.kind", "CAPTURED_PAYMENT"),
        reconcileCapturedFulfillmentCancellationExhausted,
      )
      .otherwise(reconcileFulfillmentCancellationExhausted);
    const fulfillmentCancellationOutcome = new Choice(this, "FulfillmentCancellationOutcome")
      .when(
        Condition.and(
          Condition.stringEquals("$.fulfillmentCancellation.status", "CANCELLED"),
          Condition.stringEquals("$.compensation.kind", "CAPTURED_PAYMENT"),
        ),
        releaseCompensatingInventory,
      )
      .when(
        Condition.stringEquals("$.fulfillmentCancellation.status", "CANCELLED"),
        cancelPaymentAuthorization,
      )
      .when(
        Condition.and(
          Condition.stringEquals(
            "$.fulfillmentCancellation.status",
            "RESERVATION_NOT_ACTIVE",
          ),
          Condition.stringEquals(
            "$.fulfillmentCancellation.reservationStatus",
            "HANDED_OFF",
          ),
        ),
        reconcileFulfillmentHandoff,
      )
      .otherwise(reconcileFulfillmentCancellationPlan);
    for (const task of [cancelFulfillmentReservation, replayCancelFulfillmentReservation]) {
      task.next(fulfillmentCancellationOutcome);
      task.addCatch(reconcileFulfillmentCancellationExhaustedPlan, {
        errors: internalCommandTransientErrors,
        resultPath: "$.fulfillmentCancellationError",
      });
    }
    markOrderConfirmed.next(new Choice(this, "OrderConfirmationOutcome")
      .when(Condition.stringEquals("$.order.status", "CONFIRMED"), finishConfirmedCheckout)
      .otherwise(reconcileOrderConfirmation));
    handoffFulfillment.next(new Choice(this, "FulfillmentHandoffOutcome")
      .when(
        Condition.stringEquals("$.fulfillmentHandoff.status", "HANDED_OFF"),
        markOrderConfirmed,
      )
      .otherwise(retrieveFulfillmentAfterHandoffFailure));
    handoffFulfillment.addCatch(retrieveFulfillmentAfterHandoffFailure, {
      errors: ["States.ALL"],
      resultPath: "$.fulfillmentHandoffError",
    });
    retrieveFulfillmentAfterHandoffFailure.next(
      new Choice(this, "FulfillmentHandoffReconciliationOutcome")
        .when(
          Condition.stringEquals("$.fulfillmentHandoffReconciliation.status", "HANDED_OFF"),
          markOrderConfirmed,
        )
        .otherwise(reconcileFulfillmentHandoff),
    );
    retrieveFulfillmentAfterHandoffFailure.addCatch(reconcileFulfillmentHandoffExhausted, {
      errors: ["States.ALL"],
      resultPath: "$.fulfillmentHandoffReconciliationError",
    });
    markOrderConfirmed.addCatch(reconcileOrderConfirmationExhausted, {
      errors: ["States.ALL"],
      resultPath: "$.orderConfirmationError",
    });
    markOrderInventoryUnavailable.next(new Choice(this, "OrderInventoryOutcome")
      .when(
        Condition.stringEquals("$.order.status", "INVENTORY_UNAVAILABLE"),
        inventoryUnavailable,
      )
      .otherwise(new Fail(this, "OrderInventoryOutcomeRejected", {
        cause: "Order returned an unsupported Inventory-unavailable outcome.",
        error: "OrderInvariantViolation",
      })));
    commitInventory.next(new Choice(this, "InventoryCommitOutcome")
      .when(Condition.stringEquals("$.inventoryCommit.status", "COMMITTED"), handoffFulfillment)
      .when(Condition.and(
        Condition.stringEquals("$.inventoryCommit.status", "RESERVATION_NOT_ACTIVE"),
        Condition.stringEquals("$.inventoryCommit.reservationStatus", "COMMITTED"),
      ), handoffFulfillment)
      .otherwise(beginCapturedPaymentCompensation));
    const reservationDeadlineReached = new Choice(this, "ReservationDeadlineReached")
      .when(
        Condition.timestampLessThanEqualsJsonPath(
          "$.reservationExpiresAt",
          "$$.State.EnteredTime",
        ),
        beginCapturedPaymentCompensation,
      )
      .otherwise(commitInventory);
    commitInventory.addCatch(beginCapturedPaymentCompensation, {
      errors: internalCommandTransientErrors,
      resultPath: "$.inventoryCommitError",
    });
    const waitUntilInventoryCommit = new Wait(this, "WaitUntilInventoryCommit", {
      time: WaitTime.timestampPath("$.inventoryCommitAt"),
    });
    // inventoryCommitAt is a deployed-test hook: it deliberately lets the domain
    // reject an expired commit so the post-capture compensation path is exercised.
    waitUntilInventoryCommit.next(commitInventory);
    const inventoryCommitTiming = new Choice(this, "InventoryCommitTiming")
      .when(Condition.isPresent("$.inventoryCommitAt"), waitUntilInventoryCommit)
      .otherwise(reservationDeadlineReached);
    capturePayment.next(new Choice(this, "PaymentCaptureOutcome")
      .when(Condition.stringEquals("$.paymentCapture.status", "CAPTURED"), inventoryCommitTiming)
      .otherwise(retrievePaymentAfterCaptureFailure));
    capturePayment.addCatch(retrievePaymentAfterCaptureFailure, {
      errors: paymentCommandTransientErrors,
      resultPath: "$.paymentCaptureError",
    });
    retrievePaymentAfterCaptureFailure.next(
      new Choice(this, "PaymentCaptureReconciliationOutcome")
        .when(
          Condition.stringEquals("$.paymentCaptureReconciliation.status", "CAPTURED"),
          beginCapturedPaymentCompensation,
        )
        .when(
          Condition.stringEquals("$.paymentCaptureReconciliation.status", "AUTHORIZED"),
          beginReservedFulfillmentCompensation,
        )
        .when(
          Condition.stringEquals("$.paymentCaptureReconciliation.status", "CANCELLED"),
          beginReservedFulfillmentCompensation,
        )
        .when(
          Condition.stringEquals("$.paymentCaptureReconciliation.status", "REFUNDED"),
          beginCapturedPaymentCompensation,
        )
        .otherwise(new Fail(this, "PaymentCaptureReconciliationRejected", {
          cause: "Payment capture could not be reconciled to a safe compensating action.",
          error: "PaymentCaptureFailure",
        })),
    );
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
        beginPaymentAuthorizationCompensation,
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
        beginInventoryCompensation,
      )
      .otherwise(new Fail(this, "PaymentAuthorizationRejected", {
        cause: "Payment returned an unsupported authorization outcome.",
        error: "PaymentAuthorizationFailure",
      })));
    authorizePayment.addCatch(beginInventoryCompensation, {
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
    const reconciliationReplayTargets: Record<ReconciliationWorkflowStep, IChainable> = {
      RELEASE_INVENTORY: replayReleaseCompensatingInventory,
      CANCEL_PAYMENT_AUTHORIZATION: replayCancelPaymentAuthorization,
      CANCEL_FULFILLMENT_RESERVATION: replayCancelFulfillmentReservation,
      REFUND_CAPTURED_PAYMENT: replayRefundCapturedPayment,
      HANDOFF_FULFILLMENT: handoffFulfillment,
      CONFIRM_ORDER: markOrderConfirmed,
    };
    const reconciliationReplayRoute = new Choice(this, "ReconciliationReplayRoute");
    for (const requiredAction of Object.keys(
      reconciliationRecoveryPlan,
    ) as ReconciliationRequiredAction[]) {
      reconciliationReplayRoute.when(
        Condition.stringEquals("$.reconciliationReplay.requiredAction", requiredAction),
        reconciliationReplayTargets[
          reconciliationRecoveryPlan[requiredAction].workflowStep
        ],
      );
    }
    reconciliationReplayRoute.otherwise(new Fail(this, "ReconciliationReplayRejected", {
        cause: "Reconciliation requested an unsupported recovery action.",
        error: "ReconciliationInvariantViolation",
      }));
    const workflowDefinition = new Choice(this, "WorkflowEntry")
      .when(Condition.isPresent("$.reconciliationReplay"), reconciliationReplayRoute)
      .otherwise(createPendingOrder.next(reserveInventory));
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
    stateMachine.addToRolePolicy(
      new PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: [`${reconciliationFunction.functionArn}:*`],
      }),
    );
    reconciliationReplay.addToRolePolicy(new PolicyStatement({
      actions: ["states:StartExecution"],
      resources: [stateMachine.stateMachineArn, `${stateMachine.stateMachineArn}:*`],
    }));

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
      new GraphWidget({
        title: "Actionable reconciliation work",
        left: [reconciliationRequiredMetric.metric()],
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
    new CfnOutput(this, "SagaTableName", { value: sagaTable.tableName });
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
    new CfnOutput(this, "FulfillmentOutboxTableName", {
      value: fulfillmentOutboxTable.tableName,
    });
    new CfnOutput(this, "FulfillmentEventSource", { value: fulfillmentEventSource });
    new CfnOutput(this, "FulfillmentCommandFunctionName", {
      value: fulfillmentFunction.functionName,
    });
    new CfnOutput(this, "FulfillmentQueueUrl", { value: fulfillmentQueue.queueUrl });
    new CfnOutput(this, "FulfillmentWorkerFunctionName", {
      value: fulfillmentWorker.functionName,
    });
    new CfnOutput(this, "ReconciliationTableName", { value: reconciliationTable.tableName });
    new CfnOutput(this, "ReconciliationOutboxTableName", {
      value: reconciliationOutboxTable.tableName,
    });
    new CfnOutput(this, "ReconciliationEventSource", { value: reconciliationEventSource });
    new CfnOutput(this, "ReconciliationReplayFunctionName", {
      value: reconciliationReplay.functionName,
    });
    new CfnOutput(this, "ReconciliationRequiredAlarmName", {
      value: reconciliationRequiredAlarm.alarmName,
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
      errors: internalCommandTransientErrors,
      interval: Duration.seconds(1),
      maxAttempts: 2,
      backoffRate: 2,
      jitterStrategy: JitterType.FULL,
    });
  }

  private addPaymentCommandRetry(
    task: LambdaInvoke,
    options: { readonly retryResponseLoss?: boolean } = {},
  ): void {
    const errors = options.retryResponseLoss === false
      ? paymentCommandTransientErrors.filter(
          (error) => error !== "PaymentProviderResponseLostError",
        )
      : paymentCommandTransientErrors;
    task.addRetry({
      errors,
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
