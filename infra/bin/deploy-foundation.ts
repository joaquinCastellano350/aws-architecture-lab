#!/usr/bin/env node
import { runCdk } from "../lib/aws-cli.js";
import { executeCli, runEnvironmentPreflight } from "../lib/cli.js";
import { FOUNDATION_STACK_NAME } from "../lib/foundation-config.js";

executeCli(() => {
  runEnvironmentPreflight();
  const notificationEmail = process.env.BUDGET_NOTIFICATION_EMAIL;
  if (notificationEmail === undefined) {
    throw new Error("BUDGET_NOTIFICATION_EMAIL is required.");
  }

  runCdk([
    "deploy",
    FOUNDATION_STACK_NAME,
    "--exclusively",
    "--require-approval",
    "never",
    "--parameters",
    `${FOUNDATION_STACK_NAME}:BudgetNotificationEmail=${notificationEmail}`,
  ]);
});
