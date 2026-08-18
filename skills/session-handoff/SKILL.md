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

1. Update `PROGRESS.md` — current verified state, what this session completed, blockers, next best step. It is the canonical continuity log.
2. Update `session-handoff.md` — current objective, completed items, verification evidence, files changed, decisions, risks, recommended next step.
3. Record decisions in `DECISIONS.md` (template at the top of the file); expand long records into `docs/decisions/`.
4. Update `docs/quality-document.md` for every module touched (A/B/C/D per dimension).
5. Update `feature_list.json` with the new feature state (only via `npm run verify-feature -- <id>`).
6. Record the trace: `npm run session-end` (merges end state, files modified, decisions, verification into the session start trace in `.harness/traces/`).
7. Run `npm run clean-check`, then commit — one logical operation per commit, message explaining WHY.

## Rules

- State files are the source of truth, not chat history.
- If running low on context: do NOT rush — update `PROGRESS.md` and commit a clean checkpoint.
- Leave the repo clean enough that the next session can run `./init.sh` immediately.

## Quick Reference

- [ ] PROGRESS.md updated (state, blockers, next step)
- [ ] session-handoff.md updated
- [ ] DECISIONS.md updated if decisions were made
- [ ] docs/quality-document.md updated for touched modules
- [ ] `npm run session-end` recorded
- [ ] `npm run clean-check` passes, committed
