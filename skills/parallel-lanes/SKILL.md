---
name: parallel-lanes
description: An agent detects which planned features are safe to run in parallel, proposes the plan, and waits for a human to approve before creating any lane or starting another session.
---
# Parallel Lanes

Turns Worktree Lanes (D-017) from something a human drives by hand into something an
agent can propose on its own — without ever acting on its own. Detection is automatic;
every state-changing step still needs an explicit human yes.

## When to Use

- You (the agent) notice more than one `planned` feature in `feature_list.json` and
  wonder whether they could be developed at the same time
- A human asks "what can we parallelize right now?"
- You are about to start a single feature and want to check first whether starting it
  alongside another one is worth proposing

## Workflow

1. **Detect.** Run `npm run lane-suggest`. It is read-only — no worktree, no branch, no
   state write — and reports one of three things: nothing startable, exactly one
   startable feature (no parallel benefit), or a set of features that are all
   dependency-graph independent right now (none is waiting on another in that set).
2. **Propose, don't act.** If `lane-suggest` reports two or more candidates, present the
   set to the human in plain language — which features, why they're independent, what
   the lane commands would be — and ask whether to proceed. Do not run `lane-new` before
   they say yes. This is the same bar as any other hard-to-reverse action: creating a
   worktree and branch is cheap to undo, but starting other agent sessions on your own
   initiative is not something to do silently.
3. **On approval, create one lane per approved feature.**
   ```bash
   npm run lane-new -- <feature-id>
   ```
   Repeat for each feature the human approved — skip any they didn't. Each lane is an
   independent sibling worktree (`../<repo>-lane-<feature-id>`) on branch
   `lane/<feature-id>`.
4. **Hand each lane to its own session.** Open a separate agent session (or terminal)
   rooted at each lane's worktree directory, scoped to that one feature only. Tell it
   explicitly: work only `<feature-id>` in this directory; do not touch the other lanes.
   Running two agents against the same worktree is not supported — one worktree, one
   active writer.
5. **Supervise, don't race ahead.** Check `npm run lane-list` periodically. A lane is
   ready to land only once its own `.harness/state/<feature-id>.json` is committed as
   `passing` inside that lane (never fake this from outside the lane).
6. **Land one at a time, each with confirmation.** For each lane reported `passing`:
   confirm with the human, then run `npm run lane-land -- <feature-id>` from the branch
   you're merging into. Land lanes one at a time rather than batching merges — a merge
   is a shared-state, hard-to-reverse-cleanly action, so each one gets its own go-ahead.
7. **Expect — and fix — the one residual conflict.** `lane-suggest`'s independence check
   is dependency-graph safety only; it does not know whether two features touch the same
   files. If a land produces a merge conflict (most likely in the generated
   `PROGRESS.md`), resolve it and re-run `node scripts/framework-check.mjs
   progress-update`; this is expected occasionally and is not a sign the lanes were
   wrongly judged independent.

## Rules

- Never call `lane-new`, start another session, or call `lane-land` without the human
  having said yes to that specific step — an earlier approval does not cover a later one.
- `lane-suggest` never writes anything. If it ever needs to, that's a bug.
- One active writer per worktree. Don't point two sessions at the same lane directory.
- A feature with unmet dependencies, already `blocked`, or already claimed by an
  existing `lane/*` branch never appears as a candidate — don't propose it anyway.

## Quick Reference

- [ ] `npm run lane-suggest` run and read before proposing anything
- [ ] Candidate set presented to the human in plain language
- [ ] Explicit approval received before any `lane-new`
- [ ] One session per lane, each scoped to its one feature
- [ ] `lane-list` checked before claiming a lane is ready
- [ ] Each `lane-land` confirmed individually, landed one at a time
