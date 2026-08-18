---
name: commit
description: Creating focused commits — one logical operation per commit, with a message that explains why.
---
# Commit

How changes become history: focused, verifiable, explainable.

## When to Use

- Every time you are about to commit
- When splitting a large change into logical commits
- When reviewing whether a commit is ready

## Workflow

1. Run `npm run check` before the commit — a layer that fails blocks the commit.
2. Review what changed: `git diff` and `git status`. Only intended files; no debug artifacts, no OS files, no unrelated edits.
3. Stage ONE logical operation. Code and its docs go together — no stale documentation.
4. Write the message: a concise summary line that explains WHY the change exists, not a restatement of what it touches.
5. Commit, then confirm the tree state: the repository must be consistent after every commit.

## Rules

- Verification before every commit (the harness constraint, not a preference).
- One logical operation per commit — split rather than bundle.
- Docs update in the same commit as the code change.
- Never commit placeholders, debug output, or generated artifacts that do not belong to the change.

## Quick Reference

- [ ] `npm run check` passed
- [ ] Diff reviewed — only intended files
- [ ] One logical operation
- [ ] Message explains WHY
- [ ] Docs included in the same commit
