export function interfaceLines(name, schema) {
  const required = new Set(schema.required ?? []);
  const lines = [`export interface ${name} {`];
  for (const [propertyName, property] of Object.entries(schema.properties ?? {})) {
    const optional = required.has(propertyName) ? "" : "?";
    lines.push(`  readonly ${propertyName}${optional}: ${typescriptType(property)};`);
  }
  if (schema.additionalProperties === true) lines.push("  readonly [key: string]: unknown;");
  return [...lines, "}", ""];
}

export function objectValidatorLines({
  schemaName,
  validatorName,
  schema,
  error,
  resultType,
}) {
  const conditions = validationConditions(schema);
  return [
    `export function ${validatorName}(`,
    "  input: unknown,",
    `): ${resultType}<${schemaName}> {`,
    "  if (",
    '    typeof input !== "object" ||',
    "    input === null ||",
    ...conditions.map((condition, index) =>
      `    ${condition}${index === conditions.length - 1 ? "" : " ||"}`,
    ),
    "  ) {",
    `    return { ok: false, error: ${JSON.stringify(error)} };`,
    "  }",
    `  return { ok: true, value: input as ${schemaName} };`,
    "}",
    "",
  ];
}

export function invalidValueExpression(value, schema) {
  const checks = [];
  if (schema.type === "object") {
    checks.push(`typeof ${value} !== "object"`);
    checks.push(`${value} === null`);
    checks.push(`Array.isArray(${value})`);
    const required = new Set(schema.required ?? []);
    for (const [name, property] of Object.entries(schema.properties ?? {})) {
      const nestedValue = `(${value} as Record<string, unknown>)[${JSON.stringify(name)}]`;
      const condition = invalidValueExpression(nestedValue, property);
      checks.push(required.has(name) ? condition : `(${nestedValue} !== undefined && ${condition})`);
    }
  }
  if (schema.type === "string") {
    checks.push(`typeof ${value} !== "string"`);
    if (Object.hasOwn(schema, "const")) checks.push(`${value} !== ${JSON.stringify(schema.const)}`);
    if (schema.minLength !== undefined) checks.push(`String(${value}).length < ${schema.minLength}`);
    if (schema.maxLength !== undefined) checks.push(`String(${value}).length > ${schema.maxLength}`);
    if (schema.enum !== undefined) {
      checks.push(`![${schema.enum.map(JSON.stringify).join(", ")}].includes(${value} as string)`);
    }
    if (schema.format === "date-time") {
      checks.push(`!/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$/.test(${value} as string)`);
      checks.push(`Number.isNaN(Date.parse(${value} as string))`);
    }
  }
  if (schema.type === "integer" || schema.type === "number") {
    checks.push(`typeof ${value} !== "number"`);
  }
  if (schema.type === "boolean") checks.push(`typeof ${value} !== "boolean"`);
  return checks.length === 0 ? "false" : `(${checks.join(" || ")})`;
}

function typescriptType(schema) {
  if (Object.hasOwn(schema, "const")) return JSON.stringify(schema.const);
  if (schema.enum !== undefined) return schema.enum.map(JSON.stringify).join(" | ");
  if (schema.type === "object") {
    const required = new Set(schema.required ?? []);
    const properties = Object.entries(schema.properties ?? {}).map(([name, property]) => {
      const optional = required.has(name) ? "" : "?";
      return `readonly ${name}${optional}: ${typescriptType(property)}`;
    });
    if (schema.additionalProperties === true) properties.push("readonly [key: string]: unknown");
    return `{ ${properties.join("; ")} }`;
  }
  if (schema.type === "integer" || schema.type === "number") return "number";
  if (schema.type === "boolean") return "boolean";
  return "string";
}

function validationConditions(schema) {
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(([name, property]) => {
    const value = `(input as Record<string, unknown>)[${JSON.stringify(name)}]`;
    const condition = invalidValueExpression(value, property);
    return required.has(name) ? condition : `(${value} !== undefined && ${condition})`;
  });
}
