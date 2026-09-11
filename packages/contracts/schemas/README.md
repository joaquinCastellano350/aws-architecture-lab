# Contracts

OpenAPI is the source of truth for the public HTTP API. JSON Schema is the source of
truth for commands, outcomes, and domain events. `npm run generate` in the contracts
workspace regenerates TypeScript types and runtime validators; generated files are not
maintained independently.

The contracts currently define the versioned Order and Inventory commands, outcomes, and
domain-event envelopes. Payment adds provider-neutral authorize, capture, cancel, refund,
and retrieve commands, typed outcomes, and committed-fact envelopes. Later increments add
Fulfillment and compensation schemas without changing these v1 contracts in place.
