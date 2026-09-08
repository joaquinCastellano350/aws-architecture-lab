# Contracts

OpenAPI is the source of truth for the public HTTP API. JSON Schema is the source of
truth for commands, outcomes, and domain events. `npm run generate` in the contracts
workspace regenerates TypeScript types and runtime validators; generated files are not
maintained independently.

The contracts currently define the versioned Create Pending Order command and outcome,
plus the OrderPending domain-event envelope. Later increments add Inventory, Payment,
Fulfillment, and compensation schemas without changing these v1 contracts in place.
