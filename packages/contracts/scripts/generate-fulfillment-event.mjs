import { readFile, writeFile } from "node:fs/promises";

import { interfaceLines, objectValidatorLines } from "./schema-codegen.mjs";

const definitions = await Promise.all([
  load("fulfillment-reserved-event.v1.json", "validateFulfillmentReservedEvent"),
  load("fulfillment-handed-off-event.v1.json", "validateFulfillmentHandedOffEvent"),
]);
const lines = [
  "// Generated from schemas/fulfillment-*-event.v1.json. Do not edit by hand.",
  "",
];
for (const { schema } of definitions) lines.push(...interfaceLines(schema.title, schema));
lines.push(
  "export type FulfillmentEventValidationResult<T> =",
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
    resultType: "FulfillmentEventValidationResult",
  }));
}

while (lines.at(-1) === "") lines.pop();
await writeFile(
  new URL("../src/generated/fulfillment-event.ts", import.meta.url),
  `${lines.join("\n")}\n`,
);

async function load(fileName, validatorName) {
  const schema = JSON.parse(
    await readFile(new URL(`../schemas/${fileName}`, import.meta.url), "utf8"),
  );
  return { schema, validatorName };
}
