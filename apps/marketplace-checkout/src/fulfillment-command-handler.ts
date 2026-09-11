import {
  validateFulfillmentCommandOutcome,
  validateHandoffFulfillmentCommand,
  validateReserveFulfillmentCommand,
  type FulfillmentCommand,
  type FulfillmentCommandOutcome,
} from "@aws-architecture-lab/contracts";

import { commandTypeOf } from "./domain-command.js";

export interface FulfillmentCommandExecutor {
  execute(command: FulfillmentCommand): Promise<FulfillmentCommandOutcome>;
}

export function createFulfillmentCommandHandler(fulfillment: FulfillmentCommandExecutor) {
  return async (event: unknown): Promise<FulfillmentCommandOutcome> => {
    const commandType = commandTypeOf(event);
    const validation = commandType === "ReserveFulfillment"
      ? validateReserveFulfillmentCommand(event)
      : commandType === "HandoffFulfillment"
        ? validateHandoffFulfillmentCommand(event)
        : undefined;
    if (validation === undefined) throw new Error("Unsupported Fulfillment command");
    if (!validation.ok) throw new Error(validation.error);

    const result = await fulfillment.execute(validation.value);
    const outcome = validateFulfillmentCommandOutcome(result);
    if (!outcome.ok) throw new Error(outcome.error);
    return outcome.value;
  };
}
