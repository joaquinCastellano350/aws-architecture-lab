#!/usr/bin/env node
import { runAwsJson, runCdk } from "../lib/aws-cli.js";
import { executeCli, runEnvironmentPreflight } from "../lib/cli.js";
import {
  FOUNDATION_STACK_NAME,
  MARKETPLACE_CHECKOUT_STACK_NAME,
} from "../lib/foundation-config.js";

executeCli(() => {
  runEnvironmentPreflight();
  runCdk(["destroy", MARKETPLACE_CHECKOUT_STACK_NAME, "--exclusively", "--force"]);
  runAwsJson(["cloudformation", "describe-stacks", "--stack-name", FOUNDATION_STACK_NAME]);
  console.log(`Destroyed ${MARKETPLACE_CHECKOUT_STACK_NAME}; ${FOUNDATION_STACK_NAME} remains deployed.`);
});
