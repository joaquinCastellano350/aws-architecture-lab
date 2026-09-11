import { LambdaClient } from "@aws-sdk/client-lambda";
import { SFNClient } from "@aws-sdk/client-sfn";
import type { SQSHandler } from "aws-lambda";

import { requiredEnvironment } from "./environment.js";
import { createFulfillmentWorker } from "./fulfillment-worker.js";
import { LambdaFulfillmentHandoffExecutor } from "./lambda-fulfillment-handoff-executor.js";

const fulfillment = new LambdaFulfillmentHandoffExecutor(
  requiredEnvironment("FULFILLMENT_FUNCTION_ARN"),
  new LambdaClient({}),
);
const callbacks = new SFNClient({});

export const handler: SQSHandler = createFulfillmentWorker(fulfillment, callbacks);
