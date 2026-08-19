# Session Handoff

## Current Objective

- Goal: Make the harness reusable by design — seam contract, runner consolidation, skills, portability, and now a proven adoption matrix (e2e layer is real). On the roadmap: multi-repo (feat-005) and distribution (feat-006).
- Current status: feat-001, feat-002, feat-003, feat-004, feat-008, feat-009 passing. Next up: feat-005 (Multi-repo Extension).
- Branch / commit: master (feat-004 assurance suite commit)

## Completed This Session

- [x] Adoption matrix (`scripts/adoption-matrix.mjs`): 5 cells (none/node/python/go/rust) × check-arch + product layers + feature cycle — all PASS, missing toolchains SKIP honestly
- [x] Customization-survival upgrade test: corrupt mustNotEdit surface → simulated upgrade → corruption restored, all customizations survived
- [x] Product-first stack detection (D-010) + tool-availability degradation
- [x] e2e mode runs the matrix (with cell recursion guard); Layer 2 runs runner unit tests (6 tests)
- [x] Hardening: SKIP-aware evidence in verify-feature, atomic session-trace merge, package.json 0.4.0, .nvmrc 18
- [x] feat-004 verified through its own layers; D-010 recorded

## Verification Evidence

| Check | Command | Result | Notes |
|---|---|---|---|
| Full check | `npm run check` | PASS | e2e layer real: 5 cells + upgrade test |
| Architecture | `npm run check-arch` | PASS | 5 rules (arch-001..005) |
| Feature gate | `npm run verify-feature -- feat-004` | PASS | evidence notes per-cell SKIPs |
| VCR trail | `npm run vcr` | recorded | .harness/trails/2026-08-19T19-22-18-232Z-vcr.json |
| Unit tests | `node --test tests/*.test.mjs` | 6/6 pass | part of Layer 2 |

## Files Changed

- scripts/adoption-matrix.mjs (new), tests/stack-detect.test.mjs (new)
- scripts/framework-check.mjs, scripts/stack-detect.mjs
- .harness/manifest.json (tests/ in core), package.json (0.4.0), .nvmrc (18)
- docs/ARCHITECTURE.md, DECISIONS.md (D-010), feature_list.json

## Decisions Made

- D-010: e2e = adoption matrix; product stacks win detection; upgrades overwrite mustNotEdit only; Layer 2 runs unit tests; SKIP-aware evidence.

## Blockers / Risks

- Real-toolchain coverage (pytest/ruff/go/rust) depends on the machine running the matrix; cells degrade to SKIP here.
- `npm run check` is slower now (five throwaway repos + upgrade test) — acceptable for the honesty gained.

## Next Session Startup

1. Read `AGENTS.md`.
2. Read `feature_list.json` and `PROGRESS.md`.
3. Review this handoff.
4. Run `./init.sh`, then `npm run check` before editing.

## Recommended Next Step

- Activate feat-005 (Multi-repo Extension): optional multi-repo component gated by the manifest (contracts/, tasks/, repositories/*/scripts/verify, scripts/verify-all) with graceful degradation when absent.
