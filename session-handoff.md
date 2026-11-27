# Session Handoff

## Current Objective

- Goal: Skills load through a harness command that records each use (feat-060).
- Current status: all 60 declared features are passing once this PR merges; no active feature, none planned.
- Branch / commit: `feat/feat-060-skill-command`

## Completed This Session

- [x] Merged PR #82 (feat-059) and PR #83 (agent-compatibility docs, feat-060 declaration).
- [x] `npm run skill -- <name>` prints a skill and records the load in a local, ignored log.
- [x] `progress-new` fills Skills used from the recorded loads; `clean-check` warns on an omitted one; lint requires AGENTS.md to name the command.
- [x] AGENTS.md, feature-cycle, session-handoff and write-skill skills, USAGE (both copies), README, HARNESS.md and D-070 updated.

## Verification Evidence

| Check | Command | Result | Notes |
|---|---|---|---|
| Feature tests | `node --test --test-name-pattern="feat-060|..." .harness/selftest/framework-check.selftest.mjs` | PASS | 14 tests |
| Full verification | `npm run check` | PASS | |
| Feature gate | `npm run verify-feature -- feat-060` | PASS | Bound evidence on 4d4722e; 283 self-tests |

## Files Changed

- `scripts/framework-check.mjs`, `.harness/selftest/`
- `package.json`, `Makefile`, `skills/feature-cycle/`, `skills/session-handoff/`, `skills/write-skill/`
- `AGENTS.md`, `DECISIONS.md`, `README.md`, `docs/`, `templates/docs/USAGE.md`

## Decisions Made

- D-070: skills load through `npm run skill`, which records each use; notes stay the shared record.

## Blockers / Risks

- Opening SKILL.md directly is not recorded; the log is per clone.

## Next Session Startup

1. Read `AGENTS.md`, then run `./init.sh` and read the session brief it prints.
2. Read the latest note under `progress/`.
3. Before activating any feature, run `npm run clarify -- <id>` and record the answers.

## Recommended Next Step

- Merge this PR. Then consider measuring Codex or Gemini CLI with the evals, or ignoring `.env` in `templates/gitignore`.
