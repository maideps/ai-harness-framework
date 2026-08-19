# Contracts

Cross-repository contracts live here — interface agreements that repositories depend on across boundaries:

- API schemas (OpenAPI, protobuf, GraphQL)
- Message/event shapes
- Shared data contracts

Rules:

- A contract change is a breaking change until every consumer repository is updated.
- Each contract file declares its owner and its consumers.
- `verify-all` does not run contracts themselves; repositories verify against them in their own `scripts/verify`.

## Existing Contracts

[List your contracts here, one section per contract.]
