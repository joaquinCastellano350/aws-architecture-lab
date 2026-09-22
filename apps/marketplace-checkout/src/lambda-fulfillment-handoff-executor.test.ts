import { InvokeCommand } from "@aws-sdk/client-lambda";
import { describe, expect, it } from "vitest";

import { LambdaFulfillmentHandoffExecutor } from "./lambda-fulfillment-handoff-executor.js";

describe("Lambda Fulfillment handoff executor", () => {
  it("invokes the versioned domain handler and returns its outcome", async () => {
    const command = handoffCommand();
    const result = outcome();
    const executor = new LambdaFulfillmentHandoffExecutor(
      "arn:aws:lambda:us-east-1:111122223333:function:fulfillment:7",
      {
        async send(request) {
          expect(request).toBeInstanceOf(InvokeCommand);
          expect(request.input.FunctionName).toBe(
            "arn:aws:lambda:us-east-1:111122223333:function:fulfillment:7",
          );
          expect(JSON.parse(new TextDecoder().decode(request.input.Payload))).toEqual(command);
          return {
            StatusCode: 200,
            Payload: new TextEncoder().encode(JSON.stringify(result)),
          };
        },
      },
    );

    await expect(executor.execute(command)).resolves.toEqual(result);
  });

  it("rejects a function error instead of completing the callback", async () => {
    const executor = new LambdaFulfillmentHandoffExecutor("fulfillment:7", {
      async send() {
        return {
          StatusCode: 200,
          FunctionError: "Unhandled",
          Payload: new TextEncoder().encode(JSON.stringify({ errorMessage: "failed" })),
        };
      },
    });

    await expect(executor.execute(handoffCommand())).rejects.toThrow(
      "Fulfillment command invocation failed",
    );
  });
});

function handoffCommand() {
  return {
    schemaVersion: "1.0" as const,
    commandType: "HandoffFulfillment" as const,
    operationId: "handoff-checkout-123",
    checkoutId: "checkout-123",
    reservationId: "fulfillment-checkout-123",
    correlationId: "corr-123",
    causationId: "execution-123",
  };
}

function outcome() {
  return {
    schemaVersion: "1.0" as const,
    operationId: "handoff-checkout-123",
    checkoutId: "checkout-123",
    reservationId: "fulfillment-checkout-123",
    status: "HANDED_OFF" as const,
  };
}
