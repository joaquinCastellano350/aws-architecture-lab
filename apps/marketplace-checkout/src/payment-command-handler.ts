import {
  validateAuthorizePaymentCommand,
  validateCancelPaymentCommand,
  validateCapturePaymentCommand,
  validatePaymentCommandOutcome,
  validateRefundPaymentCommand,
  validateRetrievePaymentCommand,
  type PaymentCommand,
  type PaymentCommandOutcome,
} from "@aws-architecture-lab/contracts";

import { commandTypeOf } from "./domain-command.js";

export interface PaymentCommandExecutor {
  execute(command: PaymentCommand): Promise<PaymentCommandOutcome>;
}

export function createPaymentCommandHandler(payment: PaymentCommandExecutor) {
  return async (event: unknown): Promise<PaymentCommandOutcome> => {
    const commandType = commandTypeOf(event);
    const validation = commandType === "AuthorizePayment"
      ? validateAuthorizePaymentCommand(event)
      : commandType === "CapturePayment"
        ? validateCapturePaymentCommand(event)
        : commandType === "CancelPayment"
          ? validateCancelPaymentCommand(event)
          : commandType === "RefundPayment"
            ? validateRefundPaymentCommand(event)
            : commandType === "RetrievePayment"
              ? validateRetrievePaymentCommand(event)
              : undefined;
    if (validation === undefined) throw new Error("Unsupported Payment command");
    if (!validation.ok) throw new Error(validation.error);

    const result = await payment.execute(validation.value);
    const outcome = validatePaymentCommandOutcome(result);
    if (!outcome.ok) throw new Error(outcome.error);
    return outcome.value;
  };
}
