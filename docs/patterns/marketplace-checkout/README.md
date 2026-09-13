# Marketplace Checkout Saga

The current increment makes every failure before Payment capture terminate safely. The
happy path still proceeds through provider-neutral Payment and SQS-buffered Fulfillment,
while reversible failures compensate with stable operation IDs and expose `CANCELLED` only
after every required compensation is confirmed.

1. An IAM-authenticated caller submits the OpenAPI-defined checkout request with a client
   idempotency key.
2. The API atomically admits that key and creates a Saga Execution record containing the
   business correlation identifier. After Step Functions admits the execution through
   `LIVE`, the API reads and records the immutable version that was actually selected.
3. The API starts the Step Functions Standard workflow through `LIVE` and immediately
   returns `202 Accepted` with the Checkout identifier and status location.
4. The workflow asks the Order capability to create its independently owned `PENDING`
   record and an immutable `OrderPending` outbox item in one DynamoDB transaction. A
   caller polls the status location to observe the customer-safe state.
5. The workflow sends a versioned reserve command to Inventory. Inventory atomically
   decrements available stock only when enough remains, and writes the reservation,
   durable operation result, and `InventoryReserved` outbox fact in the same transaction.
6. A `RESERVED` outcome advances to a versioned Payment authorization command. Payment
   records the operation as `IN_PROGRESS`, calls a provider-neutral manual-capture
   capability with a semantic key, and atomically records its stable result and
   `PaymentAuthorized` fact.
7. Payment authorization rejection or exhausted fail-before-mutation, timeout, or throttling
   retries releases Inventory exactly once. Because no authorization was confirmed, no Payment
   cancellation is invented. Only the successful release advances Order to `CANCELLED`.
8. A versioned Fulfillment reservation command owns capacity in its separate table and
   outbox. Only `fulfillmentReservation.status = RESERVED` advances to Payment capture,
   followed by the Inventory deadline check and idempotent commit. An `OUT_OF_STOCK` outcome asks
   Order to record `INVENTORY_UNAVAILABLE`, so the polling client sees a truthful terminal
   result. Competing final-unit reservations and competing commit/release transitions have
   exactly one winner.
9. If Fulfillment reservation fails before capture, the workflow confirms Payment cancellation,
   then Inventory release, and only then records `OrderCancelled`. Failure of either compensation
   leaves the Order pending rather than reporting a false cancellation.
10. After capture and Inventory commit, Step Functions places a versioned handoff command
   and task token in an encrypted SQS message body. The token is absent from attributes,
   logs, metrics, errors, URLs, traces, and persistence. The dedicated worker role can
   consume only this queue, mutate Fulfillment-owned records, and call the three callback
   actions against wildcard resources.
11. The worker heartbeats, commits the irreversible handoff and outbox fact atomically, and
   then reports success. Duplicate messages replay the durable operation outcome. A late
   `TaskTimedOut` callback is terminal, while transient callback failures return only that
   SQS record for retry. The callback has a five-minute absolute timeout and one-minute
   heartbeat interval.
12. A successful handoff asks Order to commit `CONFIRMED` and `OrderConfirmed` atomically.
    This ordering means Order cannot report success before Inventory is committed, Payment
    is captured, and Fulfillment accepts responsibility.
13. A one-minute expiry worker queries the `ReservationExpiryIndex` for due `RESERVED`
   records. It submits stable `CHECKOUT_EXPIRED` release commands; it never scans the table
   and never relies on DynamoDB TTL timing. The conditional reservation transition makes a
   sweep-versus-commit race choose one winner, while each operation ledger preserves the
   winner's replay result. Expiry releases receive a cleanup TTL seven days later.
14. An expired `InventoryReleased` fact drives an idempotent Order consumer. This durable
   handoff repairs a `PENDING` Order even when the expiry worker stops after releasing stock.
15. DynamoDB Streams invoke the domain outbox publishers. They send versioned event
   envelopes to the workload EventBridge bus, using native `source` and `detail-type`
   fields for routing. Partial batch failures retry only the failed records; exhausted
   records go to the encrypted failure queue.
16. The Order audit consumer records each distinct routed Order fact with a conditional write keyed by
   `eventId`. Repeated EventBridge delivery therefore succeeds without duplicating the
   audit record.

The Saga table stores admission and execution metadata under separate prefixed keys. The
Order, Inventory, Payment, and Fulfillment own their state and outbox tables; the coordinator has no
permission to write them. Inventory stores stock, reservation, and operation-ledger records
under prefixed keys. Payment stores semantic operation keys, payload hashes, state, stable
results, provider references, and timestamps. The deterministic provider uses a separate
durable table, keeping its storage model behind the provider capability. Identical operation
replays return the recorded result, while reusing
an operation ID with a different payload is an invariant violation. Commands, outcomes,
and events are generated from versioned JSON Schemas. Business correlation remains
separate from the Step Functions execution ARN used as the event's causation identifier.
An operation is recorded as `IN_PROGRESS` before its atomic state transition; a retry can
safely resume an abandoned local operation, while conditional business failures become
stable `FAILED` results. DynamoDB transaction conflicts and throttling remain transient
errors and receive bounded full-jitter retries instead of being reported as business
rejections.
When a provider response is lost after commit, Payment retrieves current provider state and
completes the abandoned `IN_PROGRESS` operation before any later mutation. Local provider
contract tests deterministically model fail-before-mutation, rejection, throttling, timeout,
duplicate delivery, cancellation, refund, and ambiguous completion, including zero duplicate
capture under replay.
The deployed fakes consume effects from durable `FAILURE_PLAN#<semantic-key>` records in a
dedicated failure-plan table. Payment supports the full deterministic provider matrix;
Fulfillment uses a business-rejection plan to return the typed `CAPACITY_UNAVAILABLE`
outcome without mutating capacity. Only the separately assumable
`FakePaymentFailurePlanRoleArn` can write that key namespace; domain Lambdas can only read
plans, and the role has no access to provider state, domain ledgers, or outbox records.
Production-reference synthesis omits the entire test control plane when
`WORKLOAD_PROFILE=production-reference`.
Each immutable workflow revision invokes pinned Order, Inventory, Payment, and Fulfillment handler versions.
Replaced workflow and handler versions are retained across updates.
Deleting each unqualified parent resource during ephemeral teardown deletes its associated
versions as well. Step Functions logging excludes execution data, and API payload logging
is disabled.

The deployed `workload:expiry` evidence command exercises the workflow deadline, abandoned
reservation recovery, duplicate sweeps and releases, and the real DynamoDB race between
commit and expiry. TTL remains cleanup-only evidence rather than a correctness mechanism.

The deployed `workload:failure` evidence command exercises eight bounded scenarios. It verifies
terminal Order state, durable operation results, emitted facts, exact-once compensation effects,
ambiguous-result reconciliation, and transition ceilings. It uses the test role for failure-plan
writes and direct workflow starts with known identifiers so provider plans remain deterministic.
Post-capture recovery and failures after the irreversible Fulfillment pivot remain later milestones.
