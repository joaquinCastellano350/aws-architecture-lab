import {
  DescribeExecutionCommand,
  ExecutionAlreadyExists,
  SFNClient,
  StartExecutionCommand,
} from "@aws-sdk/client-sfn";

import type { WorkflowExecution, WorkflowInput, WorkflowStarter } from "./checkout-api.js";

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

function executionArnFor(aliasArn: string, checkoutId: string): string {
  const marker = ":stateMachine:";
  const markerIndex = aliasArn.indexOf(marker);
  const resource = aliasArn.slice(markerIndex + marker.length);
  const stateMachineName = resource.split(":")[0];
  if (markerIndex < 0 || stateMachineName === undefined || stateMachineName.length === 0) {
    throw new Error("WORKFLOW_ALIAS_ARN is not a Step Functions alias ARN");
  }
  return `${aliasArn.slice(0, markerIndex)}:execution:${stateMachineName}:${checkoutId}`;
}
