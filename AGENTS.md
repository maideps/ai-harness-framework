# AI Harness Framework

A general-purpose AI agent harness framework for building reliable, predictable multi-session engineering workflows. This repository serves as both the harness implementation and a reference template for bootstrapping harness-enabled projects.

## Startup Workflow

Before writing code:

1. **Confirm working directory** with `pwd`
2. **Read this file** completely
3. **Read project docs** (`docs/ARCHITECTURE.md`, `docs/PRODUCT.md`, README)
4. **Run `./init.sh`** to verify environment is healthy
5. **Read `feature_list.json`** to see current feature state
6. **Review recent commits** with `git log --oneline -5`

If baseline verification is failing, repair that first before adding new scope.

## Working Rules

- **One feature at a time**: Pick exactly one unfinished feature from `feature_list.json`
- **WIP=1**: Only one feature may be active at any time (`state: "active"` or compatibility alias `status: "in_progress"`). Complete and move to `passing` before activating the next.
- **Verification required**: Don't claim done without running verification commands
- **Update artifacts**: Before ending session, update `PROGRESS.md` and `feature_list.json`
- **Stay in scope**: Don't modify files unrelated to the current feature
- **Leave clean state**: Next session must be able to run `./init.sh` immediately
- **One logical operation per commit**: The repo must be in a consistent state after every commit
- **Update docs with code**: No stale documentation — update docs in the same commit as the code change

## Constraints

<!-- source: harness-engineering-template L03 — consistent-state predicate must be verifiable -->
<!-- why: without explicit MUST/MUST NOT rules, agents drift from the prescribed workflow -->

- **MUST** run `make check` (or equivalent verification) before every commit
  <!-- source: harness-engineering-template L03 — repo must have a verifiable consistent-state predicate -->
- **MUST NOT** mark a feature as `passing` manually — use `make verify-feature F=<id>` or the documented verification path
  <!-- source: harness-engineering-template L08 — state transitions must go through the harness gate -->
- **MUST** update `PROGRESS.md` at session end with current state, blockers, and next steps
  <!-- source: harness-engineering-template L05 — durable cross-session continuity requires written handoff -->
- **MUST NOT** skip verification layers (Layer 1 → Layer 2 → Layer 3 in order)
  <!-- source: harness-engineering-template L09 — each layer gates the next; skipping produces false confidence -->
- **MUST** keep features completable in a single session — if a feature spans multiple sessions, split it
  <!-- source: harness-engineering-template L08 — multi-session features lose context and degrade VCR -->
- **MUST** follow dual-mode cleanup: immediate cleanup at every session end + periodic (weekly/monthly) full-system sweep for structural drift
  <!-- source: harness-engineering-template L12 — structural drift accumulates silently without periodic sweeps -->

## State Files

Agents must read and update these files — they are the source of truth, not chat history:

| File | Purpose | When to Read | When to Update |
|---|---|---|---|
| `feature_list.json` | Feature state tracker | Session start | After every feature state change |
| `PROGRESS.md` | Session continuity log (canonical) | Session start | Session end |
| `claude-progress.md` | Compatibility alias for progress tracking | Session start (if used) | Session end (if used) |
| `DECISIONS.md` | Architectural decisions log | Before major decisions | After any architectural decision |
| `session-handoff.md` | Multi-session handoff notes | Session start (if present) | Session end (for large sessions) |

## Definition of Done

A feature is done only when ALL of the following are true:

- [ ] Target behavior is implemented
- [ ] Required verification actually ran (tests / lint / type-check / build)
- [ ] Layer 1 (syntax/static checks) passes
- [ ] Layer 2 (runtime behavior/tests) passes
- [ ] Layer 3 (system confirmation/e2e) passes when crossing component boundaries
- [ ] Evidence recorded in `feature_list.json` and `PROGRESS.md`
- [ ] Repository remains restartable from `./init.sh`

## Verification Commands

```bash
# Full verification (recommended) — make and npm forms are 1:1 mirrors
make check        # or: npm run check
```

Required checks (each with its npm mirror):
- `make lint` / `npm run lint` — Static analysis and code style
- `make typecheck` / `npm run typecheck` — Type checking (if applicable)
- `make test` / `npm run test` — Unit and integration tests
- `make build` / `npm run build` — Production build verification
- `make e2e` / `npm run e2e` — End-to-end tests (required for cross-component changes)

Other mirrors: `check-arch`, `verify-feature` (`npm run verify-feature -- <id>`), `vcr`, `session-start`, `session-end`, `clean-check`, `setup`, `dev`, `help`.

`make check` runs all layers in order (lint → typecheck → test → build → e2e). A layer that is not configured reports SKIP and does not count as verified; a failing layer stops the chain. Both surfaces delegate to the same Node runner (`scripts/framework-check.mjs`); `npm run check` is the make-free entrypoint.

## Architecture Boundaries

- Document architectural constraints in `.harness/arch-rules.json`
- The reusability seam contract lives in `.harness/manifest.json` and `docs/ARCHITECTURE.md` — keep both accurate in the same commit as any repository layout change
- Run `make check-arch` to enforce layer dependencies and invariants
- Every new error category caught in review becomes a rule in `.harness/arch-rules.json`
- See [Architecture Docs](docs/ARCHITECTURE.md) for the full layer model

## Observability

- Complete a sprint contract (`templates/sprint-contract.md`) before starting each feature
- Session traces are recorded to `.harness/traces/` via `make session-start` / `make session-end`
- Score completed sprints against `templates/evaluator-rubric.md` — every dimension must reach B or above
- See [Observability Docs](docs/OBSERVABILITY.md) for the full protocol

## Tools and MCP

- Tool access is scoped via `.claude/settings.json`
- MCP integrations and permitted capabilities are documented in `docs/TOOLS.md`
- Default permission for sensitive tools is `ask`, not `allow`

## Skills

Skills are reusable capability packs in `skills/` — one folder per skill, each with a `SKILL.md` (frontmatter: name and description; sections: When to Use, Workflow, Quick Reference). Load the relevant skill when starting that kind of work:

- `feature-cycle` — the one-feature-at-a-time loop
- `verification` — running the gates honestly and reading their output
- `session-handoff` — ending a session durably
- `adopt` — bootstrapping the harness in a new project
- `release` — the final pass before reporting work done
- `write-skill` — authoring new skills (project skills may be added under `skills/`)

Skill structure is validated by the lint layer; see the `write-skill` skill for the format.

## End of Session

Before ending a session:

1. Run `make clean-check` — confirms build passes, no debug artifacts, progress updated
2. Update `PROGRESS.md` with current state, decisions, blockers, and next steps
3. Update `feature_list.json` with the new feature state
4. Update `docs/quality-document.md` for modules touched (A/B/C/D per dimension)
5. Record any unresolved risks or blockers
6. Commit with descriptive message explaining WHY, not just what
7. Leave repo clean enough for next session to run `./init.sh` immediately

**If running low on context**: Do NOT rush to finish — stop, update `PROGRESS.md`, and commit a clean checkpoint.

## Escalation

If you encounter:
- **Architecture decisions**: Consult `docs/ARCHITECTURE.md` and `DECISIONS.md` first, then `docs/decisions/`
- **Unclear requirements**: Check `docs/PRODUCT.md` if present, otherwise ask user
- **Repeated test failures**: Update `PROGRESS.md`, flag for human review
- **Scope ambiguity**: Re-read `feature_list.json` for definition of done