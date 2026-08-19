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

After touching any module, update `docs/quality-document.md` with ratings (A/B/C/D) per dimension: test coverage, type safety, documentation, architecture compliance, performance.

## Verification Trail

`make vcr` / `npm run vcr` records a verification trail to `.harness/trails/` after check and check-arch pass. A plain `make check` does not write trails — only a successful VCR run does.

Record evidence in `feature_list.json` under each feature's `evidence` field.

## Session Report

```bash
make report        # or: npm run report [-- --days N] [-- --json]
```

Aggregates `.harness/traces/` into a session digest: per-session start/end, duration, open/closed state, active feature, decisions recorded, files modified, and feature evidence — plus totals for the window (default: last 7 days).

## Periodic Sweep

```bash
make sweep         # or: npm run sweep [-- --older-than N]
```

The sweep (default threshold: 30 days) archives old session traces to `.harness/traces/archive/`, prunes orphaned `.tmp` files from interrupted merges and stale open session records, and reports structural drift against the manifest (report-only). It never touches instance state — feature list, docs, and decisions are never modified by a sweep.
