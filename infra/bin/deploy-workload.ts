#!/usr/bin/env node
import { runCdk } from "../lib/aws-cli.js";
import { executeCli, runEnvironmentPreflight } from "../lib/cli.js";
import { MARKETPLACE_CHECKOUT_STACK_NAME } from "../lib/foundation-config.js";

executeCli(() => {
  runEnvironmentPreflight();
  runCdk(["deploy", MARKETPLACE_CHECKOUT_STACK_NAME, "--exclusively", "--require-approval", "never"]);
});
