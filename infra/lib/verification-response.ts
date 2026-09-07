import { isRecord } from "./aws-cli.js";

export function requireRecord(parent: unknown, key: string): Record<string, unknown> {
  if (!isRecord(parent) || !isRecord(parent[key])) {
    throw new Error(`AWS response is missing ${key}.`);
  }
  return parent[key];
}

export function requireRecordArray(parent: unknown, key: string): Array<Record<string, unknown>> {
  if (!isRecord(parent) || !Array.isArray(parent[key])) {
    throw new Error(`AWS response is missing ${key}.`);
  }
  const records = parent[key].filter(isRecord);
  if (records.length !== parent[key].length) {
    throw new Error(`AWS response contains malformed ${key}.`);
  }
  return records;
}

export function firstRecord(parent: unknown, key: string): Record<string, unknown> {
  const records = requireRecordArray(parent, key);
  const first = records[0];
  if (first === undefined) {
    throw new Error(`AWS response contains no ${key}.`);
  }
  return first;
}

export function requireString(parent: Record<string, unknown>, key: string): string {
  const value = parent[key];
  if (typeof value !== "string") {
    throw new Error(`AWS response is missing ${key}.`);
  }
  return value;
}

export function physicalIdForType(
  resources: ReadonlyArray<Record<string, unknown>>,
  resourceType: string,
): string {
  const resource = resources.find((candidate) => candidate.ResourceType === resourceType);
  if (resource === undefined) {
    throw new Error(`Foundation is missing deployed resource type ${resourceType}.`);
  }
  return requireString(resource, "PhysicalResourceId");
}

export function physicalIdForLogicalId(
  resources: ReadonlyArray<Record<string, unknown>>,
  logicalId: string,
): string {
  const resource = resources.find((candidate) => candidate.LogicalResourceId === logicalId);
  if (resource === undefined) {
    throw new Error(`Foundation is missing deployed logical resource ${logicalId}.`);
  }
  return requireString(resource, "PhysicalResourceId");
}
