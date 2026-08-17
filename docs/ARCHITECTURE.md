# Architecture

## Layer Model

The framework has two architecture concerns:

1. **Harness architecture** in this repository — the instruction, state, verification, and observability surfaces that make the framework reusable.
2. **Application architecture** in adopting repositories — the layered product code structure that the harness will later enforce.

During bootstrap (`feat-001`), the repository primarily validates harness architecture. Once an adopting project adds source code, teams should extend `.harness/arch-rules.json` with product-layer checks.

```
┌─────────────────────────────────────────────┐
│               Presentation Layer             │
│  (UI, CLI, API endpoints — user-facing)     │
├─────────────────────────────────────────────┤
│               Application Layer              │
│  (Use cases, orchestration, workflows)       │
├─────────────────────────────────────────────┤
│                 Domain Layer                  │
│  (Business logic, entities, rules)           │
├─────────────────────────────────────────────┤
│             Infrastructure Layer             │
│  (Persistence, networking, external APIs)    │
└─────────────────────────────────────────────┘
```

## Harness Boundaries

- Root operating manual and state files live at the repository root so every session can discover them immediately.
- Verification entrypoints live in `init.sh`, `Makefile`, and `scripts/`.
- Policy and enforcement rules live under `.harness/`.
- Durable user-facing guidance lives in `README.md` and `docs/`.

These boundaries are enforced today by `make check` and `make check-arch`. Verification layers report PASS, SKIP (not configured), or FAIL (stops the chain); only PASS counts as verified.

## Application Dependency Rules

Adopting projects should enforce the following layered rules once product code exists:

- Layers may only depend on layers below them
- Domain layer has zero external dependencies
- Infrastructure implements interfaces defined by domain
- Presentation never directly accesses infrastructure

## Enforcement

Architectural constraints are codified in `.harness/arch-rules.json` and enforced via:

```bash
make check-arch
```

Each rule in `arch-rules.json` must include:
- `id` — unique rule identifier
- `description` — what the rule checks
- `check` — the verification command or pattern
- `expect` — expected result
- `what` — human-readable description of the violation
- `why` — why this rule exists
- `fix` — actionable fix instructions

Bootstrap-time rules currently verify:

- required harness surfaces exist
- the feature tracker preserves WIP=1 and dependency order
- framework docs do not drift back to template placeholders

Adopting projects should add language- and framework-specific checks as the codebase grows.

## Module Documentation

Co-locate architecture decisions with the code or harness surface they affect. Product modules should contain brief architecture notes once they exist; until then, keep framework-wide decisions in the root docs.

## References

- [DECISIONS.md](../DECISIONS.md) — Recorded architectural decisions
- [docs/decisions/](../docs/decisions/) — Detailed decision records