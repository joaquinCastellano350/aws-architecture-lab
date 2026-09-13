import { createHash } from "node:crypto";

export function commandTypeOf(event: unknown): unknown {
  return typeof event === "object" && event !== null
    ? (event as Record<string, unknown>).commandType
    : undefined;
}

export function stablePayloadHash(value: unknown): string {
  // A workflow replay has a new delivery cause but must retain the same semantic operation.
  const payload = typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value).filter(([key]) => key !== "causationId"),
      )
    : value;
  return createHash("sha256").update(JSON.stringify(stableValue(payload))).digest("hex");
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stableValue(nested)]),
  );
}
