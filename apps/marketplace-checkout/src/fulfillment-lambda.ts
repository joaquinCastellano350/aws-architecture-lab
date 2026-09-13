import type { Handler } from "aws-lambda";
import type { FulfillmentCommandOutcome } from "@aws-architecture-lab/contracts";

import { DynamoFulfillmentRepository } from "./dynamo-fulfillment-repository.js";
import { createFulfillmentCommandHandler } from "./fulfillment-command-handler.js";
import { requiredEnvironment } from "./environment.js";

const fulfillment = new DynamoFulfillmentRepository(
  requiredEnvironment("FULFILLMENT_TABLE_NAME"),
  requiredEnvironment("FULFILLMENT_OUTBOX_TABLE_NAME"),
  process.env.FULFILLMENT_FAILURE_PLAN_TABLE_NAME === undefined
    ? {}
    : { failurePlanTableName: process.env.FULFILLMENT_FAILURE_PLAN_TABLE_NAME },
);

export const handler: Handler<unknown, FulfillmentCommandOutcome> =
  createFulfillmentCommandHandler(fulfillment);
