#!/usr/bin/env node

// harness-report — weekly session report aggregation (feat-007).
// Reads merged session traces from .harness/traces/ and produces a per-session
// summary plus an aggregate view. Traces are runtime records: the durable story
// lives in PROGRESS.md — this report turns the raw records into a digest.
//
//   node scripts/harness-report.mjs [--days N] [--json]

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TRACES_DIR = ".harness/traces";

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
}

function main() {
  const args = process.argv.slice(2);
  const daysIndex = args.indexOf("--days");
  const days = daysIndex !== -1 && args[daysIndex + 1] ? Number(args[daysIndex + 1]) : 7;
  const asJson = args.includes("--json");
  const report = aggregate(TRACES_DIR, Number.isFinite(days) ? days : 7);
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    render(report);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
