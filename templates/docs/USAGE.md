# Using the Framework

This guide covers running the harness day-to-day and adopting it in a new project.

## Quick Start

```bash
./init.sh        # check prerequisites, detect the project stack, install deps, run verification
make check       # full verification: lint → typecheck → test → build → e2e
make help        # list all available commands
```

- **Harness runtime**: Node.js ≥ 18. The harness tooling runs on Node regardless of the project's product stack.
- **No make?** Every make target is mirrored 1:1 by an npm script (`npm run check`, `npm run check-arch`, …). Both surfaces delegate to the same Node runner (`scripts/framework-check.mjs`), so they cannot drift apart.

## Stack Detection

`scripts/stack-detect.mjs` is the single source of truth for "what kind of project is this". It detects the runtime from manifest markers — node (`package.json`), python (`pyproject.toml`/`requirements.txt`), go (`go.mod`), rust (`Cargo.toml`), jvm (`pom.xml`/gradle), dotnet (`.csproj`/`.sln`) — and resolves the right command per verification layer (`ruff`, `mypy`, `pytest`, `go vet`/`test`/`build`, `cargo test`/`build`, `mvn test`, `dotnet test`, …).

For node projects, the package.json script keys are the layer commands (`scripts.lint`, `scripts.test`, …). A layer that is not configured reports **SKIP** — which does not count as verified. Only **PASS** counts; **FAIL** stops the chain.

## Command Surface

| Purpose | Make | npm |
|---|---|---|
| Full verification | `make check` | `npm run check` |
| Layer 1: static analysis | `make lint` | `npm run lint` |
| Layer 1b: type checking | `make typecheck` | `npm run typecheck` |
| Layer 2: runtime tests | `make test` | `npm run test` |
| Layer 3: build verification | `make build` | `npm run build` |
| Layer 3b: end-to-end | `make e2e` | `npm run e2e` |
| Architecture rules | `make check-arch` | `npm run check-arch` |
| Feature gate | `make verify-feature F=<id>` | `npm run verify-feature -- <id>` |
| Verify + record trail | `make vcr` | `npm run vcr` |
| Session start / end | `make session-start` / `session-end` | `npm run session-start` / `session-end` |
| Pre-commit clean state | `make clean-check` | `npm run clean-check` |
| Install dependencies | `make setup` | `npm run setup` |

## The Feature Workflow

1. Read `feature_list.json` — the machine-readable source of truth. Pick ONE unfinished feature.
2. Activate it by setting its `state` to `"active"`. The harness enforces **WIP=1** (at most one active feature) and **dependency order** (an active feature's dependencies must already be `passing`).
3. Implement the feature. Run `npm run check` before every commit.
4. Verify through the gate — never mark a feature `passing` by hand:
   ```bash
   npm run verify-feature -- <feature-id>
   ```
   The gate runs the feature's own verification layers, refuses to pass a feature whose dependencies are not `passing`, and records evidence in `feature_list.json`.
5. Record durable evidence of a full run with `npm run vcr` (writes a trail to `.harness/trails/`).
6. End the session: update `PROGRESS.md`, `session-handoff.md`, and `docs/quality-document.md`, then run `npm run clean-check` and commit.

## Session Lifecycle

```bash
npm run session-start   # record start time, git state, active feature
# … work …
npm run session-end     # merge end state, files modified, decisions, verification into the trace
```

Traces are JSON files in `.harness/traces/`. They are runtime records, not evidence — keep the durable story in `PROGRESS.md`, `DECISIONS.md`, and `feature_list.json`.

## Skills

Reusable capability packs live in `skills/` — one folder per skill with a `SKILL.md` (frontmatter `name`/`description`, `When to Use`, workflow, quick-reference checklist). The lint layer validates every skill's structure.

Shipped skills: `feature-cycle` (one feature at a time), `verification` (honest gate runs), `session-handoff` (durable session ends), `adopt` (bootstrapping the harness), `release` (final pre-release pass), `commit` (focused commits), `review` (pre-gate independent pass), `update-docs` (docs-drift cleanup), `write-skill` (the meta-skill for authoring new ones).

Project skills may be added under `skills/` — see the `write-skill` skill for the format.

## Adopting the Framework in Your Project

The seam contract in `.harness/manifest.json` states exactly what ships and what does not:

- **CORE** — ships as-is, must not be edited: `AGENTS.md`, `CLAUDE.md`, `Makefile`, `package.json`, `init.sh`, `scripts/`, `templates/`, `LICENSE`, `.nvmrc`, `.harness/manifest.json`, `.harness/arch-rules.json`.
- **TEMPLATES** — skeletons you fill in for your project: project `README.md`, `.gitignore`, `feature-list.json`, `progress.md`, `DECISIONS.md`, `session-handoff.md`, `quality-document.md`, sprint contract, evaluator rubric, and project docs (`docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/OBSERVABILITY.md`, `docs/TOOLS.md`, `docs/USAGE.md`).
- **INSTANCE** — your project's own state, never overwritten by harness upgrades: the files you filled from the templates plus your roadmap, progress, and decisions.
- **PRODUCT-OWNED** — your product code. List its directories in the manifest's `productRoots` so the classification rule (arch-005) exempts them.

Adoption steps:

1. Copy CORE files and `templates/` into your repository.
2. Copy each template to its declared destination and fill it in. The manifest's `templates` entries carry the mapping machine-readably: `{ "from": "templates/progress.md", "to": "PROGRESS.md" }` means copy that skeleton to `PROGRESS.md` and replace the placeholder content; entries with `"keep": true` stay under `templates/` as reference material.

   | Template (from) | Destination (to) |
   |---|---|
   | templates/README.md | README.md |
   | templates/gitignore | .gitignore |
   | templates/progress.md | PROGRESS.md |
   | templates/DECISIONS.md | DECISIONS.md |
   | templates/feature-list.json | feature_list.json |
   | templates/session-handoff.md | session-handoff.md |
   | templates/quality-document.md | docs/quality-document.md |
   | templates/docs/PRODUCT.md | docs/PRODUCT.md |
   | templates/docs/ARCHITECTURE.md | docs/ARCHITECTURE.md |
   | templates/docs/OBSERVABILITY.md | docs/OBSERVABILITY.md |
   | templates/docs/TOOLS.md | docs/TOOLS.md |
   | templates/docs/USAGE.md | docs/USAGE.md |
   | templates/docs/decisions/index.md | docs/decisions/index.md |
   | templates/sprint-contract.md | (keep — reference) |
   | templates/evaluator-rubric.md | (keep — reference) |
   | templates/clean-state-checklist.md | (keep — reference) |
3. Add your product directories to `productRoots` in `.harness/manifest.json`.
4. Add project-specific architecture rules to `.harness/arch-rules.json` as your codebase grows.
5. Run `./init.sh`, then `npm run check` — you are now on the harness.

Customization points (from the manifest):

- MUST edit: feature content (`feature_list.json`), project docs (`docs/`), project arch rules (`.harness/arch-rules.json`).
- MAY edit: extra Makefile targets, project scripts in `package.json`, stack-specific verification in `init.sh`, manifest `productRoots`.
- MUST NOT edit: `scripts/framework-check.mjs`, the manifest classification itself, the PASS/SKIP/FAIL semantics, the feature state machine and WIP=1 contract.

## Verification Semantics

- **PASS** — the layer ran and succeeded; it counts as verified.
- **SKIP** — the layer is not configured; it does not count as verified.
- **FAIL** — non-zero exit; the chain stops.

`npm run check-arch` enforces five rules: required harness surfaces exist, the feature tracker preserves WIP=1 and dependency order, framework docs contain no template placeholders, the manifest is valid, and every tracked file is classified by the manifest.
