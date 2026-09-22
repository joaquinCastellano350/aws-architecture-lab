import { readFile, writeFile } from "node:fs/promises";

import { interfaceLines, objectValidatorLines } from "./schema-codegen.mjs";

const definitions = await Promise.all([
  load("payment-authorized-event.v1.json", "validatePaymentAuthorizedEvent"),
  load("payment-captured-event.v1.json", "validatePaymentCapturedEvent"),
  load("payment-cancelled-event.v1.json", "validatePaymentCancelledEvent"),
  load("payment-refunded-event.v1.json", "validatePaymentRefundedEvent"),
]);
const lines = ["// Generated from schemas/payment-*-event.v1.json. Do not edit by hand.", ""];
for (const { schema } of definitions) lines.push(...interfaceLines(schema.title, schema));
lines.push(
  "export type PaymentEvent =",
  ...definitions.map(({ schema }, index) =>
    `  ${index === 0 ? "" : "| "}${schema.title}${index === definitions.length - 1 ? ";" : ""}`,
  ),
  "",
  "export type PaymentEventValidationResult<T> =",
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
    resultType: "PaymentEventValidationResult",
  }));
}
lines.push(
  "export function validatePaymentEvent(input: unknown): PaymentEventValidationResult<PaymentEvent> {",
  ...definitions.map(({ validatorName }) => `  const ${validatorName}Result = ${validatorName}(input);`),
  ...definitions.map(({ validatorName }) =>
    `  if (${validatorName}Result.ok) return ${validatorName}Result;`,
  ),
  '  return { ok: false, error: "Value does not match PaymentEvent" };',
  "}",
  "",
);
while (lines.at(-1) === "") lines.pop();
await writeFile(new URL("../src/generated/payment-event.ts", import.meta.url), `${lines.join("\n")}\n`);

async function load(fileName, validatorName) {
  const schema = JSON.parse(await readFile(new URL(`../schemas/${fileName}`, import.meta.url), "utf8"));
  return { schema, validatorName };
}
