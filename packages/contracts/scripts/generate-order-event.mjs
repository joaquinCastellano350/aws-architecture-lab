import { readFile, writeFile } from "node:fs/promises";

import { interfaceLines, objectValidatorLines } from "./schema-codegen.mjs";

const definitions = await Promise.all([
  load("order-pending-event.v1.json", "validateOrderPendingEvent"),
  load("order-inventory-unavailable-event.v1.json", "validateOrderInventoryUnavailableEvent"),
  load("order-expired-event.v1.json", "validateOrderExpiredEvent"),
]);
const lines = [
  "// Generated from schemas/order-*-event.v1.json. Do not edit by hand.",
  "",
];

for (const { schema } of definitions) lines.push(...interfaceLines(schema.title, schema));
lines.push(
  "export type OrderEventValidationResult<T> =",
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
    resultType: "OrderEventValidationResult",
  }));
}

if (lines.at(-1) === "") lines.pop();
await writeFile(new URL("../src/generated/order-event.ts", import.meta.url), `${lines.join("\n")}\n`);

async function load(fileName, validatorName) {
  const schema = JSON.parse(
    await readFile(new URL(`../schemas/${fileName}`, import.meta.url), "utf8"),
  );
  return { schema, validatorName };
}
