# Contracts

OpenAPI is the source of truth for the public HTTP API. JSON Schema is the source of
truth for commands, outcomes, and domain events. `npm run generate` in the contracts
workspace regenerates TypeScript types and runtime validators; generated files are not
maintained independently.

The contracts currently define versioned Order, Inventory, Payment, Fulfillment, and
Reconciliation commands, outcomes, and committed-fact envelopes. Fulfillment keeps reservation,
cancellation, retrieval, and irreversible-handoff contracts independent of the SQS callback
envelope. Compensation exposes customer-visible Order progress without rewriting earlier effects;
exhaustion adds explicit actionable work events, audited replay, and resolution.
