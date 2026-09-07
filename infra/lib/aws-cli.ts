import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";

import type { CallerIdentity } from "./preflight.js";

export function runAwsJson(
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): unknown {
  const output = execFileSync(awsExecutable(), [...args, "--output", "json", "--no-cli-pager"], {
    encoding: "utf8",
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(output) as unknown;
}

export function getCallerIdentity(environment: NodeJS.ProcessEnv = process.env): CallerIdentity {
  const response = runAwsJson(["sts", "get-caller-identity"], environment);
  if (!isRecord(response) || typeof response.Account !== "string" || typeof response.Arn !== "string") {
    throw new Error("aws sts get-caller-identity returned an unexpected response");
  }
  return { account: response.Account, arn: response.Arn };
}

export function runCommand(executable: string, args: readonly string[]): void {
  const result = spawnSync(executable, args, { stdio: "inherit" });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${executable} exited with status ${result.status ?? "unknown"}.`);
  }
}

export function runCdk(args: readonly string[]): void {
  const require = createRequire(import.meta.url);
  runCommand(process.execPath, [require.resolve("aws-cdk/bin/cdk"), ...args]);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function awsExecutable(): string {
  return process.platform === "win32" ? "aws.exe" : "aws";
}
