---
name: verification
description: Running the verification gates honestly and reading their output, not just exit codes.
---
# Verification

How to run the gates and what the tri-state results mean.

## When to Use

- Before every commit
- Before claiming any work is done
- When a layer fails and you need to know what actually broke

## Workflow

1. Run the full chain in order: `npm run check` (lint → check-arch → typecheck → test → build → e2e → verify-all → quality).
2. Read the output, not only the exit status:
   - **PASS** — the layer ran and succeeded; it counts as verified.
   - **SKIP** — the layer is not configured; it does NOT count as verified.
   - **FAIL** — non-zero exit; the chain stops. Fix and rerun the failing layer, then the chain from that layer on.
3. For architecture enforcement: `npm run check-arch` (required surfaces, WIP=1/dependency order, no placeholder docs, valid manifest, every tracked file classified).
4. Before committing: `npm run clean-check` (harness files present, working tree clean, no debug artifacts, WIP ≤ 1, no OS artifacts staged).
5. If the project enabled quality gates (`.harness/quality.json` has `"enabled": true`), `npm run quality` runs last in the chain. Read each gate line: `[PASS] coverage: 84.20 ≥ 80` counts; `[SKIP] mutation: disabled` does not; a `[FAIL]` names the metric and the floor it missed. Never lower a `min` to make a gate pass without saying so to a human.
6. For a specific feature: `npm run verify-feature -- <feature-id>` — runs the feature's own layers in order, stops at the first failure, prints the repair hint, and records evidence only when all layers pass. It refuses while code is uncommitted (harness bookkeeping excepted) and fails if a layer leaves files behind, so the commit in the evidence is the code that passed. A `[WARN] … layers changed after it was verified` line from `npm run typecheck` means that feature's evidence is stale: re-run its gate.
7. If the feature's layers declare `captures` (screenshots of a UI, for example), look at them twice — a green layer only says the tests passed, not that the page looks right:
   - **During development, before committing:** after running the layer that writes them (for example `npm run e2e`), open each new screenshot with your file-reading tool and compare it with the feature's declared behavior. Fix what is wrong now: `verify-feature` refuses uncommitted code, so a defect first seen at the gate costs another commit.
   - **At the gate:** `verify-feature` prints the copies it collected under `.harness/logs/<feature>/captures/`. Open each one and confirm it matches the behavior before reporting the feature done. If one contradicts it, fix the code, commit, and re-run the gate — never report success over a capture that shows the behavior is not met. Name the captures you checked in the session note's "Verification run".
   - **Screenshots, not video:** you can read images but not watch video. Screenshots are your evidence; videos are for human reviewers. A flow you must check needs a screenshot at each step that matters.

## Rules

- Never claim done without running the required commands.
- A SKIP is honest — it is not a pass. Do not present a SKIP as verification.
- Do not skip layers to save time; each layer gates the next.
- A layer with captures is not done until you have looked at them: collected is not the same as checked.

## Quick Reference

- [ ] `npm run check` — full chain, output read
- [ ] `npm run quality` — metric floors, when enabled
- [ ] `npm run check-arch` — architecture rules
- [ ] `npm run clean-check` — pre-commit clean state
- [ ] PASS ≠ SKIP; report both honestly
- [ ] Captures opened and compared with the behavior: before committing, and the gate's copies before reporting done
