# Quality Document

Rate each module on a scale of A (excellent) / B (good) / C (acceptable) / D (needs work) / F (failing).

## Modules

| Module | Test Coverage | Type Safety | Documentation | Arch Compliance | Performance |
|---|---|---|---|---|---|
| scripts/framework-check.mjs | A | C | A | A | A |
| scripts/harness-docs.mjs | A | C | A | A | A |
| scripts/stack-detect.mjs | B | C | A | A | A |
| scripts/harness-upgrade.mjs | A | — | A | A | A |
| scripts/create-harness.mjs | A | — | A | A | A |
| scripts/harness-audit.mjs | A | — | A | A | A |
| .harness/manifest.json + arch-rules.json | B | B | B | A | A |
| templates/ (adopter skeletons) | — | — | A | A | — |
| Makefile | B | — | A | A | A |
| package.json | B | — | A | A | — |
| init.sh + scripts/*.sh (shims) | B | — | A | B | A |
| docs/ + state files | — | — | A | B | — |

## Summary

- **Overall Quality Grade:** B
- **Blockers:** none
- **Areas requiring attention:** make is not installed on the primary dev machine (the npm path is the workaround and now the canonical surface).

## Notes

- The runner (`scripts/framework-check.mjs`) has black-box unit coverage for manifest validation, including the default product ownership of unlisted `docs/` files and precedence for explicit docs classifications, feature-state rules, architecture checks, lifecycle commands, and the generated progress dashboard/archive.
- State files were converted from templates to real records on 2026-08-17 (dogfooding).
- 2026-10-14: adopter CI and `.nvmrc` now follow adopter project configuration; the framework matrix is skipped in adopter CI, with scaffold and upgrade coverage added (D-023).
- Tri-state verification semantics (PASS/SKIP/FAIL) are now the documented contract (D-001).
- 2026-08-18: bash suite consolidated into the Node runner; the four `scripts/*.sh` files are now thin shims (D-006). Stack detection centralized in `scripts/stack-detect.mjs`; Makefile and npm scripts are 1:1 mirrors. Session-trace round-trip (start → merge end) verified on Windows.
- 2026-08-18 (session 004): manifest classifies every tracked file (schema v2, arch-005); 7 adopter doc skeletons added under templates/; instance content stripped from reusable docs (D-007). Python verify chain is argv-based and the compileall exclusion matches both path separators — verified empirically on Windows. verify-feature now enforces the dependency gate.
- 2026-08-18 (session 005): reusability verification pass — CORE surfaces scanned for instance content (2 leaks fixed), DECISIONS.md skeleton added, missing-doc lint now fails cleanly, decision counting fixed (template block no longer counted). npm/make parity verified programmatically (15/15).
- 2026-08-18 (session 008): skills component shipped (D-008) — six skills under skills/, validated by the lint layer (frontmatter name/description, When to Use); format adopted from the lidr-specboot reference harness.
- 2026-08-18 (session 009): portability extensions (D-009) — codex.md/GEMINI.md shims, docs/STANDARDS.md home for coding standards, commit/review/update-docs skills (9 total).
- 2026-08-19 (session 010): assurance suite (D-010) — adoption matrix + upgrade test make the e2e layer real (5 cells PASS, toolchains missing here SKIP honestly); runner unit tests (6) run in Layer 2; product-first stack detection.
- 2026-08-19 (session 011): multi-repo extension (D-011) — opt-in templates/multi-repo skeletons aggregated by verify-all; optional markers override directory-level CORE claims; matrix gained a multi-repo test with negative cases.
- 2026-08-19 (session 012): distribution (D-012) — create-harness/harness-upgrade/harness-audit tools read the manifest; the adoption matrix dogfoods them (one adoption implementation); bin entries ready for npx distribution.
- 2026-08-19 (session 013): sweep and report (D-013) — session digest aggregation and periodic sweep with manifest drift reporting; unit tests for the aggregator. The reusability roadmap is complete (feat-001..007 + 008, 009 all passing).
- 2026-08-19 (session 017): npm publish prep — package.json is publish-ready (`@maideps/ai-harness-framework` 0.4.0, files whitelist, bin entries, prepublishOnly gate); lockfile regenerated; `npm pack --dry-run` verified 65 files. Actual publish awaits explicit user go-ahead.
- 2026-10-14 (session 028): multi-repo verification now supports ESM and CommonJS scripts, runs as an optional check layer, and clean-state scans use manifest `productRoots`; unit and adoption coverage added.
- 2026-10-14: `verify-feature` evidence now includes the Git commit, dirty flag, and each layer's PASS result and reported-SKIP marker; regression-tested in `tests/framework-check.test.mjs`.
- 2026-10-17: per-layer logs with the command and duration in the evidence; failing layers show their output; LF writes on every OS; lifecycle commands refresh the dashboard; a Windows CI job; the path test fixed for Windows (D-025, feat-018).
- 2026-10-14 (session 029): feature lifecycle commands — `add-feature` accepts declaration options and optional manifest ID validation; `activate` guards WIP=1, dependencies, and lane ownership before writing state.
- 2026-10-14 (session 030): adopter CI now uses the project-owned Node version pin and runs project setup, checks, and architecture validation; root `LICENSE` is copied once and preserved through upgrades.
- 2026-10-14 (session 031): generated command reference — Makefile targets and npm scripts produce `docs/HARNESS.md`; lint checks for drift and a README link; adoption creates the generated page.
- 2026-10-14 (session 033): initialization skips empty Node installs and selects lock-preserving package-manager commands; a manifest-backed `.gitattributes` template establishes consistent line endings and survives upgrades.
- 2026-10-14 (session 034): current master merged with the lockfile and line-ending changes intact; conflict resolution verified by the full 87-test check and architecture rules.
- 2026-10-19 (session 041, feat-021, D-028): `lane-suggest` added — read-only detection of dependency-graph-independent `planned` features, for an agent to propose and a human to approve before any `lane-new`/session/`lane-land` runs; `parallel-lanes` skill codifies the loop. No state-changing behavior added; 6 new unit tests; full check (112 tests, e2e matrix) and verify-feature gate both PASS.
- 2026-10-26 (session 044, D-031, GitHub #23/#24/#25/#26): `.harness/trails/.gitkeep` ships on create and backfills on upgrade; the placeholder check diffs docs against their manifest-declared template source instead of dead bracket-text matching, with an `init.sh`-only warn mode; the multi-repo optional component is opt-in (`--with multi-repo`) with a reserved exit code so `verify-all` reports SKIP honestly instead of a silent pass; `harness-audit` gained `missingSelfChecks` (first-ever test coverage for that script) and docs now document chaining a layer script with the harness's own check. 14 new unit tests (133 total); full check and the standalone e2e matrix (stack cells, upgrade test, multi-repo test, existing-repo test) all PASS.
- 2026-11-05 (session 056, feat-029, D-040): adopters no longer run the harness self-tests on every check — `test` skips the runner unit tests and `e2e` reports SKIP outside the framework repository (manifest `frameworkRepository`), `verify-chain`/`./init.sh` runs them once per session through the new `selftest` mode, and the adoption matrix runs them once in an adopter layout. 10 new unit tests (175 total); a fresh adopter's `verify-feature` went from 215 s to 1.5 s and this repository's `npm run check` from 223 s to 66 s.
- 2026-11-05 (session 057, feat-030, D-041): `verify-feature` refuses uncommitted code outside harness bookkeeping and fails if a layer leaves files behind, so evidence names the commit that passed (`bound`); `--allow-dirty` records `bound: false`. Evidence stores `checksHash` of the declared layers; `typecheck` warns on stale evidence and the dependency gate refuses it. 9 new unit tests (9 of 10 fail against the old runner; the legacy-evidence test guards unchanged behavior).
- 2026-11-05 (session 058, feat-031, D-042): `create-harness` places `.claude/settings.json` from `templates/claude-settings.json` (deny rules for reading `.env` variants and home credential stores) instead of `{}`; `harness-upgrade` replaces an untouched `{}`. AGENTS.md and `docs/TOOLS.md` describe what is enforced and its limits, and how to get comparable protection in Codex and Gemini CLI. 4 new unit tests (2 fail against the old code; the 2 that pass guard adopter-owned files).
- 2026-11-05 (session 059, feat-032, D-043): `harness-upgrade` plans each framework-owned file as add/update/unchanged before writing, reports the lists, and `--dry-run` stops at the plan (no copies, no manifest rewrite, no backup). 3 new unit tests, all failing against the old script.
- 2026-11-05 (session 060, feat-033, D-044): agent-compliance evals in `evals/` (framework repository only): fixtures from `create-harness`, `claude -p` with scoped tools and the developer's settings excluded, deterministic outcome graders, five tasks (two comply, three hold back), pass^k and flip reporting. 12 grader tests with no model, run in CI with `--fixtures-only`; no real trial has run yet.
- 2026-11-06 (session 063, feat-034, D-045): `verify-feature` writes the trail on every bound pass; `clean-check` fails until `docs/quality-document.md` names every gate-verified feature. Prompted by the first eval suite (quality document updated in 1/5 passing comply trials, vcr trail in 0/5). 3 new runner tests, 2 new eval tests; the eval `command` grader copies hidden files only when asked.

---

_Update this document at session close for modules touched in the session._
