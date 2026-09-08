import { readFile, writeFile } from "node:fs/promises";

import { interfaceLines, objectValidatorLines } from "./schema-codegen.mjs";

const schema = JSON.parse(
  await readFile(new URL("../schemas/order-pending-event.v1.json", import.meta.url), "utf8"),
);
const lines = [
  "// Generated from schemas/order-pending-event.v1.json. Do not edit by hand.",
  "",
  ...interfaceLines(schema.title, schema),
  "export type OrderEventValidationResult<T> =",
  "  | { readonly ok: true; readonly value: T }",
  "  | { readonly ok: false; readonly error: string };",
  "",
  ...objectValidatorLines({
    schemaName: schema.title,
    validatorName: "validateOrderPendingEvent",
    schema,
    error: "Value does not match OrderPendingEvent",
    resultType: "OrderEventValidationResult",
  }),
];

if (lines.at(-1) === "") lines.pop();
await writeFile(new URL("../src/generated/order-event.ts", import.meta.url), `${lines.join("\n")}\n`);
