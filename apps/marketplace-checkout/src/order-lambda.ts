import type { Handler } from "aws-lambda";
import {
  validateCreatePendingOrderCommand,
  validateMarkOrderExpiredCommand,
  validateMarkOrderInventoryUnavailableCommand,
  type CreatePendingOrderOutcome,
  type MarkOrderExpiredOutcome,
  type MarkOrderInventoryUnavailableOutcome,
} from "@aws-architecture-lab/contracts";

import {
  createPendingOrder,
  markOrderExpired,
  markOrderInventoryUnavailable,
} from "./dynamo-order-repository.js";
import { commandTypeOf } from "./domain-command.js";
import { requiredEnvironment } from "./environment.js";

const orderTableName = requiredEnvironment("ORDER_TABLE_NAME");
const outboxTableName = requiredEnvironment("ORDER_OUTBOX_TABLE_NAME");

export const handler: Handler<
  unknown,
  CreatePendingOrderOutcome | MarkOrderInventoryUnavailableOutcome | MarkOrderExpiredOutcome
> = async (event) => {
  if (commandTypeOf(event) === "MarkOrderExpired") {
    const validation = validateMarkOrderExpiredCommand(event);
    if (!validation.ok) throw new Error(validation.error);
    return markOrderExpired(orderTableName, outboxTableName, validation.value);
  }
  if (commandTypeOf(event) === "MarkOrderInventoryUnavailable") {
    const validation = validateMarkOrderInventoryUnavailableCommand(event);
    if (!validation.ok) throw new Error(validation.error);
    return markOrderInventoryUnavailable(
      orderTableName,
      outboxTableName,
      validation.value,
    );
  }
  const validation = validateCreatePendingOrderCommand(event);
  if (!validation.ok) throw new Error(validation.error);
  const order = await createPendingOrder(orderTableName, outboxTableName, validation.value);
  console.info(JSON.stringify({
    event: "OrderPending",
    checkoutId: order.checkoutId,
    correlationId: order.correlationId,
    status: order.status,
  }));
  return {
    schemaVersion: "1.0",
    checkoutId: order.checkoutId,
    correlationId: order.correlationId,
    status: order.status,
  };
};
