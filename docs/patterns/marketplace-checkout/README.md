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
   record. A caller polls the status location to observe that customer-safe state.

The Saga table stores admission and execution metadata under separate prefixed keys; the
Order table stores only Order-owned state. The coordinator has no permission to write the
Order table. Workflow input contains checkout, cart, and correlation identifiers only,
and the Order command/outcome are generated from versioned JSON Schemas. Each immutable
workflow revision invokes a pinned Order handler version. Replaced workflow and handler
versions are retained across updates. Deleting each unqualified parent resource during
ephemeral teardown deletes its associated versions as well. Step Functions logging
excludes execution data, and API payload logging is disabled.

This increment deliberately stops at `PENDING`. Inventory, Payment, Fulfillment,
compensation, outboxes, and reconciliation belong to later issues in the parent plan.
