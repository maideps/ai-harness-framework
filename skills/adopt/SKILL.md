---
name: adopt
description: Bootstrapping the harness in a new project — placing templates per the manifest mapping and declaring product roots.
---
# Adopt

Bringing the harness into a new or existing project.

## When to Use

- Setting up a fresh repository with the harness
- Re-syncing a project after a harness upgrade
- Auditing whether the seam contract is satisfied

## Workflow

1. Copy the CORE files and `templates/` into the repository. CORE ships as-is (`AGENTS.md`, `CLAUDE.md`, `Makefile`, `package.json`, `init.sh`, `scripts/`, `skills/`, `templates/`, `LICENSE`, `.nvmrc`, `.harness/`).
2. Place each template at its declared destination — the manifest's `templates` entries carry the mapping machine-readably:
   - `{ "from": "templates/progress.md", "to": "PROGRESS.md" }` → copy there and fill in.
   - `{ "from": "templates/sprint-contract.md", "keep": true }` → stays under `templates/` as reference material.
3. Fill the skeletons: replace placeholder content with this project's real description, architecture, and standards. The lint layer fails while placeholder text remains — that is intentional.
4. Declare product-owned directories in the manifest's `productRoots` (e.g. `"src/"`, `"packages/"`) so arch-005 exempts them from classification.
5. Add project-specific architecture rules to `.harness/arch-rules.json`.
6. Run `./init.sh`, then `npm run check` — the project is now on the harness.

## Rules

- Never overwrite existing project files with skeleton content.
- Any repository layout change updates the manifest and `docs/ARCHITECTURE.md` in the same commit.
- CORE files must not be edited; project skills may be added under `skills/`.

## Quick Reference

- [ ] CORE + templates copied
- [ ] Templates placed per the manifest `{from, to}` mapping
- [ ] Skeletons filled (no placeholder text)
- [ ] `productRoots` declared for product code
- [ ] `./init.sh` and `npm run check` pass
