# Progress Log

Session continuity source of truth for this repository. Update at the end of each session with verified state, blockers, and next steps.

## Current Verified State

- Project root: this repository (ai-harness-framework)
- Primary startup command: `./init.sh`
- Primary verification command: `make check` (make-free equivalent: `npm run check` — both delegate to the Node runner)
- Current active feature: none (feat-001, feat-002, feat-003 passing)
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
