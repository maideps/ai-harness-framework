# Session Handoff

## Current Objective

- Goal: Pull requests carry evidence for the commit they merge (feat-055), adapted from crux's commit-sealed receipt.
- Current status: feat-055 is passing; no active feature. feat-056..059 are declared and planned.
- Branch / commit: `feat/feat-055-evidence-check`

## Completed This Session

- [x] Compared the harness with crux and declared feat-055..059 (PR #77, merged).
- [x] `npm run evidence-check [-- --base <ref>]`: features that became passing on the branch need bound evidence for an ancestor of HEAD, after which only bookkeeping changed.
- [x] This repository's CI and the shipped template run it on pull requests with full history; `lint:ci-evidence` checks both in the framework repository.
- [x] AGENTS.md (mirrors and the MUST's enforced-by), USAGE (both copies), ARCHITECTURE, README, HARNESS.md and D-065 updated.

## Verification Evidence

| Check | Command | Result | Notes |
|---|---|---|---|
| Feature tests | `node --test --test-name-pattern=feat-055 .harness/selftest/framework-check.selftest.mjs` | PASS | 6 tests |
| Full verification | `npm run check` | PASS | |
| Feature gate | `npm run verify-feature -- feat-055` | PASS | Bound evidence in `.harness/state/feat-055.json`; 261 self-tests |
| Real history | `evidence-check --base f1e3c12` at 0f58fe5 | PASS | feat-054's own PR |

## Files Changed

- `scripts/framework-check.mjs`, `.harness/selftest/`
- `.github/workflows/ci.yml`, `templates/ci.yml`
- `Makefile`, `package.json`, `AGENTS.md`, `DECISIONS.md`, `README.md`, `docs/`, `templates/docs/USAGE.md`

## Decisions Made

- D-065: evidence is checked against the merged code at the pull request, only for newly passing features, excluding commits from the base.

## Blockers / Risks

- Merge commits' conflict resolutions are not inspected.
- Adopters with a customised ci.yml must add the evidence-check step themselves; harness-upgrade only reports the missing script.

## Next Session Startup

1. Read `AGENTS.md`, then run `./init.sh` and read the session brief it prints.
2. Read the latest note under `progress/`.
3. Before activating any feature, run `npm run clarify -- <id>` and record the answers.

## Recommended Next Step

- Merge this PR, then feat-056 (checks scoped to what the change touched).
