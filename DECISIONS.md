# Architectural Decisions Log

This file records significant architectural decisions, their context, alternatives considered, and consequences. It serves as durable cross-session memory for why the codebase is structured the way it is.

---

## Decision Template

```
### D-XXX: [Decision Title]

**Date:** YYYY-MM-DD
**Status:** proposed | accepted | deprecated | superseded by D-YYY
**Context:** [What problem are we solving? What constraints exist?]
**Decision:** [What did we decide to do?]
**Alternatives considered:**
- Alternative 1: [description] — Rejected because [reason]
- Alternative 2: [description] — Rejected because [reason]
**Consequences:**
- Positive: [benefits gained]
- Negative: [tradeoffs accepted]
```

---

## Recorded Decisions

### D-001: Verification layers report PASS / SKIP / FAIL

**Date:** 2026-08-17
**Status:** accepted
**Context:** Layer targets printed `[PASS]` even when no configuration existed (e.g. "No lint configuration found — skipping" followed by PASS), and `package.json` e2e/dev were `echo && exit 0`. This produced false confidence and violated the framework's own "skipping produces false confidence" principle.
**Decision:** Every verification layer reports exactly one of PASS (ran and succeeded), SKIP (not configured — does not count as verified), or FAIL (non-zero exit stops the chain). Unconfigured layers are represented by runner modes that print `[SKIP]` and exit 0.
**Alternatives considered:**
- Treating SKIP as PASS — rejected: indistinguishable from real verification.
- Failing on SKIP — rejected: harness-only bootstrap repos legitimately lack e2e.
**Consequences:**
- Positive: `make check` output is now an honest record of what actually ran.
- Negative: adopters must read the SKIP summary instead of assuming everything passed.

### D-002: e2e is part of make check

**Date:** 2026-08-17
**Status:** accepted
**Context:** `make check` ran lint → typecheck → test → build, but the Definition of Done requires Layer 3b (e2e) for cross-component changes, so `make check` could pass without e2e ever running.
**Decision:** `make check` runs all layers in order: lint → typecheck → test → build → e2e.
**Alternatives considered:**
- Keeping e2e separate — rejected: the gate must match the Definition of Done.
**Consequences:**
- Positive: the primary gate now matches the documented DoD.
- Negative: check is slightly slower on repos with real e2e suites.

### D-003: make vcr records a verification trail

**Date:** 2026-08-17
**Status:** accepted
**Context:** `make vcr` was documented as "Verify + check-arch + record" but recorded nothing.
**Decision:** After check and check-arch pass, `vcr` writes a JSON trail (kind, timestamp, git commit, active feature) to `.harness/trails/`.
**Alternatives considered:**
- Writing into feature evidence directly — rejected: trails are per-run records, not feature summaries.
**Consequences:**
- Positive: VCR runs leave durable, inspectable evidence.
- Negative: one small JSON file per vcr run.

### D-004: make-free verification path via npm scripts

**Date:** 2026-08-17
**Status:** accepted
**Context:** The framework requires make for its gates, but make is not present on all target environments (including the primary Windows machine this repo is developed on). Node is already a hard dependency via `scripts/framework-check.mjs`.
**Decision:** `package.json` exposes a `check` script (lint && typecheck && test && build && e2e) and feature layer commands reference the npm entrypoints; Makefile targets remain for environments with make.
**Alternatives considered:**
- Requiring make everywhere — rejected: needless environment coupling.
- Removing the Makefile — rejected: make targets are a documented, useful surface.
**Consequences:**
- Positive: verification works on any machine with Node; both surfaces stay in sync because they delegate to the same runner.
- Negative: two entry surfaces to keep aligned (mitigated by `ensureMakeTargets` and the npm mirror).

### D-005: Reusability is guaranteed by a classified seam contract

**Date:** 2026-08-18
**Status:** accepted
**Context:** "Reusable" is an aspiration until the framework states which files adopters may customize and which are invariant. Adopter skeletons (PROGRESS.md, feature_list.json) were conflated with this repo's own instance state.
**Decision:** `.harness/manifest.json` classifies every surface as CORE (ships as-is, must not edit), TEMPLATE (skeletons in `templates/`), or INSTANCE (project-owned state that never ships). The manifest is validated by a `manifest` runner mode and enforced by arch-004. Layout changes must update the manifest and docs/ARCHITECTURE.md in the same commit.
**Alternatives considered:**
- Prose-only seam documentation — rejected: drift is invisible without a machine check.
- A separate package repository for the core — rejected for now: one repo serving as both product and dogfood instance is simpler at this stage.
**Consequences:**
- Positive: upgrade survival, adoption, and distribution can all be tested against one machine-readable contract.
- Negative: every layout change now has one extra file to keep accurate (accepted cost).