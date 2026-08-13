# Evaluator Rubric

Score each completed sprint against these dimensions. Every dimension must reach B or above.

---

## Dimensions

### Correctness (Does it work?)
**Target:** B+

| Grade | Criteria |
|---|---|
| A | All verification layers pass on first attempt. No regressions. Edge cases covered. |
| B | All verification layers pass. Minor fixes needed but no architectural changes. |
| C | Most verification passes. Some tests fail or lint issues remain. |
| D | Verification fails in multiple layers. Significant rework needed. |
| F | Feature doesn't function as specified. |

### Completeness (Is it done?)
**Target:** B+

| Grade | Criteria |
|---|---|
| A | Definition of Done fully satisfied. All artifacts updated. No downstream gaps. |
| B | DoD satisfied. Minor documentation or quality-document gaps. |
| C | Core behavior implemented but some DoD items missing. |
| D | Feature is partially implemented. Blockers remain. |
| F | Feature is incomplete or untestable. |

### Cleanliness (Is it maintainable?)
**Target:** B+

| Grade | Criteria |
|---|---|
| A | Code is idiomatic, well-documented, follows all conventions. No duplication. |
| B | Code is clean and follows conventions. Minor style nits. |
| C | Code works but has duplication, poor naming, or missing comments. |
| D | Code is messy, inconsistent, or has obvious technical debt. |
| F | Code is unreadable or introduces anti-patterns. |

### Continuity (Can the next session pick up?)
**Target:** B+

| Grade | Criteria |
|---|---|
| A | PROGRESS.md, feature_list.json, and DECISIONS.md are fully updated. Handoff is clear. `./init.sh` runs clean. |
| B | State files are updated. One minor gap in documentation. |
| C | State files exist but are incomplete or outdated. |
| D | State files are stale. Next session would be confused. |
| F | No state updates. Repository is in an indeterminate state. |

---

## Sprint Scorecard

| Sprint | Feature | Correctness | Completeness | Cleanliness | Continuity | Overall |
|---|---|---|---|---|---|---|
| [date] | [feat-id] | [A-F] | [A-F] | [A-F] | [A-F] | [A-F] |

## Notes

[Add sprint-specific evaluation notes here.]