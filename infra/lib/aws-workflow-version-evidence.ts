import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { isRecord, runAwsJson } from "./aws-cli.js";
import { signedJsonRequest } from "./signed-json-request.js";
import { dynamoStringAttribute, pollUntil, stackOutput } from "./workload-evidence.js";
import type {
  CheckoutVersionObservation,
  ExecutionVersionObservation,
  WorkflowVersionEvidencePort,
} from "./workflow-version-evidence.js";

const probeResumeDelayMilliseconds = 5 * 60_000;

export class AwsWorkflowVersionEvidencePort implements WorkflowVersionEvidencePort {
  readonly #aliasArn = stackOutput("CheckoutWorkflowAliasArn");
  readonly #apiUrl = stackOutput("CheckoutApiUrl");
  readonly #sagaTableName = stackOutput("SagaTableName");
  readonly #region: string;
  readonly #stateMachineArn: string;
  #originalDefinition: string | undefined;
  #roleArn: string | undefined;
  #routingProbeSequence = 0;

  public constructor(region: string) {
    this.#region = region;
    this.#stateMachineArn = unqualifiedStateMachineArn(this.#aliasArn);
  }

  public async getLiveVersionArn(): Promise<string> {
    const response = runAwsJson([
      "stepfunctions",
      "describe-state-machine-alias",
      "--state-machine-alias-arn",
      this.#aliasArn,
    ]);
    const routes = isRecord(response) && Array.isArray(response.routingConfiguration)
      ? response.routingConfiguration
      : [];
    if (routes.length !== 1) {
      throw new Error("LIVE must route 100 percent to exactly one workflow version.");
    }
    const route = routes[0];
    if (
      !isRecord(route) ||
      typeof route.stateMachineVersionArn !== "string" ||
      route.weight !== 100
    ) {
      throw new Error("LIVE returned an unexpected routing configuration.");
    }
    return route.stateMachineVersionArn;
  }

  public async startProbe(name: string): Promise<ExecutionVersionObservation> {
    const response = runAwsJson([
      "stepfunctions",
      "start-execution",
      "--state-machine-arn",
      this.#aliasArn,
      "--name",
      name,
      "--input",
      JSON.stringify({
        versionDeploymentProbe: {
          probeId: name,
          checkoutId: `checkout-${name}`,
          paymentId: `payment-${name}`,
          correlationId: `correlation-${name}`,
          resumeAt: new Date(Date.now() + probeResumeDelayMilliseconds).toISOString(),
        },
      }),
    ]);
    if (!isRecord(response) || typeof response.executionArn !== "string") {
      throw new Error("Step Functions did not return an execution ARN for the version probe.");
    }
    const executionArn = response.executionArn;
    const observation = await pollUntil(10_000, async () => {
      const current = await this.observeExecution(executionArn);
      return current.status === "RUNNING" ? current : undefined;
    });
    if (observation === undefined) {
      throw new Error(`Version probe ${executionArn} did not remain active.`);
    }
    return observation;
  }

  public async publishEvidenceVersion(marker: string): Promise<string> {
    const response = runAwsJson([
      "stepfunctions",
      "describe-state-machine",
      "--state-machine-arn",
      this.#stateMachineArn,
    ]);
    if (
      !isRecord(response) ||
      typeof response.definition !== "string" ||
      typeof response.roleArn !== "string"
    ) {
      throw new Error("Step Functions returned an unexpected mutable workflow definition.");
    }
    this.#originalDefinition = response.definition;
    this.#roleArn = response.roleArn;
    const definition = JSON.parse(response.definition) as unknown;
    if (!isRecord(definition)) throw new Error("The deployed workflow definition is not an object.");
    definition.Comment = `Version deployment evidence ${marker}`;

    const updated = this.#updateDefinition(JSON.stringify(definition), true, marker);
    if (!isRecord(updated) || typeof updated.stateMachineVersionArn !== "string") {
      throw new Error("Step Functions did not return the published evidence version ARN.");
    }
    return updated.stateMachineVersionArn;
  }

  public async routeLiveTo(versionArn: string): Promise<void> {
    runAwsJson([
      "stepfunctions",
      "update-state-machine-alias",
      "--state-machine-alias-arn",
      this.#aliasArn,
      "--routing-configuration",
      JSON.stringify([{ stateMachineVersionArn: versionArn, weight: 100 }]),
    ]);
  }

  public async waitForAliasVersion(versionArn: string): Promise<void> {
    const routed = await pollUntil(30_000, async () => {
      const probe = await this.startProbe(
        `version-route-${Date.now()}-${this.#routingProbeSequence++}`,
      );
      await this.stopExecution(probe.executionArn);
      return probe.workflowVersionArn === versionArn ? true : undefined;
    });
    if (routed === undefined) {
      throw new Error(`LIVE did not admit an execution to ${versionArn} within 30 seconds.`);
    }
  }

  public async admitCheckout(label: string): Promise<CheckoutVersionObservation> {
    const submitted = await signedJsonRequest(this.#apiUrl, this.#region, "POST", "/checkouts", {
      body: JSON.stringify({
        contractVersion: "1.0",
        cartId: `version-cart-${label}`,
        correlationId: `version-correlation-${label}`,
        itemId: `version-item-${label}`,
        quantity: 1,
      }),
      headers: { "Idempotency-Key": `version-admission-${label}` },
    });
    if (
      submitted.status !== 202 ||
      !isRecord(submitted.body) ||
      typeof submitted.body.checkoutId !== "string"
    ) {
      throw new Error(
        `Version evidence checkout admission failed: ${submitted.status} ${JSON.stringify(submitted.body)}`,
      );
    }
    return this.observeCheckout(submitted.body.checkoutId);
  }

  public async observeCheckout(checkoutId: string): Promise<CheckoutVersionObservation> {
    const observed = await pollUntil(10_000, () => {
      const response = runAwsJson([
        "dynamodb",
        "get-item",
        "--table-name",
        this.#sagaTableName,
        "--consistent-read",
        "--key",
        JSON.stringify({ recordKey: { S: `SAGA#${checkoutId}` } }),
      ]);
      const item = isRecord(response) && isRecord(response.Item) ? response.Item : undefined;
      const workflowVersionArn = dynamoStringAttribute(item, "workflowVersionArn");
      return workflowVersionArn === undefined ? undefined : { checkoutId, workflowVersionArn };
    });
    if (observed === undefined) {
      throw new Error(`Saga ${checkoutId} did not record its selected workflow version.`);
    }
    return observed;
  }

  public async observeExecution(executionArn: string): Promise<ExecutionVersionObservation> {
    const response = runAwsJson([
      "stepfunctions",
      "describe-execution",
      "--execution-arn",
      executionArn,
    ]);
    if (
      !isRecord(response) ||
      typeof response.executionArn !== "string" ||
      typeof response.stateMachineVersionArn !== "string" ||
      !isExecutionStatus(response.status)
    ) {
      throw new Error(`Step Functions returned an unexpected execution: ${executionArn}.`);
    }
    return {
      executionArn: response.executionArn,
      status: response.status,
      workflowVersionArn: response.stateMachineVersionArn,
    };
  }

  public async stopExecution(executionArn: string): Promise<void> {
    const current = await this.observeExecution(executionArn);
    if (current.status !== "RUNNING") return;
    runAwsJson([
      "stepfunctions",
      "stop-execution",
      "--execution-arn",
      executionArn,
      "--error",
      "VersionDeploymentEvidenceComplete",
      "--cause",
      "The version deployment exercise intentionally stops its isolated probe.",
    ]);
    const stopped = await pollUntil(10_000, async () => {
      const observation = await this.observeExecution(executionArn);
      return observation.status === "ABORTED" ? true : undefined;
    });
    if (stopped === undefined) throw new Error(`Version probe ${executionArn} did not stop.`);
  }

  public async redriveExecution(executionArn: string): Promise<ExecutionVersionObservation> {
    runAwsJson([
      "stepfunctions",
      "redrive-execution",
      "--execution-arn",
      executionArn,
    ]);
    const observation = await pollUntil(probeResumeDelayMilliseconds + 30_000, async () => {
      const current = await this.observeExecution(executionArn);
      return current.status === "RUNNING" ? undefined : current;
    });
    if (observation === undefined) throw new Error(`Version probe ${executionArn} did not redrive.`);
    return observation;
  }

  public async restoreMutableRevision(): Promise<void> {
    if (this.#originalDefinition === undefined || this.#roleArn === undefined) return;
    this.#updateDefinition(this.#originalDefinition, false);
    this.#originalDefinition = undefined;
    this.#roleArn = undefined;
  }

  #updateDefinition(definition: string, publish: boolean, marker?: string): unknown {
    if (this.#roleArn === undefined) throw new Error("The workflow role ARN was not captured.");
    const directory = mkdtempSync(path.join(tmpdir(), "aws-architecture-lab-workflow-version-"));
    const definitionPath = path.join(directory, "definition.json");
    writeFileSync(definitionPath, definition, "utf8");
    try {
      return runAwsJson([
        "stepfunctions",
        "update-state-machine",
        "--state-machine-arn",
        this.#stateMachineArn,
        "--definition",
        `file://${definitionPath.replaceAll("\\", "/")}`,
        "--role-arn",
        this.#roleArn,
        ...(publish
          ? [
              "--publish",
              "--version-description",
              `Issue 13 version deployment evidence ${marker ?? ""}`.trim(),
            ]
          : []),
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
}

function unqualifiedStateMachineArn(aliasArn: string): string {
  const qualifierSeparator = aliasArn.lastIndexOf(":");
  const qualifier = aliasArn.slice(qualifierSeparator + 1);
  if (qualifierSeparator < 0 || qualifier !== "LIVE") {
    throw new Error("CheckoutWorkflowAliasArn is not the LIVE state machine alias ARN.");
  }
  return aliasArn.slice(0, qualifierSeparator);
}

function isExecutionStatus(value: unknown): value is ExecutionVersionObservation["status"] {
  return value === "RUNNING" ||
    value === "SUCCEEDED" ||
    value === "FAILED" ||
    value === "TIMED_OUT" ||
    value === "ABORTED";
}
