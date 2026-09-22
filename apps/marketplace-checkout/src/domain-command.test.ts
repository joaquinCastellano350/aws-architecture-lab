import { describe, expect, it } from "vitest";

import { stablePayloadHash } from "./domain-command.js";

describe("stable command payload hashing", () => {
  it("ignores delivery causation while retaining business payload identity", () => {
    const command = {
      commandType: "RefundPayment",
      operationId: "refund-checkout-123",
      checkoutId: "checkout-123",
      amountMinor: 1250,
      causationId: "execution-1",
    };

    expect(stablePayloadHash({ ...command, causationId: "execution-2" }))
      .toBe(stablePayloadHash(command));
    expect(stablePayloadHash({ ...command, amountMinor: 1300 }))
      .not.toBe(stablePayloadHash(command));
  });
});
