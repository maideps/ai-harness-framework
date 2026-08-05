# Observability

## Sprint Contract

Before starting each feature, fill out a sprint contract (`templates/sprint-contract.md`) that declares:
- What you intend to build
- How you'll verify it's correct
- What success looks like
- How long you expect it to take

The contract is the agent's commitment — it creates clear expectations and a baseline for evaluation.

## Session Traces

Every session is traceable through the harness infrastructure:

```bash
make session-start    # Record session start time and context
make session-end      # Record session end time, state, and outcomes
```

Traces are stored in `.harness/traces/` as timestamped JSON records with:
- Session start/end times
- Active feature ID
- Verification results (each layer)
- Files modified
- Decisions recorded

## Evaluator Rubric

After completing a sprint, score it against `templates/evaluator-rubric.md` across these dimensions:

| Dimension | Description | Target |
|---|---|---|
| Correctness | Does it pass all verification layers? | B+ |
| Completeness | Is the Definition of Done fully satisfied? | B+ |
| Cleanliness | Is the code well-structured, documented, and maintainable? | B+ |
| Continuity | Can the next session pick up without confusion? | B+ |

Every dimension must reach B or above before the feature is considered complete.

## Quality Document

After touching any module, update `docs/quality-document.md` with ratings (A/B/C/D) per dimension:
- Test coverage
- Type safety
- Documentation
- Architecture compliance
- Performance

## Verification Trail

Every `make check` run produces a verification trail. This is the proof that each layer was actually exercised:
- Layer 1: Lint/type-check output
- Layer 2: Test run summary
- Layer 3: Build artifact or e2e result

Record evidence in `feature_list.json` under each feature's `evidence` field.

## References

- [ARCHITECTURE.md](ARCHITECTURE.md) — System architecture
- [AGENTS.md](../AGENTS.md) — End-of-session protocol
- [templates/sprint-contract.md](../templates/sprint-contract.md)
- [templates/evaluator-rubric.md](../templates/evaluator-rubric.md)