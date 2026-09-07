import type { Handler } from "aws-lambda";
import {
  validateCreatePendingOrderCommand,
  type CreatePendingOrderOutcome,
} from "@aws-architecture-lab/contracts";

import { createPendingOrder } from "./dynamo-order-repository.js";
import { requiredEnvironment } from "./environment.js";

const orderTableName = requiredEnvironment("ORDER_TABLE_NAME");

export const handler: Handler<unknown, CreatePendingOrderOutcome> = async (event) => {
  const validation = validateCreatePendingOrderCommand(event);
  if (!validation.ok) throw new Error(validation.error);
  const order = await createPendingOrder(orderTableName, validation.value);
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
