import {
  GetCommand,
  PutCommand,
  TransactWriteCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";
import { describe, expect, it } from "vitest";

import type { PaymentCommand } from "@aws-architecture-lab/contracts";

import { DynamoDeterministicPaymentProvider } from "./dynamo-deterministic-payment-provider.js";
import { DynamoPaymentLedger } from "./dynamo-payment-ledger.js";
import { PaymentCommandService } from "./payment-command-service.js";
import {
  PaymentProviderResponseLostError,
  PaymentProviderTransientError,
} from "./payment-provider.js";

describe("durable Payment replay", () => {
  it("persists one capture result and fact across fresh adapter instances", async () => {
    const dynamo = new PaymentDynamoHarness();
    const first = service(dynamo);
    await first.execute(authorizeCommand());
    const captured = await first.execute(captureCommand());

    const afterColdStart = service(dynamo);
    const replay = await afterColdStart.execute(captureCommand());

    expect(replay).toEqual(captured);
    expect(dynamo.item("payments", "OPERATION#capture-checkout-123")).toEqual(
      expect.objectContaining({
        semanticKey: "payment:payment-123:capture",
        state: "SUCCEEDED",
        result: captured,
        providerReference: "fake-payment-payment-123",
        createdAt: "2026-09-10T12:00:00.000Z",
        updatedAt: "2026-09-10T12:00:00.000Z",
      }),
    );
    expect(dynamo.items("payment-outbox")).toHaveLength(2);
    expect(dynamo.items("fake-provider").filter(({ recordKey, recordType }) =>
      recordType === "PROVIDER_OPERATION" &&
      (recordKey as string).includes(":capture")
    )).toHaveLength(1);
  });

  it("preserves a transient transaction cancellation when no replay committed", async () => {
    const cancellation = new Error("throughput conflict");
    cancellation.name = "TransactionCanceledException";
    const client = {
      async send(command: unknown) {
        if (command instanceof GetCommand) return {};
        if (command instanceof UpdateCommand) {
          const missingPlan = new Error("Failure plan not found");
          missingPlan.name = "ConditionalCheckFailedException";
          throw missingPlan;
        }
        if (command instanceof TransactWriteCommand) throw cancellation;
        throw new Error("Unexpected command");
      },
    } as unknown as DynamoDBDocumentClient;
    const provider = new DynamoDeterministicPaymentProvider("fake-provider", { client });

    await expect(provider.authorize({
      operationKey: "payment:payment-transient:authorize",
      paymentId: "payment-transient",
      amountMinor: 1250,
      currency: "USD",
    })).rejects.toBe(cancellation);
  });

  it("consumes a durable commit-then-lost-response plan and replays one capture", async () => {
    const dynamo = new PaymentDynamoHarness();
    const payment = service(dynamo);
    await payment.execute(authorizeCommand());
    dynamo.put("failure-plans", {
      recordKey: "FAILURE_PLAN#payment:payment-123:capture",
      recordType: "FAILURE_PLAN",
      effects: ["AMBIGUOUS_COMPLETION"],
      attemptCount: 0,
    });

    await expect(payment.execute(captureCommand())).rejects.toBeInstanceOf(
      PaymentProviderResponseLostError,
    );
    await expect(service(dynamo).execute(captureCommand())).resolves.toEqual(
      expect.objectContaining({ status: "CAPTURED" }),
    );
    expect(dynamo.items("fake-provider").filter(({ recordKey, recordType }) =>
      recordType === "PROVIDER_OPERATION" &&
      (recordKey as string).includes(":capture")
    )).toHaveLength(1);
  });

  it("durably consumes fail-before-mutation and duplicate-delivery plans", async () => {
    const dynamo = new PaymentDynamoHarness();
    dynamo.put("failure-plans", {
      recordKey: "FAILURE_PLAN#payment:payment-123:authorize",
      recordType: "FAILURE_PLAN",
      effects: ["FAIL_BEFORE_MUTATION", "DUPLICATE_DELIVERY"],
    });
    const payment = service(dynamo);

    await expect(payment.execute(authorizeCommand())).rejects.toBeInstanceOf(
      PaymentProviderTransientError,
    );
    await expect(service(dynamo).execute(authorizeCommand())).resolves.toEqual(
      expect.objectContaining({ status: "AUTHORIZED" }),
    );

    expect(dynamo.items("fake-provider").filter(({ recordType }) =>
      recordType === "PROVIDER_OPERATION"
    )).toHaveLength(1);
    expect(dynamo.item(
      "fake-provider",
      "FAILURE_ATTEMPT#payment:payment-123:authorize",
    )?.attemptCount).toBe(2);
  });
});

function service(dynamo: PaymentDynamoHarness): PaymentCommandService {
  const client = dynamo as unknown as DynamoDBDocumentClient;
  return new PaymentCommandService({
    ledger: new DynamoPaymentLedger("payments", "payment-outbox", { client }),
    provider: new DynamoDeterministicPaymentProvider("fake-provider", {
      client,
      failurePlanTableName: "failure-plans",
    }),
    clock: () => new Date("2026-09-10T12:00:00.000Z"),
    eventId: (() => {
      let sequence = dynamo.items("payment-outbox").length;
      return () => `event-${++sequence}`;
    })(),
  });
}

function authorizeCommand(): PaymentCommand {
  return {
    schemaVersion: "1.0",
    commandType: "AuthorizePayment",
    operationId: "authorize-checkout-123",
    checkoutId: "checkout-123",
    paymentId: "payment-123",
    amountMinor: 1250,
    currency: "USD",
    correlationId: "correlation-123",
    causationId: "execution-123",
  };
}

function captureCommand(): PaymentCommand {
  return {
    schemaVersion: "1.0",
    commandType: "CapturePayment",
    operationId: "capture-checkout-123",
    checkoutId: "checkout-123",
    paymentId: "payment-123",
    correlationId: "correlation-123",
    causationId: "execution-123",
  };
}

class PaymentDynamoHarness {
  readonly #tables = new Map<string, Map<string, Record<string, unknown>>>();

  public item(tableName: string, key: string): Record<string, unknown> | undefined {
    return this.#table(tableName).get(key);
  }

  public items(tableName: string): Array<Record<string, unknown>> {
    return [...this.#table(tableName).values()];
  }

  public put(tableName: string, item: Record<string, unknown>): void {
    this.#put(tableName, item);
  }

  public async send(command: unknown): Promise<Record<string, unknown>> {
    if (command instanceof GetCommand) {
      const key = command.input.Key?.recordKey as string | undefined;
      return { Item: key === undefined ? undefined : this.item(command.input.TableName!, key) };
    }
    if (command instanceof PutCommand) {
      this.#put(command.input.TableName!, command.input.Item as Record<string, unknown>);
      return {};
    }
    if (command instanceof UpdateCommand) {
      const key = command.input.Key?.recordKey as string;
      const current = this.item(command.input.TableName!, key);
      const values = command.input.ExpressionAttributeValues ?? {};
      if (current === undefined) {
        this.#table(command.input.TableName!).set(key, {
          recordKey: key,
          recordType: values[":recordType"],
          operationKey: values[":operationKey"],
          attemptCount: 1,
        });
        return {};
      }
      const previous = structuredClone(current);
      this.#table(command.input.TableName!).set(key, {
        ...current,
        attemptCount: Number(current.attemptCount ?? 0) + 1,
      });
      return { Attributes: previous };
    }
    if (command instanceof TransactWriteCommand) {
      for (const action of command.input.TransactItems ?? []) {
        if (action.Put !== undefined) {
          this.#put(action.Put.TableName!, action.Put.Item as Record<string, unknown>);
        }
        if (action.Update !== undefined) this.#update(action.Update as UpdateAction);
      }
      return {};
    }
    throw new Error(`Unsupported Dynamo command ${String(command)}`);
  }

  #put(tableName: string, item: Record<string, unknown>): void {
    const key = (item.recordKey ?? item.eventId) as string;
    this.#table(tableName).set(key, structuredClone(item));
  }

  #update(update: UpdateAction): void {
    const table = this.#table(update.TableName);
    const key = update.Key.recordKey;
    const values = update.ExpressionAttributeValues;
    const current = table.get(key) ?? { recordKey: key };
    if (update.UpdateExpression.includes("activeOperationId = :operationId")) {
      table.set(key, {
        ...current,
        recordType: current.recordType ?? values[":recordType"],
        paymentId: current.paymentId ?? values[":paymentId"],
        checkoutId: current.checkoutId ?? values[":checkoutId"],
        activeOperationId: values[":operationId"],
        updatedAt: values[":updatedAt"],
      });
      return;
    }
    if (update.UpdateExpression.includes("#result = :result")) {
      table.set(key, {
        ...current,
        state: values[":state"],
        result: values[":result"],
        providerReference: values[":providerReference"],
        updatedAt: values[":updatedAt"],
      });
      return;
    }
    if (update.UpdateExpression.includes("REMOVE activeOperationId")) {
      const next = {
        ...current,
        ...(values[":status"] === undefined ? {} : { status: values[":status"] }),
        ...(values[":providerReference"] === undefined
          ? {}
          : { providerReference: values[":providerReference"] }),
        updatedAt: values[":updatedAt"],
      };
      delete next.activeOperationId;
      table.set(key, next);
      return;
    }
    if (update.UpdateExpression === "SET #status = :targetStatus") {
      table.set(key, { ...current, status: values[":targetStatus"] });
      return;
    }
    throw new Error(`Unsupported update ${update.UpdateExpression}`);
  }

  #table(name: string): Map<string, Record<string, unknown>> {
    const existing = this.#tables.get(name);
    if (existing !== undefined) return existing;
    const created = new Map<string, Record<string, unknown>>();
    this.#tables.set(name, created);
    return created;
  }
}

interface UpdateAction {
  readonly TableName: string;
  readonly Key: { readonly recordKey: string };
  readonly UpdateExpression: string;
  readonly ExpressionAttributeValues: Readonly<Record<string, unknown>>;
}
