import {
  DescribeExecutionCommand,
  ExecutionAlreadyExists,
  SFNClient,
  StartExecutionCommand,
} from "@aws-sdk/client-sfn";

import type { WorkflowExecution, WorkflowInput, WorkflowStarter } from "./checkout-api.js";
import { executionArnFor } from "./step-functions-arn.js";

export class StepFunctionsWorkflowStarter implements WorkflowStarter {
  readonly #client = new SFNClient({});
  readonly #aliasArn: string;

  public constructor(aliasArn: string) {
    this.#aliasArn = aliasArn;
  }

  public async start(input: WorkflowInput): Promise<WorkflowExecution> {
    let executionArn: string;
    try {
      const result = await this.#client.send(
        new StartExecutionCommand({
          stateMachineArn: this.#aliasArn,
          name: input.checkoutId,
          input: JSON.stringify(input),
        }),
      );
      if (result.executionArn === undefined) throw new Error("Step Functions omitted executionArn");
      executionArn = result.executionArn;
    } catch (error) {
      if (!(error instanceof ExecutionAlreadyExists)) throw error;
      executionArn = executionArnFor(this.#aliasArn, input.checkoutId);
    }

    const execution = await this.#client.send(new DescribeExecutionCommand({ executionArn }));
    if (execution.stateMachineVersionArn === undefined) {
      throw new Error("Step Functions execution did not identify its selected workflow version");
    }
    return { executionArn, workflowVersionArn: execution.stateMachineVersionArn };
  }
}
