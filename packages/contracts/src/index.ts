export const contractStrategy = {
  commandsAndEvents: "json-schema",
  http: "openapi",
} as const;

export * from "./generated/checkout-api.js";
export * from "./generated/order-command.js";
