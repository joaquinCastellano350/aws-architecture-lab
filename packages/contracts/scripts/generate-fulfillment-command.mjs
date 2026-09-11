import { readFile, writeFile } from "node:fs/promises";

import { interfaceLines, objectValidatorLines } from "./schema-codegen.mjs";

const definitions = await Promise.all([
  load("reserve-fulfillment-command.v1.json", "validateReserveFulfillmentCommand"),
  load("handoff-fulfillment-command.v1.json", "validateHandoffFulfillmentCommand"),
  load("fulfillment-command-outcome.v1.json", "validateFulfillmentCommandOutcome"),
]);
const lines = [
  "// Generated from schemas/*-fulfillment-command*.v1.json. Do not edit by hand.",
  "",
];

for (const { schema } of definitions) lines.push(...interfaceLines(schema.title, schema));
lines.push(
  "export type FulfillmentCommand = ReserveFulfillmentCommand | HandoffFulfillmentCommand;",
  "",
  "export type FulfillmentContractValidationResult<T> =",
  "  | { readonly ok: true; readonly value: T }",
  "  | { readonly ok: false; readonly error: string };",
  "",
);
for (const { schema, validatorName } of definitions) {
  lines.push(...objectValidatorLines({
    schemaName: schema.title,
    validatorName,
    schema,
    error: `Value does not match ${schema.title}`,
    resultType: "FulfillmentContractValidationResult",
  }));
}

while (lines.at(-1) === "") lines.pop();
await writeFile(
  new URL("../src/generated/fulfillment-command.ts", import.meta.url),
  `${lines.join("\n")}\n`,
);

async function load(fileName, validatorName) {
  const schema = JSON.parse(
    await readFile(new URL(`../schemas/${fileName}`, import.meta.url), "utf8"),
  );
  return { schema, validatorName };
}
