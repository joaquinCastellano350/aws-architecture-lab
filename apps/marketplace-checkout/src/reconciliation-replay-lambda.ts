import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import type { Handler } from "aws-lambda";
import {
  validateReconciliationCommandOutcome,
  validateReplayReconciliationCommand,
} from "@aws-architecture-lab/contracts";

import { DynamoReconciliationRepository } from "./dynamo-reconciliation-repository.js";
import {
  ReconciliationReplayService,
  type ReconciliationWorkflowInput,
} from "./reconciliation-replay.js";
import { executionArnFor } from "./step-functions-arn.js";
import { requiredEnvironment } from "./environment.js";

const repository = new DynamoReconciliationRepository(
  requiredEnvironment("RECONCILIATION_TABLE_NAME"),
  requiredEnvironment("SAGA_TABLE_NAME"),
  requiredEnvironment("RECONCILIATION_OUTBOX_TABLE_NAME"),
);
const client = new SFNClient({});
const replay = new ReconciliationReplayService(repository, {
  async start(
    workflowVersionArn: string,
    name: string,
    input: ReconciliationWorkflowInput,
  ) {
    let response;
    try {
      response = await client.send(new StartExecutionCommand({
        stateMachineArn: workflowVersionArn,
        name,
        input: JSON.stringify(input),
      }));
    } catch (error) {
      if (error instanceof Error && error.name === "ExecutionAlreadyExists") {
        return { executionArn: executionArnFor(workflowVersionArn, name) };
      }
      throw error;
    }
    if (response.executionArn === undefined) {
      throw new Error("Step Functions omitted the reconciliation replay execution ARN");
    }
    return { executionArn: response.executionArn };
  },
});

export const handler: Handler = async (event) => {
  const validation = validateReplayReconciliationCommand(event);
  if (!validation.ok) throw new Error(validation.error);
  const result = await replay.execute(validation.value);
  const outcome = validateReconciliationCommandOutcome(result);
  if (!outcome.ok) throw new Error(outcome.error);
  console.info(JSON.stringify({
    event: "ReconciliationReplayStarted",
    reconciliationId: result.reconciliationId,
    checkoutId: result.checkoutId,
    executionArn: result.executionArn,
    attempts: result.attempts,
  }));
  return result;
};
