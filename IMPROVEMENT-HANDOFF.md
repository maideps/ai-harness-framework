# Handoff: ai-harness-framework improvement pass

Context for a fresh Claude Code session with no memory of prior conversation. This picks up a review + improvement pass done from a remote session that had file access to this repo but no working shell (`device_bash` reported "Workspace unavailable" the whole session) — so Tier 1 below is prepared but largely unapplied. Claude Code running locally has real shell access and should be able to finish it directly.

## Goal

Work through the prioritized improvement plan for this repo, starting with Tier 1 (quick fixes), then Tier 2–4 as time allows. Full plan and rationale: see `harness-improvement-proposal.md` (delivered separately to Maide; ask her for it if it's not already in this repo, or regenerate from the summary below — nothing in it depends on external context).

Two framing corrections already established during the review, so they don't get re-litigated:
- The framework's multi-agent property is **agnosticism** (any single agent — Claude, Codex, Gemini — can drive a session through the shared `AGENTS.md` contract), not concurrent/coordinating multi-agent execution. That's intentional and already well-built; don't "fix" it toward parallelism unless Maide asks for that as new scope.
- The reusability contract (`create-harness`'s never-overwrite `skipExisting` logic, `harness-upgrade`'s CORE-vs-adopter-owned split, `productRoots`) is real and already supports both from-scratch bootstrapping and incorporation into an existing project. Don't rebuild this — extend/harden it (see Tier 3 item 8).

## Tier 1 — status as of handoff

1. **`.nvmrc` vs `package.json engines` mismatch — ALREADY RESOLVED, no action needed.** Checked directly: `.nvmrc` = `18`, `engines.node` = `>=18`. These agree. (An earlier pass of this review had flagged a mismatch against Node 24 — that appears to have been stale/incorrect; disregard it.)

2. **Stray `nul` file at repo root — NOT YET DELETED, blocked on missing shell access.** `PROGRESS.md` session 001 claims it was removed; it's still physically present (303 bytes, gitignored via `.gitignore` lines 7-9 but not actually deleted from disk). Confirmed via grep across `scripts/*.mjs`, `scripts/*.sh`, and `init.sh` that nothing currently regenerates it (no `> nul` redirect found) — it's a one-off leftover, safe to just delete once. On Windows, `nul` is a reserved device name, so a plain `del`/Explorer delete often fails; use:
   ```powershell
   Remove-Item -LiteralPath "\\?\<repo-root>\nul" -Force
   ```
   (the `\\?\` prefix bypasses reserved-name handling). Verify with `git status` that nothing tracked references it afterward.

3. **`.claude/settings.json` clarifying note — drafted but NOT YET APPLIED, blocked by a remote-write restriction (should not apply to local Claude Code).** This file currently holds a Cline/Roo-Code-shaped config (`auto_approve`, `read_file`, `execute_command`, etc.) — not Claude Code's actual schema (`permissions: {allow/ask/deny}`). Established during review: this is *not* a distribution bug — `scripts/create-harness.mjs`'s `createRuntimeSurfaces()` writes new adopters a clean empty `{}`; this file is only this maintainer's own local INSTANCE dev config, likely for whichever tool actually drives day-to-day development. Two options, pick with Maide:
   - **(a) Minimal, matches what was drafted:** add a `_note` field at the top of the existing JSON explaining it's local-only and unrelated to the shipped agent-adapter contract, so a future reader doesn't mistake it for a real integration point. Exact content to use:
     ```json
     {
       "_note": "Local development tool config only (Cline/Roo-Code schema) — not part of the harness's shipped agent-adapter contract. New adopters get an empty {} via create-harness; this file only affects this maintainer's own working copy.",
       "token_usage_warning_threshold": 0.8,
       "auto_approve": {
         "read_file": true,
         "search_files": true,
         "list_files": true,
         "list_code_definition_names": true,
         "execute_command": "ask",
         "write_to_file": "ask",
         "replace_in_file": "ask",
         "generate_explanation": false,
         "use_mcp_tool": "ask",
         "access_mcp_resource": "ask",
         "ask_followup_question": false,
         "attempt_completion": false,
         "load_mcp_documentation": false
       },
       "allowed_tools": [
         "execute_command", "read_file", "search_files", "list_files",
         "list_code_definition_names", "write_to_file", "replace_in_file",
         "generate_explanation", "use_mcp_tool", "access_mcp_resource",
         "ask_followup_question", "attempt_completion", "load_mcp_documentation"
       ],
       "context_management": {
         "max_file_size_lines": 2000,
         "aggregate_on_open": true
       }
     }
     ```
   - **(b) Ask Maide which tool she actually drives local dev with** and rewrite this file to that tool's real schema instead of just annotating the mismatch. If it actually is Claude Code day-to-day, this should become real `permissions`-schema content, not a Cline schema with a disclaimer.
   Confirm with Maide which she wants before writing.

## Tier 2 — process fixes (not started)

- Write a `DECISIONS.md` entry (next available ID, currently D-014) explaining why `feature_list.json`'s shipped schema (`name`/`behavior`/`state`) diverges from what `base/learn-harness-engineering/repo-completion-plan.md` directed (`priority`/`area`/`title`/`user_visible_behavior`).
- Move `repo-completion-plan.md` out of `base/learn-harness-engineering/` (a vendored reference clone) to the project root or `docs/` — it's Maide's own planning doc, not third-party bibliography.
- Add a `DECISIONS.md` entry explaining why `.harness/` shipped narrower (`manifest.json`, `arch-rules.json`, `traces/`, `trails/` only) than the bibliography's model (`instructions/`, `workflows/`, `policies/`, `evals/`).
- Add a `DECISIONS.md` entry stating explicitly: this framework is agent-agnostic (interchangeable single-agent sessions), concurrent multi-agent coordination is out of scope for v1. See framing note above — this is about naming the boundary, not changing behavior.

## Tier 3 — structural (not started)

- Add an e2e adoption-matrix cell (`scripts/adoption-matrix.mjs`) that pre-seeds a throwaway target repo with existing, realistic files (a real `README.md`, a `package.json` with real deps, a `src/` tree) *before* running `create-harness`, then asserts those files are byte-identical afterward. This is the most direct test of the "incorporate into an existing project" path and doesn't appear to be covered today — the existing matrix generates fresh empty repos via `mkdtempSync`.
- Consider splitting `AGENTS.md` (currently 8.4KB, full contract inline) into a short router plus `.harness/instructions/workflow.md` for the fuller prose — pairs with the `.harness/` scope decision above.
- Add direct `node:test` unit coverage for `scripts/framework-check.mjs` (39.5KB, currently untested directly — only exercised indirectly via self-hosted `check`/`check-arch` runs). Start with `ensureManifest`, the WIP=1 gate in `verify-feature`, and `check-arch`'s rule evaluation. Already flagged as P1 in the repo's own `docs/quality-document.md`.

## Tier 4 — release readiness (not started)

- `npm publish` has not run. Needs an `NPM_TOKEN` GitHub secret and confirmed npm org membership for `@maideps`. `feature_list.json`/`session-handoff.md` currently read as "complete" but the package isn't actually published yet.

## Suggested first steps in this session

1. Confirm shell access works (`git status`, `npm run check`) — if it does, this environment can do everything the remote session couldn't.
2. Close out the two pending Tier 1 items (delete `nul`, decide + apply the `.claude/settings.json` fix).
3. Run `npm run check-arch` to confirm nothing broke.
4. Ask Maide whether to proceed into Tier 2, or stop here and let her review.
