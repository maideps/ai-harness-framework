# Tools and MCP

## Configured MCP Tools

Document your MCP server integrations here. Each entry should include:

- Server name and purpose
- Available tools with brief descriptions
- Permissions (allow / ask / deny)
- Configuration location

### Default MCP Configuration

MCP servers are configured via:
- `.claude/settings.json` (Claude-specific)
- IDE MCP configuration (environment-specific)

### Sensitive Tool Policy

Default permission for sensitive tools is `ask`, not `allow`. Sensitive tools include:
- File system writes outside the project directory
- Network requests to external services
- Shell commands that modify system state
- Package installations

## Available Tools (Standard)

| Tool | Scope | Permission |
|---|---|---|
| `read_file` | Project files only | allow |
| `write_to_file` | Project files only | ask |
| `replace_in_file` | Project files only | ask |
| `execute_command` | Project paths, build tools | ask |
| `search_files` | Project directories | allow |
| `list_files` | Project directories | allow |

## Skills

Reusable capability packs are documented in `skills/` (one `SKILL.md` per skill folder). Load the relevant skill when its "When to Use" conditions match; add project skills with the format described in the `write-skill` skill.

## Git Integration

- Commit messages must follow the project convention: concise, descriptive, explaining WHY
- One logical change per commit
- Pre-commit verification via `make check` is mandatory

## References

- [AGENTS.md](../AGENTS.md) — Full agent operating manual
- [MCP Documentation](https://modelcontextprotocol.io/) — Official MCP docs