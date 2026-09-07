import { describe, expect, it } from "vitest";

import { boundedContexts } from "./index.js";

describe("marketplace checkout boundaries", () => {
  it("starts with the four agreed domain owners", () => {
    expect(boundedContexts).toEqual([
      "order",
      "inventory",
      "payment",
      "fulfillment",
    ]);
  });
});
