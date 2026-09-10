# Contracts

OpenAPI is the source of truth for the public HTTP API. JSON Schema is the source of
truth for commands, outcomes, and domain events. `npm run generate` in the contracts
workspace regenerates TypeScript types and runtime validators; generated files are not
maintained independently.

The contracts currently define the versioned Create Pending Order command and outcome,
the Order domain-event envelopes, and Inventory reserve, commit, release, outcome, and
event contracts. Later increments add Payment, Fulfillment, and compensation schemas
without changing these v1 contracts in place.
