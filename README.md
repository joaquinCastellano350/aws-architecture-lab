# AWS Architecture Lab

A cost-conscious, production-shaped AWS architecture learning lab. The first reference application is a marketplace checkout implemented as an orchestrated Saga.

## Repository shape

- `apps/marketplace-checkout`: the single initial application and its bounded-context modules
- `infra`: the AWS CDK application and stack boundaries
- `packages/contracts`: schema-first HTTP, command, outcome, and event contracts
- `packages/test-kit`: deterministic failure-injection and test utilities
- `docs/patterns`: architecture explanations and evidence

The architecture lab is the primary product, the documented portfolio is secondary, and reusable construct extraction happens only after two distinct applications demonstrate a stable seam.

## Commands

```shell
npm install
npm run build
npm test
npm run synth
```

On Windows PowerShell systems that block the `npm.ps1` shim, run the same commands with `npm.cmd`.

Deployment, verification, load, and teardown commands will be added with the walking-skeleton milestone.
