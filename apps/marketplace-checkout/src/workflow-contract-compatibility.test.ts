import { createRequire } from "node:module";

import { PutCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { EventBridgeEvent } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";

import { createAuditConsumer } from "./audit-consumer.js";
import { createOrderExpiryConsumer } from "./order-expiry-consumer.js";

const fixture = createRequire(import.meta.url)(
  "../../../packages/contracts/fixtures/workflow-v1-events.json",
) as Record<string, unknown>;

describe("v1 event producer compatibility", () => {
  it("is accepted by the current Order audit consumer", async () => {
    const send = vi.fn(async (command: unknown) => {
      expect(command).toBeInstanceOf(PutCommand);
      return {};
    });
    const consume = createAuditConsumer({
      client: { send } as unknown as DynamoDBDocumentClient,
      eventSource: "aws-architecture-lab.order",
      tableName: "order-audit",
    });

    await consume(delivery("aws-architecture-lab.order", fixture.orderPending));

    expect(send).toHaveBeenCalledOnce();
  });

  it("is accepted by the current Inventory-expiry consumer", async () => {
    const markExpired = vi.fn(async () => ({
      schemaVersion: "1.0" as const,
      checkoutId: "checkout-from-workflow-v1",
      correlationId: "correlation-from-workflow-v1",
      status: "EXPIRED" as const,
    }));
    const consume = createOrderExpiryConsumer({
      eventSource: "aws-architecture-lab.inventory",
      markExpired,
    });

    await consume(delivery("aws-architecture-lab.inventory", fixture.inventoryReleased));

    expect(markExpired).toHaveBeenCalledWith(expect.objectContaining({
      checkoutId: "checkout-from-workflow-v1",
      commandType: "MarkOrderExpired",
    }));
  });
});

function delivery(source: string, event: unknown): EventBridgeEvent<string, unknown> {
  if (typeof event !== "object" || event === null) throw new Error("Event fixture is missing");
  const record = event as Record<string, unknown>;
  if (typeof record.eventType !== "string") throw new Error("Event fixture has no eventType");
  const { eventType, ...detail } = record;
  return {
    id: "compatibility-delivery",
    version: "0",
    account: "123456789012",
    time: "2026-09-18T15:00:01.000Z",
    region: "us-east-1",
    resources: [],
    source,
    "detail-type": eventType,
    detail,
  };
}
