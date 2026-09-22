import { describe, expect, it } from "vitest";

import {
  exerciseWorkflowVersionEvolution,
  type CheckoutVersionObservation,
  type ExecutionVersionObservation,
  type WorkflowVersionEvidencePort,
} from "../lib/workflow-version-evidence.js";

describe("workflow version deployment evidence", () => {
  it("pins active and redriven work while LIVE moves forward and rolls back", async () => {
    const port = new InMemoryWorkflowVersionEvidencePort();

    const evidence = await exerciseWorkflowVersionEvolution(port, "run-123");

    expect(evidence).toEqual({
      originalVersionArn: "workflow:1",
      publishedVersionArn: "workflow:2",
      activeExecutionArn: "execution:probe-run-123",
      newCheckout: { checkoutId: "checkout-forward-run-123", workflowVersionArn: "workflow:2" },
      rollbackCheckout: {
        checkoutId: "checkout-rollback-run-123",
        workflowVersionArn: "workflow:1",
      },
      redrivenExecutionArn: "execution:probe-run-123",
    });
    expect(port.calls).toEqual([
      "getLiveVersionArn",
      "startProbe:probe-run-123:workflow:1",
      "publishEvidenceVersion:run-123",
      "routeLiveTo:workflow:2",
      "waitForAliasVersion:workflow:2",
      "admitCheckout:forward-run-123:workflow:2",
      "observeExecution:execution:probe-run-123:RUNNING:workflow:1",
      "routeLiveTo:workflow:1",
      "waitForAliasVersion:workflow:1",
      "admitCheckout:rollback-run-123:workflow:1",
      "observeCheckout:checkout-forward-run-123:workflow:2",
      "routeLiveTo:workflow:2",
      "waitForAliasVersion:workflow:2",
      "stopExecution:execution:probe-run-123",
      "redriveExecution:execution:probe-run-123:workflow:1",
      "routeLiveTo:workflow:1",
      "waitForAliasVersion:workflow:1",
      "restoreMutableRevision",
    ]);
  });

  it("restores LIVE and the mutable revision when the exercise fails", async () => {
    const port = new InMemoryWorkflowVersionEvidencePort();
    port.failAdmission = true;

    await expect(exerciseWorkflowVersionEvolution(port, "run-456")).rejects.toThrow(
      "admission failed",
    );

    expect(port.liveVersionArn).toBe("workflow:1");
    expect(port.mutableRevisionRestored).toBe(true);
    expect(port.executionStatus).toBe("ABORTED");
  });
});

class InMemoryWorkflowVersionEvidencePort implements WorkflowVersionEvidencePort {
  readonly calls: string[] = [];
  liveVersionArn = "workflow:1";
  mutableRevisionRestored = false;
  executionStatus: ExecutionVersionObservation["status"] = "RUNNING";
  failAdmission = false;

  async getLiveVersionArn(): Promise<string> {
    this.calls.push("getLiveVersionArn");
    return this.liveVersionArn;
  }

  async startProbe(name: string): Promise<ExecutionVersionObservation> {
    this.calls.push(`startProbe:${name}:${this.liveVersionArn}`);
    return this.execution(`execution:${name}`);
  }

  async publishEvidenceVersion(marker: string): Promise<string> {
    this.calls.push(`publishEvidenceVersion:${marker}`);
    return "workflow:2";
  }

  async routeLiveTo(versionArn: string): Promise<void> {
    this.calls.push(`routeLiveTo:${versionArn}`);
    this.liveVersionArn = versionArn;
  }

  async waitForAliasVersion(versionArn: string): Promise<void> {
    this.calls.push(`waitForAliasVersion:${versionArn}`);
    expect(this.liveVersionArn).toBe(versionArn);
  }

  async admitCheckout(label: string): Promise<CheckoutVersionObservation> {
    this.calls.push(`admitCheckout:${label}:${this.liveVersionArn}`);
    if (this.failAdmission) throw new Error("admission failed");
    return { checkoutId: `checkout-${label}`, workflowVersionArn: this.liveVersionArn };
  }

  async observeCheckout(checkoutId: string): Promise<CheckoutVersionObservation> {
    this.calls.push(`observeCheckout:${checkoutId}:workflow:2`);
    return { checkoutId, workflowVersionArn: "workflow:2" };
  }

  async observeExecution(executionArn: string): Promise<ExecutionVersionObservation> {
    const observation = this.execution(executionArn);
    this.calls.push(
      `observeExecution:${executionArn}:${observation.status}:${observation.workflowVersionArn}`,
    );
    return observation;
  }

  async stopExecution(executionArn: string): Promise<void> {
    this.calls.push(`stopExecution:${executionArn}`);
    this.executionStatus = "ABORTED";
  }

  async redriveExecution(executionArn: string): Promise<ExecutionVersionObservation> {
    this.executionStatus = "SUCCEEDED";
    const observation = this.execution(executionArn);
    this.calls.push(`redriveExecution:${executionArn}:${observation.workflowVersionArn}`);
    return observation;
  }

  async restoreMutableRevision(): Promise<void> {
    this.calls.push("restoreMutableRevision");
    this.mutableRevisionRestored = true;
  }

  private execution(executionArn: string): ExecutionVersionObservation {
    return {
      executionArn,
      status: this.executionStatus,
      workflowVersionArn: "workflow:1",
    };
  }
}
