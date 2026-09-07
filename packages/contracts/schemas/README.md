# Contracts

OpenAPI is the source of truth for the public HTTP API. JSON Schema is the source of
truth for commands, outcomes, and domain events. `npm run generate` in the contracts
workspace regenerates TypeScript types and runtime validators; generated files are not
maintained independently.

The walking skeleton currently defines the versioned Create Pending Order command and
outcome. Later increments add Inventory, Payment, Fulfillment, event, and compensation
schemas without changing this v1 contract in place.
