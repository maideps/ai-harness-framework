# Tools and MCP

## Configured MCP Tools

Document your MCP server integrations here. Each entry should include:

- Server name and purpose
- Available tools with brief descriptions
- Permissions (allow / ask / deny)
- Configuration location

### Default MCP Configuration

MCP servers are configured via:

- `.mcp.json` (project-scoped servers for Claude Code) and `.gemini/settings.json` (Gemini CLI), placed by `create-harness --with mcp`; see the MCP Servers section of `docs/USAGE.md`
- IDE MCP configuration (environment-specific)

## Agent Permissions

### What the harness ships

`create-harness` places `.claude/settings.json` (feat-031). It only **denies Claude Code reads** of files that usually hold secrets:

- in the project, at any depth: `.env`, `.env.local`, `.env.*.local`, `.env.development`, `.env.production`, `.env.staging`, `.env.test`. `.env.example` and `.env.sample` stay readable, since agents need them to learn the configuration.
- in your home directory: `~/.ssh/`, `~/.aws/`, `~/.azure/`, `~/.config/gcloud/`, `~/.kube/`, `~/.gnupg/`, `~/.docker/config.json`, `~/.git-credentials`, `~/.netrc`, `~/.npmrc`, `~/.pypirc`.

Everything else stays at Claude Code's defaults: it asks before editing files or running commands. Deny rules apply as soon as the project opens, before the folder is trusted, and they also stop `cat`, `head`, `tail`, `sed` and shell redirections from reading those paths.

**Limits.** These rules are not a security boundary. A script, test or build step that Claude runs can still open the files, and so can a command that finds files without naming them (`grep -r`). For an OS-enforced boundary, enable the sandbox (below) or run the agent in the dev container (`create-harness --with devcontainer`).

The file is yours: add rules for your own secret locations (for example `"Read(./config/credentials.yml)"`). `harness-upgrade` never changes it, except to replace an untouched `{}` written by an older harness. Path forms: `~/` is your home directory, `//` is an absolute path, `./` or a bare name is relative to the project. Personal rules belong in `.claude/settings.local.json`, which is not committed.

### Sensitive actions

Don't add `allow` rules to the shared `.claude/settings.json` for writes outside the project, network access, package installs, or `git push`: they apply to every teammate. Approve those per session, or allow them in your own `.claude/settings.local.json`. Deny rules always win over allow rules from any settings file.

### Opt in: Claude Code's sandbox

Claude Code can run shell commands in an OS sandbox (Seatbelt on macOS; bubblewrap on Linux and WSL2, which needs `bubblewrap` and `socat` installed). Writes are limited to the project and network access to the domains you allow. Native Windows has no sandbox: commands there run unsandboxed. The harness doesn't turn it on for you, because one committed setting would apply to every teammate's platform. To opt in, add to `.claude/settings.json`:

```json
"sandbox": {
  "enabled": true,
  "network": { "allowedDomains": ["registry.npmjs.org"] }
}
```

Sandboxed commands are approved automatically. Check the current keys in the [Claude Code sandboxing docs](https://code.claude.com/docs/en/sandboxing).

### Codex

The harness ships no Codex permission file. Codex reads a project `.codex/config.toml` only after you trust the project. `sandbox_mode = "workspace-write"` with `approval_policy = "on-request"` limits writes to the workspace and keeps network access off unless `[sandbox_workspace_write] network_access = true`. Codex has no documented rule to block reading a specific file, so keep secrets out of the workspace (use your OS keychain or a secrets manager, not a `.env` file in the repository). Reference: the [Codex configuration docs](https://developers.openai.com/codex/config-basic).

### Gemini CLI

The harness ships no Gemini permission rules (`create-harness --with mcp` places `.gemini/settings.json` for MCP servers only). Project `.gemini/settings.json` supports `tools.exclude` and `tools.core` (an allowlist of built-in tools) and sandbox settings; check the [Gemini CLI configuration reference](https://geminicli.com/docs/reference/configuration) for the version you run. As with Codex, keep secrets out of the workspace.

## Skills

Reusable capability packs are documented in `skills/` (one `SKILL.md` per skill folder). Load the relevant skill when its "When to Use" conditions match; add project skills with the format described in the `write-skill` skill.

## Git Integration

- Commit messages must follow the project convention: concise, descriptive, explaining WHY
- One logical change per commit
- Pre-commit verification via `make check` (or `npm run check`) is mandatory

## References

- [AGENTS.md](../AGENTS.md) — Full agent operating manual
- [MCP Documentation](https://modelcontextprotocol.io/) — Official MCP docs
