---
name: write-skill
description: Authoring a new skill pack — the format, the rules, and how it is validated.
---
# Write Skill

The meta-skill: how to add a capability pack to this harness.

## When to Use

- Adding a reusable workflow the team repeats (deploy, migrations, reviews, on-call…)
- Improving an existing skill
- Onboarding a skill from another framework or project

## Workflow

1. Create a folder under `skills/` named after the skill (kebab-case, one word or hyphenated).
2. Write `skills/<name>/SKILL.md` with:
   - YAML frontmatter between `---` lines: `name` (must match the folder name) and `description` (one line, what the skill does).
   - A `## When to Use` section listing the triggering situations.
   - A `## Workflow` section — numbered, concrete steps using real commands and file names.
   - A `## Quick Reference` checklist of the must-do items.
3. Optionally add a `references/` subfolder for deep material and `examples/` for worked examples; reference them from the workflow.
4. Run `npm run lint` — the runner validates every skill: SKILL.md exists, frontmatter present, name matches the folder, description present, `When to Use` present.
5. Keep the skill generic — no instance-specific content (no feature ids, dates, or machine paths from a specific project). Project-specific knowledge belongs in project skills, which adopters may add under `skills/`.

## Rules

- Skills are capability packs, not process law — AGENTS.md stays the operating manual.
- One skill, one workflow. Split rather than bloat.
- Ground every step in commands and files that actually exist in this harness.

## Quick Reference

- [ ] Folder `skills/<name>/` with `SKILL.md`
- [ ] Frontmatter: `name` matches folder, `description` present
- [ ] `## When to Use`, `## Workflow`, `## Quick Reference` sections
- [ ] No instance-specific content
- [ ] `npm run lint` passes skill validation
