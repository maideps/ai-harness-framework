# Using the Framework

This guide covers running the harness day-to-day and adopting it in a new project.

## Quick Start

```bash
./init.sh        # check prerequisites, detect the project stack, install deps, run verification
make check       # full verification: lint → typecheck → test → build → e2e → optional verify-all
make help        # list all available commands
```

- **Harness runtime**: Node.js ≥ 18. The harness tooling runs on Node regardless of the project's product stack.
- **No make?** Every make target is mirrored 1:1 by an npm script (`npm run check`, `npm run check-arch`, …). Both surfaces delegate to the same Node runner (`scripts/framework-check.mjs`), so they cannot drift apart.

## Stack Detection

`scripts/stack-detect.mjs` is the single source of truth for "what kind of project is this". It detects the runtime from manifest markers — node (`package.json`), python (`pyproject.toml`/`requirements.txt`), go (`go.mod`), rust (`Cargo.toml`), jvm (`pom.xml`/gradle), dotnet (`.csproj`/`.sln`) — and resolves the right command per verification layer (`ruff`, `mypy`, `pytest`, `go vet`/`test`/`build`, `cargo test`/`build`, `mvn test`, `dotnet test`, …).

For node projects, the package.json script keys are the layer commands (`scripts.lint`, `scripts.test`, …). A layer that is not configured reports **SKIP** — which does not count as verified. Only **PASS** counts; **FAIL** stops the chain.

## Command Surface

The generated [Harness Command Reference](HARNESS.md) lists Makefile targets and npm scripts. Run `npm run harness-docs` to regenerate it after changing either command surface.

## The Feature Workflow

1. Read `feature_list.json` — the machine-readable source of truth for what each feature is (id, behavior, dependencies, layers). Pick ONE unfinished feature, or add a new one: `npm run add-feature -- <id> <name> [--behavior ..] [--verification ..] [--depends a,b] [--layer label=cmd]` configures the declaration; repeated `--layer` options append custom verification layers to the standard chain. An optional `featureIdPattern` regular expression in `.harness/manifest.json` restricts accepted IDs.
2. Activate it with `npm run activate -- <feature-id>`. Activation immediately enforces **WIP=1** (at most one active feature) and **dependency order** (every dependency must already be `passing`), then writes the feature's state shard.
3. Implement the feature. Run `npm run check` before every commit.
4. Verify through the gate — never mark a feature `passing` by hand:
   ```bash
   npm run verify-feature -- <feature-id>
   ```
   The gate runs the feature's own verification layers, refuses to pass a feature whose dependencies are not `passing`, and records evidence in `.harness/state/<feature-id>.json` — `feature_list.json` itself is never rewritten (feat-011, D-017).
5. Record durable evidence of a full run with `npm run vcr` (writes a trail to `.harness/trails/`).
6. End the session: add `progress/NNN-YYYY-MM-DD.md`, regenerate `PROGRESS.md` with `node scripts/framework-check.mjs progress-update`, update `session-handoff.md` and `docs/quality-document.md`, then run `npm run clean-check` and commit.

## Session Lifecycle

```bash
npm run session-start   # record start time, git state, active feature
# … work …
npm run session-end     # merge end state, files modified, decisions, verification into the trace
```

Traces are JSON files in `.harness/traces/`. They are runtime records, not evidence — keep durable session notes in `progress/`, decisions in `DECISIONS.md`, and feature state in `.harness/state/`. `PROGRESS.md` is a generated dashboard/index.

## Skills

Reusable capability packs live in `skills/` — one folder per skill with a `SKILL.md` (frontmatter `name`/`description`, `When to Use`, workflow, quick-reference checklist). The lint layer validates every skill's structure.

Shipped skills: `feature-cycle` (one feature at a time), `verification` (honest gate runs), `session-handoff` (durable session ends), `adopt` (bootstrapping the harness), `release` (final pre-release pass), `commit` (focused commits), `review` (pre-gate independent pass), `update-docs` (docs-drift cleanup), `write-skill` (the meta-skill for authoring new ones).

Project skills may be added under `skills/` — see the `write-skill` skill for the format.

## Worktree Lanes

Multiple agents can work on independent features at the same time, each in its own sibling git worktree:

```bash
npm run lane-new -- feat-020    # sibling worktree ../<repo>-lane-feat-020 on branch lane/feat-020,
                                 # feature marked active in .harness/state/feat-020.json (uncommitted)
npm run lane-list               # every local lane/* branch: feature, state, worktree path
npm run lane-land -- feat-020   # from the branch to merge into: refuses unless the lane's
                                 # feature is passing, then merges, removes the worktree, deletes the branch
npm run lane-drop -- feat-020   # abandon the lane's worktree without merging (branch kept)
```

A git branch can only be checked out in one worktree at a time, so branch-checkout exclusivity is the coordination primitive — no lock file or lease. WIP=1 applies per lane: a `lane/<feature-id>` branch may only activate the feature it is named for (`arch-002` enforces this). Feature state is sharded — one file per feature under `.harness/state/<id>.json` (feat-011, D-017) — so two lanes landing two different features touch two different files and merge conflict-free by construction; `feature_list.json` itself only changes when features are declared, so lane landings rarely touch it at all.

## Sharded Feature State

`feature_list.json` declares what each feature is (id, name, behavior, verification, dependencies, layers) and rarely changes. Each feature's mutable state — `state` and `evidence` — lives in its own file, `.harness/state/<feature-id>.json`:

```json
{
  "state": "passing",
  "evidence": "All verification layers passed via node scripts/framework-check.mjs verify-feature at 2026-09-09T00:00:00.000Z"
}
```

A missing shard means "planned, no evidence yet" — you don't need to create one until you activate a feature. `npm run verify-feature -- <id>` writes only that feature's shard; it never rewrites `feature_list.json`. `npm run typecheck` (Layer 1b) rejects any `state`/`status`/`evidence` key found inline in `feature_list.json` — that data belongs in the shard now.

Upgrading a repository from the older inline-state schema (or hand-migrating one): `npm run migrate-feature-state` moves every feature's inline `state`/`status`/`evidence` into its shard and strips those keys from `feature_list.json`. It's idempotent — a feature that already has a shard is left alone, and running it again on an already-migrated repo reports nothing to do.

## Multi-repo Extension (optional)

Projects that span multiple repositories can activate the multi-repo component:

1. Copy the `templates/multi-repo/*` skeletons to their declared destinations (`scripts/verify-all`, `scripts/verify-all.mjs`, `contracts/`, `tasks/`, `repositories/`).
2. Give every subrepository a `scripts/verify`, `scripts/verify.mjs`, or `scripts/verify.cjs` that exits non-zero on failure.
3. Run the root gate: `npm run verify-all` (or `make verify-all`) — it runs every repository's verify script and aggregates the results. `make check` includes this optional layer.

Single-repo projects never need the component: `check` passes without it, and `verify-all` reports SKIP when the markers are absent. Repositories without any supported verify script are SKIPped, not passed.

## Distribution

Three tools read the manifest as the single source of truth (make and npm mirrors exist):

| Tool | Purpose |
|---|---|
| `create-harness <dir>` | Generates an adopter repo: CORE as-is, templates placed per their `{from, to}` mapping, runtime surfaces created. Never overwrites existing files. |
| `harness-upgrade <dir>` | Applies an upgrade per the D-010 contract: overwrites mustNotEdit CORE only; every adopter-owned surface is never overwritten. |
| `harness-audit [dir]` | Local health report: manifest validity, classification coverage, template placement status, skills structure. Exits non-zero on any failure. |

```bash
node scripts/create-harness.mjs my-project    # or: npm run create-harness -- my-project
node scripts/harness-audit.mjs my-project
node scripts/harness-upgrade.mjs my-project
```

### Upgrade Backups

`harness-upgrade` snapshots every file it's about to overwrite before touching anything — a safety net independent of git, for a dirty tree or a mustNotEdit file an adopter edited against policy (feat-012). Backups live in `.harness/backups/` (gitignored — a local safety net, not durable evidence):

```bash
npm run backup-list                        # every backup: id, pinned?, file count, timestamp
npm run backup-pin -- <id>                 # protect a backup from pruning
npm run backup-unpin -- <id>
npm run backup-restore -- <id>             # or: npm run backup-restore -- latest
```

Dedup: an upgrade that changes nothing skips creating a redundant backup (checksummed against the most recent one) — the overwrite still runs. Retention: the 5 most recent *unpinned* backups are kept; pinned backups are never pruned. Restore is per-file: a file that existed before the operation gets its content back; a file the operation created that didn't exist before is removed.

## Reports and Sweeps

```bash
npm run report       # session digest from .harness/traces/ (last 7 days)
npm run sweep        # archive old traces, prune orphans, report manifest drift
```

The sweep never touches instance state — it only organizes runtime trace artifacts.

## Adopting the Framework in Your Project

The seam contract in `.harness/manifest.json` states exactly what ships and what does not:

- **CORE** — ships as-is: `AGENTS.md`, `CLAUDE.md`, `Makefile`, `package.json`, `init.sh`, `scripts/`, `templates/`, `.harness/manifest.json`, `.harness/arch-rules.json`.
- **TEMPLATES** — skeletons you fill in for your project: `LICENSE` (copied once at adoption), `.nvmrc`, project `README.md`, `.gitignore`, `feature-list.json`, `progress.md`, `DECISIONS.md`, `session-handoff.md`, `quality-document.md`, sprint contract, evaluator rubric, and project docs (`docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/OBSERVABILITY.md`, `docs/TOOLS.md`, `docs/USAGE.md`).
- **INSTANCE** — your project's own state, never overwritten by harness upgrades: the root `LICENSE`, `.nvmrc`, and the files you filled from the templates plus your roadmap, progress, and decisions.
- **PRODUCT-OWNED** — your product code. List its directories in the manifest's `productRoots` so the classification rule (arch-005) exempts them.

Adoption steps:

1. Copy CORE files and `templates/` into your repository.
2. Copy each template to its declared destination and fill it in. The manifest's `templates` entries carry the mapping machine-readably: `{ "from": "templates/progress.md", "to": "PROGRESS.md" }` means copy that dashboard skeleton to `PROGRESS.md`; regenerate its generated block after changing feature declarations or adding session notes. Entries with `"keep": true` stay under `templates/` as reference material.

   | Template (from) | Destination (to) |
   |---|---|
   | templates/nvmrc | .nvmrc |
   | templates/LICENSE | LICENSE (kept by upgrades) |
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
   | templates/ci.yml | .github/workflows/ci.yml |
   | templates/sprint-contract.md | (keep — reference) |
   | templates/evaluator-rubric.md | (keep — reference) |
   | templates/clean-state-checklist.md | (keep — reference) |
3. The generated CI workflow uses your `.nvmrc`, runs `npm run setup --if-present`, then `npm run check` and `npm run check-arch`. Edit `.nvmrc` to choose the Node version for your project. The workflow skips the framework's adoption matrix, which runs in this repository's CI; configure your own e2e script to run project-specific end-to-end tests.
4. Add your product directories to `productRoots` in `.harness/manifest.json`.
5. Add project-specific architecture rules to `.harness/arch-rules.json` as your codebase grows.
6. Run `./init.sh`, then `npm run check` — you are now on the harness.

Customization points (from the manifest):

- MUST edit: feature content (`feature_list.json`), project docs (`docs/`), project arch rules (`.harness/arch-rules.json`).
- MAY edit: extra Makefile targets, project scripts in `package.json`, stack-specific verification in `init.sh`, manifest `productRoots`.
- MUST NOT edit: `scripts/framework-check.mjs`, the manifest classification itself, the PASS/SKIP/FAIL semantics, the feature state machine and WIP=1 contract.

## Verification Semantics

- **PASS** — the layer ran and succeeded; it counts as verified.
- **SKIP** — the layer is not configured; it does not count as verified.
- **FAIL** — non-zero exit; the chain stops.
- **The default `e2e` layer is the framework's adoption matrix.** It generates throwaway adopter repos and runs the harness in each. Its fixtures always use the canonical harness layer scripts, so repointing `lint`, `typecheck`, `test` or `build` at your product tooling (a documented customisation point) does not break it. It tests the harness, not your product: once you have real end-to-end tests, replace the `e2e` script with them.

`npm run check-arch` enforces six rules: required harness surfaces exist, the feature tracker preserves WIP=1, dependency order, and lane ownership, framework docs contain no template placeholders, the manifest is valid, every tracked file is classified by the manifest, and feature declarations carry no leftover inline state (sharded state stays consistent).

Two more checks worth knowing about, neither a numbered arch rule:

- **`check-arch` warns (does not fail) on untracked files.** Coverage rules like arch-005 only see what `git ls-files` already tracks — a brand-new file silently passes coverage until it's `git add`ed, then fails once it is. `check-arch` prints a heads-up (`[WARN] N untracked file(s) exist…`) before evaluating rules, so a rule result you're about to read isn't misread as covering a file it can't see yet.
- **`npm run lint` checks the generated `PROGRESS.md` dashboard and `progress/` archive.** The dashboard must match feature declarations/state shards and the dated session files; filenames/headings must agree, and session numbers must be unique and contiguous (file creation order does not matter). Run `node scripts/framework-check.mjs progress-update` to regenerate it.
