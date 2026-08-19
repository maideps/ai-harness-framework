# Architectural Decisions Log

This file records significant architectural decisions, their context, alternatives considered, and consequences. It serves as durable cross-session memory for why the codebase is structured the way it is.

---

## Decision Template

```
### D-XXX: [Decision Title]

**Date:** YYYY-MM-DD
**Status:** proposed | accepted | deprecated | superseded by D-YYY
**Context:** [What problem are we solving? What constraints exist?]
**Decision:** [What did we decide to do?]
**Alternatives considered:**
- Alternative 1: [description] — Rejected because [reason]
- Alternative 2: [description] — Rejected because [reason]
**Consequences:**
- Positive: [benefits gained]
- Negative: [tradeoffs accepted]
```

---

## Recorded Decisions

### D-001: Verification layers report PASS / SKIP / FAIL

**Date:** 2026-08-17
**Status:** accepted
**Context:** Layer targets printed `[PASS]` even when no configuration existed (e.g. "No lint configuration found — skipping" followed by PASS), and `package.json` e2e/dev were `echo && exit 0`. This produced false confidence and violated the framework's own "skipping produces false confidence" principle.
**Decision:** Every verification layer reports exactly one of PASS (ran and succeeded), SKIP (not configured — does not count as verified), or FAIL (non-zero exit stops the chain). Unconfigured layers are represented by runner modes that print `[SKIP]` and exit 0.
**Alternatives considered:**
- Treating SKIP as PASS — rejected: indistinguishable from real verification.
- Failing on SKIP — rejected: harness-only bootstrap repos legitimately lack e2e.
**Consequences:**
- Positive: `make check` output is now an honest record of what actually ran.
- Negative: adopters must read the SKIP summary instead of assuming everything passed.

### D-002: e2e is part of make check

**Date:** 2026-08-17
**Status:** accepted
**Context:** `make check` ran lint → typecheck → test → build, but the Definition of Done requires Layer 3b (e2e) for cross-component changes, so `make check` could pass without e2e ever running.
**Decision:** `make check` runs all layers in order: lint → typecheck → test → build → e2e.
**Alternatives considered:**
- Keeping e2e separate — rejected: the gate must match the Definition of Done.
**Consequences:**
- Positive: the primary gate now matches the documented DoD.
- Negative: check is slightly slower on repos with real e2e suites.

### D-003: make vcr records a verification trail

**Date:** 2026-08-17
**Status:** accepted
**Context:** `make vcr` was documented as "Verify + check-arch + record" but recorded nothing.
**Decision:** After check and check-arch pass, `vcr` writes a JSON trail (kind, timestamp, git commit, active feature) to `.harness/trails/`.
**Alternatives considered:**
- Writing into feature evidence directly — rejected: trails are per-run records, not feature summaries.
**Consequences:**
- Positive: VCR runs leave durable, inspectable evidence.
- Negative: one small JSON file per vcr run.

### D-004: make-free verification path via npm scripts

**Date:** 2026-08-17
**Status:** accepted
**Context:** The framework requires make for its gates, but make is not present on all target environments (including the primary Windows machine this repo is developed on). Node is already a hard dependency via `scripts/framework-check.mjs`.
**Decision:** `package.json` exposes a `check` script (lint && typecheck && test && build && e2e) and feature layer commands reference the npm entrypoints; Makefile targets remain for environments with make.
**Alternatives considered:**
- Requiring make everywhere — rejected: needless environment coupling.
- Removing the Makefile — rejected: make targets are a documented, useful surface.
**Consequences:**
- Positive: verification works on any machine with Node; both surfaces stay in sync because they delegate to the same runner.
- Negative: two entry surfaces to keep aligned (mitigated by `ensureMakeTargets` and the npm mirror).

### D-005: Reusability is guaranteed by a classified seam contract

**Date:** 2026-08-18
**Status:** accepted
**Context:** "Reusable" is an aspiration until the framework states which files adopters may customize and which are invariant. Adopter skeletons (PROGRESS.md, feature_list.json) were conflated with this repo's own instance state.
**Decision:** `.harness/manifest.json` classifies every surface as CORE (ships as-is, must not edit), TEMPLATE (skeletons in `templates/`), or INSTANCE (project-owned state that never ships). The manifest is validated by a `manifest` runner mode and enforced by arch-004. Layout changes must update the manifest and docs/ARCHITECTURE.md in the same commit.
**Alternatives considered:**
- Prose-only seam documentation — rejected: drift is invisible without a machine check.
- A separate package repository for the core — rejected for now: one repo serving as both product and dogfood instance is simpler at this stage.
**Consequences:**
- Positive: upgrade survival, adoption, and distribution can all be tested against one machine-readable contract.
- Negative: every layout change now has one extra file to keep accurate (accepted cost).

### D-006: One Node runner, two surfaces, bash shims

**Date:** 2026-08-18
**Status:** accepted
**Context:** Harness operations were split across five bash scripts (`check-arch.sh`, `verify-feature.sh`, `session-trace.sh`, `clean-state-check.sh`) plus inline Makefile recipes and init.sh logic, with jq/node fallback branches duplicated everywhere. Bash-only tooling breaks the Windows-first environment and every copy of logic is a drift risk.
**Decision:** The Node runner (`scripts/framework-check.mjs`) is the single canonical implementation of every harness operation. A new `scripts/stack-detect.mjs` module is the single source of truth for project-stack detection (runtime, package manager, per-layer commands, install step, verification chain) and is consumed by init.sh and the verification layers. Makefile targets and npm scripts are thin 1:1 mirrors that delegate to the runner; the four bash scripts become `exec node …` shims. The harness runtime is Node ≥ 18 for all adopters regardless of their product stack.
**Alternatives considered:**
- Keeping bash as the canonical implementation with a Node fallback — rejected: two implementations of every check, and bash is not portable to the Windows-first environment.
- Deleting the bash entrypoints entirely — rejected: documented surfaces (`bash scripts/verify-feature.sh feat-001`) and existing tooling reference them; thin shims preserve compatibility at zero logic cost.
- A shell module shared by init.sh and the Makefile — rejected: make and bash cannot import a common shell module cleanly, and detection logic belongs next to the runner that executes it.
**Consequences:**
- Positive: one implementation per operation; `make check` ≡ `npm run check` by construction; stack detection works for node/python/go/rust/jvm/dotnet hosts from one module; session traces, feature verification, and clean-state checks are portable to Windows.
- Negative: make targets now require Node (already a hard dependency of the harness); `run-layer` executes package.json script values directly, so pre/post npm hooks do not run (documented in ARCHITECTURE.md).

### D-007: The seam manifest classifies every tracked file

**Date:** 2026-08-18
**Status:** accepted
**Context:** The manifest classified CORE and INSTANCE but was silent about README.md, docs/, LICENSE, .gitignore, .nvmrc, .claude/settings.json, and package-lock.json. README.md carried this repo's feature roadmap (project-specific content) in a surface distribution would touch, and adopters had no skeletons for the project docs every repository needs. Distribution could not answer "does this file ship?" for half the repo.
**Decision:** The manifest now classifies every tracked file: `core` (ships as-is, now including LICENSE and .nvmrc), `templates` (skeletons, now including project README, .gitignore, and docs/PRODUCT, ARCHITECTURE, OBSERVABILITY, TOOLS, decisions/index), and `instance` (this repo's state, now including README.md, docs/, .gitignore, .claude/settings.json, package-lock.json, trails, trace placeholder). A new arch-005 rule fails on any tracked file that is not classified or is claimed twice. Adopters exempt their product code with a `productRoots` key (the only manifest field they may edit). Precedence: a specific INSTANCE or TEMPLATE claim overrides a directory-level CORE claim; INSTANCE+TEMPLATE ambiguity is an error. Instance-specific content (this repo's roadmap, feat-001 history) was removed from reusable docs.
**Alternatives considered:**
- Shipping README/docs as CORE — rejected: project docs are project-specific by nature; shipping this repo's filled versions leaks one project's roadmap into every adopter.
- Coverage check over the whole repo without exemptions — rejected: adopters' product code would fail the harness's own arch check; `productRoots` makes the exemption explicit and machine-readable.
**Consequences:**
- Positive: distribution (feat-006) has one machine-readable answer for every file; adopters receive project-shaped doc skeletons instead of nothing or leaked instance content; arch-005 prevents silent drift.
- Negative: every new tracked file in this repo must be classified (accepted cost, enforced by arch-005); adopters with product code must list their roots in `productRoots`.

### D-008: Skills are capability packs validated by the runner

**Date:** 2026-08-18
**Status:** accepted
**Context:** How-to knowledge (how to run a feature cycle, verify honestly, hand off a session) lived only inside AGENTS.md prose — no load-when-relevant granularity, no adopter extension point, no machine check. The lidr-specboot reference harness demonstrated a proven format: per-skill folders with SKILL.md frontmatter (name, description), a When to Use section, workflow phases, and quick-reference checklists.
**Decision:** The harness ships a `skills/` CORE directory with six framework-native skills (feature-cycle, verification, session-handoff, adopt, release, write-skill) in the lidr-style format. The runner's lint layer validates every skill: SKILL.md present, frontmatter name matches its folder, description present, "## When to Use" section present. Adopters may add project skills under `skills/` (mayEdit) but must not modify shipped skills.
**Alternatives considered:**
- Keeping skill knowledge only in AGENTS.md — rejected: no granular load conditions, no extension point, nothing to validate.
- Adopting lidr-specboot's full agents/skills/symlink structure — rejected: role agents and multi-copilot symlinks are out of scope for this harness's verification loop; the skill format is the transferable part.
**Consequences:**
- Positive: capability packs are discoverable, loadable, and machine-validated; adopters get a documented extension point; AGENTS.md stays process law while skills carry how-to.
- Negative: skills are a new surface to keep accurate; skill authors must follow the format (enforced by lint).

### D-009: Multi-copilot shims and project standards complete the portability surface

**Date:** 2026-08-18
**Status:** accepted
**Context:** The harness's canonical contract lived in AGENTS.md with a CLAUDE.md shim only; Copilot and Gemini conventions had no entry point, and adopters had no place for project coding standards (the lidr-specboot reference harness carries base-standards.md plus backend/frontend/docs standards). Commit discipline, pre-gate review, and docs-drift rules were scattered across prose instead of being loadable skills.
**Decision:** Add `codex.md` and `GEMINI.md` thin shims pointing at AGENTS.md (CORE, no symlinks — portable on Windows), a `docs/STANDARDS.md` adopter skeleton (`{from: templates/docs/STANDARDS.md, to: docs/STANDARDS.md}`) plus this repo's filled instance copy, and three new skills: `commit` (focused commits), `review` (independent pre-gate pass), `update-docs` (same-commit docs-drift rule). The shims join the required surfaces (lint, clean-state-check).
**Alternatives considered:**
- Symlinking per-copilot files like lidr-specboot — rejected: symlinks fail without privileges on Windows; plain shim files are simpler and portable.
- A single multi-copilot file — rejected: each tool looks for its own conventional filename.
**Consequences:**
- Positive: the harness exposes itself to Copilot, Gemini, and Claude conventions with zero duplication of the contract; coding standards have a home; commit/review/docs discipline is loadable and validated.
- Negative: two more root files to keep as thin shims (enforced as required surfaces).

### D-010: The e2e layer is the adoption matrix; product stacks win; upgrades never overwrite adopter-owned surfaces

**Date:** 2026-08-19
**Status:** accepted
**Context:** The e2e layer reported SKIP — the framework had never proven it could be adopted. The matrix's first run exposed a real seam flaw: an adopter repo always contains the harness's own package.json (CORE), so stack detection resolved every adopter to node and shadowed python/go/rust products. It also forced a decision on upgrade semantics: how does a harness upgrade avoid clobbering customizations while still delivering fixes?
**Decision:** (1) `npm run e2e` runs a real adoption matrix (`scripts/adoption-matrix.mjs`): throwaway repos are generated from the manifest for none/node/python/go/rust cells, and each runs check-arch, the product layer chain, and a full feature cycle through verify-feature; cells whose toolchain is absent SKIP with a reason. (2) Detection order is product-first: python/go/rust/jvm/dotnet markers are checked before package.json, which becomes the node fallback. (3) Upgrade contract: overwrite mustNotEdit CORE only; never overwrite mayEdit/mustEdit surfaces (Makefile, package.json, init.sh, manifest productRoots, skills additions, docs, INSTANCE state). A customization-survival upgrade test enforces it. (4) Layer 2 now also runs `node --test tests/` for the runner's own logic; verify-feature records which layers reported SKIP in the evidence string; session-trace merges atomically (tmp + rename).
**Alternatives considered:**
- Keeping e2e as a SKIP reporter — rejected: adoption was unverified; the matrix found real bugs the SKIP reporter would have hidden.
- Harness-scripts-first detection with per-stack overrides — rejected: fragile; product-first is a simple, predictable rule.
- Full-overwrite upgrades — rejected: destroys adopters' customization work; never-overwrite plus mustNotEdit refresh is the survival guarantee.
**Consequences:**
- Positive: adoption is proven on every `npm run check`; stack detection matches what adopters actually have; upgrades are safe by construction; the runner has unit tests.
- Negative: e2e is slower (five throwaway repos per run); missing toolchains report SKIP rather than being exercised — real-toolchain coverage still depends on the environment running the matrix.

### D-011: The multi-repo component is an opt-in skeleton set aggregated by verify-all

**Date:** 2026-08-19
**Status:** accepted
**Context:** The roadmap's multi-repo extension (contracts/, tasks/, repositories/*/scripts/verify, scripts/verify-all) had no activation story: where do the files come from, and how do single-repo adopters stay unaffected?
**Decision:** The component ships as `templates/multi-repo/*` skeletons whose declared destinations land on optional-component markers (accepted by the template destination validation alongside INSTANCE). Activation is copying them into place. A root `scripts/verify-all` (Node, extensionless CJS) runs every `repositories/*/scripts/verify` and aggregates PASS/SKIP/FAIL; `npm run verify-all` / `make verify-all` delegate to a runner mode that SKIPs gracefully when the component is absent. Classification precedence now includes optional markers (a specific optional claim beats the scripts/ directory-level CORE claim). The adoption matrix gained a multi-repo test: component active + git index → check-arch and verify-all pass; a failing subrepo fails verify-all; an unclassified stray file fails arch-005.
**Alternatives considered:**
- Bash verify-all — rejected: the harness runtime is Node; bash is not portable to the Windows-first environment.
- Adding verify-all to `make check` — rejected: single-repo checks would then depend on an optional component; keep the layer chain orthogonal and verify-all explicit.
**Consequences:**
- Positive: multi-repo projects get a one-command gate with honest per-repo tri-state; single-repo behavior is unchanged and covered by the matrix; the component is a first-class, manifest-declared opt-in.
- Negative: one more surface (verify-all) to mirror across make/npm; the example repository skeleton SKIPs until the adopter adds real checks (documented behavior).