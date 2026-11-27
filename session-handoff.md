# Session Handoff

## Current Objective

- Goal: Checks scoped to what the change touched (feat-056), adapted from crux's diff-classified quality gate.
- Current status: feat-055 and feat-056 are passing; no active feature. feat-057..059 are planned.
- Branch / commit: `feat/feat-056-scoped-check`

## Completed This Session

- [x] `npm run check` is a runner mode: a documentation-only change runs lint and reports the other steps as SKIP; anything else runs the new `check-full` chain.
- [x] `--full`, `make check FULL=1`, `HARNESS_CHECK_FULL=1` force the full chain; verify-feature and both CI workflows never scope.
- [x] feat-038 Layer 3, harness-upgrade (hint and missing-script report) and the adoption matrix follow `check-full`.
- [x] AGENTS.md, USAGE (both copies), ARCHITECTURE, README, HARNESS.md and D-066 updated.

## Verification Evidence

| Check | Command | Result | Notes |
|---|---|---|---|
| Feature tests | `node --test --test-name-pattern=feat-056 .harness/selftest/framework-check.selftest.mjs` | PASS | 5 tests, also with `HARNESS_CHECK_FULL=1` set |
| Full verification | `npm run check` | PASS | Scope: full (code changed) |
| Feature gate | `npm run verify-feature -- feat-056` | PASS | Bound evidence; 266 self-tests; first run failed on the leaked variable |

## Files Changed

- `scripts/framework-check.mjs`, `scripts/harness-upgrade.mjs`, `scripts/adoption-matrix.mjs`, `.harness/selftest/`
- `package.json`, `Makefile`, `.github/workflows/ci.yml`, `templates/ci.yml`
- `AGENTS.md`, `DECISIONS.md`, `README.md`, `docs/`, `templates/docs/USAGE.md`

## Decisions Made

- D-066: `check` is scoped to the change; the full chain is `check-full`; documentation-only changes run lint alone.

## Blockers / Risks

- Adopters with an older package.json keep the unscoped `check` until they move the chain to `check-full` by hand.
- A docs-only branch's other layers are verified only by CI or verify-feature.

## Next Session Startup

1. Read `AGENTS.md`, then run `./init.sh` and read the session brief it prints.
2. Read the latest note under `progress/`.
3. Before activating any feature, run `npm run clarify -- <id>` and record the answers.

## Recommended Next Step

- Merge this PR, then feat-057 (lanes get their own ports and environment).
