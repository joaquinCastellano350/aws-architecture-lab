import { isRecord, runAwsJson } from "./aws-cli.js";
import { MARKETPLACE_CHECKOUT_STACK_NAME } from "./foundation-config.js";

export function stackOutput(outputKey: string): string {
  const response = runAwsJson([
    "cloudformation",
    "describe-stacks",
    "--stack-name",
    MARKETPLACE_CHECKOUT_STACK_NAME,
  ]);
  if (!isRecord(response) || !Array.isArray(response.Stacks)) {
    throw new Error("CloudFormation returned an unexpected stack response.");
  }
  const stack = response.Stacks[0];
  const outputs = isRecord(stack) && Array.isArray(stack.Outputs) ? stack.Outputs : [];
  const output = outputs.find(
    (candidate) => isRecord(candidate) && candidate.OutputKey === outputKey,
  );
  if (!isRecord(output) || typeof output.OutputValue !== "string") {
    throw new Error(`${MARKETPLACE_CHECKOUT_STACK_NAME} output ${outputKey} is missing.`);
  }
  return output.OutputValue;
}

export function dynamoStringAttribute(
  item: Record<string, unknown> | undefined,
  name: string,
): string | undefined {
  const attribute = item?.[name];
  return isRecord(attribute) && typeof attribute.S === "string" ? attribute.S : undefined;
}

export async function pollUntil<T>(
  timeoutMilliseconds: number,
  probe: () => T | undefined | Promise<T | undefined>,
): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    const result = await probe();
    if (result !== undefined) return result;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return undefined;
}
