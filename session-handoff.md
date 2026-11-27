# Session Handoff

## Current Objective

- Goal: Skill usage report (feat-059), adapted from crux's per-skill usage count.
- Current status: feat-055..059 are passing (feat-058 merged in PR #81); no active feature. feat-060 (skills load through a recording command) is drafted, to be declared next.
- Branch / commit: `feat/feat-059-skill-usage`

## Completed This Session

- [x] Merged PR #81 (feat-058) after its CI passed.
- [x] Session notes carry a Skills used line; lint checks the names against `skills/`.
- [x] `npm run skill-usage` and the report table: sessions and last date per skill, skills unused in 30 days.
- [x] USAGE (both copies), AGENTS.md, README, session-handoff and write-skill skills, HARNESS.md and D-069 updated.

## Verification Evidence

| Check | Command | Result | Notes |
|---|---|---|---|
| Feature tests | `node --test --test-name-pattern="feat-059|..." framework-check and report self-tests` | PASS | 17 tests |
| Full verification | `npm run check` | PASS | |
| Feature gate | `npm run verify-feature -- feat-059` | PASS | Bound evidence on 470eb03; 278 self-tests |

## Files Changed

- `scripts/framework-check.mjs`, `scripts/harness-report.mjs`, `.harness/selftest/`
- `package.json`, `Makefile`, `skills/session-handoff/`, `skills/write-skill/`
- `AGENTS.md`, `DECISIONS.md`, `README.md`, `docs/`, `templates/docs/USAGE.md`

## Decisions Made

- D-069: skill usage is recorded by the agent in the session note; the report reads the notes.

## Blockers / Risks

- Skills used is self-reported; feat-060 is meant to make it mechanical.

## Next Session Startup

1. Read `AGENTS.md`, then run `./init.sh` and read the session brief it prints.
2. Read the latest note under `progress/`.
3. Before activating any feature, run `npm run clarify -- <id>` and record the answers.

## Recommended Next Step

- Merge this PR; then the agent-compatibility docs with feat-060's declaration; then feat-060.
