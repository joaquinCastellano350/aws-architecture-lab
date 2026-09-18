export interface ExecutionVersionObservation {
  readonly executionArn: string;
  readonly status: "RUNNING" | "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "ABORTED";
  readonly workflowVersionArn: string;
}

export interface CheckoutVersionObservation {
  readonly checkoutId: string;
  readonly workflowVersionArn: string;
}

export interface WorkflowVersionEvidencePort {
  getLiveVersionArn(): Promise<string>;
  startProbe(name: string): Promise<ExecutionVersionObservation>;
  publishEvidenceVersion(marker: string): Promise<string>;
  routeLiveTo(versionArn: string): Promise<void>;
  waitForAliasVersion(versionArn: string): Promise<void>;
  admitCheckout(label: string): Promise<CheckoutVersionObservation>;
  observeCheckout(checkoutId: string): Promise<CheckoutVersionObservation>;
  observeExecution(executionArn: string): Promise<ExecutionVersionObservation>;
  stopExecution(executionArn: string): Promise<void>;
  redriveExecution(executionArn: string): Promise<ExecutionVersionObservation>;
  restoreMutableRevision(): Promise<void>;
}

export interface WorkflowVersionEvidence {
  readonly originalVersionArn: string;
  readonly publishedVersionArn: string;
  readonly activeExecutionArn: string;
  readonly newCheckout: CheckoutVersionObservation;
  readonly rollbackCheckout: CheckoutVersionObservation;
  readonly redrivenExecutionArn: string;
}

export async function exerciseWorkflowVersionEvolution(
  port: WorkflowVersionEvidencePort,
  runId: string,
): Promise<WorkflowVersionEvidence> {
  const originalVersionArn = await port.getLiveVersionArn();
  let activeExecution: ExecutionVersionObservation | undefined;
  let executionStopped = false;

  try {
    activeExecution = await port.startProbe(`probe-${runId}`);
    requireExecution(activeExecution, originalVersionArn, "RUNNING", "initial probe");

    const publishedVersionArn = await port.publishEvidenceVersion(runId);
    if (publishedVersionArn === originalVersionArn) {
      throw new Error("Publishing the evidence revision did not create a new workflow version.");
    }

    await routeLive(port, publishedVersionArn);
    const newCheckout = await port.admitCheckout(`forward-${runId}`);
    requireCheckoutVersion(newCheckout, publishedVersionArn, "forward admission");

    const activeAfterForwardAdmission = await port.observeExecution(activeExecution.executionArn);
    requireExecution(
      activeAfterForwardAdmission,
      originalVersionArn,
      "RUNNING",
      "active execution after forward admission",
    );

    await routeLive(port, originalVersionArn);
    const rollbackCheckout = await port.admitCheckout(`rollback-${runId}`);
    requireCheckoutVersion(rollbackCheckout, originalVersionArn, "rollback admission");

    const forwardCheckoutAfterRollback = await port.observeCheckout(newCheckout.checkoutId);
    requireCheckoutVersion(
      forwardCheckoutAfterRollback,
      publishedVersionArn,
      "checkout admitted before rollback",
    );

    await routeLive(port, publishedVersionArn);
    await port.stopExecution(activeExecution.executionArn);
    executionStopped = true;
    const redrivenExecution = await port.redriveExecution(activeExecution.executionArn);
    executionStopped = redrivenExecution.status !== "RUNNING";
    requireExecution(redrivenExecution, originalVersionArn, "SUCCEEDED", "redriven execution");
    if (redrivenExecution.executionArn !== activeExecution.executionArn) {
      throw new Error("Redrive changed the original execution ARN.");
    }
    return {
      originalVersionArn,
      publishedVersionArn,
      activeExecutionArn: activeExecution.executionArn,
      newCheckout,
      rollbackCheckout,
      redrivenExecutionArn: redrivenExecution.executionArn,
    };
  } finally {
    try {
      if (activeExecution !== undefined && !executionStopped) {
        await port.stopExecution(activeExecution.executionArn);
      }
    } finally {
      try {
        await routeLive(port, originalVersionArn);
      } finally {
        await port.restoreMutableRevision();
      }
    }
  }
}

async function routeLive(port: WorkflowVersionEvidencePort, versionArn: string): Promise<void> {
  await port.routeLiveTo(versionArn);
  await port.waitForAliasVersion(versionArn);
}

function requireExecution(
  observation: ExecutionVersionObservation,
  versionArn: string,
  status: ExecutionVersionObservation["status"],
  stage: string,
): void {
  if (observation.workflowVersionArn !== versionArn || observation.status !== status) {
    throw new Error(
      `${stage} expected ${status} on ${versionArn}, received ${observation.status} on ${observation.workflowVersionArn}.`,
    );
  }
}

function requireCheckoutVersion(
  observation: CheckoutVersionObservation,
  versionArn: string,
  stage: string,
): void {
  if (observation.workflowVersionArn !== versionArn) {
    throw new Error(
      `${stage} expected ${versionArn}, received ${observation.workflowVersionArn}.`,
    );
  }
}
