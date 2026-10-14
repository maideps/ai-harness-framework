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

### D-012: Distribution tools read the manifest; the matrix dogfoods them

**Date:** 2026-08-19
**Status:** accepted
**Context:** Adoption was only possible by hand-copying files or through the matrix's internal copy logic. feat-006 promised create/upgrade/audit tooling driven by the manifest.
**Decision:** Three Node tools ship in `scripts/` (also `bin` entries and make/npm mirrors): `create-harness` generates an adopter repo from the manifest (CORE as-is, templates per `{from, to}`, runtime surfaces, never overwrites existing files); `harness-upgrade` applies the D-010 contract (overwrites mustNotEdit CORE only); `harness-audit` reports manifest validity, classification coverage, template placement, and skills structure locally. The adoption matrix was refactored to consume `create-harness` and `harness-upgrade` instead of its own copy logic — the e2e layer now proves the distribution tools directly.
**Alternatives considered:**
- Keeping the matrix's internal copy logic and adding separate tools — rejected: two implementations of adoption would drift exactly like the bash/Node split feat-003 eliminated.
- A single do-everything CLI — rejected: create, upgrade, and audit have different contracts (generate / preserve / report).
**Consequences:**
- Positive: adoption is a one-command operation; upgrades are safe by construction and machine-checked; audits give adopters a local health report; npx distribution works after publish via the `bin` entries.
- Negative: three more tools to keep in sync with the manifest (mitigated: the matrix exercises them on every `npm run check`).

### D-013: Reports and sweeps organize runtime traces without touching instance state

**Date:** 2026-08-19
**Status:** accepted
**Context:** Session traces accumulate forever and had no aggregate view; the roadmap's sweep/report promised drift detection and archival. Session traces were already merged start/end records (feat-003), so the remaining work was aggregation and lifecycle.
**Decision:** `npm run report` (`scripts/harness-report.mjs`) aggregates `.harness/traces/` into a per-session digest with totals over a window (default 7 days, `--days`/`--json` flags). `npm run sweep` (`scripts/harness-sweep.mjs`) archives traces older than a threshold (default 30 days) to `.harness/traces/archive/`, prunes orphaned `.tmp` files and stale open records, and reports structural drift by running the runner's manifest mode (report-only). The sweep never mutates instance state — it only organizes gitignored runtime artifacts. Aggregation logic has unit tests (tests/report.test.mjs).
**Alternatives considered:**
- Deleting old traces instead of archiving — rejected: history is cheap and archived records stay inspectable.
- Making the sweep fail on drift — rejected: sweep is a maintenance operation, not a gate; it reports and leaves the gate to check-arch.
**Consequences:**
- Positive: sessions gain a digest view; trace directories stay bounded; drift is visible on every sweep.
- Negative: archived traces are gitignored runtime artifacts — teams wanting durable history should rely on `.harness/trails/` evidence files, which remain tracked.

### D-014: `feature_list.json` keeps its own schema instead of the bibliography's

**Date:** 2026-08-26
**Status:** accepted
**Context:** `repo-completion-plan.md` (an early planning doc, written against the vendored `base/learn-harness-engineering` reference clone) directed normalizing `feature_list.json` to that source's shape (`id`/`priority`/`area`/`title`/`user_visible_behavior`/`status`/`verification`/`evidence`/`notes`, with status values `not_started`/`in_progress`/`blocked`/`passing`). The schema this harness actually shipped is narrower: `id`/`name`/`behavior`/`state`/`verification`/`evidence`/`dependencies`/`layers`, with state values `planned`/`active`/`passing`. This divergence was never recorded, so a reader comparing the two would see an unexplained gap.
**Decision:** Keep the shipped schema. `priority` and `area` add sorting/grouping metadata this harness doesn't use — features gate strictly through `dependencies` and the WIP=1 rule, not priority ranking or area grouping. `title`/`user_visible_behavior` are renamed to `name`/`behavior` for brevity; they carry the same meaning. `not_started` was folded into `planned` (no separate `blocked` state — a blocked feature simply stays `planned` until its dependency is `passing`, which `dependencies` already encodes). `layers` and `dependencies` are additions the bibliography schema didn't have, needed for WIP=1 enforcement (arch-002) and the per-layer verify-feature gate (D-001).
**Alternatives considered:**
- Migrating to the bibliography schema — rejected: `priority`/`area`/`notes` would be unused fields carried for parity alone, and `blocked` as a distinct state duplicates what `dependencies` already expresses.
**Consequences:**
- Positive: the schema stays minimal and every field is load-bearing for an actual runner behavior (arch-002, verify-feature, WIP=1).
- Negative: a reader coming from the bibliography's `repo-completion-plan.md` sees a schema that doesn't match section 2 of that plan; this entry is the pointer that resolves the apparent gap.

### D-015: `.harness/` ships narrower than the bibliography's five-directory model

**Date:** 2026-08-26
**Status:** accepted
**Context:** `base/sources/agentic-repository-harness-guide.md` (the vendored bibliography) models `.harness/` as `instructions/`, `workflows/`, `skills/`, `policies/`, `evals/`, `templates/`. This harness ships `.harness/manifest.json`, `.harness/arch-rules.json`, `.harness/traces/`, and `.harness/trails/` instead — a different, narrower set, with `skills/` and `templates/` promoted to repo-root directories rather than nested under `.harness/`.
**Decision:** Keep the shipped layout. `instructions/` and `policies/` duplicate what AGENTS.md already states as process law (D-005, D-009); splitting that prose into two more directories was considered and rejected in the D-009 write-up already. `workflows/` and `evals/` have no runner consumer in this harness — nothing reads or enforces them — so shipping empty directories would be unclassified surface with no behavior behind it. `skills/` and `templates/` exist, but at repo root (not nested under `.harness/`) because `create-harness` needs to read `templates/` to generate adopter skeletons and both are large enough to warrant top-level visibility rather than being buried three levels deep. `.harness/` itself is reserved for the machine-checked contract surfaces (manifest, arch-rules) and gitignored runtime output (traces, trails) — not prose.
**Alternatives considered:**
- Adopting the full five-directory model — rejected: `instructions/`/`policies/` would fork the single source of truth D-009 already established in AGENTS.md; `workflows/`/`evals/` would ship with no runner behavior, violating the "no unclassified surface" principle behind arch-005 (D-007).
**Consequences:**
- Positive: `.harness/` stays small and every file in it is either a validated contract (manifest, arch-rules) or gitignored runtime evidence (traces, trails) — no prose duplication, no dead directories.
- Negative: a reader coming from the bibliography's `.harness/` tree expects `instructions/`/`workflows/`/`policies/`/`evals/` and won't find them; this entry is the pointer that explains why.

### D-016: Multi-agent means agent-agnostic, not concurrent coordination

**Date:** 2026-08-26
**Status:** superseded by D-017
**Context:** The framework's multi-agent property had never been stated explicitly in DECISIONS.md, only demonstrated through the shims (D-009: `codex.md`, `GEMINI.md`, `CLAUDE.md` all pointing at the single AGENTS.md contract). Left unstated, a reader could reasonably assume "multi-agent" means concurrent/coordinating agents working the same session, which is not what this harness does or is scoped to do.
**Decision:** State explicitly: this harness is agent-agnostic — any single agent (Claude, Codex, Gemini, or another tool that reads AGENTS.md) can drive a session through the shared contract, one agent per session. Concurrent multi-agent coordination (multiple agents working the same feature simultaneously, hand-off protocols mid-session, shared-state locking beyond WIP=1) is out of scope for v1.
**Alternatives considered:**
- Leaving the boundary implicit — rejected: implicit scope invites both adopters and future contributors to build toward concurrent coordination as if it were a gap rather than a deliberate boundary.
**Consequences:**
- Positive: the scope boundary is now a recorded decision, not just an emergent property of the shim design; future proposals to add concurrent coordination are a new decision against this one, not a bug fix.
- Negative: none — this records existing, working behavior; it changes nothing about the runner or the shims.

### D-017: Concurrent coordination is in scope, via worktree isolation, not a lock/lease layer

**Date:** 2026-09-09
**Status:** accepted
**Context:** D-016 fixed the boundary at "one agent per session, no concurrent coordination" and required any reversal to be recorded as a decision, not a silent bug fix. The user asked how to run multiple agents against this framework in parallel. Analysis of the runner surfaced five concrete collision points if two sessions ran against one checkout at once: (1) WIP=1 is enforced globally across the whole feature_list.json (`ensureFeatureGraph`, arch-002); (2) `verify-feature`'s evidence write is a whole-file read-modify-write on feature_list.json — a lost-update race under two concurrent writers; (3) `clean-state-check` requires a fully clean `git status`, so one session's in-progress work fails another session's gate; (4) `session-trace end` pairs against "the latest session-start file" and merges via read + `renameSync`, which mispairs and races under concurrent sessions; (5) PROGRESS.md/DECISIONS.md/session-handoff.md are single-writer markdown files that collide on simultaneous session-end. A lock-file/lease design (claim files with atomic `wx` create, stale-claim expiry) was drafted to solve all five, but `git worktree` already solves (3) and (4) for free — `git status` and the gitignored `.harness/traces/` are naturally worktree-scoped — and git's own branch-checkout exclusivity (a branch can only be checked out in one worktree at a time) already gives mutual-exclusion on "who owns this feature" with no lock file and no stale-claim reaper needed. That leaves (1) and (2), which a worktree alone converts from a silent runtime race into a merge conflict on feature_list.json — better, but still a tax on every lane landing.
**Decision:** Reverse D-016's scope boundary. Concurrent multi-agent work is supported through two composed mechanisms, planned as feat-010 and feat-011: **(a) Worktree Lanes** — each concurrent agent works in its own sibling git worktree on a `lane/<feature-id>` branch; arch-002's WIP=1 check is re-scoped from "at most one active feature in the whole file" to "at most one active feature per lane," detected via the current git branch. **(b) Sharded Feature State** — the mutable fields (state, evidence, owner, timestamps) move out of the single feature_list.json into one file per feature under `.harness/state/<id>.json`; feature_list.json keeps only declaration fields (id, name, behavior, dependencies, layers) and changes rarely. Two lanes landing different features then touch disjoint tracked paths and merge without conflict by construction — no lock file, no lease, no reaper process. A new invariant (enforced in CI, not by a lock): a lane's diff may only touch its own feature's shard file.
**Alternatives considered:**
- A lock-file/lease layer (`.harness/agents/<id>/claim.json`, atomic create-or-fail, stale-claim expiry) — rejected as the primary mechanism: git worktrees already provide the exclusivity guarantee (branch checkout) that a lock file would reimplement, for free and without a reaper to maintain.
- Relaxing arch-002 to a global "WIP=N" instead of re-scoping it per lane — rejected: this deletes the invariant rather than generalizing it; a global N loses the property that makes a single session's state resumable and auditable.
- Leaving feature_list.json as one file and accepting merge conflicts on every lane landing — rejected: cheap short-term, but the whole point of adding lanes is to remove coordination tax, and a conflict-on-every-landing design keeps most of it.
- A full control-plane/task-queue redesign (promoting `templates/multi-repo/tasks/` into a dispatchable queue, DAG scheduling over `dependencies`) — deferred, not rejected: worktrees plus sharded state is the minimal change that unlocks real parallel lanes; the queue/DAG layer is a larger, separate feature to consider only after lanes are proven.
**Consequences:**
- Positive: multiple agents can work genuinely independent features in parallel with git itself as the coordination primitive; the five collision points above are resolved by construction (worktree scoping) or by disjoint file paths (sharding), not by a new stateful subsystem to keep correct; review bandwidth remains the honest ceiling on how many lanes are worth running, unchanged by this decision.
- Negative: `arch-002` gains lane-awareness (git-branch detection) it did not need before; `.harness/state/` is a new surface requiring manifest classification and an arch-005 update; adopters following this harness now need to understand two coordination primitives (branch = exclusivity, shard path = conflict-freedom) instead of one flat file; feat-010/011 are declared `planned` only — this decision authorizes the design, not yet the implementation.

### D-018: Sharded feature state is a hard cutover, not a dual-read compatibility layer

**Date:** 2026-09-09
**Status:** accepted
**Context:** Implementing feat-011 required choosing how feature_list.json's inline state/status/evidence fields would migrate to .harness/state/<id>.json shards. Two options existed: (a) dual-read — keep accepting inline fields forever as a fallback when no shard exists, so old data and old test fixtures never need to change; (b) hard cutover — the shape check (ensureFeatureShape, Layer 1b) rejects any inline state/status/evidence outright, and a migrate-feature-state command does the one-time move. Dual-read is less upfront work but leaves two permanent code paths for the same data and never actually completes the promise feat-011 makes ("feature_list.json keeps only declaration fields") — the inline fields would simply never go away for anyone who doesn't opt into cleaning them up.
**Decision:** Hard cutover. ensureFeatureShape fails on any inline mutable field in feature_list.json, pointing at migrate-feature-state in the failure message. migrate-feature-state (its own command, full Makefile/npm/docs surface, not just a hidden CLI mode) moves inline data into shards and strips it from the declaration file; it is idempotent and never overwrites a shard that already exists (so a partially-migrated repo with fresher shard data than stale inline leftovers is not clobbered). This repo's own feature_list.json (feat-001 through feat-011) was migrated with the same command before this decision's commit, so the harness dogfoods the new schema immediately rather than carrying legacy data.
**Alternatives considered:**
- Dual-read fallback (shard wins if present, else read inline) kept indefinitely — rejected: matches D-006's prior rejection of "two implementations of every check" for the bash/Node split; here it would be two implementations of "where does feature state live" that never converge.
- Auto-migrating on every check-arch/typecheck run instead of a separate command — rejected: a verification gate that silently rewrites files on every run is a surprising side effect (verification should verify, not mutate); a named, explicit command matches the existing harness-upgrade/harness-audit pattern of separate, deliberate operations.
**Consequences:**
- Positive: exactly one code path reads feature state (loadFeaturesWithState()); the declaration-only promise is actually true for this repo today, not aspirational; arch-006 gives drift a machine-checked, visible failure instead of silent dual-schema tolerance.
- Negative: this is a breaking change for any adopter already running the older inline-state schema — schemaVersions.featureList bumped 1→2 (manifest/package.json version 0.4.0→0.5.0, matching the D-007/D-010 precedent of bumping on schema changes) and they must run migrate-feature-state once after upgrading; no automatic migration runs during harness-upgrade itself (INSTANCE state is never touched by upgrades, per D-010).

### D-019: Upgrade backups are local, gitignored, and scoped only to what an upgrade overwrites

**Date:** 2026-09-09
**Status:** accepted
**Context:** User asked for an analysis of `Gentleman-Programming/gentle-ai` (a multi-agent ecosystem configurator, not a project-level harness — most of its surface doesn't transfer) for portable ideas. Its rollback system was the strongest match: every install/sync/upgrade snapshots config files, checksum-deduped, gzip-compressed, retained 5-most-recent-unpinned with pin protection, restore correctly reverting files an operation newly created. This exposed a real gap in `harness-upgrade` (D-010): it overwrites mustNotEdit CORE surfaces with no safety net beyond git — meaning an upgrade run against a dirty, uncommitted tree, or against a mustNotEdit file an adopter edited against policy, loses that content with no recovery path except git history, which may not exist yet.
**Decision:** Port the pattern, scoped narrowly to what `harness-upgrade` actually overwrites (`MUST_NOT_EDIT_SURFACES`: AGENTS.md, CLAUDE.md, codex.md, GEMINI.md, LICENSE, .nvmrc, scripts/) — not a general-purpose backup system. `createBackup` snapshots the current on-disk state of every file about to be touched (per-file, not a single tarball — no tar dependency needed, `node:zlib` gzips each file individually), records `existed: true/false` per file so restore correctly removes files the operation newly created rather than restoring stale content for them, dedups against the most recent backup by checksum, and keeps the 5 most recent unpinned backups (pinned ones survive regardless of age). Backups live in `.harness/backups/`, which is **gitignored** — a deliberate choice: this is a local safety net for the moment between "upgrade ran" and "you noticed something's wrong," not a durable record. The durable record of what changed stays git itself, per this harness's own "repository is the system of record" principle (already the basis for how `.harness/trails/` vs `.harness/traces/` are treated).
**Alternatives considered:**
- Tracking backups in git (committing snapshots) — rejected: every upgrade would commit a new gzipped blob into history forever, bloating the repo for a safety net that's only useful in the narrow window before the next commit; git already durably records every *committed* state, a backup only needs to cover the *uncommitted* gap.
- A general-purpose backup system covering any file, not just upgrade-overwritten surfaces — rejected: scope creep past what the actual gap was; `harness-upgrade` is the only operation in this harness that destructively overwrites files an adopter might have touched, so that's the only operation that needs a snapshot.
- Porting gentle-ai's Engram (persistent, MCP-driven, cross-machine-syncable memory) as part of this same effort — rejected as a separate, much larger decision: it would duplicate what PROGRESS.md/DECISIONS.md/`.harness/trails/` already do deliberately as flat, git-tracked files, and cross-machine sync of a side database contradicts "the repository is the system of record" rather than extending it. Noted as considered-and-rejected, not silently skipped.
**Consequences:**
- Positive: `harness-upgrade` now has a real rollback path independent of git, tested both in isolated unit tests (`tests/harness-backup.test.mjs`) and end-to-end via the adoption matrix's upgrade test (a real `upgrade()` call creates a backup, restoring it reproduces the pre-upgrade corruption, proving fidelity rather than just structure); dedup means running upgrade repeatedly with no changes doesn't accumulate redundant backups.
- Negative: another local directory (`.harness/backups/`) an adopter needs to know exists, though it requires zero action from them (created automatically, pruned automatically); a pinned backup must be pinned *before* seven more backups age it out, not after — pruning runs on every `createBackup` call, so retroactive rescue isn't possible (documented in USAGE.md and caught by an early, wrong version of the prune test during this session).

### D-020: The progress-log check validates a set, not a sequence; adopter session-scratch files are gitignored, not classified

**Date:** 2026-09-15
**Status:** accepted
**Context:** Two files from real-world use of this harness — `DOGFOODING-FEEDBACK-payroll.md` (from-the-outside feedback, gathered by running a real 15-feature project through the framework) and its companion `IMPROVEMENT-HANDOFF.md` (from-the-inside review) — surfaced two decisions during feat-013 (Round 1 of the dogfooding feedback):
1. The dogfooding doc's own suggested fix for its Tier 1 item 3 ("nothing lints the session log") was: parse `### Session N` headers and fail if `N` isn't strictly increasing by 1. Implementing that literally against this repo's own `PROGRESS.md` would have immediately failed: Session 020 was written and logged *before* Session 019 (a same-day hotfix session got written up out of order), which is legitimate history, not a bug — only the later-reported duplicate ("Session 016" appearing twice, different dates) is an actual defect.
2. `DOGFOODING-FEEDBACK-payroll.md` needs *some* disposition — the new untracked-file warning (this same feature) immediately flagged it as unclassified. The manifest's seam contract exists to answer "does this file ship, and to whom" for every tracked file; this file answers neither question meaningfully — it's a point-in-time report to the maintainer, not a project artifact.
**Decision:** (1) `ensureProgressLog()` validates the *set* of session numbers (no duplicates, no gaps once sorted) rather than the order they appear in the file. A legitimate out-of-order write stays valid; only a genuine duplicate or a missing number fails. (2) `DOGFOODING-FEEDBACK-payroll.md` is gitignored, joining `IMPROVEMENT-HANDOFF.md` under the same rule and the same stated reason ("local-only session handoff scratch notes (not project documentation)") — not given a `productRoots` entry, because it was never going to ship or apply to an adopter either way.
**Alternatives considered:**
- Implementing the literal file-order check as specified — rejected: it would have failed this repo's own real, correct history on the first run, which is a strong signal the literal spec was wrong, not that the history needed fixing.
- Classifying the dogfooding/handoff docs as `productRoots` (product-owned, tracked) instead of gitignoring — rejected: `productRoots` exists for a repo's actual product code and repo-only infra (e.g. `repo-completion-plan.md`, `.github/workflows/publish.yml`) that legitimately lives in the repo forever; these two files are dated, addressed-to-the-maintainer snapshots that stop being relevant once acted on, closer to a chat transcript than to documentation.
**Consequences:**
- Positive: the progress-log check is actually usable against this repo's own history (validated immediately — no false positive on 24 real sessions); the untracked-file warning from this same feature doesn't nag about a file class that was never going to be committed.
- Negative: a future session-feedback file with a different name will need the same one-line `.gitignore` addition rather than matching a wildcard pattern — accepted, since a wildcard broad enough to catch arbitrary future filenames would risk silently ignoring something that should have been tracked.

### D-021: Backup ids are forced strictly monotonic, not left to clock resolution

**Date:** 2026-10-12
**Status:** accepted
**Context:** While adopting the harness in a new project, `npm run check` failed intermittently on two tests in `tests/harness-backup.test.mjs` (reproduced in 5 of 5 runs here). `createBackup` derived the backup id from `new Date().toISOString()`, which has millisecond resolution. Two backups created in the same millisecond got the same directory name, so the second silently overwrote the first, and `listBackups` (sorted by `createdAt`) could not order them. A clock stepping backwards would have the same effect.
**Decision:** `createBackup` now computes the creation time as `max(now, latestExistingBackup + 1ms)` and derives both `createdAt` and the id from that single value, so ids are unique and strictly ordered. A regression test creates 20 backups back-to-back and asserts distinct ids and that `list` and `latest` resolve to the newest.
**Alternatives considered:**
- Random or counter suffix on the id — Rejected: ids would no longer sort chronologically by name, and `createdAt` ties would still be ambiguous.
- Relaxing the failing tests (sleeping between backups) — Rejected: it hides a real defect that a fast `harness-upgrade` followed by another operation could hit.
**Consequences:**
- Positive: backup ids are collision-free and ordering is deterministic; the backup tests are no longer flaky (15 of 15 passing runs after the change).
- Negative: under a burst of backups a `createdAt` can run a few milliseconds ahead of the wall clock — harmless for a local safety net.

### D-022: Adoption-matrix fixtures use canonical layer scripts, not the host repo's customised ones

**Date:** 2026-10-12
**Status:** accepted
**Context:** `npm run e2e` runs the adoption matrix in every repo that carries the harness. The matrix generates throwaway adopters with `adopt()`, which copies CORE from `HARNESS_ROOT` — in an adopter repo that is the adopter's own tree, including its customised `package.json`. Customising the layer scripts is a documented, supported point (`lint`, `typecheck`, `test`, `build` pointed at product tooling), yet the moment an adopter did it, every fixture inherited scripts referencing files the fixture does not contain, and the matrix failed in 6 places (all cells plus the upgrade test) although the harness and the product were healthy. Found while adopting the harness in a FastAPI + React project, which appends Python tooling to the layer scripts.
**Decision:** `buildAdopter()` now calls `normalizeFixtureScripts()` straight after `adopt()`: the six layer scripts and `check` are reset to the canonical harness values (`node scripts/framework-check.mjs <layer>`, and the `npm run` chain). Other adopter scripts are left untouched. The helper is exported and unit-tested. Verified end to end: a copy of the framework with poisoned `lint`/`test` scripts failed 6 matrix checks with the old code and passed all of them with the new code.
**Alternatives considered:**
- Skip the matrix (report SKIP) in any repo that is not the framework source — Rejected: needs a reliable "am I the framework?" marker that does not exist, and the matrix is still a useful harness-integrity check for adopters.
- Ship a pristine `package.json` template and build fixtures from it — Rejected: a second copy of the scripts to keep in sync with the real one; normalising the handful of layer entries is smaller and cannot drift.
- Tell adopters to replace the `e2e` script with their own — Kept as guidance (docs/USAGE.md) for when they have product e2e tests, but not a fix: the failure appeared with `e2e` left at its default.
**Consequences:**
- Positive: customising layer scripts is safe, as documented; the matrix tests the harness regardless of how the host repo is wired.
- Negative: if the canonical layer-script values ever change, `normalizeFixtureScripts` must change with them (the unit test asserts the current values, so a drift fails loudly).

### D-023: Adopter LICENSE is copied once and preserved by upgrades

**Date:** 2026-10-14
**Status:** accepted
**Context:** `harness-upgrade` treated the root `LICENSE` as an immutable CORE surface and overwrote adopter-specific copyright lines on every upgrade, despite adoption projects needing to name their own copyright holder.
**Decision:** Ship the MIT starter as `templates/LICENSE` and declare it as a template destination to root `LICENSE`. Classify the root file as INSTANCE and exclude it from the surfaces `harness-upgrade` overwrites or backs up; the source template remains part of the shipped `templates/` tree.
**Alternatives considered:**
- Keep LICENSE in CORE and check for the framework notice during upgrade — rejected: the root file remains adopter-owned after creation, and even a validating upgrade need not rewrite or reject its modifications.
- Store the root LICENSE as a template source — rejected: the same tracked path would be classified as both a template and INSTANCE destination.
**Consequences:**
- Positive: adopters receive the MIT notice on first adoption and can preserve their copyright lines across future upgrades; the adoption matrix verifies copy-on-adoption and upgrade survival.
- Negative: changes to the framework's license starter must be reflected in both `LICENSE` and `templates/LICENSE`.
