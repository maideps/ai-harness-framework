# codex.md

GitHub Copilot / Codex compatibility shim for this reusable harness framework.

## Purpose

This file exists for repositories and tools that expect a root codex.md.
The canonical workflow contract remains in AGENTS.md.

## Startup

1. Read AGENTS.md.
2. Read docs/STANDARDS.md.
3. Read feature_list.json.
4. Read PROGRESS.md.
5. Run ./init.sh.

## State Files

- feature_list.json (declarations only; mutable state lives in .harness/state/<id>.json)
- PROGRESS.md (canonical)
- DECISIONS.md
- session-handoff.md

## Verification

Use make check (or npm run check) before claiming completion.
