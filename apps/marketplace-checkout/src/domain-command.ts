import { createHash } from "node:crypto";

export function commandTypeOf(event: unknown): unknown {
  return typeof event === "object" && event !== null
    ? (event as Record<string, unknown>).commandType
    : undefined;
}

export function stablePayloadHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stableValue(nested)]),
  );
}
