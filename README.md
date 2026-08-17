# AI Harness Framework

A general-purpose AI agent harness framework for building reliable, predictable multi-session engineering workflows. This repository serves as both the harness implementation and a reference template for bootstrapping harness-enabled projects.

## What It Is

The AI Harness Framework provides a structured, verifiable workflow for AI-assisted software development. It enforces a disciplined engineering process through:

- **Layered verification**: Three verification gates (static checks → runtime tests → system confirmation) that must pass in order before any feature is considered done
- **Feature-driven development**: All work is tracked as discrete features in `feature_list.json` with explicit dependencies and verification criteria
- **WIP=1 constraint**: Only one feature is active at a time—complete it before starting the next
- **Durable cross-session continuity**: State files (`PROGRESS.md`, `DECISIONS.md`, `session-handoff.md`) ensure context survives across sessions
- **Architecture enforcement**: Codified layer dependency rules in `.harness/arch-rules.json`, enforced via `make check-arch`

The framework is intentionally generic: it provides a reusable harness contract for any development project rather than prescribing a single product stack.

## Quick Start

```bash
# 1. Clone the repository
git clone <repo-url>
cd ai-harness-framework

# 2. Verify the environment is healthy
./init.sh

# 3. Run full verification
make check

# 4. See all available commands
make help
```

### Prerequisites

- **Node.js** ≥ 18 (see `.nvmrc`)
- **Git Bash** (on Windows) — scripts use portable POSIX constructs compatible with Git for Windows
- **Make** — available via Git Bash (`mingw32-make`) on Windows, or natively on macOS/Linux

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
| 1 | Static Analysis | `make lint` | Code style, formatting, syntax |
| 1b | Type Checking | `make typecheck` | Type safety |
| 2 | Runtime Tests | `make test` | Unit and integration tests |
| 3 | Build Verification | `make build` | Production build succeeds |
| 3b | End-to-End | `make e2e` | Full system integration |

Run all layers with `make check` (lint → typecheck → test → build → e2e).

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

### Makefile Targets

| Target | Description |
|--------|-------------|
| `make setup` | Install all dependencies from scratch |
| `make dev` | Start local development server |
| `make check` | Full verification: lint → typecheck → test → build → e2e |
| `make lint` | Layer 1: static analysis |
| `make typecheck` | Layer 1b: type checking |
| `make test` | Layer 2: runtime tests |
| `make build` | Layer 3: build verification |
| `make e2e` | Layer 3b: end-to-end tests |
| `make check-arch` | Architecture constraint enforcement |
| `make verify-feature F=<id>` | Run all verification layers for a specific feature |
| `make vcr` | Verify + check-arch + record trail in `.harness/trails/` |
| `make session-start` | Record session start |
| `make session-end` | Record session end |
| `make clean-check` | Pre-commit clean state verification |
| `make help` | Show all available targets |

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

See `feature_list.json` for the detailed, dependency-ordered feature plan. Current features:

1. **feat-001** — Core Scaffold
2. **feat-002** — Primary Capability
3. **feat-003** — Reliability and Guardrails
4. **feat-004** — Documentation Alignment
5. **feat-005** — Release Readiness
6. **feat-006** — Optional Enhancements

## Documentation

- [Product Overview](docs/PRODUCT.md) — Purpose, user flows, and non-goals
- [Architecture](docs/ARCHITECTURE.md) — Layer model, dependency rules, and enforcement
- [Observability](docs/OBSERVABILITY.md) — Session traces, sprint contracts, and evaluation rubrics
- [Tools & MCP](docs/TOOLS.md) — Tool access scoping and MCP integrations
- [Quality Document](docs/quality-document.md) — Module quality ratings
- [Decisions](DECISIONS.md) — Recorded architectural decisions
- [Detailed Decision Records](docs/decisions/) — Expanded decision write-ups

## License

This repository is licensed under the MIT License. See `LICENSE` for details.