# [Project Name]

[One paragraph: what this project does and who it serves. Replace this section with your project's description.]

## Quick Start

```bash
# 1. Verify the environment is healthy
./init.sh

# 2. Run full verification (make and npm forms are 1:1 mirrors)
make check          # or: npm run check

# 3. See all available commands
make help           # or: npm run help
```

### Prerequisites

- **Node.js** ≥ 18 — the harness runtime (stack detection, verification layers, session traces)
- **Make** — optional; `npm run <target>` mirrors every make target

## Verification Layers

| Layer | Command | What It Checks |
|-------|---------|----------------|
| 1 | `make lint` / `npm run lint` | Static analysis |
| 1b | `make typecheck` / `npm run typecheck` | Type safety |
| 2 | `make test` / `npm run test` | Unit and integration tests |
| 3 | `make build` / `npm run build` | Build verification |
| 3b | `make e2e` / `npm run e2e` | End-to-end tests |

Layers that are not configured report **SKIP** and do not count as verified.

### Command Targets

Every make target is mirrored 1:1 by an npm script:

| Purpose | Make form | npm form |
|---|---|---|
| Install dependencies | `make setup` | `npm run setup` |
| Dev server | `make dev` | `npm run dev` |
| Full verification | `make check` | `npm run check` |
| Layer 1: static analysis | `make lint` | `npm run lint` |
| Layer 1b: type checking | `make typecheck` | `npm run typecheck` |
| Layer 2: runtime tests | `make test` | `npm run test` |
| Layer 3: build verification | `make build` | `npm run build` |
| Layer 3b: end-to-end tests | `make e2e` | `npm run e2e` |
| Architecture enforcement | `make check-arch` | `npm run check-arch` |
| Feature verification | `make verify-feature F=<id>` | `npm run verify-feature -- <id>` |
| Multi-repo verification | `make verify-all` | `npm run verify-all` |
| Verify + record trail | `make vcr` | `npm run vcr` |
| Record session start | `make session-start` | `npm run session-start` |
| Record session end | `make session-end` | `npm run session-end` |
| Pre-commit clean state | `make clean-check` | `npm run clean-check` |
| Generate an adopter repo | `make create-harness D=<dir>` | `npm run create-harness -- <dir>` |
| Apply a harness upgrade | `make harness-upgrade D=<dir>` | `npm run harness-upgrade -- <dir>` |
| Local harness audit | `make harness-audit D=<dir>` | `npm run harness-audit -- <dir>` |
| Session report | `make report` | `npm run report` |
| Periodic sweep | `make sweep` | `npm run sweep` |
| Show all targets | `make help` | `npm run help` |

## State Files

- `feature_list.json` — feature state tracker with dependencies and verification criteria
- `PROGRESS.md` — session continuity log
- `DECISIONS.md` — architectural decisions log
- `session-handoff.md` — multi-session handoff notes

## Documentation

- [Product Overview](docs/PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Observability](docs/OBSERVABILITY.md)
- [Tools & MCP](docs/TOOLS.md)
- [Usage Guide](docs/USAGE.md)
- [Quality Document](docs/quality-document.md)

## License

[Declare your project's license here and link the license file.]
