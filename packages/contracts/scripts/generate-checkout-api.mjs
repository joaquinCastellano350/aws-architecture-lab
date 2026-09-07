import { readFile, writeFile } from "node:fs/promises";

import { interfaceLines, invalidValueExpression, objectValidatorLines } from "./schema-codegen.mjs";

const sourceUrl = new URL("../openapi/checkout-api.json", import.meta.url);
const outputUrl = new URL("../src/generated/checkout-api.ts", import.meta.url);
const document = JSON.parse(await readFile(sourceUrl, "utf8"));
const schemas = document.components.schemas;
const [submitPath, submitOperation] = findOperation("submitCheckout");
const [statusPath] = findOperation("getCheckout");
const idempotencyParameter = submitOperation.parameters.find(
  (parameter) => parameter.in === "header" && parameter.name.toLowerCase() === "idempotency-key",
);
if (idempotencyParameter === undefined) throw new Error("Idempotency-Key parameter is missing");

const lines = [
  "// Generated from openapi/checkout-api.json. Do not edit by hand.",
  "",
  "export const checkoutApiPaths = {",
  `  submit: ${JSON.stringify(submitPath)},`,
  `  status: ${JSON.stringify(statusPath)},`,
  "} as const;",
  `export const idempotencyKeyHeaderName = ${JSON.stringify(idempotencyParameter.name)};`,
  "",
];

for (const [name, schema] of Object.entries(schemas)) {
  lines.push(...interfaceLines(name, schema));
}

lines.push(
  "export type ValidationResult<T> =",
  "  | { readonly ok: true; readonly value: T }",
  "  | { readonly ok: false; readonly error: string };",
  "",
  "export function checkoutStatusPath(checkoutId: string): string {",
  '  return checkoutApiPaths.status.replace("{checkoutId}", encodeURIComponent(checkoutId));',
  "}",
  "",
  "export function checkoutIdFromStatusPath(path: string): string | undefined {",
  '  const parts = checkoutApiPaths.status.split("{checkoutId}");',
  '  const prefix = parts[0] ?? "";',
  '  const suffix = parts[1] ?? "";',
  "  if (!path.startsWith(prefix) || !path.endsWith(suffix)) return undefined;",
  "  const encoded = path.slice(prefix.length, path.length - suffix.length);",
  '  if (encoded.length === 0 || encoded.includes("/")) return undefined;',
  "  try {",
  "    return decodeURIComponent(encoded);",
  "  } catch {",
  "    return undefined;",
  "  }",
  "}",
  "",
  "export function validateIdempotencyKey(value: unknown): value is string {",
  `  return !${invalidValueExpression("value", idempotencyParameter.schema)};`,
  "}",
  "",
);

for (const [schemaName, validatorName, error] of [
  [
    "SubmitCheckoutRequest",
    "validateSubmitCheckoutRequest",
    `Request body does not match SubmitCheckoutRequest v${schemas.SubmitCheckoutRequest.properties.contractVersion.enum[0]}`,
  ],
  ["SubmitCheckoutResponse", "validateSubmitCheckoutResponse", "Response does not match SubmitCheckoutResponse"],
  ["CheckoutStatusResponse", "validateCheckoutStatusResponse", "Response does not match CheckoutStatusResponse"],
]) {
  lines.push(...objectValidatorLines({
    schemaName,
    validatorName,
    schema: schemas[schemaName],
    error,
    resultType: "ValidationResult",
  }));
}

await writeFile(outputUrl, `${lines.join("\n")}\n`, "utf8");

function findOperation(operationId) {
  for (const [pathName, pathItem] of Object.entries(document.paths)) {
    for (const operation of Object.values(pathItem)) {
      if (operation.operationId === operationId) return [pathName, operation];
    }
  }
  throw new Error(`OpenAPI operation ${operationId} is missing`);
}
