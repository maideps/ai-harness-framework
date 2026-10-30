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
- Negative: `npm run check` in this repository runs the test suite twice (once plain, once under coverage, about 30 s more). Existing adopters must append `&& npm run quality` to their own `check` script, because `package.json` is adopter-owned on upgrade; `make check` gets it through the Makefile.

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
