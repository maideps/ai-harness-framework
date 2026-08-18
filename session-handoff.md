# Session Handoff

## Current Objective

- Goal: Make the harness reusable by design — seam contract complete (every tracked file classified, arch-005 enforced), Node runner consolidation done, on the roadmap to the assurance suite (feat-004) and distribution (feat-006).
- Current status: feat-001, feat-002, feat-003 passing. Next up: feat-004 (Assurance Suite).
- Branch / commit: master (seam completeness + runner fixes commit)

## Completed This Session

- [x] Manifest classifies every tracked file (templates array, expanded instance, LICENSE/.nvmrc in core, productRoots exemption)
- [x] arch-005 rule: no unclassified tracked file
- [x] Instance content removed from reusable surfaces (README roadmap, ARCHITECTURE feat-001 line, OBSERVABILITY trail claim)
- [x] 7 new adopter skeletons: README, gitignore, docs/PRODUCT, ARCHITECTURE, OBSERVABILITY, TOOLS, decisions/index
- [x] B1: python verify chain argv-based; compileall exclusion regex matches both path separators (empirically verified on Windows)
- [x] B2: verify-feature refuses unmet dependencies (verified: feat-007 refused)
- [x] feat-002 and feat-003 re-verified with fresh evidence; D-007 recorded

## Verification Evidence

| Check | Command | Result | Notes |
|---|---|---|---|
| Full check | `npm run check` | PASS (e2e SKIP) | e2e still not configured |
| Architecture | `npm run check-arch` | PASS | 5 rules (arch-001..005) |
| Feature gate | `npm run verify-feature -- feat-002` / `feat-003` | PASS | evidence re-recorded |
| VCR trail | `npm run vcr` | recorded | .harness/trails/2026-08-18T18-07-26-858Z-vcr.json |
| Dep gate | `verify-feature feat-007` | refused, exit 1 | unmet dep feat-006 |
| Compileall | argv-based step on Windows | excl. works | venv/node_modules/dist excluded |

## Files Changed

- .harness/manifest.json (v0.3.0, schema v2), .harness/arch-rules.json (arch-005)
- scripts/framework-check.mjs (manifest coverage, dep gate, argv steps), scripts/stack-detect.mjs (PY_COMPILE_EXCLUDE)
- README.md, docs/ARCHITECTURE.md, docs/OBSERVABILITY.md, DECISIONS.md (D-007)
- templates/README.md, templates/gitignore, templates/docs/{PRODUCT,ARCHITECTURE,OBSERVABILITY,TOOLS}.md, templates/docs/decisions/index.md (new)
- feature_list.json (evidence), PROGRESS.md, claude-progress.md, docs/quality-document.md

## Decisions Made

- D-007: the seam manifest classifies every tracked file; productRoots exempts adopter product code; instance content stripped from reusable surfaces.

## Blockers / Risks

- None new. Adopters must list their product dirs in `productRoots` (documented). feat-004's matrix will exercise the adopter experience end-to-end.

## Next Session Startup

1. Read `AGENTS.md`.
2. Read `feature_list.json` and `PROGRESS.md`.
3. Review this handoff.
4. Run `./init.sh`, then `npm run check` before editing.

## Recommended Next Step

- Activate feat-004 (Assurance Suite): adoption e2e matrix (node/python/go/rust/no-runtime × single/multi-repo) + customization-survival upgrade test, making the e2e layer report PASS instead of SKIP.
