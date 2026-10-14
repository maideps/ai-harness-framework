---
name: feature-cycle
description: The one-feature-at-a-time loop — activate, implement, verify through the gate, record evidence.
---
# Feature Cycle

The core workflow of this harness. Everything else serves this loop.

## When to Use

- Starting any implementation work on a feature
- Picking up a partially done feature in a new session
- Deciding what "done" means before writing code

## Workflow

1. Read `feature_list.json` — it is the source of truth, not chat history. To add a feature, use `npm run add-feature -- <id> <name> [--behavior ..] [--verification ..] [--depends a,b] [--layer label=cmd]` instead of hand-writing the JSON.
2. Pick exactly ONE unfinished feature. Leave every other feature alone.
3. Activate it with `npm run activate -- <id>`; the command refuses a second active feature or unmet dependencies and writes the state shard.
4. Confirm the contract: at most one active feature (WIP=1), and every dependency of the active feature must already be `passing`. `npm run test` enforces both.
5. Implement only that feature. Stay in scope — do not touch files unrelated to it.
6. Run `npm run check` before every commit. A layer that reports SKIP does not count as verified; a FAIL stops the chain.
7. When the behavior is implemented, run the gate:
   ```bash
   npm run verify-feature -- <feature-id>
   ```
   The gate runs the feature's own verification layers, refuses to pass it while dependencies are unmet, and records evidence in `.harness/state/<feature-id>.json` — feature_list.json itself is never rewritten. Never mark `passing` by hand.
8. Record a full-run trail: `npm run vcr` (check + check-arch + trail in `.harness/trails/`).
9. Update docs in the same commit as the code change — no stale documentation.

## Quick Reference

- [ ] Exactly one feature active before starting
- [ ] Dependencies of the active feature are passing
- [ ] `npm run check` before each commit
- [ ] `npm run verify-feature -- <id>` after implementation
- [ ] Evidence recorded in `.harness/state/<id>.json`
- [ ] Docs updated in the same commit
