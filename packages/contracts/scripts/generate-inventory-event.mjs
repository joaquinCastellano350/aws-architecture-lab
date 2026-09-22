import { readFile, writeFile } from "node:fs/promises";

import { interfaceLines, objectValidatorLines } from "./schema-codegen.mjs";

const definitions = await Promise.all([
  load("inventory-reserved-event.v1.json", "validateInventoryReservedEvent"),
  load("inventory-committed-event.v1.json", "validateInventoryCommittedEvent"),
  load("inventory-released-event.v1.json", "validateInventoryReleasedEvent"),
]);
const lines = [
  "// Generated from schemas/inventory-*-event.v1.json. Do not edit by hand.",
  "",
];
for (const { schema } of definitions) lines.push(...interfaceLines(schema.title, schema));
lines.push(
  "export type InventoryEvent =",
  ...definitions.map(({ schema }, index) =>
    `  ${index === 0 ? "" : "| "}${schema.title}${index === definitions.length - 1 ? ";" : ""}`,
  ),
  "",
  "export type InventoryEventValidationResult<T> =",
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
    resultType: "InventoryEventValidationResult",
  }));
}
lines.push(
  "export function validateInventoryEvent(input: unknown): InventoryEventValidationResult<InventoryEvent> {",
  ...definitions.map(({ validatorName }) => `  const ${validatorName}Result = ${validatorName}(input);`),
  ...definitions.map(({ validatorName }) =>
    `  if (${validatorName}Result.ok) return ${validatorName}Result;`,
  ),
  '  return { ok: false, error: "Value does not match InventoryEvent" };',
  "}",
  "",
);

while (lines.at(-1) === "") lines.pop();
await writeFile(new URL("../src/generated/inventory-event.ts", import.meta.url), `${lines.join("\n")}\n`);

async function load(fileName, validatorName) {
  const schema = JSON.parse(
    await readFile(new URL(`../schemas/${fileName}`, import.meta.url), "utf8"),
  );
  return { schema, validatorName };
}
