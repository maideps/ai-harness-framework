---
name: update-docs
description: Docs-drift pass after code changes — manifest, architecture, and guides updated in the same commit.
---
# Update Docs

The same-commit rule, operationalized: no stale documentation.

## When to Use

- After any code change that touches a documented surface
- After layout changes (new/moved/renamed files)
- Before every commit — as a checklist, not an afterthought

## Workflow

1. Identify what changed: commands, files, layout, contracts, semantics.
2. Update each affected surface:
   - `docs/ARCHITECTURE.md` — layer model, harness boundaries, seam contract changes
   - `.harness/manifest.json` — any layout change (arch-005 fails on unclassified files)
   - `README.md` — after every feature that passes the gate: what the app being built does, how to run it, what a user can do now (in an adopter, the product; in the framework repository, the harness). `clean-check` fails until it changes after the latest verified feature; a feature with no user-visible change declares `"readme": "<reason>"` instead
   - `docs/USAGE.md` — command surface or workflow changes
   - `docs/STANDARDS.md` — standards changes
   - `docs/quality-document.md` — ratings for modules touched this session
   - `skills/` — if the change alters a skill's workflow
   - `AGENTS.md` MUST / MUST NOT rules — a new or changed rule gets an `<!-- enforced-by: ... -->` comment right below it in the same commit: the gate that enforces it (a runner check, an arch rule id that exists), or `none — <reason>`. When a change adds a gate for a rule that said `none`, update its comment. Lint fails an untagged rule
3. Templates and instance copies stay in sync: a docs change that ships must update both `templates/docs/*` and `docs/*`.
4. Run `npm run check` — the lint layer catches placeholder drift and skill format drift.
5. Commit docs in the same commit as the code change.

## Rules

- No stale documentation — the same-commit rule is a harness constraint.
- Docs describe what IS, not what was planned or hoped.
- A docs-only fix is still a real commit: small, focused, explaining why.

## Quick Reference

- [ ] Touched surfaces identified
- [ ] ARCHITECTURE.md and manifest updated for layout changes
- [ ] README describes the app as it is after this session's features (or the feature declares `readme`)
- [ ] USAGE updated for command changes
- [ ] Templates + instance copies in sync
- [ ] Every MUST rule in AGENTS.md has an accurate enforced-by comment
- [ ] Same commit as the code change
