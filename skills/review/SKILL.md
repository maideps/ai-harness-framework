---
name: review
description: Independent verification pass before the feature gate — scope, diff, and evidence.
---
# Review

An adversarial pass on your own work before it goes through the gate. It exists so the feature gate verifies something worth verifying.

## When to Use

- Before running `npm run verify-feature -- <id>`
- Before reporting a feature as done
- When picking up someone else's in-flight work

## Workflow

1. Re-read the feature definition in `feature_list.json` — behavior, verification criteria, dependencies. The diff must implement THAT feature, nothing else.
2. Review the diff file by file: scope creep, unrelated edits, debug artifacts, commented-out code, TODOs without owners.
3. Confirm the gates actually ran and their output was read — PASS vs SKIP must be reported separately; a SKIP is not evidence.
4. Check the feature's dependency chain: dependencies must be `passing` or the gate will refuse the transition.
5. Verify the evidence path: trail in `.harness/trails/` (via `npm run vcr`), evidence field in `feature_list.json`, state files updated.
6. Write down anything not verified — say it in the handoff instead of implying it.

## Rules

- Review is adversarial: assume the change is wrong until the evidence says otherwise.
- Never present a partial result as the whole.
- The gate is the mechanism; this pass is the discipline. Both are required.

## Quick Reference

- [ ] Feature definition re-read; diff matches it
- [ ] No scope creep or debug artifacts
- [ ] Gates ran; PASS/SKIP reported honestly
- [ ] Dependencies passing
- [ ] Evidence recorded and trail present
