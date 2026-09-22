import { readFile, writeFile } from "node:fs/promises";

import { interfaceLines, objectValidatorLines } from "./schema-codegen.mjs";

const commandDefinitions = await Promise.all([
  load("authorize-payment-command.v1.json", "validateAuthorizePaymentCommand"),
  load("capture-payment-command.v1.json", "validateCapturePaymentCommand"),
  load("cancel-payment-command.v1.json", "validateCancelPaymentCommand"),
  load("refund-payment-command.v1.json", "validateRefundPaymentCommand"),
  load("retrieve-payment-command.v1.json", "validateRetrievePaymentCommand"),
]);
const outcomeDefinitions = await Promise.all([
  load("payment-applied-outcome.v1.json", "validatePaymentAppliedOutcome"),
  load("payment-rejected-outcome.v1.json", "validatePaymentRejectedOutcome"),
  load("payment-not-found-outcome.v1.json", "validatePaymentNotFoundOutcome"),
  load(
    "payment-reconciliation-required-outcome.v1.json",
    "validatePaymentReconciliationRequiredOutcome",
  ),
]);
const lines = [
  "// Generated from schemas/*-payment-command*.v1.json. Do not edit by hand.",
  "",
];

for (const { schema } of [...commandDefinitions, ...outcomeDefinitions]) {
  lines.push(...interfaceLines(schema.title, schema));
}

lines.push(
  "export type PaymentCommand =",
  "  | AuthorizePaymentCommand",
  "  | CapturePaymentCommand",
  "  | CancelPaymentCommand",
  "  | RefundPaymentCommand",
  "  | RetrievePaymentCommand;",
  "",
  "export type PaymentCommandOutcome =",
  ...outcomeDefinitions.map(({ schema }, index) =>
    `  ${index === 0 ? "" : "| "}${schema.title}${index === outcomeDefinitions.length - 1 ? ";" : ""}`,
  ),
  "",
  "export type PaymentContractValidationResult<T> =",
  "  | { readonly ok: true; readonly value: T }",
  "  | { readonly ok: false; readonly error: string };",
  "",
);

for (const { schema, validatorName } of [...commandDefinitions, ...outcomeDefinitions]) {
  lines.push(...objectValidatorLines({
    schemaName: schema.title,
    validatorName,
    schema,
    error: `Value does not match ${schema.title}`,
    resultType: "PaymentContractValidationResult",
  }));
}

lines.push(
  "export function validatePaymentCommandOutcome(",
  "  input: unknown,",
  "): PaymentContractValidationResult<PaymentCommandOutcome> {",
  ...outcomeDefinitions.map(({ validatorName }) => `  const ${validatorName}Result = ${validatorName}(input);`),
  ...outcomeDefinitions.map(({ validatorName }) =>
    `  if (${validatorName}Result.ok) return ${validatorName}Result;`,
  ),
  '  return { ok: false, error: "Value does not match PaymentCommandOutcome" };',
  "}",
  "",
);

while (lines.at(-1) === "") lines.pop();
await writeFile(new URL("../src/generated/payment-command.ts", import.meta.url), `${lines.join("\n")}\n`);

async function load(fileName, validatorName) {
  const schema = JSON.parse(await readFile(new URL(`../schemas/${fileName}`, import.meta.url), "utf8"));
  return { schema, validatorName };
}
