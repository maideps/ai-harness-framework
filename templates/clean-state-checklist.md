# Clean State Checklist

Run through this checklist at session end to confirm the repository is in a clean, restartable state.

---

## Before Commit

- [ ] `make lint` passes (Layer 1)
- [ ] `make test` passes (Layer 2)
- [ ] `make build` passes (Layer 3, if applicable)
- [ ] No debug artifacts (console.log, print, dump statements) remain
- [ ] No commented-out code blocks remain (remove or convert to issues)
- [ ] All new files have appropriate file headers / license

## State Files

- [ ] `PROGRESS.md` updated with current state, decisions, blockers, next steps
- [ ] `feature_list.json` updated with the new feature state
- [ ] `DECISIONS.md` updated with any new architectural decisions
- [ ] `session-handoff.md` filled out (for large sessions)
- [ ] `docs/quality-document.md` updated for modules touched

## Startup Path

- [ ] `./init.sh` exits successfully (0)
- [ ] No manual setup steps required beyond what init.sh covers
- [ ] Dependencies are declared (package.json, pyproject.toml, go.mod, etc.)

## Git State

- [ ] `git status` shows only intentional changes
- [ ] Commit message explains WHY, not just what
- [ ] No .DS_Store, Thumbs.db, or editor temp files staged

## Documentation

- [ ] README is current and accurate
- [ ] Architecture docs match code (no stale references)
- [ ] API docs updated if public interfaces changed

## Next Session Preview

- [ ] `feature_list.json` has exactly one feature with `state: "active"` (or zero)
- [ ] The next feature in dependency order is clearly identified
- [ ] No blockers that would prevent the next session from starting

---

**Target:** All items checked before `git commit`.