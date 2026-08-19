# Claude Progress

Compatibility alias for systems expecting `claude-progress.md`.

The canonical source of truth is [PROGRESS.md](PROGRESS.md). Read and update that file; keep this one in sync only if your workflow depends on the `claude-progress.md` naming convention.

Current state (mirror of PROGRESS.md):

- Active feature: none — feat-001 through feat-006 plus feat-008 and feat-009 passing
- Primary verification: `make check` (make-free: `npm run check`) — both delegate to the Node runner; e2e layer runs the adoption matrix
- Blocker: none
