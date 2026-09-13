import { readFile, writeFile } from "node:fs/promises";

import { interfaceLines, objectValidatorLines } from "./schema-codegen.mjs";

const definitions = await Promise.all([
  load("create-pending-order-command.v1.json", "validateCreatePendingOrderCommand"),
  load("create-pending-order-outcome.v1.json", "validateCreatePendingOrderOutcome"),
  load("mark-order-inventory-unavailable-command.v1.json", "validateMarkOrderInventoryUnavailableCommand"),
  load("mark-order-inventory-unavailable-outcome.v1.json", "validateMarkOrderInventoryUnavailableOutcome"),
  load("mark-order-expired-command.v1.json", "validateMarkOrderExpiredCommand"),
  load("mark-order-expired-outcome.v1.json", "validateMarkOrderExpiredOutcome"),
  load("mark-order-confirmed-command.v1.json", "validateMarkOrderConfirmedCommand"),
  load("mark-order-confirmed-outcome.v1.json", "validateMarkOrderConfirmedOutcome"),
  load("mark-order-cancelled-command.v1.json", "validateMarkOrderCancelledCommand"),
  load("mark-order-cancelled-outcome.v1.json", "validateMarkOrderCancelledOutcome"),
]);
const lines = [
  "// Generated from schemas/create-pending-order-*.v1.json. Do not edit by hand.",
  "",
];

for (const { schema } of definitions) {
  lines.push(...interfaceLines(schema.title, schema));
}

lines.push(
  "export type OrderContractValidationResult<T> =",
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
    resultType: "OrderContractValidationResult",
  }));
}

await writeFile(new URL("../src/generated/order-command.ts", import.meta.url), `${lines.join("\n")}\n`);

async function load(fileName, validatorName) {
  const schema = JSON.parse(
    await readFile(new URL(`../schemas/${fileName}`, import.meta.url), "utf8"),
  );
  return { schema, validatorName };
}
