#!/usr/bin/env node
import { runCdk } from "../lib/aws-cli.js";
import { executeCli } from "../lib/cli.js";
import { FOUNDATION_STACK_NAME } from "../lib/foundation-config.js";

executeCli(() => runCdk(["synth", FOUNDATION_STACK_NAME]));
