#!/bin/bash
# Registers the project's MCP servers (.mcp.json, placed by the mcp component) with Codex,
# which reads its servers from ~/.codex/config.toml instead of the project. Claude Code
# reads .mcp.json and Gemini CLI reads .gemini/settings.json on their own. Only servers
# started by a command are registered; env entries are not passed. Safe to rerun.
set -euo pipefail

[ -f .mcp.json ] || exit 0
if ! command -v codex >/dev/null 2>&1; then
  echo "register-mcp: codex is not installed; skipping"
  exit 0
fi

node -e '
const servers = JSON.parse(require("fs").readFileSync(".mcp.json", "utf8")).mcpServers ?? {};
for (const [name, server] of Object.entries(servers)) {
  if (server.command) console.log([name, server.command, ...(server.args ?? [])].join("\t"));
}' | while IFS=$'\t' read -r -a server; do
  codex mcp add "${server[0]}" -- "${server[@]:1}" || echo "register-mcp: could not register ${server[0]} with codex"
done
