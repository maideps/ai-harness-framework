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

### D-001: Harness-First Bootstrap Order

**Date:** 2026-08-05
**Status:** accepted
**Context:** The repository needs both harness infrastructure (AGENTS.md, feature_list.json, scripts) and application code. The order of creation matters for verification and WIP=1 compliance.
**Decision:** Create the harness infrastructure first as feat-001, then scaffold the application as feat-002. No application code is written until the harness verification path is confirmed.
**Alternatives considered:**
- Simultaneous harness + project creation — Rejected because it violates WIP=1 and makes it impossible to verify each layer independently
- Project-first, harness later — Rejected because it creates unverifiable state; the harness is needed to guide agent behavior from the start
**Consequences:**
- Positive: Clean separation of concerns, verifiable bootstrap, clear handoff between harness setup and project setup
- Negative: Initial `init.sh` and `make check` must handle the "no application yet" state gracefully

### D-002: Bash-Based Verification Scripts

**Date:** 2026-08-05
**Status:** accepted
**Context:** The base framework prescribes bash-based verification scripts (init.sh, verify-feature.sh, check-arch.sh, session-trace.sh, clean-state-check.sh). The project needs to run on Windows where native bash is not available.
**Decision:** Use bash scripts compatible with Git Bash (included with Git for Windows). Document the requirement in the README. The scripts use portable POSIX constructs and avoid bashisms that don't work in Git Bash.
**Alternatives considered:**
- PowerShell scripts (.ps1) — Rejected because they're not portable to Linux/macOS and the base framework tools are all bash
- Node.js scripts — Rejected because Node.js may not be available at bootstrap time; adds runtime dependency
- Python scripts — Rejected because Python may not be available; adds runtime dependency
**Consequences:**
- Positive: Portable across all platforms with Git Bash, consistent with base framework, zero runtime dependencies beyond bash
- Negative: Windows users must use Git Bash or WSL to run scripts; may need to document this in README

### D-003: Make as Task Runner

**Date:** 2026-08-05
**Status:** accepted
**Context:** The base framework heavily uses `make` targets (check, lint, test, build, e2e, check-arch, vcr, verify-feature, session-start, session-end, clean-check). The project needs a task runner that works cross-platform and supports the prescribed target names.
**Decision:** Use GNU Make via a Makefile. On Windows, Make is available through Git Bash, Chocolatey (`make`), or as `mingw32-make`. Document the requirement.
**Alternatives considered:**
- npm scripts (`package.json` scripts) — Rejected because there's no `package.json` at bootstrap; `make` is runtime-agnostic
- just (justfile) — Rejected because it's less universal than Make; adds a tool dependency
- Task (Taskfile.yml) — Rejected because it's less universal than Make
**Consequences:**
- Positive: Universal task names (`make check`, `make test`) work consistently, no runtime dependency on Node/Python/etc., matches base framework conventions exactly
- Negative: Windows users need to install Make or use the one bundled with Git Bash (mingw32-make)