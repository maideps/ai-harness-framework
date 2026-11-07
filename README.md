# AI Harness Framework

[![CI](https://github.com/maideps/ai-harness-framework/actions/workflows/ci.yml/badge.svg)](https://github.com/maideps/ai-harness-framework/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Make your AI coding agent finish features properly: one at a time, verified before it says "done", and able to pick up where the last session stopped.**

Works with Claude Code, Codex and Gemini CLI, on node, python, go, rust, jvm and dotnet projects.

<!--
  Demo GIF goes here. Record it with `vhs docs/demo/demo.tape` (see the comments in that file),
  then replace this comment with:
  ![An agent's feature is refused by the verification gate, fixed, then recorded as passing](docs/demo/demo.gif)
-->

## Why

Coding agents write code quickly. The work around the code is where they slip:

- **They forget.** Every new session starts from zero, so you explain the project again.
- **They say "done" too early.** The tests never ran, or a check that was skipped got reported as passing.
- **They sprawl.** You end up with three half-finished features instead of one finished one.
- **They collide.** Two agents in the same checkout overwrite each other's work.

## What the harness does

It adds a small set of files and commands to your repository. Every agent session follows them.

| Problem | What the harness does |
|---|---|
| Forgetting | Progress lives in files, not in chat: `feature_list.json`, `PROGRESS.md`, `progress/`, `DECISIONS.md`. Each session starts with `./init.sh` and continues from the recorded state. |
| "Done" too early | A feature becomes `passing` only through `verify-feature`, which runs its checks in order and saves the evidence. A check that didn't run is reported as SKIP, never as PASS. |
| Sprawl | One active feature at a time, in dependency order. |
| Collisions | Agents working in parallel each get their own git worktree and branch. |

## What it looks like

These are the commands your agent runs. The output is real, from a new project with one feature (`feat-002`) whose test fails until the code is fixed. `…` marks lines left out.

```console
$ npm run -s activate -- feat-001
FAIL: cannot activate feat-001: feature feat-002 is already active

$ npm run -s verify-feature -- feat-002
…
  [PASS] Layer 1: Static checks (137 ms)
  [PASS] Layer 2: Runtime tests (134 ms)
  [PASS] Layer 3: System confirmation (1.1 s)
…
  not ok 1 - greet() returns hi
    error: "'hello' == 'hi'"
…
  [FAIL] Layer 2b: App tests (93 ms) — full output: .harness/logs/feat-002/04-layer-2b-app-tests.log

Repair hint: Fix Layer 2b: App tests failures and rerun the layer command.

=== Feature feat-002: VERIFICATION FAILED ===

$ # after the fix
$ npm run -s verify-feature -- feat-002
…
  [PASS] Layer 2b: App tests (109 ms)

=== Feature feat-002: ALL LAYERS PASS ===
Note: these layers reported SKIP inside a passing run: Layer 3: System confirmation
PASS: Recorded passing evidence for feat-002
Evidence recorded in .harness/state/feat-002.json
```

The SKIP note comes from steps a new project hasn't set up yet: its own end-to-end tests, the optional multi-repo check and the opt-in quality gates. The harness reports them as skipped instead of counting them as passes. Its own self-tests run once per session from `./init.sh`, not on every check.

## Quick Start

You need Node.js 18 or newer. The harness runs on Node whatever your project's stack is. Make is optional: every make target has an `npm run` equivalent.

```bash
# 1. Get the framework
git clone https://github.com/maideps/ai-harness-framework.git

# 2. Add the harness to a project (a new folder or one you already have)
node ai-harness-framework/scripts/create-harness.mjs my-project
cd my-project

# 3. Describe your project in README.md, docs/PRODUCT.md and docs/quality-document.md.
#    Verification fails while they still match the templates. That's on purpose.

# 4. Check that everything is wired up
./init.sh
npm run check
```

Then open the project in your agent and ask it to work on the next feature. It reads `AGENTS.md` (Claude Code reads `CLAUDE.md`, Gemini CLI reads `GEMINI.md`; both point to `AGENTS.md`) and follows the loop: pick one feature, `npm run activate -- <id>`, implement and commit it, `npm run verify-feature -- <id>`, write the session notes.

- **Adding it to a project you already have?** `create-harness` never overwrites a file that already exists, so if your project has its own `package.json`, the harness scripts aren't added to it. Copy them from this repository's [`package.json`](package.json). Where you already have a `lint`, `typecheck`, `test` or `build` script, chain the two instead of replacing yours ([how](docs/USAGE.md#replacing-lint-typecheck-test-or-build-without-losing-the-harnesss-own-checks-25)).
- **On Windows?** Use Git Bash for `./init.sh`.
- **Optional add-ons:** `--with devcontainer` (the same container for every agent), `--with mcp` (shared MCP servers), `--with multi-repo` (one verification across several repositories). See the [Usage Guide](docs/USAGE.md).

## Features

- **Layered verification**: Three verification gates (static checks → runtime tests → system confirmation) that must pass in order before any feature is considered done
- **Feature-driven development**: All work is tracked as discrete features in `feature_list.json` with explicit dependencies and verification criteria
- **WIP=1 constraint**: Only one feature is active at a time—complete it before starting the next
- **Concurrent multi-agent lanes**: Multiple agents can work independent features at once, each in its own sibling git worktree on branch `lane/<feature-id>` (`lane-new`/`lane-list`/`lane-land`/`lane-drop`) — git's own branch-checkout exclusivity is the coordination primitive, no lock file needed, and WIP=1 is enforced per lane. `lane-suggest` lets an agent detect which planned features are startable in parallel right now and propose the plan — advisory only, every state-changing step still needs a human's yes (see the `parallel-lanes` skill)
- **Sharded feature state**: `feature_list.json` declares what a feature is and rarely changes; each feature's mutable state (`state`, `evidence`) lives in its own `.harness/state/<id>.json` — two lanes finishing two different features merge without conflict by construction
- **Durable cross-session continuity**: Per-session notes in `progress/` and a generated `PROGRESS.md` dashboard keep context concise and in sync with feature state
- **Architecture enforcement**: Codified layer dependency rules in `.harness/arch-rules.json`, enforced via `make check-arch` / `npm run check-arch`
- **Skills packs**: Eleven reusable capability packs in `skills/` (feature-cycle, verification, review, testing, commit, release, adopt, parallel-lanes, update-docs, session-handoff, write-skill), validated on every lint run
- **Proven adoption**: An e2e matrix generates throwaway repos for node/python/go/rust from the seam manifest and runs real feature cycles in each; a customization-survival upgrade test guards the seam contract; CI proves both on Linux with real toolchains
- **Agent compliance evals** (framework repository only): `node evals/run.mjs` runs Claude Code on tasks in throwaway adopter repos (implement a feature, or refuse a shortcut such as marking a failing feature passing by hand) and grades what it did: state changed only through the gate, WIP=1, a green check, a hidden test. Reports pass^k across trials and cost. See [evals/README.md](evals/README.md)
- **Distribution**: `create-harness`, `harness-upgrade`, and `harness-audit` tools read the manifest as the single source of truth — adopt with one command, upgrade without losing customizations
- **Opt-in quality gates**: `make quality` / `npm run quality` enforces metric floors declared in `.harness/quality.json` — coverage presets per stack, and any command that prints a number (mutation score, eval accuracy); disabled by default, SKIP while off
- **Optional dev container**: `create-harness --with devcontainer` adds an Ubuntu dev container with Node pinned to `.nvmrc`, the product stack's toolchain, and Claude Code, Codex and Gemini CLI preinstalled — the same environment for every agent session
- **Optional MCP servers**: `create-harness --with mcp` configures the context7 documentation server for Claude Code and Gemini CLI, and the dev container registers it with Codex
- **Optional multi-repo extension**: `verify-all` aggregates per-repository verification for projects that span repositories; single-repo projects are unaffected

The framework is intentionally generic: it provides a reusable harness contract for any development project rather than prescribing a single product stack. Harness tooling runs on Node and detects the host project's stack (node, python, go, rust, jvm, dotnet) at runtime.

## How It Works

### Architecture

This repository has two distinct architecture concerns — don't confuse them:

1. **This repo's own architecture**: one canonical Node runner, `scripts/framework-check.mjs`, implements every harness operation (verification layers, `verify-feature`, worktree lanes, sharded feature state, quality gates, …). The Makefile and `package.json` scripts are thin 1:1 delegations to it, so the make and npm surfaces can't drift apart. `scripts/stack-detect.mjs` is the single source of truth for what kind of project is being verified (node, python, go, rust, jvm, dotnet) and resolves per-layer commands accordingly. Reusable vs. project-owned surfaces are classified in `.harness/manifest.json` (CORE / TEMPLATE / INSTANCE / product-owned), enforced by `make check-arch`. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full model.
2. **The layered product architecture the harness enforces in adopting projects**, once they add source code:

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

   Layers may only depend on layers below them. The domain layer has zero external dependencies. Infrastructure implements interfaces defined by domain. Presentation never directly accesses infrastructure. Adopters extend `.harness/arch-rules.json` with checks for their own product layers as their codebase grows; this repository itself has no product code, so only harness-architecture rules apply here today.

### Verification Layers

Every feature passes through these layers, grouped into three gates (static checks, runtime tests, system confirmation):

| Layer | Name | Command | What It Checks |
|-------|------|---------|----------------|
| 1 | Static Analysis | `make lint` / `npm run lint` | Code style, formatting, syntax |
| 1b | Type Checking | `make typecheck` / `npm run typecheck` | Type safety |
| 2 | Runtime Tests | `make test` / `npm run test` | Unit and integration tests |
| 3 | Build Verification | `make build` / `npm run build` | Production build succeeds |
| 3b | End-to-End | `make e2e` / `npm run e2e` | Full system integration |
| 4 | Quality Gates (opt-in) | `make quality` / `npm run quality` | Coverage, mutation score or any metric stays above its floor |

Run all layers with `make check` (lint → typecheck → test → build → e2e → optional verify-all → optional quality); `npm run check` is the make-free equivalent. The verify-all layer SKIPs when multi-repo markers are absent, and the quality layer while `.harness/quality.json` is disabled. Both surfaces delegate to the same Node runner (`scripts/framework-check.mjs`), so they cannot drift apart.

Layers that are not configured report **SKIP** instead of PASS and do not count as verified. A layer reports **FAIL** by exiting non-zero, which stops the chain.

### State Files

These files are the source of truth—not chat history:

| File | Purpose |
|------|---------|
| `feature_list.json` | Feature declarations — id, behavior, dependencies, verification layers. Rarely changes. |
| `.harness/state/<id>.json` | That feature's mutable state (`state`, `evidence`) — one file per feature |
| `PROGRESS.md` | Generated current-state dashboard and index of session notes |
| `progress/NNN-YYYY-MM-DD.md` | One durable notes file per session |
| `DECISIONS.md` | Architectural decisions log — why the codebase is structured this way |
| `session-handoff.md` | Multi-session handoff starter artifact |

`state` values are `planned`, `active`, `blocked`, and `passing`. `verify-feature` writes only the shard for the feature it just verified — `feature_list.json` itself is never rewritten by the gate (see [Sharded Feature State](docs/ARCHITECTURE.md#sharded-feature-state)). At session end, start a dated note with `node scripts/framework-check.mjs progress-new "<title>"` and fill it in; lint rejects a stale dashboard or a broken session index.

### Reusability Contract

The framework's reusable surfaces are classified in `.harness/manifest.json`: **CORE** files ship as-is (must not be edited); **TEMPLATE** skeletons in `templates/` are what adopters receive to fill in, and **INSTANCE** files (`feature_list.json`, `.harness/state/`, `PROGRESS.md`, `progress/`, `DECISIONS.md`, `README.md`, explicitly declared `docs/` surfaces, …) are this repo's own state and never ship to adopters. Every tracked file is classified — `make check-arch` (rules arch-004 and arch-005) fails on any unclassified file, so distribution can always answer exactly what ships. Unlisted files under `docs/` default to product-owned; declare product code elsewhere with the manifest's `productRoots` key. Any repository layout change must update the manifest and `docs/ARCHITECTURE.md` in the same commit.

### Harness Commands

The generated [Harness Command Reference](docs/HARNESS.md) lists Makefile targets and npm scripts. Run `npm run harness-docs` to regenerate it after changing either command surface.

## Definition of Done

A feature is complete only when ALL of the following are true:

- [ ] Target behavior is implemented
- [ ] Required verification actually ran (tests / lint / type-check / build)
- [ ] Layer 1 (syntax/static checks) passes
- [ ] Layer 2 (runtime behavior/tests) passes
- [ ] Layer 3 (system confirmation/e2e) passes when crossing component boundaries
- [ ] Evidence recorded in `.harness/state/<id>.json` and session notes under `progress/`
- [ ] Repository remains restartable from `./init.sh`

## Feature Roadmap

The dependency-ordered roadmap lives in `feature_list.json` — the machine-readable source of truth. Each feature there declares its behavior, dependencies, and verification layers; current state lives in `.harness/state/<id>.json`. This document intentionally does not duplicate either.

## Working on the Framework Itself

To change the harness rather than use it, run its own checks from a clone of this repository:

```bash
git clone https://github.com/maideps/ai-harness-framework.git
cd ai-harness-framework
./init.sh           # verify the environment is healthy
make check          # full verification; or: npm run check (make and npm forms are 1:1 mirrors)
make help           # all available commands; or: npm run help
```

Prerequisites: Node.js ≥ 18 (the harness runtime: stack detection, verification layers, session traces, and every make target delegate to it); Make is optional, since `npm run <target>` mirrors every make target; Git Bash on Windows, only for `./init.sh` and the `scripts/*.sh` compatibility shims.

## Documentation

- [Product Overview](docs/PRODUCT.md) — Purpose, user flows, and non-goals
- [Architecture](docs/ARCHITECTURE.md) — Layer model, dependency rules, and enforcement
- [Observability](docs/OBSERVABILITY.md) — Session traces, sprint contracts, and evaluation rubrics
- [Tools & MCP](docs/TOOLS.md) — Tool access scoping and MCP integrations
- [Usage Guide](docs/USAGE.md) — How to run, verify, and adopt the framework
- [Project Standards](docs/STANDARDS.md) — This repository's engineering standards
- [Quality Document](docs/quality-document.md) — Module quality ratings
- [Decisions](DECISIONS.md) — Recorded architectural decisions
- [Detailed Decision Records](docs/decisions/) — Expanded decision write-ups

## License

This repository is licensed under the MIT License. See `LICENSE` for details.
