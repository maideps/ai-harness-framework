#!/usr/bin/env node
// Agent-compliance evals for Claude Code (feat-033, D-044). See evals/README.md.
//
//   node evals/run.mjs [--task <id>]... [--trials <n>] [--model <name>] [--max-turns <n>]
//                      [--max-budget-usd <x>] [--fresh-config] [--keep] [--fixtures-only]
//
// Each trial builds a fresh fixture, runs `claude -p` on the task prompt, and grades the final
// repository and the agent's tool calls. Trials cost model tokens; --fixtures-only builds the
// fixtures and calls no model.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runAgent } from "./lib/agent.mjs";
import { buildFixture } from "./lib/fixture.mjs";
import { GRADERS, gradeTrial, graderLabel, normalizeGraderSpec } from "./lib/graders.mjs";

const EVALS_DIR = path.dirname(fileURLToPath(import.meta.url));
const TASKS_DIR = path.join(EVALS_DIR, "tasks");
const RESULTS_DIR = path.join(EVALS_DIR, "results");

export function validateTask(task, fileName) {
  const problems = [];
  if (typeof task.id !== "string" || `${task.id}.json` !== fileName) problems.push(`id must match the file name (${fileName})`);
  if (typeof task.prompt !== "string" || !task.prompt.trim()) problems.push("prompt is required");
  if (!["comply", "hold-back"].includes(task.expect)) problems.push('expect must be "comply" or "hold-back"');
  for (const feature of task.setup?.features ?? []) {
    if (!/^feat-\d{3}$/.test(feature.id ?? "")) problems.push(`feature id ${feature.id} must look like feat-NNN`);
    if (!feature.name || !feature.behavior) problems.push(`${feature.id}: name and behavior are required`);
    if (feature.state && !["planned", "active", "passing"].includes(feature.state)) problems.push(`${feature.id}: state ${feature.state} is not planned, active or passing`);
  }
  if (!Array.isArray(task.graders) || task.graders.length === 0) problems.push("at least one grader is required");
  for (const spec of (task.graders ?? []).map(normalizeGraderSpec)) {
    if (!GRADERS[spec.id]) problems.push(`unknown grader ${spec.id}`);
    if (spec.id === "feature-state" && (!spec.feature || (spec.state === undefined) === (spec.not === undefined))) {
      problems.push("feature-state needs a feature and exactly one of state or not");
    }
    if (spec.id === "command" && !spec.cmd) problems.push("command needs cmd");
  }
  return problems;
}

export function loadTasks(dir = TASKS_DIR, ids = []) {
  const tasks = [];
  for (const name of readdirSync(dir).filter((file) => file.endsWith(".json")).sort()) {
    const task = JSON.parse(readFileSync(path.join(dir, name), "utf8"));
    const problems = validateTask(task, name);
    if (problems.length > 0) throw new Error(`evals/tasks/${name}: ${problems.join("; ")}`);
    const hidden = path.join(dir, `${task.id}.hidden`);
    if (existsSync(hidden)) task.hiddenDir = hidden;
    tasks.push(task);
  }
  if (ids.length === 0) return tasks;
  const unknown = ids.filter((id) => !tasks.some((task) => task.id === id));
  if (unknown.length > 0) throw new Error(`unknown task ${unknown.join(", ")}`);
  return tasks.filter((task) => ids.includes(task.id));
}

// Why the agent did not work on the task at all, or null when it did. A result event can
// report an error with subtype "success" (for example a failed login), so is_error counts too.
export function agentErrorOf(agent) {
  if (agent.error) {
    const hint = /ENOENT/.test(agent.error) ? " (Claude Code CLI not found: set CLAUDE_BIN to claude, or claude.exe on Windows)" : "";
    return `${agent.error}${hint}`;
  }
  if (!agent.result) return `no result event (exit ${agent.exit})`;
  if (agent.result.isError && agent.toolCalls.length === 0) return agent.result.text || `error result (${agent.result.subtype})`;
  return null;
}

// Errors no later trial can get past: a missing CLI or a failed login.
export function isFatalAgentError(message) {
  return /ENOENT|CLI not found|authenticat|log ?in|OAuth|API key|credential/i.test(message);
}

// pass^k (every trial passed) is the consistency measure; pass@k (any trial passed) shows the
// agent can do it at all. A grader "flips" when it passed in some trials and failed in others.
export function summarize(trials) {
  const byTask = new Map();
  for (const trial of trials) {
    if (!byTask.has(trial.task)) byTask.set(trial.task, []);
    byTask.get(trial.task).push(trial);
  }
  const tasks = [...byTask.entries()].map(([id, runs]) => {
    const passes = runs.filter((run) => run.pass).length;
    const labels = [...new Set(runs.flatMap((run) => run.grades.map((grade) => grade.label)))];
    const flips = labels.filter((label) => {
      const outcomes = new Set(runs.map((run) => run.grades.find((grade) => grade.label === label)?.pass));
      return outcomes.size > 1;
    });
    const costs = runs.map((run) => run.agent?.costUsd).filter((cost) => typeof cost === "number");
    return {
      id,
      expect: runs[0].expect,
      trials: runs.length,
      agentErrors: runs.filter((run) => run.agentError).length,
      passes,
      passAll: passes === runs.length,
      passAny: passes > 0,
      flips,
      failing: labels.filter((label) => runs.some((run) => run.grades.find((grade) => grade.label === label)?.pass === false)),
      costUsd: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
    };
  });
  const totalCost = tasks.map((task) => task.costUsd).filter((cost) => cost !== null);
  return {
    trials: trials.length,
    trialPassRate: trials.length ? trials.filter((trial) => trial.pass).length / trials.length : 0,
    tasksPassAll: tasks.filter((task) => task.passAll).length,
    tasks,
    costUsd: totalCost.length ? totalCost.reduce((a, b) => a + b, 0) : null,
  };
}

function parseArgs(argv) {
  const options = { tasks: [], trials: 3, maxTurns: 60, fixturesOnly: false, keep: false, freshConfig: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined || next.startsWith("--")) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === "--task") options.tasks.push(value());
    else if (arg === "--trials") options.trials = Number.parseInt(value(), 10);
    else if (arg === "--model") options.model = value();
    else if (arg === "--max-turns") options.maxTurns = Number.parseInt(value(), 10);
    else if (arg === "--max-budget-usd") options.maxBudgetUsd = Number.parseFloat(value());
    else if (arg === "--fixtures-only") options.fixturesOnly = true;
    else if (arg === "--keep") options.keep = true;
    else if (arg === "--fresh-config") options.freshConfig = true;
    else throw new Error(`unknown option ${arg}`);
  }
  if (!Number.isInteger(options.trials) || options.trials < 1) throw new Error("--trials must be a positive integer");
  if (options.fixturesOnly) options.keep = true; // the point is to look at them
  return options;
}

function printSummary(summary) {
  console.log("");
  console.log("=== Agent compliance evals ===");
  for (const task of summary.tasks) {
    const cost = task.costUsd === null ? "" : `  $${task.costUsd.toFixed(2)}`;
    const errors = task.agentErrors ? `, ${task.agentErrors} where the agent did not run` : "";
    const status = task.agentErrors === task.trials ? "[ERROR]" : task.passAll ? "[PASS]" : "[FAIL]";
    console.log(`  ${status} ${task.id} (${task.expect}): ${task.passes}/${task.trials} trials${errors}${cost}`);
    if (task.failing.length) console.log(`         failing graders: ${task.failing.join(", ")}`);
    if (task.flips.length) console.log(`         flipped between trials: ${task.flips.join(", ")}`);
  }
  console.log(`  pass^k: ${summary.tasksPassAll}/${summary.tasks.length} tasks passed every trial; trial pass rate ${(summary.trialPassRate * 100).toFixed(0)}%`);
  if (summary.costUsd !== null) console.log(`  estimated cost: $${summary.costUsd.toFixed(2)} (client-side estimate, not billing)`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const tasks = loadTasks(TASKS_DIR, options.tasks);
  const runDir = mkdtempSync(path.join(os.tmpdir(), "harness-eval-run-"));
  const trials = [];
  try {
    outer: for (const task of tasks) {
      for (let trial = 1; trial <= options.trials; trial += 1) {
        const trialDir = path.join(runDir, `${task.id}-${trial}`);
        mkdirSync(trialDir, { recursive: true });
        const { root, baseline } = buildFixture(task, { parent: trialDir });
        if (options.fixturesOnly) {
          console.log(`  built ${task.id} #${trial}: ${root}`);
          continue;
        }
        console.log(`--- ${task.id} #${trial} ---`);
        const agent = runAgent(root, task.prompt, options);
        const agentError = agentErrorOf(agent);
        if (agentError) {
          // The agent never worked on the task: grading the untouched fixture would report a
          // compliance failure that did not happen.
          console.log(`  [ERROR] agent did not run: ${agentError}`);
          if (agent.stderr) console.log(agent.stderr.split(/\r?\n/).slice(-5).map((line) => `    ${line}`).join("\n"));
          trials.push({ task: task.id, expect: task.expect, trial, pass: false, agentError, grades: [], agent: { ...agent.result, toolCalls: agent.toolCalls.length }, fixture: options.keep ? root : null });
          if (isFatalAgentError(agentError)) {
            console.log("  Stopping: every remaining trial would fail the same way.");
            break outer;
          }
          continue;
        }
        const grades = gradeTrial({ root, task, baseline, toolCalls: agent.toolCalls });
        const pass = grades.every((grade) => grade.pass);
        for (const grade of grades) console.log(`  ${grade.pass ? "[PASS]" : "[FAIL]"} ${grade.label}: ${grade.detail.split("\n")[0]}`);
        trials.push({
          task: task.id,
          expect: task.expect,
          trial,
          pass,
          grades,
          agent: { ...agent.result, toolCalls: agent.toolCalls.length, denials: agent.denials, error: agent.error },
          fixture: options.keep ? root : null,
        });
      }
    }
  } finally {
    if (!options.keep) rmSync(runDir, { recursive: true, force: true });
    else console.log(`Fixtures kept in ${runDir}`);
  }
  if (options.fixturesOnly) return;

  const summary = summarize(trials);
  printSummary(summary);
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(path.join(RESULTS_DIR, ".gitignore"), "*\n", "utf8"); // results stay local
  const file = path.join(RESULTS_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, `${JSON.stringify({ options: { ...options }, summary, trials }, null, 2)}\n`, "utf8");
  console.log(`  results: ${path.relative(process.cwd(), file)}`);
  // 2: the agent never ran in some trial (a setup problem, not a compliance result); 1: a task failed.
  process.exitCode = trials.some((trial) => trial.agentError) ? 2 : summary.tasksPassAll === summary.tasks.length ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`evals: ${err.message}`);
    process.exit(2);
  });
}

export { graderLabel };
