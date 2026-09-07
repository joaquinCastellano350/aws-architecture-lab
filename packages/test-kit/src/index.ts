export const failureModes = [
  "before-mutation",
  "after-commit",
  "timeout",
  "throttle",
  "duplicate-delivery",
  "compensation-failure",
] as const;

export type FailureMode = (typeof failureModes)[number];
