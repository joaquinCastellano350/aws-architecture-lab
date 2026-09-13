import type { Handler } from "aws-lambda";
import type { ReconciliationCommandOutcome } from "@aws-architecture-lab/contracts";

import { createReconciliationCommandHandler } from "./reconciliation-command-handler.js";
import { DynamoReconciliationRepository } from "./dynamo-reconciliation-repository.js";
import { requiredEnvironment } from "./environment.js";

const repository = new DynamoReconciliationRepository(
  requiredEnvironment("RECONCILIATION_TABLE_NAME"),
  requiredEnvironment("SAGA_TABLE_NAME"),
  requiredEnvironment("RECONCILIATION_OUTBOX_TABLE_NAME"),
);
const execute = createReconciliationCommandHandler(repository);

export const handler: Handler<unknown, ReconciliationCommandOutcome> = async (event) => {
  const result = await execute(event);
  console.info(JSON.stringify({
    event: result.status === "RESOLVED" ? "ReconciliationResolved" : "ReconciliationRequired",
    reconciliationId: result.reconciliationId,
    checkoutId: result.checkoutId,
    status: result.status,
    attempts: result.attempts,
  }));
  return result;
};
