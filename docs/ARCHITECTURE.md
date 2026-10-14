# Architecture

## Layer Model

The framework has two architecture concerns:

1. **Harness architecture** in this repository — the instruction, state, verification, and observability surfaces that make the framework reusable.
2. **Application architecture** in adopting repositories — the layered product code structure that the harness will later enforce.

During bootstrap, a newly adopted repository primarily validates harness architecture. Once the adopting project adds source code, teams should extend `.harness/arch-rules.json` with product-layer checks.

```
┌─────────────────────────────────────────────┐
│               Presentation Layer             │
│  (UI, CLI, API endpoints — user-facing)     │
├─────────────────────────────────────────────┤
│               Application Layer              │
│  (Use cases, orchestration, workflows)       │
├─────────────────────────────────────────────┤
│                 Domain Layer                  │
│  (Business logic, entities, rules)           │
├─────────────────────────────────────────────┤
│             Infrastructure Layer             │
│  (Persistence, networking, external APIs)    │
└─────────────────────────────────────────────┘
```

## Harness Boundaries

- Root operating manual and state files live at the repository root so every session can discover them immediately.
- Verification entrypoints live in `init.sh`, `Makefile`, `package.json`, and `scripts/`.
- Policy and enforcement rules live under `.harness/`.
- Durable user-facing guidance lives in `README.md` and `docs/`.

These boundaries are enforced today by `make check` / `npm run check` and `make check-arch` / `npm run check-arch`. Verification layers report PASS, SKIP (not configured), or FAIL (stops the chain); only PASS counts as verified.

## Runner Consolidation

The canonical implementation of every harness operation lives in the Node runner `scripts/framework-check.mjs`. There is one runner, two thin surfaces (Makefile targets and npm scripts), and bash shims for compatibility:

- **Node runner** — `scripts/framework-check.mjs` implements all modes: verification layers (`lint`, `typecheck`, `test`, `build`, `e2e`), `run-layer`, `verify-chain`, `check-arch`, `verify-feature`, `lane-new`/`lane-list`/`lane-land`/`lane-drop`, `migrate-feature-state`, `session-trace`, `clean-state-check`, `setup`, `record-trail`, `manifest`, `help`. It is the only place the logic exists; every surface delegates to it.
- **Stack detection** — `scripts/stack-detect.mjs` is the single source of truth for "what kind of project is this". It detects the runtime (node, python, go, rust, jvm, dotnet, none) from manifest markers, the package manager for node stacks (npm, pnpm, yarn, bun), per-layer commands (including tool availability for python), the install step, and the verification chain. `init.sh` and the verification layers both consume it.
- **Makefile** — every target is a one-line delegation to the runner (`node scripts/framework-check.mjs <mode>`). Make is optional; nothing is implemented in make recipes anymore.
- **npm scripts** — `package.json` mirrors every make target 1:1 (`npm run check`, `npm run check-arch`, `npm run verify-feature -- <id>`, …). This is the make-free canonical path.
- **Command reference** — `docs/HARNESS.md` is generated from Makefile targets and npm scripts by `npm run harness-docs`; lint checks it against both sources and requires the README to link to it.
- **Bash shims** — `init.sh` and `scripts/check-arch.sh`, `verify-feature.sh`, `session-trace.sh`, `clean-state-check.sh` are thin `exec node …` wrappers kept for documented compatibility.

Layer resolution contract for node projects: the package.json script key is the layer command (`scripts.lint` = `eslint .`, `scripts.test` = `vitest`, …). `run-layer` executes that value directly with `node_modules/.bin` on PATH (matching npm's own behavior). A script value that delegates back to the runner (`run-layer`) is treated as unconfigured to prevent self-reference loops. Harness scripts therefore keep their self-checks under the standard keys and adopters replace those values with their own tools; script values must be direct commands, not wrapper indirections.

Stack precedence: product manifests win over the harness runtime. An adopter repo always contains the harness's own `package.json` (CORE), so detection checks product markers first — python, go, rust, jvm, dotnet — and falls back to `package.json` (node) only when none exist. A python project with the harness installed is therefore detected as python, and its layers resolve to ruff/pytest instead of being shadowed by the harness scripts. Toolchains that are absent resolve to SKIP with a reason (honest degradation) rather than failing.

The harness runtime is Node ≥ 18: any adopter running harness tooling (make targets, npm scripts, init.sh) needs Node regardless of their product stack — detection of python/go/rust/jvm/dotnet projects is about verifying the host project, not replacing the harness runtime.

## Worktree Lanes

Concurrent multi-agent work (D-017) is supported through git worktrees, not a lock or lease layer. Each lane is a sibling git worktree checked out on branch `lane/<feature-id>`:

- **`lane-new F=<id>`** — creates a sibling worktree (`../<repo>-lane-<id>`) on branch `lane/<id>` (new, from the current HEAD, or reused if it already exists), validates the feature's dependencies are already `passing`, and marks it `active` in the lane's own `.harness/state/<id>.json` (uncommitted — the lane's first commit records it).
- **`lane-list`** — lists local `lane/*` branches with the feature each claims, its state, and whether a worktree currently exists for it.
- **`lane-land F=<id>`** — run from the branch you want to merge into: refuses unless the lane branch's committed `.harness/state/<id>.json` marks the feature `passing`, then merges (`--no-ff`), removes the worktree, and deletes the branch.
- **`lane-drop F=<id>`** — removes a lane's worktree without merging; the branch is left intact. `git worktree remove` refuses on uncommitted or untracked changes by default, so abandoning a lane never silently discards work.

Why no lock file: a git branch can only be checked out in one worktree at a time, so branch-checkout exclusivity already gives mutual exclusion on "who owns this feature" — a lease with a stale-claim reaper would just reimplement what git already guarantees. `git status` and the gitignored `.harness/traces/` are naturally worktree-scoped, so `clean-state-check` and session traces need no lane-awareness at all.

What lanes change: arch-002 (`arch:wip-contract`) is lane-aware — on a `lane/<feature-id>` branch, the sole active feature (if any) must be `<feature-id>`, catching drift where a lane's working copy activates a different feature than the one it's named for. This is a real, local check (derived from the current git branch), evaluated in both `check-arch` and Layer 2 (`npm run test`).

## Sharded Feature State

feat-011 (D-017) closed the gap the first cut of Worktree Lanes left open: `feature_list.json` declares what a feature is (id, name, behavior, verification, dependencies, layers) and changes rarely; each feature's mutable fields — `state`, `evidence` — live in their own file, `.harness/state/<feature-id>.json`. Two lanes landing two different features now touch two different files and merge conflict-free by construction, instead of racing to rewrite the same shared array.

- **Read** — `loadFeaturesWithState()` overlays each declared feature with its shard (missing shard = `{state: "planned", evidence: ""}`); every runtime consumer (WIP=1, dependency checks, `verify-feature`, session traces, `clean-state-check`, lane commands) reads through it.
- **Write** — `verify-feature` (via `recordFeaturePass`) writes only the passing feature's shard; its evidence string contains JSON with the timestamp, Git commit, dirty flag, and per-layer results. `feature_list.json` is never rewritten by the gate. Lane commands read/write shards inside the lane's own worktree or, for a landed branch, via `git show <branch>:.harness/state/<id>.json`.
- **Shape enforcement** — Layer 1b (`npm run typecheck`) rejects any `state`/`status`/`evidence` key left inline in `feature_list.json`, and validates every shard file: valid JSON, an allowed state, a real declared feature id (arch-006, `arch:sharded-state`). A stray shard with no matching declaration fails the same way a stray unclassified file fails arch-005.
- **Migration** — `npm run migrate-feature-state` moves a repo's inline `state`/`status`/`evidence` into shards and strips those keys from `feature_list.json`; idempotent, skips features that already have a shard.

## Application Dependency Rules

Adopting projects should enforce the following layered rules once product code exists:

- Layers may only depend on layers below them
- Domain layer has zero external dependencies
- Infrastructure implements interfaces defined by domain
- Presentation never directly accesses infrastructure

## Reusability Contract (Seams)

The framework is reusable because its surfaces are classified. `.harness/manifest.json` is the machine-readable declaration of that classification; this section is its prose form. The classification rule of thumb: a file is **CORE** if it ships as-is and must not be edited; **TEMPLATE** if it ships as a skeleton adopters replace; **INSTANCE** if it never ships at all (project-owned state). Every tracked file is classified — the manifest's `templates` array lists the skeletons, `instance` lists this repo's own state, and arch-005 fails on any tracked file that is not classified (or exempted as product-owned via `productRoots`). Classification precedence: a specific INSTANCE, TEMPLATE, or optional-component claim overrides a directory-level CORE claim; a file claimed as both INSTANCE and TEMPLATE is an error.

- **CORE** — the reusable spine: `AGENTS.md`, `CLAUDE.md`, `Makefile`, `package.json`, `init.sh`, `scripts/`, `templates/`, `LICENSE`, `.nvmrc`, `.harness/manifest.json`, `.harness/arch-rules.json`. Same everywhere; changes here flow to every adopter through upgrades.
- **TEMPLATES** — adopter skeletons in `templates/`. Each manifest entry declares its destination: `{ "from": "templates/progress.md", "to": "PROGRESS.md" }` (copy-and-fill) or `"keep": true` (reference material that stays under `templates/` — sprint contract, evaluator rubric, clean-state checklist). Destinations must be declared INSTANCE and must not collide with CORE (enforced by arch-004). This includes the CI workflow skeleton (`templates/ci.yml` → `.github/workflows/ci.yml`), which runs the full harness check plus the adoption matrix on Linux with real python/go/rust toolchains. Adopters receive these and fill them in; this repo's filled versions live at the declared destinations as INSTANCE state. This repo additionally keeps a `.github/workflows/publish.yml` (tag or manual publish of the harness package to npm) — distribution infrastructure for the harness package itself, not an adopter surface, so it is declared product-owned via `productRoots` and ships nowhere.
- **INSTANCE** — this repo's own state: `feature_list.json`, `.harness/state/` (sharded per-feature state, feat-011), `PROGRESS.md`, `claude-progress.md`, `DECISIONS.md`, `session-handoff.md`, `README.md`, `.gitignore`, `package-lock.json`, `.claude/settings.json`, `docs/`, `.harness/trails/`, `.harness/traces/.gitkeep`. Adopters receive empty skeletons from `templates/`, never this content. `docs/HARNESS.md` is generated for each adopter from its command surfaces.
- **PRODUCT-OWNED** — directories (or files) listed in `productRoots` (e.g. `src/`, `packages/`, a single workflow file); files under them are outside the harness contract and exempt from classification. Adopters list their product code here; the harness repo itself uses it for repo-only distribution infrastructure.
- **OPTIONAL COMPONENTS** — the multi-repo extension (`contracts/`, `tasks/`, `repositories/`, `scripts/verify-all`). Adopters activate it by copying the `templates/multi-repo/*` skeletons to their declared destinations; `npm run verify-all` (root gate) runs every `repositories/*/scripts/verify` and aggregates results, SKIPping repositories without a verify script. Single-repo projects pass `check` without the component, and every check that references it degrades gracefully when its markers are absent. Template destinations may land on optional markers as well as INSTANCE surfaces.

Customization points (from the manifest):
- MUST edit: feature content, project docs, project arch rules.
- MAY edit: extra Makefile targets, package.json project scripts, init.sh stack verification, manifest `productRoots`.
- MUST NOT edit: `scripts/framework-check.mjs`, the manifest classification itself, PASS/SKIP/FAIL semantics, the feature state machine and WIP=1 contract.

Every reuse guarantee (upgrade survival, adoption tests, copy vs npx distribution) derives from this classification. Any future change to the repository layout must update the manifest and this section in the same commit.

Upgrade contract: a harness upgrade overwrites **mustNotEdit CORE surfaces only** (`scripts/`, the root operating-manual shims, LICENSE, `.nvmrc`). Every surface an adopter may own — Makefile additions, package.json scripts, init.sh stack tweaks, manifest `productRoots`, project skills, docs, and all INSTANCE state — is **never overwritten**. The adoption matrix's upgrade test enforces this: it corrupts a mustNotEdit surface, simulates an upgrade, and asserts the corruption was restored while every customization survived. The e2e layer (`npm run e2e`) runs the full adoption matrix (none/node/python/go/rust cells × harness check, product layers, feature cycle) plus the upgrade test; cells whose toolchain is missing report SKIP honestly.

Before an upgrade overwrites anything, `harness-upgrade` snapshots the current on-disk state of every file about to be touched via `scripts/harness-backup.mjs` (feat-012) — a safety net independent of git, for a dirty tree or a mustNotEdit file an adopter edited against policy. Backups are checksum-deduped (an upgrade that changes nothing skips a redundant backup), gzip-compressed per file, and live in `.harness/backups/` (gitignored — a local safety net, not durable evidence; the durable record of *what changed* is git itself). Retention keeps the 5 most recent unpinned backups; `backup-pin`/`backup-unpin` protect specific ones from pruning. `backup-restore <id|latest>` reverts per file: a file that existed before the operation gets its content back, a file the operation newly created is removed.

## Enforcement

Architectural constraints are codified in `.harness/arch-rules.json` and enforced via:

```bash
make check-arch     # or: npm run check-arch
```

Each rule in `arch-rules.json` must include:
- `id` — unique rule identifier
- `description` — what the rule checks
- `check` — the verification command or pattern
- `expect` — expected result
- `what` — human-readable description of the violation
- `why` — why this rule exists
- `fix` — actionable fix instructions

Bootstrap-time rules currently verify:

- required harness surfaces exist
- the feature tracker preserves WIP=1, dependency order, and (on a `lane/<feature-id>` branch) lane ownership
- framework docs do not drift back to template placeholders
- the manifest classifies every tracked file (reusability seam)
- feature declarations carry no leftover inline state — mutable fields live only in `.harness/state/<id>.json` shards

Adopting projects should add language- and framework-specific checks as the codebase grows.

## Module Documentation

Co-locate architecture decisions with the code or harness surface they affect. Product modules should contain brief architecture notes once they exist; until then, keep framework-wide decisions in the root docs.

## References

- [DECISIONS.md](../DECISIONS.md) — Recorded architectural decisions
- [docs/decisions/](../docs/decisions/) — Detailed decision records