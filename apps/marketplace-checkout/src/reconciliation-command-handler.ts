import {
  validateCreateReconciliationCommand,
  validateReconciliationCommandOutcome,
  validateResolveReconciliationCommand,
  type ReconciliationCommandOutcome,
} from "@aws-architecture-lab/contracts";

import type { DynamoReconciliationRepository } from "./dynamo-reconciliation-repository.js";
import { commandTypeOf } from "./domain-command.js";

export function createReconciliationCommandHandler(
  repository: Pick<DynamoReconciliationRepository, "create" | "resolve">,
) {
  return async (event: unknown): Promise<ReconciliationCommandOutcome> => {
    const commandType = commandTypeOf(event);
    const result = commandType === "CreateReconciliation"
      ? await create(repository, event)
      : commandType === "ResolveReconciliation"
        ? await resolve(repository, event)
        : undefined;
    if (result === undefined) throw new Error("Unsupported Reconciliation command");
    const validation = validateReconciliationCommandOutcome(result);
    if (!validation.ok) throw new Error(validation.error);
    return validation.value;
  };
}

async function create(
  repository: Pick<DynamoReconciliationRepository, "create">,
  event: unknown,
): Promise<ReconciliationCommandOutcome> {
  const validation = validateCreateReconciliationCommand(event);
  if (!validation.ok) throw new Error(validation.error);
  return repository.create(validation.value);
}

async function resolve(
  repository: Pick<DynamoReconciliationRepository, "resolve">,
  event: unknown,
): Promise<ReconciliationCommandOutcome> {
  const validation = validateResolveReconciliationCommand(event);
  if (!validation.ok) throw new Error(validation.error);
  return repository.resolve(validation.value);
}
