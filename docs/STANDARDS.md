# Project Standards

Single source of truth for this repository's engineering standards. This is the framework's own instance of the STANDARDS.md skeleton — adopters fill their copy with their project's standards.

## Core Principles

- One feature at a time (WIP=1); complete and gate it before activating the next.
- Verification required: never claim done without running the commands and reading their output.
- PASS / SKIP / FAIL are the honest tri-state; SKIP does not count as verified.
- Small, focused changes; one logical operation per commit; the repo is consistent after every commit.
- No stale documentation — docs update in the same commit as the code change.
- No instance-specific content in CORE or template surfaces — the framework stays reusable.

## Language and Tooling

- Harness runtime: Node.js ≥ 18 (JavaScript, ESM).
- Verification runner: `scripts/framework-check.mjs`; stack detection: `scripts/stack-detect.mjs`.
- Lint/typecheck/test/build layers run via `npm run check` (make mirrors exist for every target).
- Windows and Linux are both supported; bash shims must stay thin delegations to the Node runner.

## Testing Discipline

- Every verification layer must actually run; configured layers report PASS or FAIL, unconfigured report SKIP.
- Feature gates run through `npm run verify-feature -- <id>`; never mark `passing` by hand.
- Cross-component changes need Layer 3b (e2e) PASSing — SKIP is not enough.

## Naming and Structure

- State files: `feature_list.json`, `PROGRESS.md`, `DECISIONS.md`, `session-handoff.md` (canonical names).
- CORE files ship as-is; INSTANCE files hold project state; TEMPLATES are adopter skeletons with `{from, to}` destinations.
- Every tracked file is classified by `.harness/manifest.json` (arch-005).

## Commit and Review Standards

- Commit message explains WHY, not just what; one logical operation per commit.
- `npm run check` before every commit; `npm run clean-check` on the clean tree before finishing.
- Architecture decisions are recorded in DECISIONS.md (template at the top).

## Documentation Standards

- Manifest and `docs/ARCHITECTURE.md` update in the same commit as any layout change.
- Skills follow the `write-skill` format; the lint layer validates them.
- README and USAGE.md reflect the actual command surface — no undocumented or ghost commands.
