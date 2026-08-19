# AI Harness Framework

A general-purpose AI agent harness framework for building reliable, predictable multi-session engineering workflows. This repository serves as both the harness implementation and a reference template for bootstrapping harness-enabled projects.

## What It Is

The AI Harness Framework provides a structured, verifiable workflow for AI-assisted software development. It enforces a disciplined engineering process through:

- **Layered verification**: Three verification gates (static checks → runtime tests → system confirmation) that must pass in order before any feature is considered done
- **Feature-driven development**: All work is tracked as discrete features in `feature_list.json` with explicit dependencies and verification criteria
- **WIP=1 constraint**: Only one feature is active at a time—complete it before starting the next
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
git clone <repo-url>
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

Every feature passes through three verification gates:

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
| `feature_list.json` | Feature state tracker with dependencies and verification criteria |
| `PROGRESS.md` | Session continuity starter artifact — current state, blockers, next steps |
| `DECISIONS.md` | Architectural decisions log — why the codebase is structured this way |
| `session-handoff.md` | Multi-session handoff starter artifact |

`feature_list.json` uses a framework-native schema with `state` values of `planned`, `active`, `blocked`, and `passing`.

### Reusability Contract

The framework's reusable surfaces are classified in `.harness/manifest.json`: **CORE** files ship as-is (must not be edited), **TEMPLATE** skeletons in `templates/` are what adopters receive to fill in, and **INSTANCE** files (`feature_list.json`, `PROGRESS.md`, `DECISIONS.md`, `README.md`, `docs/`, …) are this repo's own state and never ship to adopters. Every tracked file is classified — `make check-arch` (rules arch-004 and arch-005) fails on any unclassified file, so distribution can always answer exactly what ships. Adopters exempt their own product code with the manifest's `productRoots` key. Any repository layout change must update the manifest and `docs/ARCHITECTURE.md` in the same commit.

### Command Targets

Every make target is mirrored 1:1 by an npm script; both delegate to the Node runner and resolve the host project's stack through the shared detection module (`scripts/stack-detect.mjs`).

| Target | Make form | npm form |
|--------|-----------|----------|
| Install dependencies | `make setup` | `npm run setup` |
| Dev server | `make dev` | `npm run dev` |
| Full verification | `make check` | `npm run check` |
| Layer 1: static analysis | `make lint` | `npm run lint` |
| Layer 1b: type checking | `make typecheck` | `npm run typecheck` |
| Layer 2: runtime tests | `make test` | `npm run test` |
| Layer 3: build verification | `make build` | `npm run build` |
| Layer 3b: end-to-end tests | `make e2e` | `npm run e2e` |
| Architecture enforcement | `make check-arch` | `npm run check-arch` |
| Feature verification | `make verify-feature F=<id>` | `npm run verify-feature -- <id>` |
| Multi-repo verification | `make verify-all` | `npm run verify-all` |
| Verify + record trail | `make vcr` | `npm run vcr` |
| Record session start | `make session-start` | `npm run session-start` |
| Record session end | `make session-end` | `npm run session-end` |
| Pre-commit clean state | `make clean-check` | `npm run clean-check` |
| Generate an adopter repo | `make create-harness D=<dir>` | `npm run create-harness -- <dir>` |
| Apply a harness upgrade | `make harness-upgrade D=<dir>` | `npm run harness-upgrade -- <dir>` |
| Local harness audit | `make harness-audit D=<dir>` | `npm run harness-audit -- <dir>` |
| Session report | `make report` | `npm run report` |
| Periodic sweep | `make sweep` | `npm run sweep` |
| Show all targets | `make help` | `npm run help` |

## Definition of Done

A feature is complete only when ALL of the following are true:

- [ ] Target behavior is implemented
- [ ] Required verification actually ran (tests / lint / type-check / build)
- [ ] Layer 1 (syntax/static checks) passes
- [ ] Layer 2 (runtime behavior/tests) passes
- [ ] Layer 3 (system confirmation/e2e) passes when crossing component boundaries
- [ ] Evidence recorded in `feature_list.json` and `PROGRESS.md`
- [ ] Repository remains restartable from `./init.sh`

## Feature Roadmap

The dependency-ordered roadmap lives in `feature_list.json` — the machine-readable source of truth. Each feature there declares its behavior, dependencies, verification layers, and current state; this document intentionally does not duplicate it.

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