# Marketplace Checkout Saga

The current increment extends the walking skeleton through Inventory reservation and
commit without claiming that Payment, Fulfillment, or compensation exist yet.

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
6. A `RESERVED` outcome advances to an idempotent commit. An `OUT_OF_STOCK` outcome asks
   Order to record `INVENTORY_UNAVAILABLE`, so the polling client sees a truthful terminal
   result. Competing final-unit reservations and competing commit/release transitions have
   exactly one winner.
7. DynamoDB Streams invoke the domain outbox publishers. They send versioned event
   envelopes to the workload EventBridge bus, using native `source` and `detail-type`
   fields for routing. Partial batch failures retry only the failed records; exhausted
   records go to the encrypted failure queue.
8. The Order audit consumer records each distinct routed Order fact with a conditional write keyed by
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

This increment deliberately stops after Inventory commit. Payment, Fulfillment,
compensation, expiry reconciliation, and their additional operational evidence belong to
later issues in the parent plan.
