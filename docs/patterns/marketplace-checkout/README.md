# Marketplace Checkout Saga

The walking skeleton establishes the first end-to-end path without claiming that the
remaining Saga steps exist yet.

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
5. A DynamoDB Stream invokes the Order outbox publisher. It sends the versioned event
   envelope to the workload EventBridge bus, using native `source` and `detail-type`
   fields for routing. Partial batch failures retry only the failed records; exhausted
   records go to the encrypted failure queue.
6. The audit consumer records each distinct fact with a conditional write keyed by
   `eventId`. Repeated EventBridge delivery therefore succeeds without duplicating the
   audit record.

The Saga table stores admission and execution metadata under separate prefixed keys. The
Order capability owns its state and outbox tables; the coordinator has no permission to
write either one. The Order command, outcome, and event are generated from versioned JSON
Schemas. Business correlation remains separate from the Step Functions execution ARN used
as the event's causation identifier. Each immutable workflow revision invokes a pinned
Order handler version. Replaced workflow and handler versions are retained across updates.
Deleting each unqualified parent resource during ephemeral teardown deletes its associated
versions as well. Step Functions logging excludes execution data, and API payload logging
is disabled.

This increment deliberately stops at `PENDING`. Inventory, Payment, Fulfillment,
compensation, their additional outboxes, and reconciliation belong to later issues in the
parent plan.
