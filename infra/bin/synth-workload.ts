#!/usr/bin/env node
import { runCdk } from "../lib/aws-cli.js";
import { executeCli } from "../lib/cli.js";
import { MARKETPLACE_CHECKOUT_STACK_NAME } from "../lib/foundation-config.js";

executeCli(() => runCdk(["synth", MARKETPLACE_CHECKOUT_STACK_NAME]));
