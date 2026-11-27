---
name: session-handoff
description: Ending a session durably — state files, traces, and a clean tree the next session can start from.
---
# Session Handoff

How to end a session so the next one can pick up without confusion.

## When to Use

- End of every working session
- Before context runs low — stop, write the handoff, commit a clean checkpoint
- Before leaving a feature half-done

## Workflow

1. Start this session's note with `node scripts/framework-check.mjs progress-new "<title>"` — it writes `progress/NNN-YYYY-MM-DD.md` with the right number, date, heading and sections, and refreshes `PROGRESS.md` — then fill in every section. "Mistakes caught" is `none`, or one entry per mistake caught this session (yours, a test's, review's) ending in what it became: `→ rule: <arch rule id>`, `→ test: <name>`, `→ lint: <check>`, or `→ no check possible: <reason>`; prefer adding the check now over the reason. Lint rejects an entry without one; `npm run clean-check` fails while it is blank. "Skills used" lists the skill folder names you loaded this session (`verification, commit`), or `none`; lint rejects a name that is not under `skills/`, and `npm run skill-usage` counts them. After any later state change, regenerate the current state and index with `node scripts/framework-check.mjs progress-update`. `PROGRESS.md` is generated; do not edit its block by hand.
2. Update `session-handoff.md` — current objective, completed items, verification evidence, files changed, decisions, risks, recommended next step.
3. Record decisions in `DECISIONS.md` (template at the top of the file); expand long records into `docs/decisions/`.
4. Update `README.md` so it describes the app as it is after this session's features: what it does, how to run it, what a user can do now. `npm run clean-check` fails until it changes after the latest verified feature, unless that feature declares `"readme": "<reason>"` because users see no change.
5. Update `docs/quality-document.md`: name each feature that passed this session and rate every module touched (A/B/C/D per dimension). `npm run clean-check` fails while a gate-verified feature is not mentioned.
6. Update the feature's `.harness/state/<id>.json` with the new state (only via `npm run verify-feature -- <id>`).
7. Record the trace: `npm run session-end` (merges end state, files modified, decisions, verification into the session start trace in `.harness/traces/`).
8. Run `npm run clean-check`, then commit — one logical operation per commit, message explaining WHY.

## Rules

- State files are the source of truth, not chat history.
- If running low on context: do NOT rush — add a concise note under `progress/`, regenerate `PROGRESS.md`, and commit a clean checkpoint.
- Leave the repo clean enough that the next session can run `./init.sh` immediately.

## Quick Reference

- [ ] Session note added and `PROGRESS.md` regenerated
- [ ] "Mistakes caught" filled in: `none`, or each mistake → the rule, test or lint check it became (or why none is possible)
- [ ] "Skills used" lists the skills loaded this session, or `none`
- [ ] session-handoff.md updated
- [ ] DECISIONS.md updated if decisions were made
- [ ] README.md describes the app after this session's features
- [ ] docs/quality-document.md updated for touched modules
- [ ] `npm run session-end` recorded
- [ ] `npm run clean-check` passes, committed
