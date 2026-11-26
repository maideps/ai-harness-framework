---
name: clarify
description: Before activating a feature, find what its declaration leaves open, answer each question from the repository or the human, and record the answers in its state shard.
---
# Clarify

A feature's `behavior` is the spec, but a spec written in one sitting leaves things open: a term nobody defined, an edge case nobody mentioned, a sentence the verification never checks. Guessing those mid-implementation is how a feature ends up doing something nobody asked for. Clarify settles them before the feature is activated, and leaves a record of what was decided and why.

## When to Use

- Before `npm run activate -- <id>`: activate refuses a feature with no clarifications recorded
- When a feature's behavior reads as obvious: record `none` if it really is, it costs one command
- When `npm run brief` shows `clarifications: skipped` for the active feature

## Workflow

1. **Print the checklist.** `npm run clarify -- <id>` shows the feature's behavior, verification and dependencies, five fixed questions, and the flags it finds mechanically: vague wording (etc, properly, as needed, TODO, …), a verification that names no test or command, and behavior sentences the verification text never mentions. The flags are hints, not verdicts; the questions still need answers.
2. **Answer from the repository first.** For each open question, look in the code, `docs/`, `DECISIONS.md` and the features this one depends on. An answer found there cites the file (`docs/USAGE.md`, `scripts/framework-check.mjs:120`).
3. **Ask the human only what the repository cannot answer.** Ask all the open questions at once, each with the option you would pick. Their answers get the source `human`.
4. **Stop if an answer changes what done means.** If the answer adds, removes or changes behavior, it does not belong in the answers: ask for the `behavior` (and `verification`) in `feature_list.json` to be edited, then clarify again. The declaration stays the spec; clarifications only pin down what it already says.
5. **Record the answers.** Write them to a JSON file as a list of `{"question", "answer", "source"}`, then run `npm run clarify -- <id> --record <file>`. An empty list `[]` records `none`: nothing was open. The file is scratch; the shard keeps the answers.
6. **Activate.** `npm run activate -- <id>` now succeeds. Implement against the behavior and the recorded answers.

`--skip-clarify` on activate exists for a human who decides the step is not worth it. It records `clarifications: skipped`, and the session brief shows it until the feature passes. An agent does not skip on its own.

## Rules

- Never record a guess as an answer. A question you cannot answer from the repository goes to the human.
- An answer's source is a path that exists in the repository, or `human`. `--record` refuses anything else.
- Clarify does not edit `feature_list.json`. Changing the declaration is a separate, explicit step.

## Quick Reference

- [ ] `npm run clarify -- <id>` read: questions and flags
- [ ] Each open question answered from the repository (file cited) or by the human
- [ ] No answer changes what done means; if one would, the behavior was edited first
- [ ] Answers recorded with `npm run clarify -- <id> --record <file>` (`[]` for none)
- [ ] `npm run activate -- <id>` succeeds
