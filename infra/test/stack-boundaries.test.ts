import { App } from "aws-cdk-lib";
import { describe, expect, it } from "vitest";

import { MarketplaceCheckoutStack } from "../lib/marketplace-checkout-stack.js";
import { SandboxFoundationStack } from "../lib/sandbox-foundation-stack.js";

describe("stack boundaries", () => {
  it(
    "keeps the ephemeral workload independent from the foundation stack",
    () => {
      const app = new App();
      new SandboxFoundationStack(app, "Foundation");
      const workload = new MarketplaceCheckoutStack(app, "Workload");

      expect(workload.node.dependencies).toHaveLength(0);
      expect(() => app.synth()).not.toThrow();
    },
    60_000,
  );
});
