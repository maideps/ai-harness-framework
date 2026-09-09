# Progress Log

Session continuity source of truth for this repository. Update at the end of each session with verified state, blockers, and next steps.

## Current Verified State

- Project root: this repository (ai-harness-framework)
- Primary startup command: `./init.sh`
- Primary verification command: `make check` (make-free equivalent: `npm run check` — both delegate to the Node runner)
- Current active feature: none (feat-001 through feat-010 passing; feat-011 planned, next in queue)
- Current blocker: none
## Session Log

### Session 001 — 2026-08-17 — Harness integrity fixes (P0)

- Goal: Make the harness's own gates honest and its state files real. Scope: tri-state verification layers, e2e in `check`, `vcr` trail recording, honest e2e/dev scripts, docs alignment, dogfooded state files, repo hygiene.
- Completed:
  - Verification layers now report PASS / SKIP / FAIL; SKIP does not count as verified (Makefile, `scripts/framework-check.mjs`)
  - `make check` now runs lint → typecheck → test → build → e2e; `npm run check` added as make-free equivalent (D-002, D-004)
  - `make vcr` records a JSON verification trail to `.harness/trails/` (D-003)
  - `package.json` e2e/dev scripts replaced fake `echo && exit 0` passes with honest SKIP reporters
  - Placeholder check tightened (`[module or surface name]` in quality-document.md is now caught)
  - Docs aligned: README layer/target tables, AGENTS.md SKIP semantics, ARCHITECTURE.md enforcement note
  - `docs/decisions/` created (was referenced but missing); DECISIONS.md now records D-001..D-004
  - PROGRESS.md, session-handoff.md, claude-progress.md, quality-document.md filled with real content
  - `.gitignore` covers Windows reserved device names; stray `nul` artifact removed
- Verification run: `npm run check` + `bash scripts/check-arch.sh` + `bash scripts/verify-feature.sh feat-001` (see feature evidence and `.harness/trails/`)
- Evidence captured: feat-001 `evidence` field; vcr trail JSON
- Commits: see `git log` for this session (three logical commits: verification surface, docs+decisions, state+hygiene)
- Files or artifacts updated: Makefile, package.json, scripts/framework-check.mjs, README.md, AGENTS.md, docs/ARCHITECTURE.md, docs/decisions/index.md, DECISIONS.md, PROGRESS.md, session-handoff.md, claude-progress.md, docs/quality-document.md, feature_list.json, .gitignore
- Known risk or unresolved issue: `make` is not installed on the primary Windows dev machine; all verification used the npm/bash entrypoints instead. Consider installing make (winget) or accepting npm as the canonical path.
- Next best step: pick feat-002 (Primary Capability) or adopt the P1 roadmap (state-machine CLI, evidence objects, self-audit port) — see session-handoff.md.

---

### Session 002 — 2026-08-18 — feat-002 Seams and Manifest

- Goal: Introduce the reusability seam contract: a machine-readable manifest, adopter skeleton templates, seam documentation, and enforcement.
- Completed:
  - `.harness/manifest.json` classifies CORE / INSTANCE / optional components / customization points
  - `framework-check.mjs` gained a `manifest` validation mode; arch-004 enforces it via check-arch
  - `templates/` now carries adopter skeletons: progress.md, feature-list.json, session-handoff.md, quality-document.md (fixed contract sections, no fake content)
  - `docs/ARCHITECTURE.md` gained the Reusability Contract section; README and AGENTS.md reference the manifest and the same-commit update rule
  - feature_list.json rewritten to the agreed 7-feature reusability roadmap
- Verification run: `npm run check` (PASS, e2e SKIP) + `bash scripts/check-arch.sh` (4 rules) + `bash scripts/verify-feature.sh feat-002` (ALL LAYERS PASS)
- Evidence captured: feat-002 `evidence` field; vcr trail `.harness/trails/2026-08-18T15-50-22-827Z-vcr.json`
- Commits: 595978c (roadmap), 6f0d3d6 (manifest+arch-004), 1f9cec6 (templates+docs)
- Files or artifacts updated: .harness/manifest.json, .harness/arch-rules.json, scripts/framework-check.mjs, templates/* (4 new), docs/ARCHITECTURE.md, README.md, AGENTS.md, feature_list.json
- Known risk or unresolved issue: the File edit tool silently dropped two large insertions this session; workaround adopted (write-temp + node splice) and verified by read-back. `make` still absent on this machine.
- Next best step: feat-003 (Node Runner Consolidation) — port the bash suite to the runner and mirror make targets as npm scripts.

---

### Session 003 — 2026-08-18 — feat-003 Node Runner Consolidation

- Goal: One Node runner as the canonical implementation of every harness operation: the four bash scripts ported in, one shared stack-detection module, and npm scripts mirroring every make target.
- Completed:
  - `scripts/stack-detect.mjs` — single source of truth for stack detection: runtime (node/python/go/rust/jvm/dotnet), package manager, per-layer commands with tool availability, install step, verification chain
  - `framework-check.mjs` gained `check-arch`, `verify-feature`, `session-trace` (start/end with merge), `clean-state-check`, `run-layer`, `verify-chain`, `setup`, `help` modes
  - The four bash scripts are now thin `exec node …` shims; init.sh consumes the stack-detect module for install + verification
  - Makefile targets are one-line delegations; package.json mirrors every make target (check-arch, verify-feature, vcr, session-start/end, clean-check, setup, help added)
  - Docs aligned in the same change: README command tables, ARCHITECTURE.md Runner Consolidation section, AGENTS.md command mirrors, D-006 decision, quality-document grades
- Verification run: `npm run check` (PASS, e2e SKIP) + `npm run check-arch` (4 rules PASS) + `npm run verify-feature -- feat-003` (ALL LAYERS PASS) + `npm run vcr` (trail recorded) + init.sh end-to-end
- Session-trace round-trip: start → merged end record and end-only fallback both verified via the Node runner on Windows
- Evidence captured: feat-003 `evidence` field; vcr trail `.harness/trails/2026-08-18T17-01-27-989Z-vcr.json`
- Commits: this session's work lands as one logical commit (runner consolidation + docs in the same change)
- Files or artifacts updated: scripts/stack-detect.mjs (new), scripts/framework-check.mjs, scripts/*.sh (4 shims), Makefile, package.json, init.sh, README.md, docs/ARCHITECTURE.md, docs/quality-document.md, DECISIONS.md, AGENTS.md, feature_list.json
- Known risk or unresolved issue: `make` still not installed here — Makefile delegation verified via the identical npm/runner paths; a real `make check` on Linux is unverified this session. `run-layer` executes package.json script values directly (no npm pre/post hooks) — documented in D-006.
- Next best step: feat-004 (Assurance Suite) — adoption e2e matrix + customization-survival upgrade test.

---

### Session 004 — 2026-08-18 — Seam completeness + runner bug fixes

- Goal: Audit-driven hardening: complete the manifest classification so no tracked file is undeclared, strip instance-specific content from reusable surfaces, add missing adopter skeletons, and fix the two runner bugs found in audit.
- Completed:
  - Manifest classifies every tracked file: `templates` array (7 new skeletons: project README, .gitignore, docs/PRODUCT, ARCHITECTURE, OBSERVABILITY, TOOLS, decisions/index), `instance` now includes README.md, docs/, .gitignore, .claude/settings.json, package-lock.json, trails, trace placeholder; `core` now includes LICENSE and .nvmrc; new `productRoots` key exempts adopter product code
  - arch-005 rule: no unclassified tracked file (coverage via git ls-files, precedence instance > templates > core, INSTANCE+TEMPLATE ambiguity is an error)
  - Instance content removed from reusable surfaces: README Feature Roadmap (now points to feature_list.json), ARCHITECTURE feat-001 bootstrap line, OBSERVABILITY false trail claim corrected
  - B1 fixed: python verify chain runs via argv (no shell) and the compileall exclusion regex matches both separators — verified empirically on Windows (venv/node_modules/dist excluded, exit 0)
  - B2 fixed: verify-feature refuses to mark a feature passing with unmet dependencies — verified (feat-007 refused, exit 1)
  - D-007 recorded; manifest schema v2, version 0.3.0
- Verification run: `npm run check` (PASS, e2e SKIP) + `npm run check-arch` (5 rules PASS) + `npm run verify-feature -- feat-002` and `feat-003` (ALL LAYERS PASS, evidence re-recorded) + `npm run vcr`
- Evidence captured: feat-002/feat-003 `evidence` fields; vcr trail `.harness/trails/2026-08-18T18-07-26-858Z-vcr.json`
- Files or artifacts updated: .harness/manifest.json, .harness/arch-rules.json, scripts/framework-check.mjs, scripts/stack-detect.mjs, README.md, docs/ARCHITECTURE.md, docs/OBSERVABILITY.md, DECISIONS.md, templates/* (7 new skeletons), feature_list.json (evidence)
- Known risk or unresolved issue: none new. Adopters must list product dirs in `productRoots` (documented in ARCHITECTURE.md); the adopter experience will be exercised by feat-004's matrix.
- Next best step: feat-004 (Assurance Suite) — adoption e2e matrix + customization-survival upgrade test.

---

### Session 005 — 2026-08-18 — Reusability verification pass

- Goal: Verify every file against the reusability seam and fix what the pass found.
- Completed:
  - Full gate re-run: `npm run check` PASS, `npm run check-arch` 5/5 PASS, `clean-check` PASS
  - Coverage audit: every tracked file classified (arch-005); manifest template list ↔ tracked templates fully consistent
  - CORE-surface scan for instance content (feature ids, session refs, machine paths, owner names): fixed the two leaks — `F=feat-003` example in Makefile comment and in the runner's help output → `<id>`; sprint-contract skeleton example → feat-001 (adopter fresh-start numbering)
  - Gap found and fixed: `DECISIONS.md` was required by the runner but had no adopter skeleton → `templates/DECISIONS.md` added and registered in the manifest
  - `ensureNoPlaceholders` now fails cleanly (with actionable message) when a required doc is missing instead of crashing
  - Observability bug fixed: `collectDecisionsSummary` counted the decision template block as a decision → now matches only `### D-<n>:` records (verified: count 7, latest D-007)
  - npm/make parity verified programmatically: 15 targets ↔ 15 scripts, zero drift
- Verification run: `npm run check`, `npm run check-arch`, session-trace round-trip (decisions count verified), CORE-surface greps
- Files or artifacts updated: scripts/framework-check.mjs, Makefile, .harness/manifest.json, templates/DECISIONS.md (new), templates/sprint-contract.md
- Known risk or unresolved issue: none new. `.nvmrc` pins node 24 while `engines` says >=18 — noted for feat-006 packaging.
- Next best step: feat-004 (Assurance Suite).

---

### Session 006 — 2026-08-18 — Usage guide shipped with the framework

- Goal: Provide a durable, shippable usage guide covering running, verifying, and adopting the harness.
- Completed:
  - `templates/docs/USAGE.md` added (ships to adopters as a skeleton) with this repo's instance copy at `docs/USAGE.md` (dogfooding)
  - Registered in the manifest (`templates` + `instance`); arch-005 coverage verified
  - Linked from README.md and templates/README.md
  - Content scan: no instance-specific references (feature ids, dates, machine paths) in the template
- Verification run: `npm run check` (PASS, e2e SKIP) + `npm run check-arch` (5/5 PASS)
- Files or artifacts updated: templates/docs/USAGE.md (new), docs/USAGE.md (new), .harness/manifest.json, README.md, templates/README.md
- Known risk or unresolved issue: none.
- Next best step: feat-004 (Assurance Suite).

---

### Session 007 — 2026-08-18 — Template placement is machine-readable

- Goal: Future adopters (and feat-006's generator) must be able to tell where every template goes without reading prose.
- Completed:
  - Manifest `templates` entries restructured from bare paths to `{ from, to }` objects (copy-and-fill) or `{ keep: true }` (reference material that stays under templates/) — manifest schema v3, version 0.4.0
  - Runner validates destinations: `to` must be declared INSTANCE and must not collide with CORE; legacy string entries still accepted as keep-in-place
  - Mapping documented in USAGE.md (both copies, full table) and ARCHITECTURE.md seam section
- Verification run: `npm run check` (PASS, e2e SKIP) + `npm run check-arch` (5/5 PASS) + manifest mode with the new validations
- Files or artifacts updated: .harness/manifest.json, scripts/framework-check.mjs, docs/USAGE.md, templates/docs/USAGE.md, docs/ARCHITECTURE.md
- Known risk or unresolved issue: none.
- Next best step: feat-004 (Assurance Suite).

---

### Session 008 — 2026-08-18 — feat-008 Skills Packs

- Goal: Add the capability-pack layer the framework was missing — reusable skills in the format proven by the lidr-specboot reference harness.
- Completed:
  - `skills/` registered as a CORE surface in the manifest; adopters may add project skills (mayEdit), shipped skills must not be modified
  - Six framework-native skills shipped: feature-cycle, verification, session-handoff, adopt, release, write-skill (meta-skill) — each with frontmatter name/description, When to Use, Workflow, Quick Reference
  - Runner validates skills in the lint layer: SKILL.md present, frontmatter name matches folder, description present, When to Use section present (negative test confirmed: mismatched name → FAIL, exit 1)
  - `skills/` added to required surfaces (lint, clean-state-check); docs wired (AGENTS.md Skills section, USAGE.md ×2, TOOLS.md ×2); D-008 recorded
- Verification run: `npm run check` (PASS, e2e SKIP) + `npm run check-arch` (5/5 PASS) + `npm run verify-feature -- feat-008` (ALL LAYERS PASS) + `npm run vcr`
- Evidence captured: feat-008 `evidence` field; vcr trail `.harness/trails/2026-08-18T19-49-39-468Z-vcr.json`
- Files or artifacts updated: skills/* (6 new), .harness/manifest.json, scripts/framework-check.mjs, feature_list.json, AGENTS.md, DECISIONS.md, docs/USAGE.md, templates/docs/USAGE.md, docs/TOOLS.md, templates/docs/TOOLS.md
- Known risk or unresolved issue: none.
- Next best step: feat-004 (Assurance Suite).

---

### Session 009 — 2026-08-18 — feat-009 Portability Extensions

- Goal: Adopt the remaining useful lidr-specboot patterns: multi-copilot entry points, a home for coding standards, and the commit/review/docs disciplines as skills.
- Completed:
  - `codex.md` and `GEMINI.md` thin shims pointing at AGENTS.md (CORE, no symlinks — portable on Windows); added to required surfaces (lint + clean-state-check)
  - `templates/docs/STANDARDS.md` skeleton registered with destination `docs/STANDARDS.md`; this repo's filled instance copy dogfoods it
  - Three new skills: `commit` (focused commits), `review` (pre-gate independent pass), `update-docs` (same-commit docs-drift rule) — 9 skills total, all validated by lint
  - Docs wired: AGENTS.md skills list, USAGE.md ×2, D-009 recorded
- Verification run: `npm run check` (PASS, e2e SKIP) + `npm run check-arch` (5/5 PASS) + `npm run verify-feature -- feat-009` (ALL LAYERS PASS) + `npm run vcr` + instance-content scan of new CORE surfaces (clean)
- Evidence captured: feat-009 `evidence` field; vcr trail `.harness/trails/2026-08-18T20-12-02-573Z-vcr.json`
- Files or artifacts updated: codex.md, GEMINI.md, docs/STANDARDS.md, templates/docs/STANDARDS.md (new), skills/{commit,review,update-docs} (new), .harness/manifest.json, scripts/framework-check.mjs, feature_list.json, AGENTS.md, DECISIONS.md, docs/USAGE.md, templates/docs/USAGE.md
- Known risk or unresolved issue: none.
- Next best step: feat-004 (Assurance Suite).

---

### Session 010 — 2026-08-19 — feat-004 Assurance Suite

- Goal: Make the e2e verification layer real — prove adoption with a generated-repo matrix and a customization-survival upgrade test.
- Completed:
  - `scripts/adoption-matrix.mjs`: generates throwaway adopter repos from the manifest (CORE + templates per {from,to} + filled docs + product markers) and runs check-arch, the product layer chain, and a full feature cycle via verify-feature in each cell (none/node/python/go/rust); cells with missing toolchains SKIP honestly
  - Customization-survival upgrade test: customizes every adopter-owned surface, corrupts a mustNotEdit surface, simulates an upgrade, asserts customizations survived and the corrupted surface was restored, then re-runs check-arch + feature cycle
  - Matrix recursion guard (CW_ADOPTION_CELL) so cell-level `npm run check` doesn't re-trigger the matrix
  - Stack detection now product-first (python/go/rust/jvm/dotnet before package.json — D-010) with tool-availability checks resolving to SKIP instead of FAIL
  - e2e mode replaced its SKIP reporter with the matrix; Layer 2 now also runs `node --test tests/*.test.mjs` (6 unit tests); verify-feature records SKIPs in evidence; session-trace merges atomically; package.json 0.4.0, .nvmrc 18
- Matrix first run found and fixed three real bugs: missing src/ parent dir, missing .harness/trails/ surface, and e2e self-recursion in cells
- Verification run: `npm run check` (PASS incl. real e2e matrix) + `npm run check-arch` (5/5) + `npm run verify-feature -- feat-004` (ALL LAYERS PASS) + `npm run vcr`
- Evidence captured: feat-004 `evidence` field (notes per-cell SKIPs); vcr trail `.harness/trails/2026-08-19T19-22-18-232Z-vcr.json`
- Files or artifacts updated: scripts/adoption-matrix.mjs (new), tests/stack-detect.test.mjs (new), scripts/framework-check.mjs, scripts/stack-detect.mjs, .harness/manifest.json (tests/ in core), docs/ARCHITECTURE.md (precedence + upgrade contract), DECISIONS.md (D-010), package.json, .nvmrc
- Known risk or unresolved issue: real-toolchain coverage (pytest/ruff/go/rust) still depends on the environment running the matrix — cells degrade to SKIP on this machine. `npm run check` is now slower (five throwaway repos).
- Next best step: feat-005 (Multi-repo Extension) — optional multi-repo component gated by the manifest.

---

### Session 011 — 2026-08-19 — feat-005 Multi-repo Extension

- Goal: Ship the optional multi-repo component (contracts/, tasks/, repositories/*/scripts/verify, scripts/verify-all) with graceful degradation for single-repo projects.
- Completed:
  - Five component skeletons in templates/multi-repo/ (verify-all root gate, contracts/tasks/repositories READMEs, example per-repo verify that SKIPs until a check.js exists) — destinations land on optional markers
  - `verify-all` runner mode + make/npm targets; SKIPs gracefully when the component is absent; argv-array spawning (no shell) — immune to spaces in the Node path
  - Manifest template destinations now accept optional-component markers; a specific optional claim overrides the scripts/ directory-level CORE claim (precedence: instance > templates > optional > core)
  - Matrix multi-repo test: component activated + git index → check-arch + verify-all pass; failing subrepo fails verify-all; unclassified stray file fails arch-005; removal restores
  - Docs: ARCHITECTURE optional-components + precedence, USAGE multi-repo section (both copies), D-011
- Debugging notes: the matrix caught two real bugs — extensionless verify scripts must be CJS (ESM import fails without .mjs), and execSync-without-shell breaks on paths with spaces ("C:\Program Files") — both fixed with spawnSync argv arrays; fixture check.js path mismatch fixed
- Verification run: `npm run check` (PASS incl. matrix) + `npm run check-arch` (5/5) + `npm run verify-feature -- feat-005` (ALL LAYERS PASS) + `npm run vcr`
- Evidence captured: feat-005 `evidence` field; vcr trail `.harness/trails/2026-08-19T20-14-27-751Z-vcr.json`
- Files or artifacts updated: templates/multi-repo/* (5 new), scripts/framework-check.mjs, scripts/adoption-matrix.mjs, Makefile, package.json, .harness/manifest.json, docs/ARCHITECTURE.md, docs/USAGE.md, templates/docs/USAGE.md, DECISIONS.md, feature_list.json
- Known risk or unresolved issue: none new. The example repository skeleton SKIPs until the adopter adds real checks (documented).
- Next best step: feat-006 (Distribution) — create-harness, upgrade, and audit tools reading the manifest.

---

### Session 012 — 2026-08-19 — feat-006 Distribution

- Goal: Ship create-harness, upgrade, and audit tools driven by the manifest as the single source of truth.
- Completed:
  - `scripts/create-harness.mjs` — generates an adopter repo (CORE as-is, templates per {from,to}, runtime surfaces), never overwrites; reusable exports
  - `scripts/harness-upgrade.mjs` — applies the D-010 contract (overwrites mustNotEdit CORE only; everything adopter-owned survives)
  - `scripts/harness-audit.mjs` — local health report (manifest, coverage, template placement, skills), non-zero exit on failure
  - make/npm mirrors + package.json `bin` entries (npx distribution after publish); ensureMakeTargets covers the new targets
  - Adoption matrix refactored to dogfood the tools (buildAdopter → adopt(), upgrade test → harness-upgrade) — the e2e layer now proves the distribution tools directly
  - CLI smoke test: create (15 CORE + 19 templates) / audit (honest FAILs on unfilled docs) / upgrade (overwrites mustNotEdit) — all correct
- Verification run: `npm run check` (PASS incl. matrix) + `npm run check-arch` (5/5) + `npm run verify-feature -- feat-006` (ALL LAYERS PASS) + `npm run vcr`
- Evidence captured: feat-006 `evidence` field; vcr trail `.harness/trails/2026-08-19T20-43-23-373Z-vcr.json`
- Files or artifacts updated: scripts/create-harness.mjs, scripts/harness-upgrade.mjs, scripts/harness-audit.mjs (new), scripts/adoption-matrix.mjs, scripts/framework-check.mjs, Makefile, package.json, docs/USAGE.md, templates/docs/USAGE.md, DECISIONS.md (D-012), feature_list.json
- Known risk or unresolved issue: npx distribution requires publishing the package; until then the node/npm entrypoints are the distribution path.
- Next best step: feat-007 (Sweep and Report) — the final roadmap feature.

---

### Session 013 — 2026-08-19 — feat-007 Sweep and Report (roadmap complete)

- Goal: Ship the final roadmap feature — session report aggregation and a periodic sweep with drift detection.
- Completed:
  - `scripts/harness-report.mjs` — aggregates .harness/traces/ into a session digest (per-session start/end/duration/state, feature, decisions, files, evidence; totals over a window; --days/--json flags); aggregation logic unit-tested (tests/report.test.mjs)
  - `scripts/harness-sweep.mjs` — archives old traces to .harness/traces/archive/, prunes orphaned .tmp files and stale open records, reports structural drift via the manifest mode (report-only); never touches instance state
  - make/npm mirrors (report, sweep); ensureMakeTargets covers them; verified live: report showed 5 real sessions (1 open), sweep archived a synthetic old trace + 3 genuinely stale pre-session traces, git tree unchanged
  - Docs: OBSERVABILITY (instance + template) Session Report/Periodic Sweep sections, USAGE (both), D-013
- Verification run: `npm run check` (PASS) + `npm run check-arch` (5/5) + `npm run verify-feature -- feat-007` (ALL LAYERS PASS) + `npm run vcr`
- Evidence captured: feat-007 `evidence` field; vcr trail `.harness/trails/2026-08-19T21-07-50-824Z-vcr.json`
- Files or artifacts updated: scripts/harness-report.mjs, scripts/harness-sweep.mjs, tests/report.test.mjs (new), Makefile, package.json, scripts/framework-check.mjs, docs/OBSERVABILITY.md, templates/docs/OBSERVABILITY.md, docs/USAGE.md, templates/docs/USAGE.md, DECISIONS.md, feature_list.json
- Known risk or unresolved issue: none. ALL roadmap features (feat-001..007 + 008, 009) are now passing.
- Next best step: roadmap complete — next work is optional: publish the package for npx distribution, run the matrix on Linux CI, extend unit tests.

---

### Session 014 — 2026-08-19 — CI proof on Linux (beyond roadmap)

- Goal: Prove the harness on Linux with real toolchains — closing the two honesty gaps: non-SKIP matrix cells and the never-executed Makefile surface.
- Completed:
  - `templates/ci.yml` (→ `.github/workflows/ci.yml`, both registered in the manifest): GitHub Actions on ubuntu with node 18+24 matrix, real python/go/rust toolchains installed, `npm run check` + `npm run check-arch` + `make check` (node 18 only)
  - Rust matrix fixture fixed: added `src/main.rs` (cargo test/build fail without a crate target — hidden until a real toolchain runs the cell)
  - Docs: USAGE template tables + ARCHITECTURE templates bullet mention the CI skeleton
- Verification run: `npm run check` (PASS), `npm run check-arch` (5/5), manifest mode (classifications)
- Known risk or unresolved issue: the CI workflow itself runs for the first time on GitHub after this push — its execution there is unverified from this machine; watch the Actions tab on the next push.
- Next best step: watch the CI run; then publish prep (npm), dogfood adoption into a real project, or extend unit tests.

### Session 015 — 2026-08-19 — CI green on Linux with real toolchains

- Goal: Get the Linux CI matrix green — and it earned its keep immediately.
- Completed:
  - CI bugs caught by the first two runs and fixed: (1) `node --test` glob expansion differs between Windows and Linux — unit test files are now enumerated explicitly; (2) tool-availability probes were double-flagged (`go version --version` exits 2) — probes now run verbatim
  - Final state: node 18 + 24 jobs pass; adoption matrix runs all five cells with REAL python/go/rust toolchains (zero SKIPs); `make check` on Linux passes — the Makefile surface is finally proven executed
  - Rust matrix fixture gained src/main.rs (cargo needs a crate target)
- Verification run: GitHub Actions runs 32303977456 (fail → fix), 32304763162 (pass, go/rust SKIP → fix), 32306019047 (pass, all cells real) — plus local `npm run check` before each push
- Files or artifacts updated: scripts/framework-check.mjs, scripts/stack-detect.mjs, scripts/adoption-matrix.mjs, .github/workflows/ci.yml, templates/ci.yml, .harness/manifest.json, docs (USAGE ×2, ARCHITECTURE)
- Known risk or unresolved issue: GitHub Actions deprecation notice (checkout/setup-* actions on Node 20 will migrate to Node 24) — informational; go.sum cache warning is harmless (no go.sum in this repo).
- Next best step: publish prep (npm), dogfood adoption into a real project, or extend unit tests.

### Session 016 — 2026-08-19 — README/AGENTS drift fix + enforcement

- Goal: Close the documentation drift found in review — the README command table omitted 6 targets, AGENTS mirrors were stale, and nothing caught it.
- Completed:
  - README updated: 6 missing target rows (verify-all, create-harness, harness-upgrade, harness-audit, report, sweep), skills/matrix/distribution/multi-repo bullets, STANDARDS.md link
  - AGENTS.md mirrors list completed
  - New lint check (ensureCommandSurfaces): every make target must appear in the README Command Targets table (when present) and in AGENTS.md — drift now fails the gate
  - templates/README.md gained the full Command Targets table so adopters inherit both the docs and the check
- Verification run: `npm run check` (PASS), `npm run check-arch` (5/5), lint shows the new PASS line
- Files or artifacts updated: README.md, AGENTS.md, templates/README.md, scripts/framework-check.mjs
- Known risk or unresolved issue: none.
- Next best step: publish prep (npm), dogfood adoption into a real project, or extend unit tests.

### Session 017 — 2026-08-19 — npm publish prep

- Goal: Make the framework publishable so `npx create-harness` / `npx harness-upgrade` / `npx harness-audit` distribution works end-to-end.
- Completed:
  - package.json: scoped name `@maideps/ai-harness-framework`, version 0.4.0, MIT license, repository URL, `publishConfig.access: public`, `engines.node >=18`, `bin` entries for the three distribution tools, `files` whitelist (CORE surfaces + docs + templates + skills + LICENSE; framework-only state such as `tests/` and `feature_list.json` intentionally excluded), `prepublishOnly: npm run check && npm run check-arch`
  - Removed `private: true`; regenerated package-lock.json (top-level name/version now match)
  - `npm pack --dry-run` verified: 65 files, 57.7 kB tarball, all manifest CORE surfaces present except `tests/` (copyCore skips non-existent surfaces — Layer 2 SKIPs honestly in adopters)
  - Confirmed no stale unscoped-name references in repo docs/scripts (manifest `harness` identity intentionally stays unscoped)
- Verification run: `npm run check` (all layers PASS), `npm run check-arch` (5/5), `npm pack --dry-run` listing reviewed
- Files or artifacts updated: package.json, package-lock.json
- Known risk or unresolved issue: actual `npm publish` NOT run — requires explicit user go-ahead and npm credentials; CI does not yet cover the prepublish hook itself.
- Next best step: publish to npm on user confirmation; then dogfood `npx create-harness` into a real project.

### Session 018 — 2026-08-19 — GitHub CI publish path

- Goal: Publish via GitHub Actions instead of a local `npm login` (the local machine lacks npm credentials).
- Completed:
  - New `.github/workflows/publish.yml`: triggers on `v*` tags or manual `workflow_dispatch`; runs `npm ci`, full verification (`check` + `check-arch` explicitly, and again via the `prepublishOnly` hook at publish time), verifies the tag matches the package.json version, then `npm publish` using `secrets.NPM_TOKEN`
  - Manifest: `.github/workflows/publish.yml` declared product-owned via `productRoots` (not INSTANCE — the adoption matrix caught that INSTANCE surfaces must exist in every adopter repo, and this file ships nowhere); ARCHITECTURE.md notes the productRoots file-level pattern
- Verification run: pending — workflow files cannot be verified locally; `npm run check` and `npm run check-arch` must pass before commit, and the first Actions run is the real proof.
- Files or artifacts updated: .github/workflows/publish.yml, .harness/manifest.json, docs/ARCHITECTURE.md
- Known risk or unresolved issue: requires the `NPM_TOKEN` repo secret (never committed — passed via `env`); the npm account must have publish rights on the `maideps` scope; first Actions execution is unverified until triggered.
- Next best step: user adds the secret and confirms org membership, then triggers the workflow (Actions tab → publish → Run workflow, or push a `v0.4.0` tag).

### Session 020 — 2026-08-26 — npm scope rename: maideps → maidelinps

- Goal: `maideps` was unavailable as an npm organization name; the user created `maidelinps` instead, so the package scope needs to match before publish can work.
- Completed:
  - package.json: `name` changed to `@maidelinps/ai-harness-framework`; package-lock.json regenerated via `npm install` so its name fields match
  - Updated forward-looking operational docs that named the org: claude-progress.md (current-state mirror), session-handoff.md (recommended next step)
  - Left sessions 017/018's dated log entries above as-written — they're historical record of what was true at the time, not live documentation
  - GitHub repository URL (`github.com/maideps/ai-harness-framework`) and the manifest's unscoped `harness` identity are unaffected — the npm scope is independent of the GitHub org name
- Verification run: `npm run check-arch` (PASS, unaffected — package.json/package-lock.json are CORE surfaces, not manifest-tracked content)
- Files or artifacts updated: package.json, package-lock.json, claude-progress.md, session-handoff.md
- Known risk or unresolved issue: actual `npm publish` still not run — still requires the `NPM_TOKEN` secret and confirmed `@maidelinps` org membership.
- Next best step: user adds the `NPM_TOKEN` secret scoped to the `maidelinps` org, then triggers the publish workflow.

### Session 019 — 2026-08-26 — Fix CI failure in check (24)

- Goal: Fix failing Actions job `check (24)` (run `32999015031`, job `98275603667`).
- Completed:
  - Pulled workflow run list and job logs from GitHub Actions MCP.
  - Root cause: `npm run check-arch` failed because tracked root docs were not classified by `.harness/manifest.json`.
  - First failing file from CI logs: `IMPROVEMENT-HANDOFF.md`; after fixing locally, `repo-completion-plan.md` surfaced as another unclassified tracked file.
  - Final fix: classify both files as product-owned (`productRoots`) so they remain repo-only and do not become adopter-required instance surfaces.
- Verification run: `npm run check-arch` (PASS) and `npm run check` (PASS, including adoption matrix/e2e).
- Files or artifacts updated: `.harness/manifest.json`
- Known risk or unresolved issue: none.
- Next best step: rerun CI on the branch/PR to confirm `check (24)` is green remotely.

### Session 021 — 2026-09-09 — Multi-agent parallelism: planning only (feat-010/011, D-017)

- Goal: User asked how to run multiple agents against this framework in parallel. Analyzed the runner for concurrency-safety, found five collision points (WIP=1 global, feature_list.json whole-file evidence write, clean-state-check global git-status requirement, session-trace latest-start pairing, single-writer markdown files), and evaluated worktree isolation vs. a lock/lease layer. Recorded the design and added it to the backlog — no implementation this session.
- Completed:
  - D-016 ("multi-agent means agent-agnostic, not concurrent coordination") marked superseded by D-017, per its own stated reversal contract
  - D-017 recorded: concurrent coordination via git worktree lanes (branch-checkout exclusivity replaces a lock file) plus sharded per-feature state (`.harness/state/<id>.json`) replacing the single-file feature_list.json read-modify-write; a lock/lease design was drafted and rejected as redundant with what worktrees already guarantee
  - feat-010 (Worktree Lanes) and feat-011 (Sharded Feature State) added to feature_list.json as `planned`, dependent on feat-009 and feat-010 respectively, with verification layers defined
- Verification run: `npm run check-arch` (5/5 PASS, arch-002 accepts the two new `planned` features with no WIP violation)
- Files or artifacts updated: feature_list.json, DECISIONS.md, PROGRESS.md
- Known risk or unresolved issue: feat-010/011 are design-only — the `lane-new`/`lane-list`/`lane-land`/`lane-drop` tooling, the git-branch-aware arch-002 rescoping, and the `.harness/state/` shard read/write path do not exist yet. `.harness/state/` will need manifest classification (core, likely) and an arch-005 pass once feat-011 starts.
- Next best step: activate feat-010 (Worktree Lanes) as the next WIP=1 feature when ready to implement.

### Session 022 — 2026-09-09 — feat-010 Worktree Lanes

- Goal: Implement the design recorded in D-017 — git-worktree-based parallel lanes with git branch-checkout exclusivity as the coordination primitive, no lock/lease layer.
- Completed:
  - `scripts/framework-check.mjs` gained the lane subsystem: `laneNew`/`laneList`/`laneLand`/`laneDrop`, plus helpers (`gitCapture`, `getCurrentBranch` via `git symbolic-ref --short HEAD` — robust on an unborn branch with zero commits, unlike `rev-parse --abbrev-ref HEAD`; `laneFeatureIdFromBranch`, `branchExists`, `findWorktreeForBranch`). All git calls use `spawnSync` argv arrays (no shell), consistent with the Windows-path-safety pattern from D-010.
  - `lane-new F=<id>`: creates a sibling worktree (`../<repo>-lane-<id>`) on branch `lane/<id>` (new from current HEAD, or reused), refuses if the feature is `passing`/`blocked`/has unmet dependencies, marks it `active` in the lane's own `feature_list.json` (uncommitted); idempotent on a second call.
  - `lane-list`: enumerates local `lane/*` branches with feature/state/worktree path, reading the worktree's live file when one exists, else the branch's committed content via `git show`.
  - `lane-land F=<id>`: refuses unless the lane branch's committed feature is `passing` and the landing branch is clean; merges `--no-ff`, removes the worktree, deletes the branch.
  - `lane-drop F=<id>`: removes a lane's worktree without merging; relies on `git worktree remove`'s built-in refusal on uncommitted/untracked changes (no `--force`) so abandoning a lane never silently discards work — verified this refusal empirically before writing the automated test.
  - `ensureLaneWipContract()` (arch-002, wired into both `arch:wip-contract` and Layer 2 `test`): on a `lane/<feature-id>` branch, the sole active feature (if any) must equal `<feature-id>`; no-ops entirely off a lane branch (existing WIP=1 behavior unchanged, confirmed by test).
  - Command surface: Makefile + npm mirrors for all four lane commands, added to `requiredMakeTargets`, documented in README.md, templates/README.md, AGENTS.md's mirror list, `docs/ARCHITECTURE.md` (full "Worktree Lanes" section) and `templates/docs/ARCHITECTURE.md` (concise version), `docs/USAGE.md` and `templates/docs/USAGE.md` (kept byte-identical, per existing repo convention).
  - `.harness/arch-rules.json` arch-002 description/what/why/fix updated to cover lane ownership.
  - 15 new unit tests in `tests/framework-check.test.mjs` exercising real git worktrees in throwaway repos (lane-new/list/land/drop lifecycle including refusal paths, plus the three lane-aware WIP cases) — 38/38 runner tests pass.
- No manifest changes needed: everything lives inside already-CORE-classified files (scripts/, Makefile, package.json); no new tracked directories.
- Verification run: `npm run check` (all layers PASS, e2e matrix green including SKIPped toolchains reported honestly) + `npm run check-arch` (5/5 PASS) + `npm run verify-feature -- feat-010` (ALL LAYERS PASS, evidence recorded)
- Evidence captured: feat-010 `evidence` field
- Files or artifacts updated: scripts/framework-check.mjs, Makefile, package.json, .harness/arch-rules.json, README.md, templates/README.md, AGENTS.md, docs/ARCHITECTURE.md, templates/docs/ARCHITECTURE.md, docs/USAGE.md, templates/docs/USAGE.md, tests/framework-check.test.mjs, feature_list.json, PROGRESS.md
- Known risk or unresolved issue: `feature_list.json` is still one shared file — two lanes landing different features can still conflict on adjacent edits or simultaneous end-of-array insertions (documented in ARCHITECTURE.md and USAGE.md as the known gap feat-011 closes). Lane commands were smoke-tested manually on Windows in addition to the automated suite; not yet exercised on Linux CI.
- Next best step: feat-011 (Sharded Feature State) — move mutable fields into `.harness/state/<id>.json` so lane landings stop touching the shared file at all.
