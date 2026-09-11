import {
  SendTaskHeartbeatCommand,
  SendTaskSuccessCommand,
} from "@aws-sdk/client-sfn";
import type { SQSEvent } from "aws-lambda";
import { describe, expect, it } from "vitest";

import { createFulfillmentWorker } from "./fulfillment-worker.js";

describe("Fulfillment callback worker", () => {
  it("commits the irreversible handoff before completing the callback", async () => {
    const sequence: string[] = [];
    const worker = createFulfillmentWorker(
      {
        async execute(command) {
          sequence.push(`commit:${command.operationId}`);
          return outcome(command.operationId);
        },
      },
      {
        async send(command) {
          sequence.push(command instanceof SendTaskHeartbeatCommand ? "heartbeat" : "success");
          if (command instanceof SendTaskSuccessCommand) {
            expect(JSON.parse(command.input.output ?? "null")).toEqual(
              outcome("handoff-checkout-123"),
            );
          }
          return {};
        },
      },
    );

    await expect(worker(event(record("message-1", "task-token")))).resolves.toEqual({
      batchItemFailures: [],
    });
    expect(sequence).toEqual(["heartbeat", "commit:handoff-checkout-123", "success"]);
  });

  it("treats a late duplicate TaskTimedOut callback as terminal", async () => {
    let deliveries = 0;
    let callbacks = 0;
    const worker = createFulfillmentWorker(
      {
        async execute(command) {
          deliveries += 1;
          return outcome(command.operationId);
        },
      },
      {
        async send(command) {
          if (command instanceof SendTaskSuccessCommand && ++callbacks === 2) {
            const error = new Error("expired callback");
            error.name = "TaskTimedOut";
            throw error;
          }
          return {};
        },
      },
    );

    await expect(worker(event(
      record("message-first", "same-task-token"),
      record("message-duplicate", "same-task-token"),
    ))).resolves.toEqual({ batchItemFailures: [] });
    expect(deliveries).toBe(2);
  });

  it("returns only retryable records as partial batch failures", async () => {
    const worker = createFulfillmentWorker(
      { async execute(command) { return outcome(command.operationId); } },
      {
        async send(command) {
          if (
            command instanceof SendTaskSuccessCommand &&
            command.input.taskToken === "retry-token"
          ) {
            throw new Error("temporary callback outage");
          }
          return {};
        },
      },
    );

    await expect(worker(event(
      record("message-ok", "ok-token"),
      record("message-retry", "retry-token"),
    ))).resolves.toEqual({
      batchItemFailures: [{ itemIdentifier: "message-retry" }],
    });
  });
});

function record(messageId: string, taskToken: string) {
  return {
    messageId,
    body: JSON.stringify({
      taskToken,
      command: {
        schemaVersion: "1.0",
        commandType: "HandoffFulfillment",
        operationId: "handoff-checkout-123",
        checkoutId: "checkout-123",
        reservationId: "fulfillment-checkout-123",
        correlationId: "corr-123",
        causationId: "execution-123",
      },
    }),
  };
}

function event(...records: ReturnType<typeof record>[]): SQSEvent {
  return { Records: records as SQSEvent["Records"] };
}

function outcome(operationId: string) {
  return {
    schemaVersion: "1.0" as const,
    operationId,
    checkoutId: "checkout-123",
    reservationId: "fulfillment-checkout-123",
    status: "HANDED_OFF" as const,
  };
}
