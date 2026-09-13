#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { isRecord, runAwsJson } from "../lib/aws-cli.js";
import { executeCli, runEnvironmentPreflight } from "../lib/cli.js";
import { stackOutput } from "../lib/workload-evidence.js";

executeCli(() => {
  runEnvironmentPreflight();
  const operationId = argument("--operation-id");
  const reconciliationId = argument("--reconciliation-id");
  const requestedBy = argument("--requested-by");
  const reason = argument("--reason");
  const functionName = stackOutput("ReconciliationReplayFunctionName");
  const directory = mkdtempSync(path.join(tmpdir(), "aws-architecture-lab-replay-"));
  const responsePath = path.join(directory, "response.json");
  try {
    const metadata = runAwsJson([
      "lambda",
      "invoke",
      "--function-name",
      functionName,
      "--cli-binary-format",
      "raw-in-base64-out",
      "--payload",
      JSON.stringify({
        schemaVersion: "1.0",
        commandType: "ReplayReconciliation",
        operationId,
        reconciliationId,
        requestedBy,
        reason,
      }),
      responsePath,
    ]);
    if (!isRecord(metadata) || metadata.StatusCode !== 200 || metadata.FunctionError !== undefined) {
      throw new Error(`Reconciliation replay failed: ${JSON.stringify(metadata)}`);
    }
    const response = JSON.parse(readFileSync(responsePath, "utf8")) as unknown;
    if (!isRecord(response) || response.status !== "REPLAYING") {
      throw new Error(`Reconciliation replay returned an unexpected response: ${JSON.stringify(response)}`);
    }
    console.log(JSON.stringify(response, undefined, 2));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined || value.length === 0 || value.startsWith("--")) {
    throw new Error(`${name} is required`);
  }
  return value;
}
