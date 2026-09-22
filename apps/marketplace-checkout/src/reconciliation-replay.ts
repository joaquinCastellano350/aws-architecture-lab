import type {
  CompensationKind,
  ReconciliationCommandOutcome,
  ReplayReconciliationCommand,
} from "@aws-architecture-lab/contracts";
import { reconciliationRecoveryPlan } from "@aws-architecture-lab/contracts";

import type {
  AdmittedReconciliationReplay,
  ReconciliationRecord,
} from "./dynamo-reconciliation-repository.js";
import { executionArnFor } from "./step-functions-arn.js";

export interface ReconciliationReplayRepository {
  beginReplay(command: ReplayReconciliationCommand): Promise<AdmittedReconciliationReplay>;
  failReplay(reconciliationId: string, operationId: string, reason: string): Promise<void>;
}

export interface ReconciliationWorkflowStarter {
  start(
    workflowVersionArn: string,
    name: string,
    input: ReconciliationWorkflowInput,
  ): Promise<{ readonly executionArn: string }>;
}

export interface ReconciliationWorkflowInput {
  readonly checkoutId: string;
  readonly correlationId: string;
  readonly inventoryReservation: { readonly reservationId: string };
  readonly paymentAuthorization: { readonly paymentId: string };
  readonly fulfillmentReservation: { readonly reservationId: string };
  readonly compensation: { readonly kind: CompensationKind };
  readonly reconciliationReplay: {
    readonly operationId: string;
    readonly attempts: number;
    readonly reconciliationId: string;
    readonly requiredAction: ReconciliationRecord["requiredAction"];
  };
}

export type ReconciliationReplayOutcome = ReconciliationCommandOutcome & {
  readonly executionArn: string;
};

export class ReconciliationReplayService {
  public constructor(
    readonly repository: ReconciliationReplayRepository,
    readonly workflow: ReconciliationWorkflowStarter,
  ) {}

  public async execute(
    command: ReplayReconciliationCommand,
  ): Promise<ReconciliationReplayOutcome> {
    const record = await this.repository.beginReplay(command);
    if (record.status === "RESOLVED") {
      return {
        schemaVersion: "1.0",
        reconciliationId: record.reconciliationId,
        checkoutId: record.checkoutId,
        status: "RESOLVED",
        attempts: record.attempts,
        executionArn: executionArnFor(record.workflowVersionArn, record.replayExecutionName),
      };
    }
    try {
      const execution = await this.workflow.start(
        record.workflowVersionArn,
        record.replayExecutionName,
        replayInput(record),
      );
      return {
        schemaVersion: "1.0",
        reconciliationId: record.reconciliationId,
        checkoutId: record.checkoutId,
        status: "REPLAYING",
        attempts: record.attempts,
        executionArn: execution.executionArn,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown replay admission failure";
      await this.repository.failReplay(record.reconciliationId, command.operationId, reason);
      throw error;
    }
  }
}

function replayInput(record: AdmittedReconciliationReplay): ReconciliationWorkflowInput {
  return {
    checkoutId: record.checkoutId,
    correlationId: record.correlationId,
    inventoryReservation: { reservationId: `reservation-${record.checkoutId}` },
    paymentAuthorization: { paymentId: `payment-${record.checkoutId}` },
    fulfillmentReservation: { reservationId: `fulfillment-${record.checkoutId}` },
    compensation: {
      kind: reconciliationRecoveryPlan[record.requiredAction].compensationKind,
    },
    reconciliationReplay: {
      operationId: record.replayOperationId,
      attempts: record.attempts,
      reconciliationId: record.reconciliationId,
      requiredAction: record.requiredAction,
    },
  };
}
