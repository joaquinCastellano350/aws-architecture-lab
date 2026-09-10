import type { Handler } from "aws-lambda";
import type { InventoryCommandOutcome } from "@aws-architecture-lab/contracts";

import { DynamoInventoryRepository } from "./dynamo-inventory-repository.js";
import { createInventoryCommandHandler } from "./inventory-command-handler.js";
import { requiredEnvironment } from "./environment.js";

const inventory = new DynamoInventoryRepository(
  requiredEnvironment("INVENTORY_TABLE_NAME"),
  requiredEnvironment("INVENTORY_OUTBOX_TABLE_NAME"),
  { initialQuantity: positiveIntegerEnvironment("INVENTORY_INITIAL_QUANTITY") },
);

export const handler: Handler<unknown, InventoryCommandOutcome> =
  createInventoryCommandHandler(inventory);

function positiveIntegerEnvironment(name: string): number {
  const value = Number(requiredEnvironment(name));
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}
