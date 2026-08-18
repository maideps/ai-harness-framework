# Architecture

## Layer Model

The framework has two architecture concerns:

1. **Harness architecture** in this repository — the instruction, state, verification, and observability surfaces that make the framework reusable.
2. **Application architecture** in adopting repositories — the layered product code structure that the harness will later enforce.

During bootstrap (`feat-001`), the repository primarily validates harness architecture. Once an adopting project adds source code, teams should extend `.harness/arch-rules.json` with product-layer checks.

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

- **Node runner** — `scripts/framework-check.mjs` implements all modes: verification layers (`lint`, `typecheck`, `test`, `build`, `e2e`), `run-layer`, `verify-chain`, `check-arch`, `verify-feature`, `session-trace`, `clean-state-check`, `setup`, `record-trail`, `manifest`, `help`. It is the only place the logic exists; every surface delegates to it.
- **Stack detection** — `scripts/stack-detect.mjs` is the single source of truth for "what kind of project is this". It detects the runtime (node, python, go, rust, jvm, dotnet, none) from manifest markers, the package manager for node stacks (npm, pnpm, yarn, bun), per-layer commands (including tool availability for python), the install step, and the verification chain. `init.sh` and the verification layers both consume it.
- **Makefile** — every target is a one-line delegation to the runner (`node scripts/framework-check.mjs <mode>`). Make is optional; nothing is implemented in make recipes anymore.
- **npm scripts** — `package.json` mirrors every make target 1:1 (`npm run check`, `npm run check-arch`, `npm run verify-feature -- <id>`, …). This is the make-free canonical path.
- **Bash shims** — `init.sh` and `scripts/check-arch.sh`, `verify-feature.sh`, `session-trace.sh`, `clean-state-check.sh` are thin `exec node …` wrappers kept for documented compatibility.

Layer resolution contract for node projects: the package.json script key is the layer command (`scripts.lint` = `eslint .`, `scripts.test` = `vitest`, …). `run-layer` executes that value directly with `node_modules/.bin` on PATH (matching npm's own behavior). A script value that delegates back to the runner (`run-layer`) is treated as unconfigured to prevent self-reference loops. Harness scripts therefore keep their self-checks under the standard keys and adopters replace those values with their own tools; script values must be direct commands, not wrapper indirections.

The harness runtime is Node ≥ 18: any adopter running harness tooling (make targets, npm scripts, init.sh) needs Node regardless of their product stack — detection of python/go/rust/jvm/dotnet projects is about verifying the host project, not replacing the harness runtime.

## Application Dependency Rules

Adopting projects should enforce the following layered rules once product code exists:

- Layers may only depend on layers below them
- Domain layer has zero external dependencies
- Infrastructure implements interfaces defined by domain
- Presentation never directly accesses infrastructure

## Reusability Contract (Seams)

The framework is reusable because its surfaces are classified. `.harness/manifest.json` is the machine-readable declaration of that classification; this section is its prose form. The classification rule of thumb: a file is **CORE** if it ships as-is and must not be edited; **TEMPLATE** if it ships as a skeleton adopters replace; **INSTANCE** if it never ships at all (project-owned state).

- **CORE** — the reusable spine: `AGENTS.md`, `CLAUDE.md`, `Makefile`, `package.json`, `init.sh`, `scripts/`, `templates/`, `.harness/manifest.json`, `.harness/arch-rules.json`. Same everywhere; changes here flow to every adopter through upgrades.
- **INSTANCE** — this repo's own state: `feature_list.json`, `PROGRESS.md`, `claude-progress.md`, `DECISIONS.md`, `session-handoff.md`, `docs/quality-document.md`. Adopters receive empty skeletons from `templates/`, never this content.
- **OPTIONAL COMPONENTS** — the multi-repo extension (`contracts/`, `tasks/`, `repositories/`, `scripts/verify-all`). Checks that reference it must degrade gracefully when its markers are absent.

Customization points (from the manifest):
- MUST edit: feature content, project docs, project arch rules.
- MAY edit: extra Makefile targets, package.json project scripts, init.sh stack verification.
- MUST NOT edit: `scripts/framework-check.mjs`, the manifest, PASS/SKIP/FAIL semantics, the feature state machine and WIP=1 contract.

Every reuse guarantee (upgrade survival, adoption tests, copy vs npx distribution) derives from this classification. Any future change to the repository layout must update the manifest and this section in the same commit.

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
- the feature tracker preserves WIP=1 and dependency order
- framework docs do not drift back to template placeholders

Adopting projects should add language- and framework-specific checks as the codebase grows.

## Module Documentation

Co-locate architecture decisions with the code or harness surface they affect. Product modules should contain brief architecture notes once they exist; until then, keep framework-wide decisions in the root docs.

## References

- [DECISIONS.md](../DECISIONS.md) — Recorded architectural decisions
- [docs/decisions/](../docs/decisions/) — Detailed decision records