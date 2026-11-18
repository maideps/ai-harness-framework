---
name: readme-review
description: Contrast README.md with the repository so it says exactly what the app does now, in a conventional structure — nothing more, nothing less.
---
# README Review

The README is the first thing a person or an agent reads about the app. It must describe what the repository does today: not what it will do, not what it did before, not what the harness does instead of the app.

## When to Use

- After a feature passes the gate (`npm run clean-check` fails until README.md changes after the latest verified feature)
- When `npm run lint` reports a README contract problem
- When adopting the harness, to replace the template's placeholders with the app's own description
- In review, before a change that alters what users can do is merged

## Workflow

1. **Run `npm run lint` first.** It checks what a machine can: a conventional structure (one `#` title, a short description, Install, Usage and License sections, a Table of Contents past 100 lines), and that every command, link and file path the README names exists. Fix those before the review below.
2. **Nothing more: every claim needs evidence.** Go through the README sentence by sentence and list what it says the app does, supports or guarantees: features, platforms and stacks, commands, configuration, numbers. Find each one in the code, a test, or a feature that is `passing` in `.harness/state/`. A claim with no evidence is removed, or narrowed to what the evidence shows ("runs tests on jvm projects", not "works with jvm projects"). Plans go in a roadmap or nowhere, never in the description of what the app does. Watch for verbs that overstate: "enforces" where the code only lets you, "always" where there are exceptions.
3. **Nothing less: every capability users can see is mentioned.** List what a user can do with the app: the behaviors of passing features (in `feature_list.json`), entry points (commands and scripts, CLI options, routes or endpoints, pages), configuration they must set. Each appears in the README, at least as one line, or in a document the README links. Internal refactors and harness bookkeeping do not need a line.
4. **Write for the app's reader.** Present tense, what it does now, how to install and run it, the smallest working example. In an adopter, the README is about the product, not the harness: one line pointing to the harness docs is enough. In the framework repository, the product is the harness itself.
5. **Keep the conventional order** (Standard Readme): title, badges, short description, Table of Contents (when long), Background or Why (optional), Install, Usage, further sections, Contributing (recommended), License.
6. **Re-run `npm run lint`**, commit the README with the feature or right after its gate, and name in the session note what the review changed.

## Rules

- A README that says more than the repository does is a bug, the same as a test that passes for the wrong reason.
- Remove what no longer exists in the same change that removes it.
- When unsure whether a claim holds, check the code; do not keep it on trust.

## Quick Reference

- [ ] `npm run lint` passes the README contract (structure, commands, links, paths)
- [ ] Every claim has evidence in code, tests or a passing feature; overstated verbs fixed
- [ ] Every user-visible capability appears (or is linked)
- [ ] Written about the app, present tense, conventional order
- [ ] README committed with or right after the feature; review noted in the session note
