---
name: release
description: Final pre-release pass — full verification, evidence trail, and a clean committed tree.
---
# Release

The final pass before a change is considered shippable.

## When to Use

- Before finishing a feature and reporting it done
- Before tagging or publishing a release
- When a change crosses component boundaries

## Workflow

1. Run the full chain: `npm run check`. Cross-component changes additionally need Layer 3b (e2e) actually PASSing — a SKIP does not count.
2. Run `npm run check-arch` — all architecture rules, including manifest classification.
3. Record durable evidence: `npm run vcr` (check + check-arch + trail in `.harness/trails/`).
4. Review what changed: `git diff`, `git status` — only intended files, no debug artifacts, no OS files.
5. Update the state files (see the session-handoff skill), then commit with a message explaining WHY, not what.
6. Finish with `npm run clean-check` on the clean tree and record `npm run session-end`.

## Rules

- One logical operation per commit — the repo must be consistent after every commit.
- Never present a partial result as the whole; say what was not verified.
- External publication (push, publish, deploy) happens only with explicit authorization.

## Quick Reference

- [ ] `npm run check` — all layers, output read
- [ ] e2e PASSed if the change crosses components (SKIP is not enough)
- [ ] `npm run vcr` — evidence trail recorded
- [ ] Diff reviewed — only intended changes
- [ ] `npm run clean-check` — ALL PASS on the clean tree
