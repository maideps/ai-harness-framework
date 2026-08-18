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

1. Run the full chain in order: `npm run check` (lint → typecheck → test → build → e2e).
2. Read the output, not only the exit status:
   - **PASS** — the layer ran and succeeded; it counts as verified.
   - **SKIP** — the layer is not configured; it does NOT count as verified.
   - **FAIL** — non-zero exit; the chain stops. Fix and rerun the failing layer, then the chain from that layer on.
3. For architecture enforcement: `npm run check-arch` (required surfaces, WIP=1/dependency order, no placeholder docs, valid manifest, every tracked file classified).
4. Before committing: `npm run clean-check` (harness files present, working tree clean, no debug artifacts, WIP ≤ 1, no OS artifacts staged).
5. For a specific feature: `npm run verify-feature -- <feature-id>` — runs the feature's own layers in order, stops at the first failure, prints the repair hint, and records evidence only when all layers pass.

## Rules

- Never claim done without running the required commands.
- A SKIP is honest — it is not a pass. Do not present a SKIP as verification.
- Do not skip layers to save time; each layer gates the next.

## Quick Reference

- [ ] `npm run check` — full chain, output read
- [ ] `npm run check-arch` — architecture rules
- [ ] `npm run clean-check` — pre-commit clean state
- [ ] PASS ≠ SKIP; report both honestly
