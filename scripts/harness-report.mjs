#!/usr/bin/env node

// harness-report — weekly session report aggregation (feat-007).
// Reads merged session traces from .harness/traces/ and produces a per-session
// summary plus an aggregate view. Traces are runtime records: the durable story
// lives in PROGRESS.md — this report turns the raw records into a digest.
//
//   node scripts/harness-report.mjs [--days N] [--json]

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TRACES_DIR = ".harness/traces";

// ---- Outcomes (feat-050, D-059) --------------------------------------------
// Whether the verification layers keep bad changes out, read from git history: how many
// merged pull requests were later reverted, and which features went from passing back to
// another state (rework). The window is the report's own --days.

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return result.error || (result.status ?? 1) !== 0 ? null : result.stdout;
}

// The PR a commit subject merged: "Merge pull request #12 from …" (merge commits) or a
// squash subject ending "(#12)". null for anything else.
export function mergedPullRequest(subject) {
  const match = /^Merge pull request #(\d+)\b/.exec(subject) ?? /\(#(\d+)\)\s*$/.exec(subject);
  return match ? Number(match[1]) : null;
}

// The PRs a revert commit names: 'Revert "Merge pull request #12 …"' or 'Revert "feat: x (#12)"'.
export function revertedPullRequests(subject) {
  if (!/^Revert "/.test(subject)) return [];
  return [...subject.matchAll(/#(\d+)/g)].map((match) => Number(match[1]));
}

// Passing → anything else, per feature, by replaying each state shard's history oldest first.
function reworkEvents(cwd) {
  const log = git(cwd, ["log", "--reverse", "--format=%x00%H%x09%cI", "-p", "--unified=0", "--", ".harness/state/"]);
  if (log === null) return [];
  const lastState = new Map();
  const events = [];
  for (const block of log.split("\0").filter(Boolean)) {
    const [header, ...lines] = block.split(/\r?\n/);
    const date = header.split("\t")[1];
    let feature = null;
    for (const line of lines) {
      const file = /^\+\+\+ b\/\.harness\/state\/(.+)\.json$/.exec(line);
      if (file) feature = file[1];
      const state = /^\+\s*"state":\s*"([^"]+)"/.exec(line);
      if (!feature || !state) continue;
      if (lastState.get(feature) === "passing" && state[1] !== "passing") events.push({ feature, date, to: state[1] });
      lastState.set(feature, state[1]);
    }
  }
  return events;
}

export function outcomes(cwd = ".", days = 7) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const log = git(cwd, ["log", `--since=${since.toISOString()}`, "--format=%H%x09%s"]);
  if (log === null) return { available: false };
  const subjects = log.split(/\r?\n/).filter(Boolean).map((line) => line.slice(line.indexOf("\t") + 1));
  const merged = [...new Set(subjects.map(mergedPullRequest).filter((number) => number !== null))].sort((a, b) => a - b);
  const reverts = subjects.filter((subject) => /^Revert "/.test(subject));
  const revertedSet = new Set(reverts.flatMap(revertedPullRequests));
  const reverted = merged.filter((number) => revertedSet.has(number));
  const rework = reworkEvents(cwd).filter((event) => new Date(event.date) >= since);
  return {
    available: true,
    pull_requests_merged: merged.length,
    pull_requests_reverted: reverted,
    revert_rate_percent: merged.length === 0 ? null : Math.round((reverted.length / merged.length) * 1000) / 10,
    commits: subjects.length,
    revert_commits: reverts.length,
    rework,
  };
}

export function readTraceFiles(tracesDir) {
  if (!existsSync(tracesDir)) return [];
  return readdirSync(tracesDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => {
      try {
        const record = JSON.parse(readFileSync(path.join(tracesDir, entry.name), "utf8"));
        return { file: entry.name, record };
      } catch {
        return { file: entry.name, record: null, unreadable: true };
      }
    });
}

export function aggregate(tracesDir, days = 7) {
  const windowStart = Date.now() - days * 24 * 60 * 60 * 1000;
  const sessions = [];
  for (const { file, record, unreadable } of readTraceFiles(tracesDir)) {
    if (unreadable || !record) continue;
    const activity = record.session_start ?? record.session_end ?? "";
    if (!activity) continue;
    if (new Date(activity).getTime() < windowStart) continue;
    sessions.push({
      file,
      start: record.session_start ?? "",
      end: record.session_end ?? "",
      open: !record.session_end,
      git_branch: record.git_branch ?? "",
      git_commit: record.git_commit ?? "",
      active_feature: record.active_feature ?? "",
      end_active_feature: record.end_active_feature ?? "",
      decisions: (record.decisions_recorded ?? {}).count ?? 0,
      latest_decision: (record.decisions_recorded ?? {}).latest ?? "",
      files_modified: (record.files_modified ?? []).length,
      feature_evidence: (record.verification_results ?? {}).feature_evidence ?? "",
    });
  }
  sessions.sort((a, b) => (a.start ?? a.end).localeCompare(b.start ?? b.end));
  const openSessions = sessions.filter((session) => session.open).length;
  const decisions = sessions.reduce((sum, session) => sum + session.decisions, 0);
  const files = new Set();
  for (const session of sessions) files.add(session.active_feature).add(session.end_active_feature);
  files.delete("");
  return {
    window_days: days,
    sessions,
    totals: {
      sessions: sessions.length,
      open_sessions: openSessions,
      decisions_recorded: decisions,
      active_features: Array.from(files),
    },
  };
}

function render(report) {
  const { sessions, totals, window_days } = report;
  console.log(`=== Session Report (last ${window_days} days) ===`);
  console.log(`  sessions: ${totals.sessions}  open: ${totals.open_sessions}  decisions recorded: ${totals.decisions_recorded}`);
  if (totals.active_features.length > 0) {
    console.log(`  features seen: ${totals.active_features.join(", ")}`);
  }
  console.log("");
  for (const session of sessions) {
    const when = session.end || session.start || "unknown";
    const state = session.open ? "OPEN" : "closed";
    const duration = session.start && session.end
      ? Math.round((new Date(session.end).getTime() - new Date(session.start).getTime()) / 60000)
      : null;
    console.log(`- ${when} [${state}]${duration !== null ? ` (${duration}m)` : ""}`);
    console.log(`  feature: ${session.end_active_feature || session.active_feature || "—"}  decisions: ${session.decisions}  files: ${session.files_modified}`);
    if (session.feature_evidence) {
      console.log(`  evidence: ${session.feature_evidence.slice(0, 90)}${session.feature_evidence.length > 90 ? "…" : ""}`);
    }
  }
  if (sessions.length === 0) {
    console.log("No session records in the window. Start a session with `npm run session-start`.");
  }
  renderOutcomes(report.outcomes, window_days);
}

function renderOutcomes(result, days) {
  console.log("");
  console.log(`=== Outcomes (last ${days} days) ===`);
  if (!result?.available) {
    console.log("  Not a git repository — no outcome data.");
    return;
  }
  const rate = result.revert_rate_percent === null ? "n/a" : `${result.revert_rate_percent}%`;
  const which = result.pull_requests_reverted.length > 0 ? ` (#${result.pull_requests_reverted.join(", #")})` : "";
  console.log(`  pull requests merged: ${result.pull_requests_merged}  reverted: ${result.pull_requests_reverted.length}${which}  revert rate: ${rate}`);
  console.log(`  commits: ${result.commits}  revert commits: ${result.revert_commits}`);
  if (result.rework.length === 0) {
    console.log("  rework: none — no feature went from passing back to another state");
  } else {
    console.log(`  rework: ${result.rework.length} feature(s) reopened after passing`);
    for (const event of result.rework) console.log(`    ${event.feature} → ${event.to} on ${event.date.slice(0, 10)}`);
  }
}

function main() {
  const args = process.argv.slice(2);
  const daysIndex = args.indexOf("--days");
  const days = daysIndex !== -1 && args[daysIndex + 1] ? Number(args[daysIndex + 1]) : 7;
  const asJson = args.includes("--json");
  const windowDays = Number.isFinite(days) ? days : 7;
  const report = { ...aggregate(TRACES_DIR, windowDays), outcomes: outcomes(".", windowDays) };
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    render(report);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
