export const boundedContexts = [
  "order",
  "inventory",
  "payment",
  "fulfillment",
] as const;

export type BoundedContext = (typeof boundedContexts)[number];
