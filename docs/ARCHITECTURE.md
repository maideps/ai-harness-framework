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

- **Node runner** — `scripts/framework-check.mjs` implements all modes: verification layers (`lint`, `typecheck`, `test`, `build`, `e2e`), `run-layer`, `verify-chain`, `check-arch`, `verify-feature`, `session-trace`, `clean-state-check`, `setup`, `record-trail`, `manifest`, `help`. It is the only place the logic exists; every surface delegates to it.
- **Stack detection** — `scripts/stack-detect.mjs` is the single source of truth for "what kind of project is this". It detects the runtime (node, python, go, rust, jvm, dotnet, none) from manifest markers, the package manager for node stacks (npm, pnpm, yarn, bun), per-layer commands (including tool availability for python), the install step, and the verification chain. `init.sh` and the verification layers both consume it.
- **Makefile** — every target is a one-line delegation to the runner (`node scripts/framework-check.mjs <mode>`). Make is optional; nothing is implemented in make recipes anymore.
- **npm scripts** — `package.json` mirrors every make target 1:1 (`npm run check`, `npm run check-arch`, `npm run verify-feature -- <id>`, …). This is the make-free canonical path.
- **Bash shims** — `init.sh` and `scripts/check-arch.sh`, `verify-feature.sh`, `session-trace.sh`, `clean-state-check.sh` are thin `exec node …` wrappers kept for documented compatibility.

Layer resolution contract for node projects: the package.json script key is the layer command (`scripts.lint` = `eslint .`, `scripts.test` = `vitest`, …). `run-layer` executes that value directly with `node_modules/.bin` on PATH (matching npm's own behavior). A script value that delegates back to the runner (`run-layer`) is treated as unconfigured to prevent self-reference loops. Harness scripts therefore keep their self-checks under the standard keys and adopters replace those values with their own tools; script values must be direct commands, not wrapper indirections.

Stack precedence: product manifests win over the harness runtime. An adopter repo always contains the harness's own `package.json` (CORE), so detection checks product markers first — python, go, rust, jvm, dotnet — and falls back to `package.json` (node) only when none exist. A python project with the harness installed is therefore detected as python, and its layers resolve to ruff/pytest instead of being shadowed by the harness scripts. Toolchains that are absent resolve to SKIP with a reason (honest degradation) rather than failing.

The harness runtime is Node ≥ 18: any adopter running harness tooling (make targets, npm scripts, init.sh) needs Node regardless of their product stack — detection of python/go/rust/jvm/dotnet projects is about verifying the host project, not replacing the harness runtime.

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
- **INSTANCE** — this repo's own state: `feature_list.json`, `PROGRESS.md`, `claude-progress.md`, `DECISIONS.md`, `session-handoff.md`, `README.md`, `.gitignore`, `package-lock.json`, `.claude/settings.json`, `docs/`, `.harness/trails/`, `.harness/traces/.gitkeep`. Adopters receive empty skeletons from `templates/`, never this content.
- **PRODUCT-OWNED** — directories (or files) listed in `productRoots` (e.g. `src/`, `packages/`, a single workflow file); files under them are outside the harness contract and exempt from classification. Adopters list their product code here; the harness repo itself uses it for repo-only distribution infrastructure.
- **OPTIONAL COMPONENTS** — the multi-repo extension (`contracts/`, `tasks/`, `repositories/`, `scripts/verify-all`). Adopters activate it by copying the `templates/multi-repo/*` skeletons to their declared destinations; `npm run verify-all` (root gate) runs every `repositories/*/scripts/verify` and aggregates results, SKIPping repositories without a verify script. Single-repo projects pass `check` without the component, and every check that references it degrades gracefully when its markers are absent. Template destinations may land on optional markers as well as INSTANCE surfaces.

Customization points (from the manifest):
- MUST edit: feature content, project docs, project arch rules.
- MAY edit: extra Makefile targets, package.json project scripts, init.sh stack verification, manifest `productRoots`.
- MUST NOT edit: `scripts/framework-check.mjs`, the manifest classification itself, PASS/SKIP/FAIL semantics, the feature state machine and WIP=1 contract.

Every reuse guarantee (upgrade survival, adoption tests, copy vs npx distribution) derives from this classification. Any future change to the repository layout must update the manifest and this section in the same commit.

Upgrade contract: a harness upgrade overwrites **mustNotEdit CORE surfaces only** (`scripts/`, the root operating-manual shims, LICENSE, `.nvmrc`). Every surface an adopter may own — Makefile additions, package.json scripts, init.sh stack tweaks, manifest `productRoots`, project skills, docs, and all INSTANCE state — is **never overwritten**. The adoption matrix's upgrade test enforces this: it corrupts a mustNotEdit surface, simulates an upgrade, and asserts the corruption was restored while every customization survived. The e2e layer (`npm run e2e`) runs the full adoption matrix (none/node/python/go/rust cells × harness check, product layers, feature cycle) plus the upgrade test; cells whose toolchain is missing report SKIP honestly.

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
- the manifest classifies every tracked file (reusability seam)

Adopting projects should add language- and framework-specific checks as the codebase grows.

## Module Documentation

Co-locate architecture decisions with the code or harness surface they affect. Product modules should contain brief architecture notes once they exist; until then, keep framework-wide decisions in the root docs.

## References

- [DECISIONS.md](../DECISIONS.md) — Recorded architectural decisions
- [docs/decisions/](../docs/decisions/) — Detailed decision records