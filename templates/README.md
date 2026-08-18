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
- [Quality Document](docs/quality-document.md)

## License

[Declare your project's license here and link the license file.]
