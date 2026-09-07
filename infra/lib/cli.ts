import { getCallerIdentity } from "./aws-cli.js";
import { runPreflight, type PreflightReport } from "./preflight.js";

export function runEnvironmentPreflight(
  environment: NodeJS.ProcessEnv = process.env,
): PreflightReport {
  return runPreflight(environment, {
    getCallerIdentity: () => getCallerIdentity(environment),
    write: (message) => console.log(message),
  });
}

export function executeCli(command: () => void): void {
  try {
    command();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export async function executeAsyncCli(command: () => Promise<void>): Promise<void> {
  try {
    await command();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
