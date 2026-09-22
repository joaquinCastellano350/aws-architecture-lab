#!/usr/bin/env node
import { AwsWorkflowVersionEvidencePort } from "../lib/aws-workflow-version-evidence.js";
import { executeAsyncCli, runEnvironmentPreflight } from "../lib/cli.js";
import { exerciseWorkflowVersionEvolution } from "../lib/workflow-version-evidence.js";

await executeAsyncCli(async () => {
  const report = runEnvironmentPreflight();
  const runId = `${Date.now()}`;
  const evidence = await exerciseWorkflowVersionEvolution(
    new AwsWorkflowVersionEvidencePort(report.region),
    runId,
  );
  console.log(JSON.stringify({
    ...evidence,
    conclusion:
      "LIVE changed admission only; earlier domain work and the redriven execution remained pinned to their selected immutable definitions.",
  }, undefined, 2));
});
