# Using the Framework

This guide covers running the harness day-to-day and adopting it in a new project.

## Quick Start

```bash
./init.sh        # check prerequisites, detect the project stack, install deps, run verification
make check       # full verification: lint → typecheck → test → build → e2e → optional verify-all → optional quality
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

It is **opt-in**: `create-harness` never places it unasked, so a plain single-repo adopter never acquires `contracts/`, `tasks/`, `repositories/`, or `scripts/verify-all` just from adopting the harness.

Projects that span multiple repositories can activate the multi-repo component:

1. Activate it: `node scripts/create-harness.mjs <dir> --with multi-repo` places the `templates/multi-repo/*` skeletons (`scripts/verify-all`, `scripts/verify-all.mjs`, `contracts/`, `tasks/`, `repositories/`) at their declared destinations. Safe to rerun later against an already-adopted repository — existing files are never overwritten, so only what's still missing gets added.
2. Give every subrepository a `scripts/verify`, `scripts/verify.mjs`, or `scripts/verify.cjs` that exits non-zero on failure.
3. Run the root gate: `npm run verify-all` (or `make verify-all`) — it runs every repository's verify script and aggregates the results. `make check` includes this optional layer.

Single-repo projects never need the component: `check` passes without it, and `verify-all` reports `[SKIP] Multi-repo component not activated` when its files are absent. Once activated but still only holding the untouched `example` scaffold (no real repositories added yet), `verify-all` honestly reports `[SKIP] verify-all ran but nothing was verified yet` rather than a silent pass — it only reports success once at least one real repository's verify script actually runs and passes. Repositories without any supported verify script are SKIPped, not passed.

## Quality Gates (opt-in)

`make quality` / `npm run quality` runs the metric gates declared in `.harness/quality.json`, and `make check` runs it last. Every adopter gets that file with the gates **disabled**, so the layer reports `[SKIP] Quality gates are disabled` until the project has tests worth measuring. To turn them on:

```json
{
  "enabled": true,
  "gates": [
    { "name": "coverage", "min": 80 },
    { "name": "mutation", "enabled": false, "min": 80 }
  ]
}
```

Each gate runs one command, reads one number from it, and fails when the number is below `min`. A disabled gate, or one whose tool is not installed, reports SKIP. A SKIP is never a PASS: a feature layer that runs `npm run quality` and only gets SKIPs fails `verify-feature` (D-029).

**Coverage presets.** A gate named `coverage` with no `cmd` uses the detected stack's preset:

| Stack | Command | Number read |
|---|---|---|
| node | your `coverage` script in `package.json` (c8, vitest, jest, `node --experimental-test-coverage`) | the `All files \| <n>` row |
| python | `pytest --cov=src` (or `--cov=.`), needs `pytest-cov` | `totals.percent_covered` in the JSON report |
| go | `go test -coverprofile` + `go tool cover -func` | the `total: (statements)` line |
| rust | `cargo llvm-cov --json --summary-only`, needs `cargo-llvm-cov` | `data.0.totals.lines.percent` |

JVM and .NET have no preset: declare the command yourself.

**Your own command.** Any gate can declare `cmd`, and then must declare where its number comes from:

- `"metric": { "pattern": "<regex>" }` reads the last match in the output (case-insensitive). Capture group 1 is the value; named groups `num` and `den` give `100 × num / den` for tools that print counts instead of a score.
- `"metric": { "file": "<json report>", "path": "a.b.0.c" }` reads a field of a JSON report (numeric segments index arrays; `"87.5%"` strings are accepted).
- `"exitCodes": [0, 2]` accepts exit codes other than 0, for tools that exit non-zero on their own verdict.
- `"probe": "<command>"` runs first; when it exits non-zero the gate reports SKIP instead of running. Use it for tools that only work on some platforms or versions (mutmut needs Linux, macOS or WSL; this repository probes for Node 22+ before measuring its own coverage).

Mutation testing has no preset because each stack's tool reports differently. Starting points (check them against your tool's version):

| Tool | `cmd` | `metric` |
|---|---|---|
| Stryker (JS/TS), Stryker.NET | `npx stryker run` / `dotnet stryker` | `{ "pattern": "all files\s*\|\s*([\d.]+)" }` |
| PIT (JVM) | `mvn -q org.pitest:pitest-maven:mutationCoverage` | `{ "pattern": "Killed \d+ \((\d+)%\)" }` |
| mutmut 3 (Linux, macOS, WSL) | `mutmut run && mutmut export-cicd-stats && mutmut badge --output .harness/quality/mutation.json` | `{ "file": ".harness/quality/mutation.json", "path": "message" }` |
| cargo-mutants | `cargo mutants` with `"exitCodes": [0, 2]` | `{ "pattern": "(?<den>\d+) mutants tested.*?(?<num>\d+) caught" }` |

A gate is any number with a floor, so the same mechanism fits an LLM eval score (`{ "name": "eval-accuracy", "cmd": "python -m evals.run", "metric": { "file": "evals/results/latest.json", "path": "accuracy" }, "min": 0.8 }`).

Reports go to `.harness/quality/`, a folder that ignores itself. `npm run lint` fails on a malformed `.harness/quality.json` even while it is disabled. To make a metric part of a feature's evidence, add `{ "label": "Layer 4: Quality gates", "cmd": "npm run quality" }` to its layers. After `harness-upgrade`, an existing adopter gets the disabled file, and the upgrade prints the `quality` npm script and make target to add: `Makefile` and `package.json` are adopter-owned, so add both, then append `quality` to the `check` target and `&& npm run quality` to the `check` script, and run `npm run harness-docs`. Until the make target exists, `npm run build` fails with `Makefile is missing target quality`.

## Dev Container (optional)

The `devcontainer` component gives every agent session the same environment: Docker and an editor that supports dev containers (VS Code, Cursor, the `devcontainer` CLI, GitHub Codespaces) are all you need on the host. It is opt-in:

```bash
node scripts/create-harness.mjs <dir> --with devcontainer   # new project, or rerun on an existing one
```

It places two files:

- `.devcontainer/devcontainer.json`: Ubuntu 24.04 with Node pinned to the project's `.nvmrc`, the GitHub CLI, Claude Code (its official dev container feature), and the toolchain feature for the product already in the directory (python, go, rust, java with Maven or Gradle, .NET). Agent logins live in named volumes (`~/.claude`, `~/.codex`, `~/.gemini`), so they survive container rebuilds.
- `.devcontainer/post-create.sh`: installs Codex and Gemini CLI from npm, registers the project's MCP servers with Codex (`register-mcp.sh`, a no-op without the `mcp` component), then runs `./init.sh`, so the first session starts from a verified state. A failing `init.sh` is reported without aborting the container.

Pinning and the toolchain are filled in only when `create-harness` places the file. If you add a stack later, or change `.nvmrc`, edit `devcontainer.json` yourself: an existing file is never rewritten. API keys are not wired in; log in inside the container once (the volumes keep it), or add `remoteEnv` entries such as `"ANTHROPIC_API_KEY": "${localEnv:ANTHROPIC_API_KEY}"`.

## MCP Servers (optional)

The `mcp` component gives the agents the same Model Context Protocol servers. It ships one, [context7](https://github.com/upstash/context7), which looks up current documentation for libraries instead of relying on what the model remembers. It needs no secret. It is opt-in:

```bash
node scripts/create-harness.mjs <dir> --with mcp            # often together with --with devcontainer
```

| Agent | Where it reads the servers | What the component does |
|---|---|---|
| Claude Code | `.mcp.json` (project scope) | places it; Claude Code asks once before starting a project server |
| Gemini CLI | `.gemini/settings.json` | places it with the same servers; Gemini keeps project servers disabled until you trust the folder |
| Codex | `~/.codex/config.toml` (user scope) | `.devcontainer/register-mcp.sh` registers every command server from `.mcp.json` with `codex mcp add`; post-create runs it. Outside the container run `codex mcp add context7 -- npx -y @upstash/context7-mcp` once |

The first start of a server runs `npx`, which downloads the package; an agent can report it as disconnected until that download finishes, so retry once before debugging.

Add a server by editing both `.mcp.json` and `.gemini/settings.json`, then rerun `bash .devcontainer/register-mcp.sh` for Codex. `register-mcp.sh` skips servers without a `command` (remote HTTP servers) and does not pass `env` entries.

## Distribution

Three tools read the manifest as the single source of truth (make and npm mirrors exist):

| Tool | Purpose |
|---|---|
| `create-harness <dir>` | Generates an adopter repo: CORE as-is, templates placed per their `{from, to}` mapping, runtime surfaces created. Never overwrites existing files. |
| `harness-upgrade <dir>` | Applies an upgrade per the D-010 contract: overwrites mustNotEdit CORE only, including the shipped skills named in the manifest's `shippedSkills`; every adopter-owned surface, project skills included, is never overwritten. |
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
4. Add your product directories to `productRoots` in `.harness/manifest.json` (a new adopter starts with an empty list).
5. Add project-specific architecture rules to `.harness/arch-rules.json` as your codebase grows.
6. Run `./init.sh`, then `npm run check` — you are now on the harness.

Customization points (from the manifest):

- MUST edit: feature content (`feature_list.json`), project docs (`docs/`), project arch rules (`.harness/arch-rules.json`).
- MAY edit: extra Makefile targets, project scripts in `package.json`, stack-specific verification in `init.sh`, manifest `productRoots`.
- MUST NOT edit: `scripts/framework-check.mjs`, the manifest classification itself, the PASS/SKIP/FAIL semantics, the feature state machine and WIP=1 contract.

### Replacing `lint`, `typecheck`, `test`, or `build` without losing the harness's own checks (#25)

For a Node project, `lint`, `typecheck`, `test`, and `build` ship pointing at `node scripts/framework-check.mjs <layer>` — which is also how the harness checks itself: `lint` validates skills structure, the generated progress dashboard, and framework docs for unfilled template placeholders; `typecheck` validates `feature_list.json`'s shape; `test` validates the feature dependency graph, the WIP=1/lane contract, and runs the runner's own unit tests; `build` validates Make targets and shell shims. `npm run check-arch` (arch-001..006) does **not** duplicate any of this — replacing one of these four script values with your product tool entirely, instead of chaining it, silently drops that layer's harness checks from both `npm run check` and every `npm run verify-feature` run, with nothing to catch the gap.

**Chain the two instead of replacing:**

```json
"scripts": {
  "lint": "node scripts/framework-check.mjs lint && eslint .",
  "typecheck": "node scripts/framework-check.mjs typecheck && tsc --noEmit",
  "test": "node scripts/framework-check.mjs test && jest",
  "build": "node scripts/framework-check.mjs build && tsc -p . --outDir dist"
}
```

Each side must still exit non-zero on its own failure for `&&` to stop the chain correctly — that's true of ordinary CLI tools (eslint, tsc, jest, …) by default. Only an adopter who later overwrites one of these four keys outright (not by appending `&&`) loses the harness side.

Forgot to chain one? `node scripts/harness-audit.mjs` warns, by layer name, the first time it notices a layer script no longer invokes `framework-check.mjs <layer>` at all.

## Verification Semantics

- **PASS** — the layer ran and succeeded; it counts as verified.
- **SKIP** — the layer is not configured; it does not count as verified.
- **FAIL** — non-zero exit; the chain stops.
- **The default `e2e` layer is the framework's adoption matrix.** It generates throwaway adopter repos and runs the harness in each — five stack cells, a simulated upgrade, the multi-repo component, and an existing-repo adoption check. It tests the harness, not your product, and is one of the slower layers: budget low-single-digit minutes locally (it spawns `git init`/`git add` and a nested `node --test` run per cell), and it can be the majority of a full `npm run check` until you have real end-to-end tests. Once you do, replace the `e2e` script with them. Until then, skip it locally with `CW_SKIP_ADOPTION_MATRIX=1 npm run check` — the generated CI workflow already sets this so CI exercises your project's own layers, not the framework's self-test, on every run.

`npm run check-arch` enforces six rules: required harness surfaces exist, the feature tracker preserves WIP=1, dependency order, and lane ownership, framework docs contain no template placeholders, the manifest is valid, every tracked file is classified by the manifest, and feature declarations carry no leftover inline state (sharded state stays consistent).

Two more checks worth knowing about, neither a numbered arch rule:

- **`check-arch` warns (does not fail) on untracked files.** Coverage rules like arch-005 only see what `git ls-files` already tracks — a brand-new file silently passes coverage until it's `git add`ed, then fails once it is. `check-arch` prints a heads-up (`[WARN] N untracked file(s) exist…`) before evaluating rules, so a rule result you're about to read isn't misread as covering a file it can't see yet.
- **`npm run lint` checks the generated `PROGRESS.md` dashboard and `progress/` archive.** The dashboard must match feature declarations/state shards and the dated session files; filenames/headings must agree, and session numbers must be unique and contiguous (file creation order does not matter). Run `node scripts/framework-check.mjs progress-update` to regenerate it.
