import {
  validateCommitInventoryCommand,
  validateInventoryCommandOutcome,
  validateReleaseInventoryCommand,
  validateReserveInventoryCommand,
  type InventoryCommandOutcome,
} from "@aws-architecture-lab/contracts";

import type { InventoryCommand } from "./dynamo-inventory-repository.js";
import { commandTypeOf } from "./domain-command.js";

export interface InventoryCommandExecutor {
  execute(command: InventoryCommand): Promise<InventoryCommandOutcome>;
}

export function createInventoryCommandHandler(inventory: InventoryCommandExecutor) {
  return async (event: unknown): Promise<InventoryCommandOutcome> => {
    const commandType = commandTypeOf(event);
    const validation = commandType === "ReserveInventory"
      ? validateReserveInventoryCommand(event)
      : commandType === "CommitInventory"
        ? validateCommitInventoryCommand(event)
        : commandType === "ReleaseInventory"
          ? validateReleaseInventoryCommand(event)
          : undefined;
    if (validation === undefined) throw new Error("Unsupported Inventory command");
    if (!validation.ok) throw new Error(validation.error);

    const outcome = await inventory.execute(validation.value);
    const outcomeValidation = validateInventoryCommandOutcome(outcome);
    if (!outcomeValidation.ok) throw new Error(outcomeValidation.error);
    return outcomeValidation.value;
  };
}
