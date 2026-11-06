// Runs Claude Code headlessly in a fixture and returns its tool calls and result (feat-033).
// Flags follow the Claude Code CLI reference (code.claude.com/docs/en/cli-reference):
//   -p --output-format stream-json --verbose   one JSON event per line, ending with `result`
//   --permission-mode dontAsk + --allowedTools  no prompts: anything not allowed is denied and
//   + --disallowedTools                         the denial goes back to the model
//   --setting-sources project,local             the developer's user settings and hooks stay out
//   --strict-mcp-config --mcp-config <empty>    no MCP servers from the developer's config
//   --no-session-persistence                    eval runs never land in session history
// The fixture's own CLAUDE.md (a shim pointing at AGENTS.md) and .claude/settings.json load as
// they would for a real adopter: that is what is being evaluated.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// What the harness loop writes or runs. Read-only shell commands (ls, cat, head, grep, cd inside
// the project, read-only git) need no rule: Claude Code allows them in every mode, and checks
// each part of a compound command (`cd x && cat y`) on its own. The first real trial (session
// 061) was denied every shell call: a rule list without `cd`, and Windows' PowerShell tool,
// which no Bash rule covers. The PowerShell tool is turned off (runAgent), so the agent uses
// Bash on every platform. npm scripts and node still run arbitrary code: run evals in the dev
// container (or another sandbox) when that matters.
export const ALLOWED_TOOLS = [
  "Read",
  "Edit",
  "Write",
  "Glob",
  "Grep",
  "TodoWrite",
  "Bash(cd *)",
  "Bash(mkdir *)",
  "Bash(npm run *)",
  "Bash(npm test)",
  "Bash(npm test *)",
  "Bash(node *)",
  "Bash(make *)",
  "Bash(./init.sh)",
  "Bash(./init.sh *)",
  "Bash(bash init.sh)",
  "Bash(bash ./init.sh)",
  "Bash(git add *)",
  "Bash(git commit *)",
  "Bash(git status)",
  "Bash(git status *)",
  "Bash(git log *)",
  "Bash(git diff *)",
  "Bash(git show *)",
  "Bash(git rev-parse *)",
];

// Network tools, and the commands that would reach outside the throwaway fixture. These are
// signals, not a boundary: deny rules on shell commands can be worked around.
export const DISALLOWED_TOOLS = ["WebFetch", "WebSearch", "Bash(git push *)", "Bash(curl *)", "Bash(wget *)"];

export function claudeArgs(prompt, { model, maxTurns, maxBudgetUsd, mcpConfig }) {
  const args = [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "dontAsk",
    "--allowedTools",
    ALLOWED_TOOLS.join(","),
    "--disallowedTools",
    DISALLOWED_TOOLS.join(","),
    "--setting-sources",
    "project,local",
    "--strict-mcp-config",
    "--mcp-config",
    mcpConfig,
    "--no-session-persistence",
    "--max-turns",
    String(maxTurns),
  ];
  if (model) args.push("--model", model);
  if (maxBudgetUsd) args.push("--max-budget-usd", String(maxBudgetUsd));
  return args;
}

// stream-json: one event per line. Tool calls are tool_use blocks in assistant messages; the
// last event is the result (cost, turns, duration, subtype). Unparseable lines are kept as text.
export function parseStream(text) {
  const toolCalls = [];
  const denials = [];
  let result = null;
  let unparsed = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      unparsed += 1;
      continue;
    }
    if (event.type === "assistant") {
      for (const block of event.message?.content ?? []) {
        if (block?.type === "tool_use") toolCalls.push({ name: block.name, input: block.input ?? {} });
      }
    } else if (event.type === "result") {
      result = {
        subtype: event.subtype,
        isError: Boolean(event.is_error),
        costUsd: typeof event.total_cost_usd === "number" ? event.total_cost_usd : null,
        turns: event.num_turns ?? null,
        durationMs: event.duration_ms ?? null,
        text: typeof event.result === "string" ? event.result : null,
      };
      for (const denial of event.permission_denials ?? []) {
        denials.push({ name: denial.tool_name, input: denial.tool_input ?? {} });
      }
    }
  }
  return { toolCalls, denials, result, unparsed };
}

/**
 * Run the agent in `root`. `bin` is the Claude Code CLI (CLAUDE_BIN or `claude` on PATH).
 * `freshConfig` points CLAUDE_CONFIG_DIR at an empty folder, which also keeps the developer's
 * ~/.claude/CLAUDE.md out; it needs ANTHROPIC_API_KEY, since stored logins live in that folder.
 */
export function runAgent(root, prompt, { bin = process.env.CLAUDE_BIN || "claude", model, maxTurns = 60, maxBudgetUsd, freshConfig = false, timeoutMs = 30 * 60 * 1000 } = {}) {
  const scratch = mkdtempSync(path.join(os.tmpdir(), "harness-eval-agent-"));
  const mcpConfig = path.join(scratch, "mcp.json");
  writeFileSync(mcpConfig, '{"mcpServers":{}}\n', "utf8");
  // PowerShell tool off: the same shell, and the same allow rules, on every platform.
  const env = { ...process.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", CLAUDE_CODE_USE_POWERSHELL_TOOL: "0", CW_INIT_SH: "" };
  delete env.NODE_TEST_CONTEXT; // would make every `node --test` the agent runs skip its files
  if (freshConfig) env.CLAUDE_CONFIG_DIR = path.join(scratch, "config");
  const started = Date.now();
  try {
    const run = spawnSync(bin, claudeArgs(prompt, { model, maxTurns, maxBudgetUsd, mcpConfig }), {
      cwd: root,
      env,
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
      timeout: timeoutMs,
      // No shell: cmd.exe would re-split the prompt and the parenthesised tool rules. On Windows
      // point CLAUDE_BIN at claude.exe (an npm .cmd shim cannot be spawned without a shell).
    });
    const parsed = parseStream(run.stdout ?? "");
    return {
      ...parsed,
      exit: run.error ? null : run.status,
      error: run.error ? run.error.message : null,
      stderr: (run.stderr ?? "").slice(-4000),
      wallMs: Date.now() - started,
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
