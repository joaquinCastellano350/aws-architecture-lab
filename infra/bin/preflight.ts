#!/usr/bin/env node
import { executeCli, runEnvironmentPreflight } from "../lib/cli.js";

executeCli(() => void runEnvironmentPreflight());
