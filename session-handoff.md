# Session Handoff

## Current Objective

- Goal: Opt-in push and commit-message hooks (feat-058), adapted from crux's git hooks.
- Current status: feat-055..058 are passing (feat-057 merged in PR #80); no active feature. feat-059 is planned.
- Branch / commit: `feat/feat-058-push-commit-hooks`

## Completed This Session

- [x] Merged PR #80 (feat-057) after its CI passed.
- [x] pre-push hook refuses a push to the default branch unless `HARNESS_ALLOW_DEFAULT_PUSH=1`.
- [x] commit-msg hook applies `.harness/commit-rules.json` (shipped disabled); lint validates it; merges and reverts pass.
- [x] USAGE (both copies), AGENTS.md, README, Makefile help, HARNESS.md and D-068 updated.

## Verification Evidence

| Check | Command | Result | Notes |
|---|---|---|---|
| Hook tests | `node --test --test-name-pattern="feat-058|feat-043" .harness/selftest/framework-check.selftest.mjs` | PASS | 6 tests, real bare remote |
| Full verification | `npm run check` | PASS | |
| Feature gate | `npm run verify-feature -- feat-058` | PASS | Bound evidence on f634779; 273 self-tests |

## Files Changed

- `scripts/framework-check.mjs`, `scripts/hooks/pre-push`, `scripts/hooks/commit-msg`, `.harness/selftest/`
- `templates/commit-rules.json`, `.harness/commit-rules.json`, `.harness/manifest.json`, `Makefile`
- `AGENTS.md`, `DECISIONS.md`, `README.md`, `docs/`, `templates/docs/USAGE.md`

## Decisions Made

- D-068: opt-in hooks refuse pushes to the default branch (with an explicit override) and check commit messages against pattern rules; no language detection.

## Blockers / Risks

- Hooks are opt-in per clone and `--no-verify` bypasses them; CI and branch protection stay the backstop.

## Next Session Startup

1. Read `AGENTS.md`, then run `./init.sh` and read the session brief it prints.
2. Read the latest note under `progress/`.
3. Before activating any feature, run `npm run clarify -- <id>` and record the answers.

## Recommended Next Step

- Merge this PR, then feat-059 (skill usage report).
