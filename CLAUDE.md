# CLAUDE.md

Claude compatibility shim for this reusable harness framework.

## Purpose

This file exists for repositories and tools that expect a root CLAUDE.md.
The canonical workflow contract remains in AGENTS.md.

## Startup

1. Read AGENTS.md.
2. Read feature_list.json.
3. Read PROGRESS.md (or claude-progress.md compatibility alias).
4. Run ./init.sh.

## State Files

- feature_list.json
- PROGRESS.md (canonical)
- claude-progress.md (compatibility alias)
- DECISIONS.md
- session-handoff.md

## Verification

Use make check (or equivalent) before claiming completion.
