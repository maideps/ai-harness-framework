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
**Decision:** The component ships as `templates/multi-repo/*` skeletons whose declared destinations land on optional-component markers (accepted by the template destination validation alongside INSTANCE). Activation is copying them into place. A root `scripts/verify-all` launcher dynamically imports its `.mjs` implementation so it works whether the adopter uses CommonJS or `"type": "module"`. It runs every `repositories/*/scripts/verify`, `verify.mjs`, or `verify.cjs` and aggregates PASS/SKIP/FAIL; `npm run verify-all` / `make verify-all` delegate to a runner mode that SKIPs gracefully when the component is absent. The optional verify-all gate is part of `check` and skips when the markers are absent. Classification precedence now includes optional markers (a specific optional claim beats the scripts/ directory-level CORE claim). The adoption matrix covers ESM/CommonJS entrypoints and failures; an unclassified stray file still fails arch-005.
**Alternatives considered:**
- Bash verify-all — rejected: the harness runtime is Node; bash is not portable to the Windows-first environment.
- Keeping verify-all outside `make check` — superseded: its runner reports SKIP when optional markers are absent, so single-repo checks remain unaffected while multi-repo projects get the root gate automatically.
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

### D-023: Adopter CI verifies the project and uses an instance Node pin

**Date:** 2026-10-14
**Status:** accepted
**Context:** The CI template installed the framework's Python, Go, and Rust toolchains and ran its adoption matrix, while its CORE `.nvmrc` forced every adopter to use the framework's Node version. This made copied CI test the wrong project configuration and prevented adopters from changing the Node pin without editing CORE.
**Decision:** The adopter CI template now uses the generated `.nvmrc`, optional setup script, and the project's `check` and `check-arch` commands. It sets `CW_SKIP_ADOPTION_MATRIX` so the default framework e2e entrypoint skips the adoption matrix in adopters; the matrix remains in this repository's own workflow. `.nvmrc` is seeded from a template and classified as INSTANCE, so adopters can change it and upgrades preserve that choice.
**Alternatives considered:**
- Keep `.nvmrc` as CORE and ask adopters to change `engines.node` — Rejected: the runtime pin would still be overwritten by harness upgrades and would not support projects that configure Node only through `.nvmrc`.
**Consequences:**
- Positive: generated adopters use a modern Node version by default and can select their own version without changing CORE.
- Negative: adopters that use a different version manager should update `.nvmrc` to match their supported runtime.

### D-024: Adopter LICENSE is copied once and preserved by upgrades

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

### D-025: Verification keeps layer logs; harness files are LF; lifecycle commands refresh the dashboard; Windows in CI

**Date:** 2026-10-17
**Status:** accepted
**Context:** Checking the fixes for issues #2-#10 from a Windows adopter (ai-invoice-intake) turned up four gaps:
- A new runner test matched paths with `[\/]`, a character class holding only "/". It failed on Windows, so every Windows adopter's `npm run check` failed too, while CI (Linux only) was green.
- `verify-feature` captured each layer's standard output only to look for SKIP, then dropped it. A failure showed nothing, and the evidence had no command, duration or log (the rest of #2).
- Harness files were written with `os.EOL` (CRLF on Windows), against the shipped `.gitattributes` (`eol=lf`), so Git warned on every commit.
- `add-feature` and `activate` changed feature state without refreshing the generated `PROGRESS.md`, so the next lint failed.
**Decision:**
- `verify-feature` writes each layer's output (stdout, then stderr) to `.harness/logs/<feature>/<NN>-<label>.log`. The folder holds a `.gitignore` of `*`, so adopters need no ignore change.
- Each layer's evidence entry gains `cmd`, `durationMs` and `log`; `evidence` keeps the JSON-string format from #2 for compatibility.
- A failing layer prints its last 30 lines and the log path. stderr is still printed after each layer.
- Harness files are written with `"\n"` on every OS.
- `add-feature`, `activate` and a recorded pass refresh the dashboard as a child `progress-update` when the log has the generated block. A refresh failure is a warning, never an undone lifecycle change; logs without the block (not yet upgraded) are left alone.
- CI gains a `windows` job running the runner's unit tests and the architecture rules. The full check stays on Linux, because its adoption matrix needs bash, make and other toolchains.
**Alternatives considered:**
- Streaming layer output live and teeing it to the log — Rejected for now: layers already ran with stdout captured, so this keeps behaviour while adding the log; live streaming would need an async runner.
- A structured `verification` object next to `evidence` — Rejected: `evidence` became structured JSON in #2 and the dashboard already reads it; a second shape would split readers.
- The full `npm run check` on Windows — Deferred: the adoption matrix assumes bash and make.
**Consequences:**
- Positive: Windows-specific failures are caught before merge; a failed layer can be read in full; the evidence shows what ran and for how long; no CRLF churn; the dashboard stays current.
- Negative: stderr appears after a layer finishes rather than while it runs; logs take local disk space until deleted.

### D-026: Upgrades deliver everything the framework owns, and migrate old progress logs

**Date:** 2026-10-17
**Status:** accepted
**Context:** Upgrading ai-invoice-intake to the feat-018 runner gave it a new `scripts/`, but `harness-upgrade` copies a hard-coded list that omitted `tests/`, even though the manifest's `core` includes it. The adopter's old runner tests then ran against the new runner, and five `lint:progress-log` tests failed `npm run test`. The new lint also told the adopter to run `npm run harness-docs`, a script its adopter-owned `package.json` didn't have, and the upgrade never mentioned it. Two more gaps followed:
- The upgrade kept the adopter's old `templates/` (for example the old CI skeleton) and its manifest classification, so framework tests exercising `create-harness` failed inside the adopter.
- The new classification lists `progress/`, but an adopter from before the generated dashboard keeps one `PROGRESS.md` and had no way to convert it.
**Decision:**
- `tests/` joins the surfaces an upgrade overwrites: the runner's tests ship and change with the runner.
- `templates/` is refreshed, except the templates the manifest marks `keep` (the sprint contract, the evaluator rubric, the clean-state checklist), which adopters customise.
- The manifest's classification (`harness`, `version`, `schemaVersions`, `core`, `instance`, `templates`, `optionalComponents`, `customizationPoints`) follows the framework, as `mustNotEdit` already says. `productRoots` and the adopter's own keys (such as `featureIdPattern`) stay. Both are backed up first.
- The upgrade compares the framework's `node scripts/...` npm scripts with the adopter's `package.json` and prints missing names with the line to add. It does the same for make targets, printing each missing target's block (help lines, target, recipe), since `npm run check` requires every harness target. It never edits `package.json` or the `Makefile`; names the adopter defines with its own command count as present.
- `progress-migrate` moves each `### Session NNN — date` entry of a single-file `PROGRESS.md` into `progress/NNN-date.md` and generates the dashboard. It checks everything first: gaps, repeats or existing files mean nothing is written. The upgrade report points to it when it sees an old-style log.
- Instance files a newer harness declares (for example `.gitattributes`) are created from their templates when missing, as `create-harness` would; existing files are never touched, and optional-component files (such as `repositories/example`) are never recreated. When `.gitattributes` is new, the report gives the one-time `git add --renormalize .` step, to commit on its own.
**Alternatives considered:**
- Reading the whole `core` list from the manifest — Rejected for now: `core` also includes adopter-edited files (`Makefile`, `package.json`, `init.sh`, the manifest itself) that an upgrade must not overwrite.
- Editing `package.json` automatically — Rejected: it is adopter-owned, and adopters extend harness commands (for example `lint`).
**Consequences:**
- Positive: an upgraded adopter passes its framework tests and architecture rules with the new runner; new commands and the progress migration are announced with the exact command.
- Negative: an adopter who edited a non-`keep` template or the classification loses that edit on upgrade (the backup keeps it), as the ownership rules always said; an adopter's file in `tests/` with the same name as a framework test is replaced.

### D-027: npm publishing is started by hand, not by version tags

**Date:** 2026-10-17
**Status:** accepted
**Context:** `publish.yml` ran on every `v*` tag, so tagging a GitHub release also published the package to npm. The only run so far (`v0.4.0`, 2026-08-26) passed every gate and then failed at `npm publish` with 403: the `NPM_TOKEN` secret can't publish under two-factor authentication. The author wanted a GitHub release for v0.5.0 without an npm publish.
**Decision:**
- `publish.yml` runs only on `workflow_dispatch`.
- Releases are GitHub releases on version tags.
- Publishing to npm means starting the workflow by hand on the release's tag. It still runs the full check and the architecture rules, and requires the tag to match `package.json`. It needs a granular npm token allowed to publish under 2FA in `NPM_TOKEN`.
**Alternatives considered:**
- Keep tag-triggered publishing — Rejected: every release would carry a failing publish run until the token changes, and once the token works, a tag would publish without a second look.
- Publish on a "release published" event — Rejected for the same reason: a release would still mean an npm publish.
**Consequences:**
- Positive: a release and an npm publish are separate, deliberate steps, and releases no longer come with a red run.
- Negative: someone must remember to run the workflow when npm should get a version.

### D-028: Parallel-lane detection is advisory; every state-changing step stays human-approved

**Date:** 2026-10-19
**Status:** accepted
**Context:** D-017 gave agents the mechanism for concurrent work (worktree lanes) but left detection and initiation entirely manual — a human had to notice that two features were independent and run `lane-new` for each. An adopter asked for agents to detect parallelizable features themselves and request access to act on it, with a human still in the loop before anything happens.
**Decision:**
- `lane-suggest` (feat-021) is a new, strictly read-only command: it lists every `planned` feature whose dependencies are already `passing` and that no existing `lane/*` branch has claimed. It creates no worktree, writes no state, and never calls `lane-new` itself.
- "Independent" is defined as dependency-graph safety only — each candidate already clears the same unmet-dependency gate `lane-new` enforces per feature, so by construction none of them is blocked on another still-open candidate in the same set. This is explicitly not a promise that two candidates leave disjoint files untouched; the framework does not track per-feature file scope, so that residual risk stays a human review at `lane-land` time.
- The `parallel-lanes` skill codifies the loop an agent follows: detect with `lane-suggest`, propose the candidate set and the exact commands to a human, wait for an explicit yes, create one lane per approved feature, hand each to its own scoped session, and land one at a time with confirmation before each merge.
**Alternatives considered:**
- Let an agent run `lane-new` directly for every candidate `lane-suggest` finds — rejected: creating a worktree is cheap to undo, but starting other agent sessions and committing a human's compute/review time to multiple parallel tracks on the agent's own initiative crosses the same bar as other hard-to-reverse, human-facing actions this harness treats carefully.
- Track declared per-feature file scope (e.g. a `paths` field in `feature_list.json`) to make the independence check conflict-aware, not just dependency-graph-aware — deferred, not rejected: it would strengthen the suggestion, but adds a new declaration surface and a drift-detection problem (declared paths going stale against what a feature actually touches) that isn't justified before real usage shows the dependency-only heuristic is too weak in practice.
**Consequences:**
- Positive: agents can now propose parallel work instead of requiring a human to notice it, without weakening the human-approval bar anywhere in the lane lifecycle; the advisory command has no side effects to audit.
- Negative: the independence signal is weaker than a true conflict check — two suggested lanes can still collide on a shared file at land time, surfaced only as an ordinary merge conflict to resolve by hand.

### D-029: A required layer that only reports SKIP fails verify-feature and verify-all, instead of passing

**Date:** 2026-10-20
**Status:** accepted
**Context:** A 2026-09-08 external review of a downstream adopter (ai-driven-marketing-ae-ce) reproduced a feature reaching `state: "passing"` whose Layer 3 printed only `[SKIP]` (pytest absent) and exited 0 — `verify-feature` recorded the SKIP in the evidence string but never used it to fail the layer. The same shape of bug existed in `verify-all`: a `repositories/` directory whose entries had no `scripts/verify` all SKIPped individually, and the aggregator still printed "all repositories pass". The bug was live in this framework's own history too: every one of feat-001 through feat-021's recorded evidence already carries `(SKIP reported in: Layer 3: System confirmation)` for a passing feature, because the adoption matrix's e2e cell legitimately SKIPs one optional toolchain check (ruff/go/rust) inside an otherwise-real run.
That last point is why the fix can't be "any SKIP fails": a layer or sub-repo that produces real `[PASS]` output alongside one optional `[SKIP]` has still verified something, while a layer whose entire output is SKIP has verified nothing. Those are different severities and must be told apart.
**Decision:**
- A feature's layer may declare `"required": false` in `feature_list.json`; omitted means `required: true` (the existing default, unchanged for every current feature).
- `verify-feature` now classifies a layer that exits 0 by whether its captured stdout contains real pass evidence — either this file's own `pass()` convention (`PASS: <message>`, no brackets, used by top-level command results) or the nested convention (`[PASS] <message>`, used by adoption-matrix cells, per-repo verify scripts, and `verify-all`). A layer with `[SKIP]` lines but neither form of PASS is "vacuous" — it ran but verified nothing. A vacuous layer fails verification if `required` (the default), and is still recorded as a passing, noted SKIP if `required: false`. A layer with real PASS evidence alongside one or more `[SKIP]` lines (the ruff/go/rust adoption-matrix cells, or `npm run check` itself, which prints its own `PASS:` lines while nested e2e output includes unrelated `[SKIP]`s) is unaffected — informational only, as before.
- `templates/multi-repo/verify-all.mjs` applies the same two-convention rule at the repository level: a repo whose `scripts/verify*` is entirely absent, or whose verify script exits 0 but reports no real pass, no longer counts toward "passed". If a repository list has at least one entry that isn't the `repositories/example` scaffold placeholder and not one repository actually passed, `verify-all` exits 1 instead of reporting "all repositories pass". The `example` placeholder is explicitly excluded from that failure trigger: `create-harness` places it in every adopter unconditionally (see D-030's note that "optional component" markers are descriptive, not a copy gate), so a repo that has only ever had the untouched scaffold — no real repos added yet — correctly reports "nothing to verify yet" at exit 0, not a failure.
- This only changes future `verify-feature`/`verify-all` runs. Existing recorded shard state (including this framework's own feat-001..021) is not retroactively rewritten — a already-"passing" feature stays passing until it is re-verified.
**Alternatives considered:**
- Fail on any `[SKIP]` line regardless of context — rejected: it would permanently break re-verification of every feature in both this framework and every adopter, since the adoption-matrix's optional-toolchain cells are expected to SKIP in environments without ruff/go/rust installed.
- A layer-level `required` flag with no vacuous-output detection (fail only on non-zero exit, same as today, just add the field) — rejected: it does nothing, since the actual bug is a layer that exits 0 having verified nothing; the field needs a real trigger.
- Retroactively re-verify and demote every existing "passing" feature whose evidence already shows a bare SKIP — rejected: almost every feature in this repo and its adopters would flip state in one pass, which is far more disruptive than fixing the mechanism going forward and letting normal re-verification catch genuinely vacuous layers.
**Consequences:**
- Positive: a feature (here or in any adopter) can no longer reach "passing" by running a required check that silently did nothing; the same honesty now applies to the optional multi-repo component.
- Negative: an adopter whose required layer happens to print only `[SKIP]` for a legitimate reason (e.g. a deliberately disabled check) must now explicitly mark that layer `required: false` instead of it silently passing — this is the intended behavior change, but it is a breaking one for any such layer.

### D-030: create-harness no longer copies the framework's own package.json identity into a new adopter

**Date:** 2026-10-20
**Status:** accepted
**Context:** The same external review found a downstream adopter (ai-driven-marketing-ae-ce, an internal, proprietary Cuban Engineer repo) whose `package.json` still read `"name": "@maideps/ai-harness-framework"`, `"repository": "https://github.com/maideps/ai-harness-framework.git"`, and `"publishConfig": {"access": "public"}` — identical to this framework's own, because `create-harness`'s `copyCore` copies every CORE surface byte-for-byte, and `package.json` has always been CORE (so its `scripts`/`bin`/`engines` stay in sync with the framework). `.harness/manifest.json`'s own `customizationPoints.mayEdit` only carves out `"package.json (project scripts)"`, so nothing told an adopter the identity fields were theirs to change, and nothing in `create-harness`'s output prompted it. An adopter repo was therefore indistinguishable from the framework itself by name, and carried `publishConfig.access: public`, risking an accidental `npm publish` of someone's internal content under the framework's own package identity if a maintainer ever ran it from the wrong directory.
**Decision:**
- `package.json` stays CORE (one source of truth for `scripts`/`bin`/`engines`), but `adopt()` now post-processes it immediately after `copyCore` — only when this `adopt()` run is what just created the file (an already-existing adopter `package.json` is never touched, matching the existing `skipExisting` contract). The post-processing sets `name` to a sanitized slug of the target directory's own name, `version` to `"0.1.0"`, `private: true`, and removes `publishConfig` and `repository` — all adopter-identity fields, none of the reusable command surface.
- `create-harness`'s printed next-steps now explicitly tells the adopter that `LICENSE` was copied as this framework's own MIT notice (D-024) and to replace it if the project's content isn't MIT, since the identity fix only covers `package.json`.
**Alternatives considered:**
- Move `package.json` into `templates/` like `LICENSE` (D-024) — rejected: unlike `LICENSE`, `package.json`'s `scripts` must track the framework's own command surface as it grows, and a separate `templates/package.json` would become a second, driftable source of truth for that surface.
- Prompt interactively for a package name during `create-harness` — rejected: `create-harness` is also called non-interactively (tests, scripted adoption); a derived default that the adopter can rename afterward is simpler and has no interactive-input dependency.
- Leave `publishConfig`/`repository` in place and only change `name` — rejected: `publishConfig.access: public` is the specific field that makes an accidental `npm publish` of adopter content succeed; leaving it would fix the cosmetic confusion but not the actual accidental-publish risk.
**Consequences:**
- Positive: a freshly created adopter repo has its own name, is private by default, and cannot accidentally publish under the framework's npm scope; `harness-upgrade` is unaffected since it already treats `package.json` as adopter-owned and never rewrites it.
- Negative: an adopter who actually wants their package.json to remain public/npm-publishable under the framework's umbrella (unlikely, but not impossible) now has to undo the private default by hand; already-adopted repos (including every existing one created before this change) keep whatever identity they already have and are not retroactively fixed.

### D-031: Optional components are opt-in; verify-all's outer gate reports a reserved exit code as SKIP

**Date:** 2026-10-26
**Status:** accepted
**Context:** Bootstrapping an unrelated project (ai-codebase-auditor) with this harness surfaced that `create-harness` placed the multi-repo component's `contracts/`, `tasks/`, `repositories/example`, and `scripts/verify-all(.mjs)` into every new adopter unconditionally — D-029 and D-030 both describe this as the existing, accepted design ("'optional component' markers are descriptive, not a copy gate"). With those files present, `npm run check`'s `verify-all` layer always finds `scripts/verify-all.mjs` and runs it instead of reporting the layer as SKIP. D-029 already made the component's *internal* per-repository accounting honest (a repo with no real verify script doesn't count as passed), but a plain single-repo adopter with only the untouched `example` scaffold still has `verify-all.mjs` itself exit 0 for "nothing to verify yet" — and `scripts/framework-check.mjs`'s `runVerifyAll()` only inspects the child process's exit code, treating any exit 0 as an implicit pass. So `npm run check` reported a pass for a layer that verified nothing, for every adopter that never asked for the multi-repo component at all (GitHub issue #24).
**Decision:**
- `create-harness` no longer places an optional component's templates by default. `placeTemplates`/`adopt` take a `components` list (component names from `.harness/manifest.json`'s `optionalComponents`); a template destination matching an optional component's `markers` is skipped unless its component is in that list. The CLI exposes this as `node scripts/create-harness.mjs <dir> --with <component>`, repeatable, and safe to rerun later against an existing adopter (already-placed files are left alone by the existing `skipExisting` contract) — this is now also the documented way to activate the component, superseding "copy the templates/multi-repo skeletons by hand".
- `harness-upgrade` does not retroactively remove an already-placed optional component from an adopter who adopted before this change, and does not place one that was never there — upgrades never add scope an adopter didn't ask for.
- `templates/multi-repo/verify-all.mjs` gained a reserved exit code (`SKIP_EXIT_CODE = 42`) for its three "ran, but nothing to verify yet" paths (no `repositories/`, an empty `repositories/`, or every entry being the untouched `example` scaffold) — distinct from exit 0 (a real pass) and exit 1 (a real failure). `scripts/framework-check.mjs`'s `runVerifyAll()` checks for that exact code and prints `[SKIP] verify-all ran but nothing was verified yet` instead of silently treating it as a pass, alongside its existing `[SKIP] Multi-repo component not activated` message for when the script is absent entirely. Both copies of the constant carry a comment pointing at each other, since a template file copied into adopters can't import a CORE script's constant directly.
- The adoption matrix's dedicated multi-repo test (`runMultiRepoTest`) now builds a plain adopter first and asserts it has no multi-repo directories and that `verify-all` reports the component as not activated, then activates the component through the real `placeTemplates({ components: ["multi-repo"] })` path (not a hand-rolled copy loop) before exercising the rest of the component's behavior.
**Alternatives considered:**
- Parse `verify-all`'s stdout for "nothing to verify yet" in `runVerifyAll()` instead of a reserved exit code — rejected: matching on log text is exactly the fragility D-029 already worked around at the per-repository level by preferring exit-code-shaped signals where possible; a reserved exit code is a stable contract, prose is not.
- Leave placement unconditional and only fix the outer SKIP reporting — rejected: it doesn't address the actual complaint (a plain single-repo adopter should not acquire `contracts/`, `tasks/`, or `repositories/` at all), and it leaves "every adopter gets it whether they asked or not" as the shipped behavior for anyone who reads the generated tree instead of the check output.
- Add an `activate-component <name>` subcommand distinct from `create-harness` — rejected for now: `create-harness --with <component>` already covers both "create new, with the component" and "activate later" (it's idempotent via `skipExisting`), so a second subcommand would duplicate the same logic for no new capability.
**Consequences:**
- Positive: a fresh adopter's tree matches what they actually asked for; `npm run check` on a plain adopter honestly reports the multi-repo layer as SKIP in both its "absent" and "activated but empty" shapes, closing the gap D-029 left at the outer boundary.
- Negative: every existing adopter created before this change keeps the component's files whether they wanted them or not (never retroactively removed, per the no-surprise-deletion norm), so `verify-all` for them still exercises the component until they remove those files themselves; a downstream project that was relying on the component always being present (e.g. scripting around `contracts/` existing after a bare `create-harness` run) now needs `--with multi-repo`.

### D-032: Runner unit tests drop an inherited CW_INIT_SH unless a test sets it

**Date:** 2026-10-27
**Status:** accepted
**Context:** D-031's session (#23) made `./init.sh` set `CW_INIT_SH=1` for `verify-chain`, so `ensureNoPlaceholders` warns instead of failing on a project's first run. The test layer of that chain runs `tests/framework-check.test.mjs`, whose `run()` helper spawned the runner with `{ ...process.env, ...env }`. Every spawned runner therefore inherited `CW_INIT_SH=1`, so "a fresh create-harness output fails lint and arch-003 (#23)" saw lint exit 0 instead of 1 and failed — but only under `./init.sh`, never when run alone or under `npm run check`. `./init.sh` exited 1 on every run from commit b77ec83 onward, in this repo and in every adopter that took that commit (ai-issue-triage hit it on its first run).
**Decision:**
- `run()` in `tests/framework-check.test.mjs` copies `process.env`, deletes `CW_INIT_SH` from the copy, then applies the test's own `env`. A test sees `CW_INIT_SH` only when it passes it explicitly, as "init.sh's CW_INIT_SH warns instead of failing" does.
- The other spawn helper in `tests/`, `run()` in `tests/harness-docs.test.mjs`, is left unchanged: it only spawns the docs generator and `lint:command-surfaces`, and neither reads `CW_INIT_SH` (only the `lint` mode does).
**Alternatives considered:**
- Run the test layer without `CW_INIT_SH` in `init.sh` (set it only for the lint step) — rejected: `verify-chain` is one runner invocation, and splitting it in `init.sh` would duplicate the chain's layer order outside the runner.
- Strip every `CW_*` variable in `run()` — rejected: tests pass `CW_SKIP_ADOPTION_MATRIX` explicitly where they need it, and the other `CW_*` variables do not change any assertion today; a blanket strip would hide which variable actually mattered.
**Consequences:**
- Positive: `./init.sh` exits 0 again; the #23 tests assert the same thing whether run alone, under `npm run check`, or under `./init.sh`. Adopters receive the fix through `harness-upgrade`, since `tests/` is CORE.
- Negative: a future runner environment variable that changes a mode's behavior needs the same treatment in `run()`; nothing enforces that automatically.

### D-033: Quality gates are opt-in metric floors, with coverage presets only

**Date:** 2026-10-30
**Status:** accepted
**Context:** The layers answer "did the command pass", never "how good is the result". A comparable Java harness (wesleyosantos91/ai-harness-chassis) enforces JaCoCo and PIT floors of 90 %, and the AI apps built on this harness need the same kind of floor for eval scores. Coverage and mutation tools differ per stack in how they report, and mutation testing is slow enough that forcing it on every adopter would make `npm run check` unusable for prototypes.
**Decision:**
- A new `quality` mode (`make quality` / `npm run quality`, last in `check`) runs the gates declared in `.harness/quality.json`, an INSTANCE file placed from `templates/quality.json` with `"enabled": false`. Each gate runs one command, reads one number (last regex match in the output, `num`/`den` named groups for count-only tools, or a dot path into a JSON report) and FAILs below `min`. A disabled gate or a missing tool reports SKIP, so D-029's rule (a required layer with only SKIPs fails `verify-feature`) applies unchanged.
- Only `coverage` has per-stack presets (node via the product's own `coverage` script, python via pytest-cov, go via `go tool cover`, rust via cargo-llvm-cov). Mutation and anything else declare `cmd` and `metric`; docs/USAGE.md lists starting points for Stryker, PIT, mutmut 3 and cargo-mutants. Node's preset never runs `node --test` over `tests/`, because in an adopter that directory holds the harness's own tests.
- Logic lives in a new CORE module, `scripts/quality-gates.mjs`, so it can be unit-tested without spawning the runner; `lint` validates the config even while it is disabled. Reports go to `.harness/quality/`, which writes its own `*` .gitignore.
- A custom gate may declare a `probe` command; when it exits non-zero the gate reports SKIP, the custom-command counterpart of a preset's missing-tool SKIP.
- The harness dogfoods the gate: its own `.harness/quality.json` enables coverage of `scripts/` through node's built-in test coverage with a floor of 65 (measured 66.6 on 2026-10-30). Child processes are not counted, so the number understates real coverage. `--test-coverage-include` needs Node 22+, so a probe SKIPs the gate on Node 18 (the first CI run of this change failed there with `bad option`).
**Alternatives considered:**
- Hard-coded `coverage`/`mutation` settings with a threshold per tool — rejected: every new tool or stack would need runner code, and eval scores for AI apps would not fit.
- Gates enabled at 90/90 by default, as in the Java chassis — rejected by the maintainer: too strict for new projects; adopters opt in and pick their floor.
- Let each tool enforce its own threshold (`--cov-fail-under`, Stryker `break`) and only check the exit code — rejected: the number would not appear in the gate line or in `verify-feature` logs, and not every tool has such a flag.
**Consequences:**
- Positive: one mechanism covers coverage, mutation score and eval accuracy; the measured value is printed and lands in `verify-feature` logs; adopters get it through `harness-upgrade` with no behavior change until they enable it.
- Negative: `npm run check` in this repository runs the test suite twice (once plain, once under coverage, about 30 s more). Existing adopters must add the `quality` make target and npm script by hand and append them to `check`, because `Makefile` and `package.json` are both adopter-owned on upgrade (corrected 2026-10-30 after upgrading ai-issue-triage: the first version of this entry said the Makefile was refreshed).

### D-034: The dev container is an optional component that create-harness instantiates once

**Date:** 2026-10-30
**Status:** accepted
**Context:** Agents run in whatever environment the host happens to have, so a session can fail on a missing toolchain or a different Node version instead of on the feature. The Java harness used for comparison ships a DevContainer that installs the agent CLIs and its MCP servers. This harness is stack-agnostic, so a single static `devcontainer.json` cannot carry the right toolchain, and the right Node version lives in the adopter's `.nvmrc`.
**Decision:**
- New optional component `devcontainer` (marker `.devcontainer/`), never placed by default (D-031), activated with `create-harness --with devcontainer`. It places `devcontainer.json` (Ubuntu 24.04 base image, node, github-cli and Anthropic's claude-code features, named volumes for `~/.claude`, `~/.codex`, `~/.gemini`) and `post-create.sh` (Codex and Gemini CLI from npm, then `./init.sh`; a failing `init.sh` does not abort container creation).
- When this `create-harness` run is what placed `devcontainer.json`, it rewrites it once: the node feature's version becomes the `.nvmrc` value, and the toolchain feature of the detected product stack is added (python, go, rust, java with Maven or Gradle, dotnet). A `devcontainer.json` that already existed is never rewritten, matching the package.json rule (H11).
- Claude, Codex and Gemini are all installed because the harness ships CLAUDE.md, codex.md and GEMINI.md (maintainer's choice). No API keys are wired in; logins persist in the volumes.
**Alternatives considered:**
- Detect the stack inside `post-create.sh` and install toolchains there — rejected: dev container features are declarative, cached by the image build, and visible in the file; a script would reinstall on every rebuild.
- Install Node per `.nvmrc` with nvm in `post-create.sh` — rejected: switching the default Node after the claude-code feature installed under the feature's Node can drop `claude` from PATH.
- Pass `ANTHROPIC_API_KEY` and friends through `remoteEnv` — rejected: an unset host variable becomes an empty string in the container, which some CLIs treat as a set-but-invalid key.
**Consequences:**
- Positive: one command gives every agent the same environment, with the project's Node and toolchain.
- Negative: adding a stack later or changing `.nvmrc` needs a manual edit of `devcontainer.json`. The container build itself is not exercised by the test suite or CI; only the generated files are.

### D-035: MCP servers are an optional component shared by the three agents

**Date:** 2026-10-30
**Status:** accepted
**Context:** Agents answer library questions from memory, which goes stale. The Java harness used for comparison ships several MCP servers preconfigured. Each agent CLI this harness supports reads MCP servers from a different place: Claude Code from a project `.mcp.json`, Gemini CLI from `.gemini/settings.json`, Codex from the user-level `~/.codex/config.toml`.
**Decision:**
- New optional component `mcp` (markers `.mcp.json`, `.gemini/`), never placed by default (D-031), activated with `create-harness --with mcp`. It ships one server, context7 (`npx -y @upstash/context7-mcp`): stack-agnostic and needs no secret (maintainer's choice).
- The same server list goes in `.mcp.json` and `.gemini/settings.json`. Codex gets it through `.devcontainer/register-mcp.sh` (devcontainer component), which reads `.mcp.json` and runs `codex mcp add` per command server; post-create runs it, and it is a no-op without `.mcp.json` or without `codex`.
- No permission is pre-granted: Claude Code still asks before starting a project server (the `ask` default in `docs/TOOLS.md`).
**Alternatives considered:**
- Place `.mcp.json` in every adopter by default — rejected: it adds a network-fetched tool the adopter did not ask for, against D-031.
- Ship more servers (fetch, GitHub, cloud docs) — rejected by the maintainer; they are stack- or account-specific.
- Write `~/.codex/config.toml` directly from `create-harness` — rejected: it would edit the user's home directory from a project scaffold.
**Consequences:**
- Positive: one command gives Claude Code and Gemini the same documentation tool, and the dev container gives it to Codex too.
- Negative: the server list lives in two files that can drift; nothing checks they match. Outside the dev container, Codex needs a manual `codex mcp add`. Each agent keeps its own gate: Claude Code lists the server as pending approval and Gemini CLI as disabled until the folder is trusted (seen in the dev container build on 2026-10-30).

### D-037: create-harness gives a new adopter an empty productRoots list

**Date:** 2026-10-30
**Status:** accepted
**Context:** `.harness/manifest.json` is CORE and `create-harness` copied it verbatim, so every new adopter's `productRoots` listed this repository's own product-owned files (`.github/workflows/publish.yml`, `repo-completion-plan.md`). The adopter has neither file, and the entries exempt those paths from arch-005 if the adopter ever creates them for another purpose. Found while creating ai-app-chassis, which emptied the list by hand.
**Decision:**
- When this `create-harness` run is what placed the manifest, it rewrites `productRoots` to `[]` and leaves every other key as the framework's. A manifest the adopter already had is never rewritten. This is the same rule as package.json (D-030) and devcontainer.json (D-034).
- `harness-upgrade` is unchanged: it already keeps the adopter's `productRoots` (feat-019).
**Alternatives considered:**
- Move the framework's two entries out of `productRoots` (classify them as INSTANCE instead) — rejected: they are this repository's distribution files, which is what `productRoots` is for, and the `instance` list ships to adopters too, so the leak would only move.
- Filter `productRoots` to the paths that exist in the target — rejected: an adopter that happens to have a `publish.yml` would still inherit an exemption it never declared.
**Consequences:**
- Positive: a fresh adopter's manifest only exempts what the adopter declares.
- Negative: adopters created before this change keep the two stale entries until they remove them; the upgrade does not touch `productRoots`.

### D-038: create-harness adds setup-python to the CI workflow of a Python product

**Date:** 2026-10-30
**Status:** accepted
**Context:** `templates/ci.yml` only sets up Node, then runs `npm run setup --if-present`. For a Python product that runs `pip install -e ".[dev]"`, which the runner's system Python refuses (`externally-managed-environment`, PEP 668; reproduced in `ubuntu:24.04` on 2026-10-30). ai-app-chassis needed `actions/setup-python` (plus a setup script of its own) before its layers stopped failing in CI.
**Decision:**
- When this `create-harness` run is what placed `.github/workflows/ci.yml` and `detectRuntime` finds python, the workflow gets an `actions/setup-python@v5` step between `setup-node` and the setup step. It uses `python-version-file: .python-version` when that file exists, else `python-version: "3.12"` (the version this repository's own CI uses). A `ci.yml` that already existed is never rewritten (D-030, D-034).
- Only python gets a step. The go, rust, java and .NET toolchains are preinstalled on `ubuntu-latest`, and their install commands (`go mod download`, `cargo fetch`) need no virtual environment.
- The template stays stack-neutral, so a plain adopter's workflow is unchanged and the adoption-matrix assertions about it hold as they are.
**Alternatives considered:**
- A commented-out `setup-python` block in the template — rejected: every adopter, of every stack, gets dead YAML, and the Python adopter still fails CI until someone finds and uncomments it.
- Steps for every stack, mirroring the devcontainer's features — rejected for now: the other stacks do not fail today, and each extra step is unverified surface.
- Make `npm run setup` create a virtual environment — rejected: the layers find `ruff`, `mypy` and `pytest` on PATH, so a venv would also change how every layer runs, far beyond this fix.
**Consequences:**
- Positive: a Python adopter created from an existing product passes `npm run setup` in CI without editing the workflow.
- Negative: an adopter that adds Python after adoption (or created the repository empty) must add the step by hand, as with the devcontainer's toolchain feature. The generated step matches the one ai-app-chassis added by hand, but no workflow generated by this code has run in GitHub Actions yet. Projects with their own setup (like ai-app-chassis) still add their own script step.

### D-039: Adoption-matrix cells drop an inherited CW_INIT_SH

**Date:** 2026-11-03
**Status:** accepted
**Context:** D-032 stopped `run()` in `tests/framework-check.test.mjs` from passing `./init.sh`'s `CW_INIT_SH=1` to the runner it spawns. `scripts/adoption-matrix.mjs` had the same leak: `spawnRunner` spawned each cell's runner with `{ ...process.env, CW_ADOPTION_CELL: "1" }`, and `./init.sh` runs the whole chain, e2e included, with `CW_INIT_SH=1`. Under `./init.sh` every cell's lint therefore only warned on an unfilled doc, while under `npm run check` it failed. No cell asserts that today (`fillDocs` fills every doc), so nothing broke, but the matrix's result depended on which entrypoint ran it.
**Decision:**
- `scripts/adoption-matrix.mjs` exports `cellEnv(baseEnv = process.env)`: a copy of the environment with `CW_ADOPTION_CELL=1` set and `CW_INIT_SH` removed. `spawnRunner` uses it for every cell.
- `tests/adoption-matrix.test.mjs` checks `cellEnv` directly: `CW_INIT_SH` is gone, `CW_ADOPTION_CELL` is set, other variables (including `CW_SKIP_ADOPTION_MATRIX`) pass through.
**Alternatives considered:**
- Leave it, since no cell depends on it — rejected: the matrix is meant to give the same answer under `./init.sh` and `npm run check`, and the leak would surface as a confusing failure the day a cell checks unfilled docs.
- Strip `CW_INIT_SH` once in `init.sh` before the e2e layer — rejected for the same reason as in D-032: `verify-chain` is one runner invocation.
**Consequences:**
- Positive: e2e cells see the same environment under `./init.sh` and `npm run check`. Adopters get it through `harness-upgrade`, since `scripts/` is CORE.
- Negative: as in D-032, any future runner variable that changes a mode's behavior needs the same treatment in `cellEnv`.

### D-040: Adopters run the harness self-tests once per session, not on every check

**Date:** 2026-11-05
**Status:** accepted
**Context:** In an adopter, the `test` layer ran the runner's unit tests (`tests/*.test.mjs`, about 11 s) and `e2e` ran the adoption matrix (about 3 min), unless `CW_SKIP_ADOPTION_MATRIX=1` was set; only the CI template sets it (D-023). The default feature layers run `npm run test` and then `npm run check`, so in a new project `verify-feature` took 215 s for a feature with no code, and `npm run check` before each commit another 203 s (measured 2026-11-05). Both test CORE files the adopter may not edit, which only change on `harness-upgrade`, so every run repeats the same result. `e2e` then reported PASS for the harness testing itself, not for the product, the kind of unearned pass D-029 rules out. And a 3-minute check is longer than an agent shell's default command timeout (2 min in Claude Code), so the agent could get a timeout instead of a verdict.
**Decision:**
- The manifest key `frameworkRepository: true` marks this repository. `create-harness` deletes it from a manifest it just placed (the D-037 rule), and `harness-upgrade` never carries it because it is not in `FRAMEWORK_MANIFEST_KEYS`. Manifest validation fails on a non-boolean value.
- Where the key is set, `test` and `e2e` are unchanged: the runner's unit tests and the adoption matrix are this repository's product tests.
- Everywhere else, `test` checks the feature graph and WIP contract and prints a NOTE saying where the self-tests run; `e2e` reports SKIP until the adopter points the script at its own end-to-end tests. `CW_SKIP_ADOPTION_MATRIX` and the adoption-cell guard keep their own messages.
- New runner mode `selftest` runs the unit tests on demand. `verify-chain`, which `./init.sh` runs at every session start, ends with it in adopters, so a Node version or platform that breaks the harness still shows up once per session. `harness-upgrade` names it in its closing "Verify the upgraded repo" line. It is not a make target or npm script, so existing adopters have nothing to add.
- The adoption matrix runs `selftest` once in a freshly built adopter, since its cells no longer run the unit tests through their test layers.
**Alternatives considered:**
- Detect the framework repository from the package name or a repo-only file such as `publish.yml` — rejected: the package name was renamed once already (session 020), and the matrix and tests build adopters from this repository's own files, so an implicit signal is easy to leak. An explicit key, dropped at the two places a manifest is created or upgraded, is testable.
- Make adopters opt in to skipping (set `CW_SKIP_ADOPTION_MATRIX` locally) — rejected: that is the current state; the default is what an agent following AGENTS.md runs.
- Drop the self-tests from adopters entirely — rejected: they are the only check that the harness works on the adopter's Node version and OS. Once per session costs about 11 s.
- Stop Layer 3 (`npm run check`) from repeating Layers 1–2 — deferred: with the self-tests gone the repetition costs about a second in a new project; it only matters once an adopter chains slow product tests into `test`, and changing what the default layers mean deserves its own feature.
**Consequences:**
- Positive: in a new project, `verify-feature` takes about 1.5 s instead of 215 s, `npm run check` about 1 s instead of 203 s, and `./init.sh` about 14 s instead of 3.5 to 4 min. The framework's own `npm run check` went from about 3.7 min to about 1.1 min, because matrix cells no longer run the unit tests through their test layers. Adopters' `e2e` no longer claims a pass it did not earn.
- Negative: an adopter that edits a CORE script mid-session is not caught by the unit tests until the next `./init.sh` or `selftest`; they were a weak guard for that anyway, since an edit that keeps the tests green passes. A cross-component change in an adopter now needs real end-to-end tests to get the e2e PASS that the `release` skill asks for. An adopter that put its own `*.test.mjs` files in `tests/` (a CORE directory, against the contract) got them run by the test layer; they now run only from `./init.sh` and `selftest`, so they belong outside `tests/`, chained into the `test` script (#25). `CW_SKIP_ADOPTION_MATRIX` in `templates/ci.yml` is now redundant in adopters; it stays, since adopter-owned workflows are never rewritten and the variable still means the same thing here. Adopters get the new behavior through `harness-upgrade` (`scripts/`, `tests/` and `AGENTS.md` are CORE).

### D-041: Verification evidence is bound to committed code

**Date:** 2026-11-05
**Status:** accepted
**Context:** `verify-feature` recorded the HEAD commit and a `dirty` flag, but passed on any tree. feat-023 and feat-029 were both recorded with `"dirty": true`: the commit their evidence names does not contain the code that passed, so the evidence could not be traced to what was verified. Nothing tied evidence to the checks either: after a feature's layers were edited, its old `passing` still counted, and dependents built on it.
**Decision:**
- Before any layer runs, the gate lists uncommitted paths in the project directory (modified, staged, deleted, renamed, untracked and not ignored) and refuses if any lie outside harness bookkeeping: `.harness/state/`, `.harness/logs/`, `.harness/traces/`, `.harness/trails/`, `progress/`, `PROGRESS.md`, `progress.md`, `claude-progress.md`, `session-handoff.md`. Those record a verification; they are not what is verified. After the layers pass it checks again and fails if a layer left new changes, since the recorded commit would then not match the verified tree.
- `--allow-dirty` records anyway, with `bound: false` and the reason in the summary. Outside a git repository the gate runs with a NOTE and records `bound: false` (the adoption-matrix cells are not git repositories).
- Evidence gains `bound` and `checksHash`: the first 16 hex characters of a SHA-256 over each layer's label, command and `required`. The repair hint is advice and is not hashed.
- A passing feature whose `checksHash` no longer matches its declaration is stale. `typecheck` prints a `[WARN]` and still passes; `verify-feature` refuses a feature whose dependency is stale. Evidence without `checksHash` (recorded before this decision) is never stale.
**Alternatives considered:**
- Record and warn only — rejected: the evidence would keep naming commits that do not hold the verified code; a warning on a later check is easy to miss.
- Verify in a clean worktree checked out at HEAD — rejected for now: it needs the same commit-first workflow, reinstalls dependencies on every run, and is much more code.
- Fail `typecheck` on stale evidence — rejected: changing a passing feature's layers is a commit, which must pass `check` first, but re-verifying needs a clean tree, so the agent could not get out without `--allow-dirty`. The warning plus the dependency gate keep the stale `passing` from being built on.
- Detect staleness from code changes since the evidence commit — rejected: every later commit changes the tree, so it would flag every old feature.
**Consequences:**
- Positive: a bound `passing` names the exact commit that passed. Stale evidence is visible in every `check` and cannot satisfy a dependency.
- Negative: the feature loop gains a commit: code and docs, then the gate, then the shard and session notes. A layer that writes unignored files now fails the gate until the output is ignored or committed. An adopter project inside a larger repository is judged only on its own directory. Existing evidence is not re-checked; it stays as recorded. Adopters get the behavior through `harness-upgrade` (`scripts/`, `tests/`, `AGENTS.md` are CORE; skills are refreshed per feat-026).

### D-042: The harness ships Claude Code deny rules for secret files, and nothing more

**Date:** 2026-11-05
**Status:** accepted
**Context:** AGENTS.md said "Tool access is scoped via `.claude/settings.json`" and "Default permission for sensitive tools is `ask`", but `create-harness` wrote `{}` to that file, and this repository's own copy held Cline settings that Claude Code ignores. Nothing enforced either claim. `docs/TOOLS.md` listed Cline tool names (`read_file`, `write_to_file`) as if they were the harness's tools. The containment work behind the improvement brief puts the real boundary in the environment, and treats permission prompts as weak: people approve most of them.
**Decision:**
- New template `templates/claude-settings.json`, placed at `.claude/settings.json` (still INSTANCE, so adopter-owned). It holds only `permissions.deny` rules for reading secrets: `.env` variants at any depth in the project, and credential stores in the home directory (`~/.ssh`, `~/.aws`, `~/.azure`, `~/.config/gcloud`, `~/.kube`, `~/.gnupg`, `~/.docker/config.json`, `~/.git-credentials`, `~/.netrc`, `~/.npmrc`, `~/.pypirc`). Deny rules apply before folder trust and also stop `cat`/`head`/`tail`/`sed` and shell redirections from reading those paths.
- `.env.*` is not denied as a wildcard: it would hide `.env.example` and `.env.sample`, which agents need. The common secret-bearing variants are listed instead.
- No `allow` rules, no `defaultMode` and no `sandbox` block. Claude Code's defaults already ask before edits and commands. An allow rule in a committed file applies to every teammate. The sandbox does not run on native Windows, so one committed setting would behave differently across a team; `docs/TOOLS.md` gives an opt-in snippet.
- `harness-upgrade` treats a `.claude/settings.json` that is exactly `{}` (whitespace ignored) as missing, replaces it from the template and says so in its report. Any other content is never touched (`PLACEHOLDER_INSTANCE_FILES`). No backup is taken: the replaced content is the literal placeholder.
- AGENTS.md and `docs/TOOLS.md` now say what is enforced, its limits (not a boundary: scripts can still open the files), and how to get comparable protection in Codex and Gemini CLI, for which the harness ships nothing. Codex documents no rule to deny reading a file, so for both the advice is to keep secrets out of the workspace.
- This repository's own `.claude/settings.json` gains the same deny rules next to the existing Cline keys, so AGENTS.md is true here too.
**Alternatives considered:**
- Ship per-adapter files for Codex (`.codex/config.toml`) and Gemini (`.gemini/settings.json`) — rejected for now: Codex already recommends workspace-write with approval on request when it opens a version-controlled folder, so a file would change little; it has no rule to deny reading a file; and its project config only loads after trust. Gemini CLI's settings format changed between versions, and the CLI page now says it was replaced by Antigravity CLI.
- Build a canonical policy file and a policy engine that generates each adapter's rules (brief WP-06) — deferred: a custom security component is the kind the containment article warns about, and only Claude Code has a per-file read rule to generate today.
- Correct the AGENTS.md claims without shipping anything — rejected: the deny rules cost nothing for agents and remove the easiest secret leak (an agent reading `.env` into its context).
**Consequences:**
- Positive: new adopters and upgraded `{}` adopters get secret-read protection in Claude Code by default. The docs no longer promise enforcement that does not exist.
- Negative: an agent that needs a real value from `.env` must ask the human. Projects that keep secrets elsewhere must add their own rules. The protection is Claude Code only and is not an OS boundary; scripts and tests the agent runs can still read the files.

### D-043: harness-upgrade plans per file and can stop at the plan (--dry-run)

**Date:** 2026-11-05
**Status:** accepted
**Context:** An upgrade wrote first and reported after, and the report named whole surfaces ("Overwritten: scripts/") whether or not anything in them changed. An adopter could not see beforehand which of their files would be replaced, for example a CORE script they had edited against policy, or tell an upgrade that changes three files from one that changes forty. The improvement brief (WP-05) asks for a preview that writes nothing.
**Decision:**
- `upgrade(root)` first builds a plan of every framework-owned file it would copy (the mustNotEdit surfaces, the shipped skills, `templates/` except existing `keep` templates), each marked `add`, `update` or `same`. Content is compared with line endings normalized, so a CRLF checkout of an unchanged file is `same`.
- `upgrade(root, { dryRun: true })` and `harness-upgrade <dir> --dry-run` stop at the plan: nothing is copied, the manifest is not rewritten, no instance file is created, and no backup is taken. The report is the same object a real run returns (`files.added`, `files.updated`, `files.unchanged`, `created`, `overwritten`), with `dryRun: true`.
- A real run takes the backup, then copies every planned file, unchanged ones included, exactly as before (a copy also carries the file mode), so the dry run's lists are what the real run reports.
- The CLI prints each changed and added file in both modes, and rejects an unknown option instead of ignoring it. `make harness-upgrade D="<dir> --dry-run"` passes the flag through; no Makefile or package.json change is needed.
**Alternatives considered:**
- Show a unified diff per file — rejected for now: the useful decision is which files change; `git diff` after a real run (with the automatic backup to restore from) shows the content.
- A `harness-lock.json` pinning the framework version (brief WP-05) — not done: the manifest already records `version`, and adopters choose the version by which copy of the framework they run.
**Consequences:**
- Positive: an adopter can review an upgrade before it touches anything, and every real upgrade says exactly which files it changed.
- Negative: an edited mustNotEdit file is reported as "update", the same as a file the framework changed; the plan cannot tell the two apart without the adopter's previous framework version.

### D-044: Agent-compliance evals run Claude Code in throwaway adopters and grade outcomes

**Date:** 2026-11-05
**Status:** accepted
**Context:** The unit tests and the adoption matrix prove the harness's scripts work. Nothing tested whether an agent following `AGENTS.md` actually does what it says: commits before the gate, keeps WIP=1, leaves feature state to `verify-feature`, refuses shortcuts. The evals article behind the improvement brief (WP-02) says to start with 20–50 tasks drawn from real failures, isolate every trial, grade outcomes rather than step sequences, prefer deterministic graders, and report consistency (pass^k) across trials. The human chose Claude Code as the first agent.
**Decision:**
- `evals/` lives in the framework repository only (`productRoots`; not in the npm package, never placed in adopters).
- Each trial builds a fresh fixture with `create-harness`, filled docs, the task's files and features (declared through the runner's own `add-feature`, and `passing` ones verified through the real gate), and a clean commit. The template's placeholder feature is dropped, and product tests are chained into `test` the way USAGE documents.
- The agent runs as `claude -p` with `--permission-mode dontAsk` and a scoped `--allowedTools` list (no push, network or delete commands), `--setting-sources project,local`, `--strict-mcp-config` with no servers, `--no-session-persistence`, and auto memory off. The fixture's `CLAUDE.md` and `.claude/settings.json` load as for a real adopter, since that is what is evaluated. `--bare` is not used because it skips `CLAUDE.md`. `--fresh-config` (an empty `CLAUDE_CONFIG_DIR`, API key only) also keeps the developer's `~/.claude/CLAUDE.md` out.
- Graders are deterministic and check outcomes: `no-state-edits`, `wip-1`, `gate-only-passing` (verify-feature evidence, bound, naming a real commit), `feature-state`, `session-note`, `check-green`, and `command` (with hidden files copied in only at grading). No LLM judge yet.
- Five first tasks, two "comply" and three "hold back": implement a feature; repair a red baseline before new scope; refuse to mark a failing feature passing by hand; refuse a second active feature; refuse to finish a feature whose dependency isn't done. Doing the work properly through the gate also passes a hold-back task.
- The report gives per-task pass^k and pass@k, graders that flip between trials, and the CLI's cost estimate. Results go to `evals/results/` (self-ignoring).
- `evals/graders.test.mjs` plays compliant and corner-cutting agents against a real fixture with no model. CI runs it and `--fixtures-only`. Both stay out of `npm run check`, which they would slow by about a minute (D-040 keeps the check short).
**Alternatives considered:**
- Compare the same tasks with and without the harness (the brief's WP-02 benchmark) — deferred: first find out whether agents follow the harness at all; an A/B comparison needs many more trials and a matched no-harness setup.
- An LLM rubric judge for answer quality — deferred: every grader so far can be checked from repository state and tool calls.
- `--dangerously-skip-permissions` in a container, as in the C compiler article — rejected as the default: a scoped allow list works anywhere; the README says to use the dev container when isolation matters.
- Run the grader tests in the framework's `test` layer — rejected: about a minute more on every local check and every `verify-feature`.
**Consequences:**
- Positive: harness changes can be measured against agent behavior, not only script behavior; corner-cutting has a test for each grader.
- Negative: real trials cost tokens and need the CLI, so they run by hand, not in CI. Five tasks are far from the 20–50 the article recommends; more should come from real failures. `no-state-edits` recognizes shell writes by pattern, so an unusual write command can slip past (`gate-only-passing` still catches state with no gate evidence). No real trial has run yet.

### D-045: The end-of-session steps agents skip are done by the gate or checked by clean-check

**Date:** 2026-11-06
**Status:** accepted
**Context:** The first full run of the agent-compliance evals (session 062) gave a consistent picture across five passing comply trials: the mechanical end-of-session steps were done every time (session note, regenerated `PROGRESS.md`, clean committed tree), but `docs/quality-document.md` was updated in one trial and the `npm run vcr` trail recorded in none. One agent said so in its final message. A step agents skip four or five times out of five is a step the workflow does not really have.
**Decision:**
- The trail: since feat-030, `verify-feature`'s bound evidence names the commit and every layer it ran, including the full `npm run check`. So the gate itself writes the trail on every bound pass: `.harness/trails/<stamp>-verify-feature-<id>.json` with the feature, commit and `checksHash`. `npm run vcr` stays for a full-run record when no feature was verified; it is no longer a per-feature step. No trail is written for unbound evidence, which names no commit.
- The quality document: rating modules is a judgment call and can't be automated, but it can be checked. `clean-check`, which agents already run at the end of a session, fails while `docs/quality-document.md` does not mention, by id, every feature whose evidence is bound, and its message says what to add. Features verified before feat-030 (no `bound` field) are not checked. A missing quality document is a warning.
- AGENTS.md (end of session, step 4), the feature-cycle, review, release and session-handoff skills, OBSERVABILITY (both copies) and the quality-document template describe the new steps.
- The comply eval tasks gain a `clean-check` grader. The `command` grader copies a task's hidden files only when the grader asks (`"hidden": true`); before, every command saw them, so `clean-check` would have failed on the untracked `hidden/` folder.
**Alternatives considered:**
- Drop the quality document from the checklist — rejected: it is the only place a session records a judgment about quality, and the OpenAI harness-engineering practice keeps such a score current; a check is cheap.
- Fail `lint` instead of `clean-check` — rejected: lint runs in every `check`, including the one before the bookkeeping commit, so it would fail in the middle of the normal sequence (verify, then write notes and ratings, then commit).
- Have `session-end` run `vcr` — rejected: a second full check after the gate's own adds minutes and proves nothing new.
**Consequences:**
- Positive: the trail exists whenever a feature passes, with no step to forget; the quality document is checked where agents already look.
- Negative: mentioning a feature id is a proxy; it does not prove the ratings are thoughtful. A trail file per verification adds one more bookkeeping file to commit.
- Measured (session 064, the two comply tasks, 3 trials each): in every trial where the agent had a working shell, the quality document named the feature (5/5, was 1/5) and the gate's trail was committed (5/5, was 0/5). Agents wrote a Notes line or a table row naming the feature, what changed and the files.

### D-046: A feature's declared behavior wins over a test that contradicts it

**Date:** 2026-11-07
**Status:** accepted
**Context:** In the `test-contradicts-spec` eval (session 068) the active feature's test passed while checking a different value than the feature's declared `behavior`. One agent in three stopped to ask which side was right, citing AGENTS.md's "unclear requirements → ask user"; the other two chose the declared behavior and flagged it as a judgment call. All three saw the conflict, and nothing in the harness said which side wins. The gate can't catch this: it runs the feature's tests, and here the tests were the wrong part.
**Decision:** AGENTS.md (Working Rules, and Escalation for unclear requirements), the feature-cycle skill and the review skill say that a feature's declared `behavior` in `feature_list.json` is the spec. A test that contradicts it is a bug in the test: fix it in the same commit, and say so in the commit message and the session note. Stop and ask only when the declared behavior itself looks wrong. The review skill also checks that the tests check the declared behavior.
**Alternatives considered:**
- Accept either outcome in the eval grader (fix it, or stop and ask) — rejected: it would hide a real gap in the rules, and an agent that stops on every such conflict leaves features unfinished.
- Make the test authoritative — rejected: `feature_list.json` is already the harness's source of truth for what a feature is, and a test written earlier against the wrong value is the more likely mistake.
**Consequences:**
- Positive: one less judgment call; the gate's pass means the declared behavior, not just whatever the tests check.
- Negative: a wrong declared behavior plus a correct test now leads the agent to "fix" the correct test, unless the behavior looks obviously wrong; the commit message and session note make that visible to a reviewer.
- Measured (session 069, `test-contradicts-spec`, 3 trials): 3/3 passed (was 2/3). Every trial fixed the test, cited the rule in its final message, and none stopped to ask or flagged a judgment call (was one stop and two flagged judgment calls).

### D-047: Session notes start from a generated skeleton

**Date:** 2026-11-07
**Status:** accepted
**Context:** Lint requires each `progress/NNN-YYYY-MM-DD.md` to start with exactly `### Session NNN — YYYY-MM-DD` (three `#`, em dashes). In the eval transcripts agents wrote their own headings (`# Session 001 — …`, `## Feature` sections), found out only when lint failed, and spent turns fixing them; several fixes used `sed -i`, which the eval run denies. The format is strict for a reason: the generated dashboard indexes sessions by their headings.
**Decision:**
- New runner mode `node scripts/framework-check.mjs progress-new "<title>"`: the next session number, today's local date, the exact heading, the standard bullet sections (Goal, Sprint contract, Completed, Verification run, Files or artifacts updated, Known risk or unresolved issue, Next best step), then a dashboard refresh so lint passes at once. It refuses a blank or multi-line title and never overwrites an existing note.
- A runner mode, like `progress-update`, not a make target or npm script, so adopter-owned `Makefile` and `package.json` need no change.
- The progress lint error now spells out the format and names the command. AGENTS.md (end of session), the session-handoff skill, USAGE (both copies), README and ARCHITECTURE point to it.
**Alternatives considered:**
- Accept any heading level and any dash — rejected: the dashboard index and the session-number checks rely on one format, and a lenient parser is harder to keep consistent than a generator.
- Ship a note template file to copy — rejected: copying still leaves the number and date to the agent, the two parts lint checks.
**Consequences:**
- Positive: starting a note is one command with nothing to get wrong; filling it in is the only judgment left.
- Negative: one more runner mode to know about; a note written by hand still works, under the same strict check.

### D-048: Sessions start from a generated brief, not from reading feature_list.json

**Date:** 2026-11-07
**Status:** accepted
**Context:** AGENTS.md's startup told every session to read `feature_list.json` in full. It is 52 KB in this repository and grows with every feature an adopter declares, and most of it is passing features a session never touches. OpenAI's harness-engineering post argues the entry point should be a short map that points to detail. Meanwhile `session-handoff.md` here still described feat-017, months old: nothing keeps it current, whereas every session writes a progress note.
**Decision:**
- New runner mode `brief` prints a few hundred bytes: branch, last commit and uncommitted count; feature counts by state; the active feature with its behavior and layer commands; planned features that can start now (dependencies passing and not stale) and those waiting; blocked and stale-evidence features; the latest session note's heading, known risk and next step; and when `session-handoff.md` last changed, flagged when older than the latest note.
- `./init.sh`, which every session already runs (AGENTS.md step 4), prints it at the end, with `|| true` so it never stops a session from starting. Its closing "Next steps" now say to pick from the brief.
- AGENTS.md step 5 says to read the brief and open `feature_list.json` only for the features it names.
- Risks and next step come from the latest progress note, not from `session-handoff.md`, which is only dated.
**Alternatives considered:**
- Split `DECISIONS.md` into one file per decision — deferred: it is large only in this repository, and sessions read it only before major decisions, not at startup.
- Make the brief a separate step agents must remember — rejected: the feat-034 evals showed separate steps get skipped; `init.sh` already runs every session.
**Consequences:**
- Positive: startup reads a short summary instead of the whole declaration file; stale handoff notes are visible.
- Negative: the brief shows only the first 300 characters of the active feature's behavior; a session still opens `feature_list.json` for the full entry. Not measured with an agent: the eval fixtures have one or two features, so the saving there is small.

### D-049: New features' Layer 3 runs only the checks Layers 1 and 2 did not

**Date:** 2026-11-07
**Status:** accepted
**Context:** `add-feature`'s default layers were `npm run lint`, `npm run test`, then `npm run check`, and `check` starts with lint and test again, so every gate ran them twice. D-040 deferred this: in a new adopter the repetition costs about a second. It matters in this repository (Layer 2 is about 31 s of a gate of about 3 minutes) and in any adopter whose `test` chains slow product tests, where it doubles the slowest part of every gate.
**Decision:**
- `add-feature` builds Layer 3 from the project's own `check` script: when it is a plain `&&` chain of `npm run` steps containing `npm run lint` and `npm run test`, those two are dropped. With the default scripts Layer 3 is `npm run typecheck && npm run build && npm run e2e && npm run verify-all && npm run quality`.
- Anything else — no `package.json`, no `check`, a script with `||`, `;`, a pipe or redirection, steps that aren't `npm run`, or a chain without both steps — keeps `npm run check`. A customised setup never loses a check.
- The template's placeholder feature uses the reduced chain. Existing features' declared layers are not rewritten, so their `checksHash` and evidence stay valid; they keep running `npm run check` until someone edits them.
**Alternatives considered:**
- Have `verify-feature` tell `check` to skip layers that already passed in the same run — rejected: it would make a passing layer depend on hidden state shared between layers.
- Rewrite every existing feature's Layer 3 — rejected: it would make all their evidence stale (feat-030) for a speed-up nobody asked for on finished work.
**Consequences:**
- Positive: one lint and one test run fewer per gate for new features; the saving grows with the project's test suite.
- Negative: Layer 3 is now a copy of the `check` chain taken when the feature was declared; a step added to `check` later reaches only features declared after it. In this repository the saving is about 30 s of a gate of about 3 minutes; most of Layer 3 is the adoption matrix and the coverage run, which are not repeats.
