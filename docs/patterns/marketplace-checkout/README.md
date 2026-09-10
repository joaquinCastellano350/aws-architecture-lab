# Marketplace Checkout Saga

The current increment extends the walking skeleton through Inventory reservation, commit,
expiry, and abandoned-reservation reconciliation without claiming that Payment,
Fulfillment, or general compensation exist yet.

1. An IAM-authenticated caller submits the OpenAPI v1 checkout request with a client
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
6. A `RESERVED` outcome advances to a deadline check and then an idempotent commit. If the
   business deadline has elapsed, the workflow releases Inventory and records the Order as
   `EXPIRED`. An `OUT_OF_STOCK` outcome asks
   Order to record `INVENTORY_UNAVAILABLE`, so the polling client sees a truthful terminal
   result. Competing final-unit reservations and competing commit/release transitions have
   exactly one winner.
7. A one-minute expiry worker queries the `ReservationExpiryIndex` for due `RESERVED`
   records. It submits stable `CHECKOUT_EXPIRED` release commands; it never scans the table
   and never relies on DynamoDB TTL timing. The conditional reservation transition makes a
   sweep-versus-commit race choose one winner, while each operation ledger preserves the
   winner's replay result. Expiry releases receive a cleanup TTL seven days later.
8. An expired `InventoryReleased` fact drives an idempotent Order consumer. This durable
   handoff repairs a `PENDING` Order even when the expiry worker stops after releasing stock.
9. DynamoDB Streams invoke the domain outbox publishers. They send versioned event
   envelopes to the workload EventBridge bus, using native `source` and `detail-type`
   fields for routing. Partial batch failures retry only the failed records; exhausted
   records go to the encrypted failure queue.
10. The Order audit consumer records each distinct routed Order fact with a conditional write keyed by
   `eventId`. Repeated EventBridge delivery therefore succeeds without duplicating the
   audit record.

The Saga table stores admission and execution metadata under separate prefixed keys. The
Order and Inventory capabilities own their state and outbox tables; the coordinator has no
permission to write them. Inventory stores stock, reservation, and operation-ledger records
under prefixed keys. Identical operation replays return the recorded result, while reusing
an operation ID with a different payload is an invariant violation. Commands, outcomes,
and events are generated from versioned JSON Schemas. Business correlation remains
separate from the Step Functions execution ARN used as the event's causation identifier.
An operation is recorded as `IN_PROGRESS` before its atomic state transition; a retry can
safely resume an abandoned local operation, while conditional business failures become
stable `FAILED` results. DynamoDB transaction conflicts and throttling remain transient
errors and receive bounded full-jitter retries instead of being reported as business
rejections.
Each immutable workflow revision invokes pinned Order and Inventory handler versions.
Replaced workflow and handler versions are retained across updates.
Deleting each unqualified parent resource during ephemeral teardown deletes its associated
versions as well. Step Functions logging excludes execution data, and API payload logging
is disabled.

The deployed `workload:expiry` evidence command exercises the workflow deadline, abandoned
reservation recovery, duplicate sweeps and releases, and the real DynamoDB race between
commit and expiry. TTL remains cleanup-only evidence rather than a correctness mechanism.

This increment deliberately stops after Inventory expiry reconciliation. Payment,
Fulfillment, general compensation, and their additional operational evidence belong to
later issues in the parent plan.
