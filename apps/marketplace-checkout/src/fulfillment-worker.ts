import {
  SendTaskFailureCommand,
  SendTaskHeartbeatCommand,
  SendTaskSuccessCommand,
} from "@aws-sdk/client-sfn";
import {
  validateFulfillmentCommandOutcome,
  validateHandoffFulfillmentCommand,
  type FulfillmentCommandOutcome,
  type HandoffFulfillmentCommand,
} from "@aws-architecture-lab/contracts";
import type { SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";

export interface FulfillmentHandoffExecutor {
  execute(command: HandoffFulfillmentCommand): Promise<FulfillmentCommandOutcome>;
}

type CallbackCommand =
  | SendTaskHeartbeatCommand
  | SendTaskSuccessCommand
  | SendTaskFailureCommand;

export interface FulfillmentCallbackClient {
  send(command: CallbackCommand): Promise<unknown>;
}

export function createFulfillmentWorker(
  fulfillment: FulfillmentHandoffExecutor,
  callbacks: FulfillmentCallbackClient,
) {
  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const results = await Promise.all(event.Records.map(async (record) => ({
      messageId: record.messageId,
      completed: await processRecord(record, fulfillment, callbacks),
    })));
    return {
      batchItemFailures: results
        .filter(({ completed }) => !completed)
        .map(({ messageId }) => ({ itemIdentifier: messageId })),
    };
  };
}

async function processRecord(
  record: SQSRecord,
  fulfillment: FulfillmentHandoffExecutor,
  callbacks: FulfillmentCallbackClient,
): Promise<boolean> {
  let envelope: CallbackEnvelope;
  try {
    envelope = callbackEnvelope(record.body);
  } catch {
    return false;
  }

  try {
    await callbacks.send(new SendTaskHeartbeatCommand({ taskToken: envelope.taskToken }));
    const result = await fulfillment.execute(envelope.command);
    const validation = validateFulfillmentCommandOutcome(result);
    if (
      !validation.ok ||
      (
        validation.value.status !== "HANDED_OFF" &&
        validation.value.reservationStatus !== "HANDED_OFF"
      )
    ) {
      await callbacks.send(new SendTaskFailureCommand({
        taskToken: envelope.taskToken,
        error: "FulfillmentInvariantViolation",
        cause: "Fulfillment handoff did not reach its irreversible committed state.",
      }));
      return true;
    }
    await callbacks.send(new SendTaskSuccessCommand({
      taskToken: envelope.taskToken,
      output: JSON.stringify(validation.value),
    }));
    return true;
  } catch (error) {
    return terminalCallbackError(error);
  }
}

interface CallbackEnvelope {
  readonly taskToken: string;
  readonly command: HandoffFulfillmentCommand;
}

function callbackEnvelope(body: string): CallbackEnvelope {
  let input: unknown;
  try {
    input = JSON.parse(body);
  } catch {
    throw new Error("Fulfillment message body is not valid JSON");
  }
  if (
    typeof input !== "object" ||
    input === null ||
    typeof (input as Record<string, unknown>).taskToken !== "string" ||
    (input as Record<string, unknown>).taskToken === ""
  ) {
    throw new Error("Fulfillment message body is incomplete");
  }
  const validation = validateHandoffFulfillmentCommand(
    (input as Record<string, unknown>).command,
  );
  if (!validation.ok) throw new Error(validation.error);
  return {
    taskToken: (input as Record<string, unknown>).taskToken as string,
    command: validation.value,
  };
}

function terminalCallbackError(error: unknown): boolean {
  return error instanceof Error &&
    (error.name === "TaskTimedOut" || error.name === "TaskDoesNotExist");
}
