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

// ---- Skill usage (feat-059, D-069) -------------------------------------------
// Each session note lists the skills loaded in that session ("- Skills used: a, b" or "none").
// A skill nobody opens for a month has a description that does not match how tasks arrive, or
// is not needed: rewrite or remove it. Notes written before the section existed are skipped.

const SKILLS_USED_PREFIX = "- Skills used:";
const NOTE_FILE = /^(\d{3,})-(\d{4}-\d{2}-\d{2})\.md$/;
export const DEFAULT_SKILL_DAYS = 30;

// null when the note has no Skills used line; [] for a blank value or "none".
export function skillsUsedIn(text) {
  const line = text.split(/\r?\n/).find((entry) => entry.startsWith(SKILLS_USED_PREFIX));
  if (line === undefined) return null;
  const value = line.slice(SKILLS_USED_PREFIX.length).trim();
  if (!value || /^none\.?$/i.test(value)) return [];
  return value
    .replace(/\.$/, "")
    .split(",")
    .map((name) => name.trim().replace(/^`|`$/g, ""))
    .filter(Boolean);
}

export function skillNames(cwd = ".") {
  const dir = path.join(cwd, "skills");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(dir, entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort();
}

function localToday() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function daysBefore(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export function skillUsage(cwd = ".", days = DEFAULT_SKILL_DAYS, today = localToday()) {
  const usage = new Map(skillNames(cwd).map((name) => [name, { name, sessions: 0, last: null }]));
  const progressDir = path.join(cwd, "progress");
  let withSection = 0;
  let withoutSection = 0;
  const notes = existsSync(progressDir) ? readdirSync(progressDir).filter((file) => NOTE_FILE.test(file)).sort() : [];
  for (const file of notes) {
    const used = skillsUsedIn(readFileSync(path.join(progressDir, file), "utf8"));
    if (used === null) {
      withoutSection += 1;
      continue;
    }
    withSection += 1;
    const date = NOTE_FILE.exec(file)[2];
    for (const name of new Set(used)) {
      const entry = usage.get(name);
      if (!entry) continue; // no longer a skill; lint reports it
      entry.sessions += 1;
      if (!entry.last || date > entry.last) entry.last = date;
    }
  }
  const cutoff = daysBefore(today, days);
  const skills = [...usage.values()];
  return {
    days,
    today,
    notes_with_section: withSection,
    notes_without_section: withoutSection,
    skills,
    unused: skills.filter((entry) => !entry.last || entry.last < cutoff).map((entry) => entry.name),
  };
}

export function renderSkillUsage(result) {
  console.log("");
  console.log(`=== Skill usage (session notes with a Skills used section: ${result.notes_with_section}; older notes without it, skipped: ${result.notes_without_section}) ===`);
  const width = Math.max(5, ...result.skills.map((entry) => entry.name.length));
  for (const entry of result.skills) {
    console.log(`  ${entry.name.padEnd(width)}  sessions: ${String(entry.sessions).padStart(3)}  last: ${entry.last ?? "-"}`);
  }
  if (result.skills.length === 0) console.log("  No skills under skills/.");
  if (result.unused.length > 0) {
    console.log(`  Not used in the last ${result.days} days — rewrite the description (say when the skill is needed and how the task is usually phrased) or remove the skill: ${result.unused.join(", ")}`);
  } else if (result.skills.length > 0) {
    console.log(`  Every skill was used in the last ${result.days} days.`);
  }
}

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

function skillUsageMain(args) {
  let days = DEFAULT_SKILL_DAYS;
  const asJson = args.includes("--json");
  const rest = args.filter((arg) => arg !== "--json");
  if (rest.length > 0) {
    const value = rest[0] === "--days" ? Number(rest[1]) : NaN;
    if (rest.length !== 2 || !Number.isInteger(value) || value < 1) {
      console.error("FAIL: usage: npm run skill-usage [-- --days <positive integer>] [--json]");
      process.exit(1);
    }
    days = value;
  }
  const result = skillUsage(".", days);
  if (asJson) console.log(JSON.stringify(result, null, 2));
  else renderSkillUsage(result);
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === "skill-usage") {
    skillUsageMain(args.slice(1));
    return;
  }
  const daysIndex = args.indexOf("--days");
  const days = daysIndex !== -1 && args[daysIndex + 1] ? Number(args[daysIndex + 1]) : 7;
  const asJson = args.includes("--json");
  const windowDays = Number.isFinite(days) ? days : 7;
  // Skill usage keeps its own 30-day window: a weekly report would flag every skill a quiet
  // week did not need.
  const report = { ...aggregate(TRACES_DIR, windowDays), outcomes: outcomes(".", windowDays), skill_usage: skillUsage(".") };
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    render(report);
    renderSkillUsage(report.skill_usage);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
