# Contracts

OpenAPI is the source of truth for the public HTTP API. JSON Schema is the source of
truth for commands, outcomes, and domain events. `npm run generate` in the contracts
workspace regenerates TypeScript types and runtime validators; generated files are not
maintained independently.

The contracts currently define versioned Order, Inventory, Payment, and Fulfillment
commands, outcomes, and committed-fact envelopes. Fulfillment keeps reservation, cancellation,
and irreversible-handoff contracts independent of the SQS callback envelope. Compensation adds
customer-visible Order progress plus immutable Order, Payment, Inventory, and Fulfillment facts
without rewriting earlier effects.
