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

1. Read `feature_list.json` — it is the source of truth, not chat history.
2. Pick exactly ONE unfinished feature. Set its `state` to `"active"` (or `status` to `"in_progress"`). Leave every other feature alone.
3. Confirm the contract: at most one active feature (WIP=1), and every dependency of the active feature must already be `passing`. `npm run test` enforces both.
4. Implement only that feature. Stay in scope — do not touch files unrelated to it.
5. Run `npm run check` before every commit. A layer that reports SKIP does not count as verified; a FAIL stops the chain.
6. When the behavior is implemented, run the gate:
   ```bash
   npm run verify-feature -- <feature-id>
   ```
   The gate runs the feature's own verification layers, refuses to pass it while dependencies are unmet, and records evidence in `feature_list.json`. Never mark `passing` by hand.
7. Record a full-run trail: `npm run vcr` (check + check-arch + trail in `.harness/trails/`).
8. Update docs in the same commit as the code change — no stale documentation.

## Quick Reference

- [ ] Exactly one feature active before starting
- [ ] Dependencies of the active feature are passing
- [ ] `npm run check` before each commit
- [ ] `npm run verify-feature -- <id>` after implementation
- [ ] Evidence recorded in `feature_list.json`
- [ ] Docs updated in the same commit
