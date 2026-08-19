# Claude Progress

Compatibility alias for systems expecting `claude-progress.md`.

The canonical source of truth is [PROGRESS.md](PROGRESS.md). Read and update that file; keep this one in sync only if your workflow depends on the `claude-progress.md` naming convention.

Current state (mirror of PROGRESS.md):

- Active feature: none — the full roadmap is passing: feat-001 through feat-007 plus feat-008 and feat-009
- Primary verification: `make check` (make-free: `npm run check`) — both delegate to the Node runner; e2e layer runs the adoption matrix
- Distribution: package is publish-ready as `@maideps/ai-harness-framework` 0.4.0 (bin: create-harness, harness-upgrade, harness-audit; prepublishOnly runs check + check-arch). Actual publish awaits explicit user go-ahead.
- Blocker: none
