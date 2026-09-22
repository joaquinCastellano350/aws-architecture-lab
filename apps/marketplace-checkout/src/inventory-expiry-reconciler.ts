import type { InventoryCommandOutcome } from "@aws-architecture-lab/contracts";

import type {
  InventoryCommand,
  InventoryReservation,
} from "./dynamo-inventory-repository.js";

export interface InventoryExpiryRepository {
  findExpiredReservations(
    cutoff: string,
    limit: number,
  ): Promise<readonly InventoryReservation[]>;
  execute(command: InventoryCommand): Promise<InventoryCommandOutcome>;
}

export interface InventoryExpiryReconciliationOptions {
  readonly clock: () => Date;
  readonly limit: number;
}

export interface InventoryExpiryReconciliationResult {
  readonly examined: number;
  readonly released: number;
  readonly alreadyFinalized: number;
  readonly attemptedReservationIds: readonly string[];
}

export async function reconcileExpiredInventory(
  inventory: InventoryExpiryRepository,
  options: InventoryExpiryReconciliationOptions,
): Promise<InventoryExpiryReconciliationResult> {
  const cutoff = options.clock().toISOString();
  const reservations = await inventory.findExpiredReservations(cutoff, options.limit);
  let released = 0;
  let alreadyFinalized = 0;

  for (const reservation of reservations) {
    const outcome = await inventory.execute({
      schemaVersion: "1.0",
      commandType: "ReleaseInventory",
      operationId: `expire-sweep-${reservation.reservationId}`,
      checkoutId: reservation.checkoutId,
      reservationId: reservation.reservationId,
      releaseReason: "CHECKOUT_EXPIRED",
      correlationId: reservation.correlationId,
      causationId: `expire-sweep-${reservation.reservationId}`,
    });
    if (outcome.status === "RELEASED") released += 1;
    else if (outcome.status === "RESERVATION_NOT_ACTIVE") alreadyFinalized += 1;
    else throw new Error(`Unexpected expiry release outcome: ${outcome.status}`);
  }

  return {
    examined: reservations.length,
    released,
    alreadyFinalized,
    attemptedReservationIds: reservations.map(({ reservationId }) => reservationId),
  };
}
