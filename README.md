# AI Harness Framework

[![CI](https://github.com/maideps/ai-harness-framework/actions/workflows/ci.yml/badge.svg)](https://github.com/maideps/ai-harness-framework/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A general-purpose AI agent harness framework for building reliable, predictable multi-session engineering workflows. This repository serves as both the harness implementation and a reference template for bootstrapping harness-enabled projects.

## What It Is

The AI Harness Framework provides a structured, verifiable workflow for AI-assisted software development. It enforces a disciplined engineering process through:

- **Layered verification**: Three verification gates (static checks → runtime tests → system confirmation) that must pass in order before any feature is considered done
- **Feature-driven development**: All work is tracked as discrete features in `feature_list.json` with explicit dependencies and verification criteria
- **WIP=1 constraint**: Only one feature is active at a time—complete it before starting the next
- **Concurrent multi-agent lanes**: Multiple agents can work independent features at once, each in its own sibling git worktree on branch `lane/<feature-id>` (`lane-new`/`lane-list`/`lane-land`/`lane-drop`) — git's own branch-checkout exclusivity is the coordination primitive, no lock file needed, and WIP=1 is enforced per lane
- **Sharded feature state**: `feature_list.json` declares what a feature is and rarely changes; each feature's mutable state (`state`, `evidence`) lives in its own `.harness/state/<id>.json` — two lanes finishing two different features merge without conflict by construction
- **Durable cross-session continuity**: State files (`PROGRESS.md`, `DECISIONS.md`, `session-handoff.md`) ensure context survives across sessions
- **Architecture enforcement**: Codified layer dependency rules in `.harness/arch-rules.json`, enforced via `make check-arch` / `npm run check-arch`
- **Skills packs**: Nine reusable capability packs in `skills/` (feature-cycle, verification, review, commit, release, adopt, update-docs, session-handoff, write-skill), validated on every lint run
- **Proven adoption**: An e2e matrix generates throwaway repos for node/python/go/rust from the seam manifest and runs real feature cycles in each; a customization-survival upgrade test guards the seam contract; CI proves both on Linux with real toolchains
- **Distribution**: `create-harness`, `harness-upgrade`, and `harness-audit` tools read the manifest as the single source of truth — adopt with one command, upgrade without losing customizations
- **Optional multi-repo extension**: `verify-all` aggregates per-repository verification for projects that span repositories; single-repo projects are unaffected

The framework is intentionally generic: it provides a reusable harness contract for any development project rather than prescribing a single product stack. Harness tooling runs on Node and detects the host project's stack (node, python, go, rust, jvm, dotnet) at runtime.

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/maideps/ai-harness-framework.git
cd ai-harness-framework

# 2. Verify the environment is healthy
./init.sh

# 3. Run full verification (make and npm forms are 1:1 mirrors)
make check          # or: npm run check

# 4. See all available commands
make help           # or: npm run help
```

### Prerequisites

- **Node.js** ≥ 18 — the harness runtime: stack detection, verification layers, session traces, and every make target delegate to it
- **Make** — optional; `npm run <target>` mirrors every make target for make-free environments
- **Git Bash** (on Windows) — only needed for `./init.sh` and the `scripts/*.sh` compatibility shims

## How It Works

### Architecture

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

Layers may only depend on layers below them. The domain layer has zero external dependencies. Infrastructure implements interfaces defined by domain. Presentation never directly accesses infrastructure.

### Verification Layers

Every feature passes through these layers, grouped into three gates (static checks, runtime tests, system confirmation):

| Layer | Name | Command | What It Checks |
|-------|------|---------|----------------|
| 1 | Static Analysis | `make lint` / `npm run lint` | Code style, formatting, syntax |
| 1b | Type Checking | `make typecheck` / `npm run typecheck` | Type safety |
| 2 | Runtime Tests | `make test` / `npm run test` | Unit and integration tests |
| 3 | Build Verification | `make build` / `npm run build` | Production build succeeds |
| 3b | End-to-End | `make e2e` / `npm run e2e` | Full system integration |

Run all layers with `make check` (lint → typecheck → test → build → e2e); `npm run check` is the make-free equivalent. Both surfaces delegate to the same Node runner (`scripts/framework-check.mjs`), so they cannot drift apart.

Layers that are not configured report **SKIP** instead of PASS and do not count as verified. A layer reports **FAIL** by exiting non-zero, which stops the chain.

### State Files

These files are the source of truth—not chat history:

| File | Purpose |
|------|---------|
| `feature_list.json` | Feature declarations — id, behavior, dependencies, verification layers. Rarely changes. |
| `.harness/state/<id>.json` | That feature's mutable state (`state`, `evidence`) — one file per feature |
| `PROGRESS.md` | Session continuity starter artifact — current state, blockers, next steps |
| `DECISIONS.md` | Architectural decisions log — why the codebase is structured this way |
| `session-handoff.md` | Multi-session handoff starter artifact |

`state` values are `planned`, `active`, `blocked`, and `passing`. `verify-feature` writes only the shard for the feature it just verified — `feature_list.json` itself is never rewritten by the gate (see [Sharded Feature State](docs/ARCHITECTURE.md#sharded-feature-state)).

### Reusability Contract

The framework's reusable surfaces are classified in `.harness/manifest.json`: **CORE** files ship as-is (must not be edited), **TEMPLATE** skeletons in `templates/` are what adopters receive to fill in, and **INSTANCE** files (`feature_list.json`, `.harness/state/`, `PROGRESS.md`, `DECISIONS.md`, `README.md`, `docs/`, …) are this repo's own state and never ship to adopters. Every tracked file is classified — `make check-arch` (rules arch-004 and arch-005) fails on any unclassified file, so distribution can always answer exactly what ships. Adopters exempt their own product code with the manifest's `productRoots` key. Any repository layout change must update the manifest and `docs/ARCHITECTURE.md` in the same commit.

### Harness Commands

The command reference is generated from the Makefile and npm scripts. See [Harness Command Reference](docs/HARNESS.md); regenerate it with `npm run harness-docs`.

## Definition of Done

A feature is complete only when ALL of the following are true:

- [ ] Target behavior is implemented
- [ ] Required verification actually ran (tests / lint / type-check / build)
- [ ] Layer 1 (syntax/static checks) passes
- [ ] Layer 2 (runtime behavior/tests) passes
- [ ] Layer 3 (system confirmation/e2e) passes when crossing component boundaries
- [ ] Evidence recorded in `.harness/state/<id>.json` and `PROGRESS.md`
- [ ] Repository remains restartable from `./init.sh`

## Feature Roadmap

The dependency-ordered roadmap lives in `feature_list.json` — the machine-readable source of truth. Each feature there declares its behavior, dependencies, and verification layers; current state lives in `.harness/state/<id>.json`. This document intentionally does not duplicate either.

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