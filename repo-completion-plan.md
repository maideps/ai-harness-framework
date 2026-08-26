# Repo Completion Plan

Goal: bring the main repository into full alignment with the `base\learn-harness-engineering` standard and move the bootstrap feature to a verified passing state.

## 1. Align harness artifacts with base

- Add root `CLAUDE.md`
- Decide whether `progress.md` stays or is replaced by `claude-progress.md`
- Update `AGENTS.md`, `init.sh`, scripts, and docs to reference one consistent set of state files
- Ensure there are no conflicting workflow instructions

## 2. Normalize `feature_list.json` to the base schema

- Convert entries to the base shape:
  - `id`
  - `priority`
  - `area`
  - `title`
  - `user_visible_behavior`
  - `status`
  - `verification`
  - `evidence`
  - `notes`
- Replace `planned` / `active` with:
  - `not_started`
  - `in_progress`
  - `blocked`
  - `passing`
- Enforce WIP=1 so only one feature is `in_progress`

## 3. Replace placeholder docs with real project content

- Fill in `docs\PRODUCT.md` with actual purpose, users, flows, and non-goals
- Fill in `docs\quality-document.md` with real quality ratings and risks
- Tighten `README.md` so commands and workflow reflect the actual repo state

## 4. Make architecture enforcement real

- Replace placeholder/manual rules in `.harness\arch-rules.json`
- Update `scripts\check-arch.sh` so `make check-arch` performs meaningful checks
- Record related design decisions in `DECISIONS.md`

## 5. Make the harness workflow executable end to end

- Verify `init.sh`
- Verify `make check`
- Verify `make verify-feature`
- Verify `make clean-check`
- Verify `make session-start` and `make session-end`
- Ensure traces, evidence recording, and feature gating work together
- Populate handoff and progress artifacts with real state

## 6. Close bootstrap cleanly, then activate the next feature

- Run the full verification path
- Record verification evidence in the feature tracker and progress log
- Move bootstrap to `passing` only through the documented gate
- Activate the next feature only after bootstrap is truly complete

## Recommended execution order

1. Align artifacts and naming
2. Normalize feature tracking
3. Replace placeholder docs
4. Implement real architecture checks
5. Verify the full harness workflow
6. Close feat-001 and advance
