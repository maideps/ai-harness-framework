#!/bin/bash
# Runs once when the dev container is created (devcontainer.json postCreateCommand).
# Installs the agent CLIs the harness ships instructions for (CLAUDE.md, codex.md,
# GEMINI.md) and runs ./init.sh so the first session starts
# from a verified state. Safe to rerun by hand: bash .devcontainer/post-create.sh
set -euo pipefail

# Named volumes keep agent logins across rebuilds; Docker creates them owned by root.
for dir in "$HOME/.claude" "$HOME/.codex" "$HOME/.gemini"; do
  mkdir -p "$dir" 2>/dev/null || sudo mkdir -p "$dir"
  sudo chown -R "$(id -u):$(id -g)" "$dir"
done

# Claude Code comes from its devcontainer feature; Codex and Gemini CLI from npm.
npm install -g @openai/codex @google/gemini-cli

./init.sh || echo "post-create: ./init.sh reported problems — run it again once you have read its output."
