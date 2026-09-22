import type { CreateReconciliationCommand } from "./generated/reconciliation-command.js";

export type ReconciliationRequiredAction = CreateReconciliationCommand["requiredAction"];

export type CompensationKind =
  | "INVENTORY_ONLY"
  | "PAYMENT_AUTHORIZATION"
  | "RESERVED_FULFILLMENT"
  | "CAPTURED_PAYMENT"
  | "NONE";

export type ReconciliationWorkflowStep =
  | "RELEASE_INVENTORY"
  | "CANCEL_PAYMENT_AUTHORIZATION"
  | "CANCEL_FULFILLMENT_RESERVATION"
  | "REFUND_CAPTURED_PAYMENT"
  | "HANDOFF_FULFILLMENT"
  | "CONFIRM_ORDER";

export const reconciliationRecoveryPlan = {
  COMPENSATE_INVENTORY: {
    compensationKind: "INVENTORY_ONLY",
    workflowStep: "RELEASE_INVENTORY",
  },
  COMPENSATE_PAYMENT_AUTHORIZATION: {
    compensationKind: "PAYMENT_AUTHORIZATION",
    workflowStep: "CANCEL_PAYMENT_AUTHORIZATION",
  },
  COMPENSATE_RESERVED_FULFILLMENT: {
    compensationKind: "RESERVED_FULFILLMENT",
    workflowStep: "CANCEL_FULFILLMENT_RESERVATION",
  },
  COMPENSATE_CAPTURED_PAYMENT: {
    compensationKind: "CAPTURED_PAYMENT",
    workflowStep: "REFUND_CAPTURED_PAYMENT",
  },
  RECOVER_FULFILLMENT_HANDOFF: {
    compensationKind: "NONE",
    workflowStep: "HANDOFF_FULFILLMENT",
  },
  CONFIRM_ORDER: {
    compensationKind: "NONE",
    workflowStep: "CONFIRM_ORDER",
  },
} as const satisfies Record<
  ReconciliationRequiredAction,
  {
    readonly compensationKind: CompensationKind;
    readonly workflowStep: ReconciliationWorkflowStep;
  }
>;
