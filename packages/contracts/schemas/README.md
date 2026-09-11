# Contracts

OpenAPI is the source of truth for the public HTTP API. JSON Schema is the source of
truth for commands, outcomes, and domain events. `npm run generate` in the contracts
workspace regenerates TypeScript types and runtime validators; generated files are not
maintained independently.

The contracts currently define versioned Order, Inventory, Payment, and Fulfillment
commands, outcomes, and committed-fact envelopes. Fulfillment keeps reservation and
irreversible-handoff contracts independent of the SQS callback envelope. Later increments
add compensation schemas without changing these v1 contracts in place.
