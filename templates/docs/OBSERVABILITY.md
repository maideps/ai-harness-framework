# Observability

## Sprint Contract

Before starting each feature, fill out a sprint contract (`templates/sprint-contract.md`) that declares:

- What you intend to build
- How you'll verify it's correct
- What success looks like
- How long you expect it to take

## Session Traces

```bash
make session-start    # or: npm run session-start
make session-end      # or: npm run session-end
```

Traces are stored in `.harness/traces/` as timestamped JSON records with:

- Session start/end times
- Active feature ID
- Verification metadata (active feature layers and recorded evidence)
- Files modified
- Decision summary (count and latest decision title)

## Evaluator Rubric

After completing a sprint, score it against `templates/evaluator-rubric.md`. Every dimension must reach B or above before the feature is considered complete.

## Quality Document

After a feature passes, name it in `docs/quality-document.md` and rate the modules it touched (A/B/C/D) per dimension: test coverage, type safety, documentation, architecture compliance, performance. `npm run clean-check` fails while any gate-verified feature is not mentioned.

## Verification Trail

`verify-feature` records a trail on every bound pass: `.harness/trails/<stamp>-verify-feature-<id>.json`, naming the feature, the commit and the `checksHash` of its layers. Commit it with the state shard. `make vcr` / `npm run vcr` records a full-run trail after check (architecture rules included) passes, for work no feature gate covers. A plain `make check` does not write trails.

Record evidence in that feature's `.harness/state/<id>.json` under its `evidence` field.

## Session Report

```bash
make report        # or: npm run report [-- --days N] [-- --json]
```

Aggregates `.harness/traces/` into a session digest: per-session start/end, duration, open/closed state, active feature, decisions recorded, files modified, and feature evidence — plus totals for the window (default: last 7 days).

The report ends with **Outcomes** for the same window, read from git history (feat-050): whether the verification layers keep bad changes out.

- **Pull requests merged, reverted and the revert rate.** A merge is a commit subject `Merge pull request #N …` or a squash subject ending `(#N)`; a PR counts as reverted when a later commit subject starting `Revert "` names `#N`. A rising revert rate means changes are getting past the gates that should have stopped them.
- **Commits and revert commits** in the window, for scale.
- **Rework:** each feature whose `.harness/state/<id>.json` went from `passing` to another state, with the date. A feature reopened after passing was declared done too early: look at what its layers missed and turn it into a check.

What it cannot see: subjects edited by hand (a squash subject without `(#N)`, a revert written without git's `Revert "…"` subject), fixes that undo a change without reverting it, and features that passed before state lived in `.harness/state/`. Outside a git repository the section says there is no outcome data.

## Periodic Sweep

```bash
make sweep         # or: npm run sweep [-- --older-than N]
```

The sweep (default threshold: 30 days) archives old session traces to `.harness/traces/archive/`, prunes orphaned `.tmp` files from interrupted merges and stale open session records, and reports structural drift against the manifest (report-only). It never touches instance state — feature list, docs, and decisions are never modified by a sweep.
