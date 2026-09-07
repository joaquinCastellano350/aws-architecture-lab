#!/usr/bin/env node
import { executeCli, runEnvironmentPreflight } from "../lib/cli.js";
import { verifyDeployedFoundation } from "../lib/verify-foundation.js";

executeCli(() => {
  const report = runEnvironmentPreflight();
  verifyDeployedFoundation(report.account, process.env);
});
