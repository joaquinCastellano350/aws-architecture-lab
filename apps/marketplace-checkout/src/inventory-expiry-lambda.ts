import type { EventBridgeEvent, Handler } from "aws-lambda";

import { DynamoInventoryRepository } from "./dynamo-inventory-repository.js";
import { requiredEnvironment } from "./environment.js";
import {
  reconcileExpiredInventory,
  type InventoryExpiryReconciliationResult,
} from "./inventory-expiry-reconciler.js";

const inventory = new DynamoInventoryRepository(
  requiredEnvironment("INVENTORY_TABLE_NAME"),
  requiredEnvironment("INVENTORY_OUTBOX_TABLE_NAME"),
  { expiryIndexName: requiredEnvironment("INVENTORY_EXPIRY_INDEX_NAME") },
);
const batchLimit = Number(requiredEnvironment("INVENTORY_EXPIRY_BATCH_LIMIT"));
if (!Number.isInteger(batchLimit) || batchLimit < 1 || batchLimit > 100) {
  throw new Error("INVENTORY_EXPIRY_BATCH_LIMIT must be an integer from 1 through 100");
}

export const handler: Handler<
  EventBridgeEvent<"Scheduled Event", Record<string, never>>,
  InventoryExpiryReconciliationResult
> = async () => {
  const result = await reconcileExpiredInventory(inventory, {
    clock: () => new Date(),
    limit: batchLimit,
  });
  console.info(JSON.stringify({ event: "InventoryExpiryReconciled", ...result }));
  return result;
};
