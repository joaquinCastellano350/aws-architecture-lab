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

## Sandbox foundation

The foundation is the long-lived part of the lab. It contains only cost guardrails, the
restricted sandbox-admission roles, and a generated Stripe Sandbox secret placeholder.
It does not contain checkout workload resources.

Install AWS CLI v2, authenticate a profile for the dedicated sandbox account, and bootstrap
CDK in `us-east-1` before the first deployment.

Set the deployment guardrails in your shell before running any account command. For
PowerShell:

```powershell
$env:AWS_PROFILE = "your-sandbox-profile" # optional when the default profile is the sandbox
$env:AWS_SANDBOX_ACCOUNT_ID = "123456789012"
$env:AWS_REGION = "us-east-1"
$env:PAYMENT_PROVIDER_MODE = "fake" # or stripe-sandbox
$env:CHECKOUT_REQUEST_CEILING = "20" # hard maximum: 9000
$env:BUDGET_NOTIFICATION_EMAIL = "owner@example.com"
```

`LAMBDA_RESERVED_CONCURRENCY` is optional and applies to each marketplace-checkout Lambda.
Leave it unset when the account has no reservable concurrency, such as a new account with a
total concurrency quota of 10. Accounts with sufficient quota can opt in with a value from 1
through 10:

```powershell
# Constrained sandbox: remove the setting instead of assigning zero.
Remove-Item Env:LAMBDA_RESERVED_CONCURRENCY -ErrorAction SilentlyContinue

# Account with enough reservable concurrency: reserve this amount per Lambda.
$env:LAMBDA_RESERVED_CONCURRENCY = "3"
```

Do not set it to `0`: Lambda uses zero reserved concurrency to disable function invocations.

Then use the repeatable entry points from the repository root:

```shell
npm run preflight
npm run foundation:synth
npm run foundation:deploy
npm run foundation:verify
```

`foundation:deploy` always runs preflight first. It refuses missing/unusable credentials,
the wrong account or region, a provider other than the fake or Stripe Sandbox adapter, an
absent/invalid request ceiling, and missing budget notification configuration. AWS Budgets
will ask the notification recipient to confirm email subscriptions.

The USD 50 budget action attaches a deny policy to the output
`SandboxDeploymentRoleArn`. The deny stops new CloudFormation deployments and common
service scaling operations while leaving read access and CloudFormation teardown
available. The separate `SandboxCloudFormationExecutionRoleArn` is for CloudFormation
itself; it is not assumable by the sandbox deployment role.

The Stripe secret is created with a generated placeholder and AWS-managed encryption. To
replace it, keep the JSON payload in an ignored local file and pass that file to AWS CLI;
never put the value in source, CDK context, environment variables, or command arguments:

```powershell
aws secretsmanager put-secret-value `
  --secret-id aws-architecture-lab/sandbox/stripe `
  --secret-string file://.scratch/stripe-sandbox-secret.json
```

`foundation:verify` reads stack, processed-template, budget, action, anomaly, IAM-policy,
and secret metadata. It deliberately never calls `secretsmanager get-secret-value`.

## Marketplace checkout walking skeleton

The first ephemeral workload exposes the OpenAPI-defined `POST /checkouts` and
`GET /checkouts/{checkoutId}` operations. Both require IAM/SigV4. Submission is
asynchronous: a successful POST returns `202 Accepted` and a status location while a
Step Functions Standard execution, admitted through the `LIVE` alias, creates the
customer-visible pending Order, reserves Inventory without overselling, captures a
manual-capture Payment through a provider-neutral capability, commits Inventory, completes
an SQS-buffered Fulfillment handoff, and confirms the Order. Optional additive `itemId`
and `quantity` request fields select stock; older v1 clients use the deterministic lab item
and a quantity of one.

The Payment capability owns a durable operation ledger and transactional outbox. Its
deterministic fake provider persists separate provider state and uses semantic keys for
authorize, capture, cancel, and refund, so repeated requests preserve one economic result.
Sandbox failure plans are durable records in a dedicated table under the `FAILURE_PLAN#`
key namespace. They can be changed only through the output
`FakePaymentFailurePlanRoleArn`; the Payment and Fulfillment Lambdas have read-only access
and consume them
  to model fail-before-mutation, business rejection, throttling, timeout, duplicate delivery,
  and ambiguous completion. Production-reference
synthesis disables this test control plane when `WORKLOAD_PROFILE=production-reference`.
The workflow enters capture only after a typed Fulfillment capacity reservation. It then
commits Inventory and sends a versioned handoff command with a Step Functions task token
in the body of an encrypted SQS message. A dedicated worker role heartbeats, commits the
irreversible handoff idempotently, and completes the callback before Order becomes
`CONFIRMED`. Task tokens are never placed in message attributes, logs, traces, metrics,
errors, URLs, or persistence.

Before Payment capture, failure is terminal but fully reversible. Inventory rejection ends
without compensation. Payment authorization rejection or bounded retry exhaustion releases
Inventory once. Fulfillment reservation failure cancels the authorization and then releases
Inventory in reverse order. Stable operation IDs make every compensation idempotent, and the
Order becomes `CANCELLED` only after all required compensation outcomes are confirmed.

The OpenAPI 3.0 contract is versioned `4.0.0` and exposes `CANCELLED`, `CONFIRMED`, and
`EXPIRED` customer outcomes while
continuing to accept the existing v1 submission schema. Reservations carry a five-minute business deadline. The
workflow releases a reservation that reaches the deadline before commit and exposes the
Order as `EXPIRED`. A one-minute
reconciliation schedule queries the reservation-expiry index and releases abandoned
reservations idempotently; DynamoDB TTL is assigned only after expiry release and is used
solely for eventual storage cleanup. The resulting `InventoryReleased` fact independently
repairs a still-pending Order, so a worker failure between bounded contexts cannot leave the
customer-visible state permanently stale.

After the foundation has been deployed, use the same preflight environment shown above:

```shell
npm run workload:synth
npm run workload:deploy
npm run workload:smoke
npm run workload:expiry
npm run workload:failure
npm run workload:destroy
```

The smoke command signs real API requests with the active AWS credentials, repeats the
POST to prove idempotent admission, polls GET until the Order is `CONFIRMED`, and
verifies that Inventory is `COMMITTED`, Payment is `CAPTURED`, and Fulfillment is
`HANDED_OFF`. It then waits for the
committed `OrderPending` fact in the audit table, republishes that
event alongside a distinct event, and proves the audit consumer deduplicates the replay
without dropping the distinct fact. Destroy removes the ephemeral workload and verifies
that the foundation stack remains.

`workload:expiry` runs the deployed expiry evidence suite. It covers the workflow deadline,
an abandoned reservation, duplicate sweeps, duplicate release delivery, and a real DynamoDB
commit-versus-expiry race. It uses four uniquely named checkouts and requires
`CHECKOUT_REQUEST_CEILING` to be at least `4`.

`workload:failure` runs eight deployed scenarios through the immutable workflow alias. It
asserts Inventory rejection, all deterministic Payment failure effects, ambiguous-result
reconciliation, Fulfillment-reservation failure, reverse-order compensation, terminal Order
status, durable operation-ledger results, emitted outbox facts, and bounded state transitions.
It writes provider plans only through the narrowly scoped test role and requires
`CHECKOUT_REQUEST_CEILING` to be at least `8`.

Set `WORKLOAD_PROFILE=production-reference` before `workload:synth` to generate the
production-reference template without the failure-plan table, role, environment variables,
or read policies. The default `sandbox` profile retains the test control plane.
