#!/usr/bin/env node

// harness-sweep — periodic structural cleanup (feat-007).
//
//   1. Archive old traces: session records whose last activity is older than
//      --older-than days move to .harness/traces/archive/.
//   2. Prune orphans: leftover *.tmp files from interrupted atomic merges,
//      and stale open session records (no session_end) past the threshold.
//   3. Report structural drift against the manifest (report-only — never
//      mutates): runs the runner's manifest mode and prints its verdict.
//
// Never touches instance state (feature list, docs, decisions); it only
// organizes runtime trace artifacts and reports.
//
//   node scripts/harness-sweep.mjs [--older-than N]   (default 30 days)

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TRACES_DIR = ".harness/traces";
const ARCHIVE_DIR = path.join(TRACES_DIR, "archive");

export function sweep(tracesDir = TRACES_DIR, olderThanDays = 30) {
  const threshold = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  const report = { archived: [], pruned: [] };

  if (!existsSync(tracesDir)) {
    return { ...report, noTraces: true };
  }

  const entries = readdirSync(tracesDir, { withFileTypes: true }).filter((entry) => entry.isFile());

  for (const entry of entries) {
    const full = path.join(tracesDir, entry.name);

    // Orphaned temp files from interrupted atomic merges
    if (entry.name.endsWith(".tmp")) {
      rmSync(full, { force: true });
      report.pruned.push(entry.name);
      continue;
    }
    if (!entry.name.endsWith(".json")) continue;

    let activity = 0;
    let openRecord = false;
    try {
      const record = JSON.parse(readFileSync(full, "utf8"));
      const stamp = record.session_end ?? record.session_start;
      if (stamp) activity = new Date(stamp).getTime();
      openRecord = Boolean(record.session_start) && !record.session_end;
    } catch {
      continue; // unreadable record — leave it for a human
    }

    if (activity > 0 && activity < threshold) {
      mkdirSync(ARCHIVE_DIR, { recursive: true });
      renameSync(full, path.join(ARCHIVE_DIR, entry.name));
      report.archived.push(entry.name);
    } else if (openRecord && activity > 0 && activity < threshold) {
      mkdirSync(ARCHIVE_DIR, { recursive: true });
      renameSync(full, path.join(ARCHIVE_DIR, entry.name));
      report.archived.push(entry.name);
    }
  }
  return report;
}

function driftReport() {
  const runner = path.join("scripts", "framework-check.mjs");
  if (!existsSync(runner)) {
    return { exit: 1, output: "scripts/framework-check.mjs is missing — not a harness-enabled repository" };
  }
  const result = spawnSync(process.execPath, [runner, "manifest"], { encoding: "utf8" });
  return { exit: result.error ? 1 : (result.status ?? 1), output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() };
}

function main() {
  const args = process.argv.slice(2);
  const index = args.indexOf("--older-than");
  const days = index !== -1 && args[index + 1] ? Number(args[index + 1]) : 30;
  const result = sweep(TRACES_DIR, Number.isFinite(days) ? days : 30);

  console.log("=== Harness Sweep ===");
  if (result.noTraces) {
    console.log("  No .harness/traces/ directory — nothing to sweep.");
  } else {
    console.log(`  Archived traces: ${result.archived.length}`);
    for (const name of result.archived) console.log(`    → archive/${name}`);
    console.log(`  Pruned orphans: ${result.pruned.length}`);
    for (const name of result.pruned) console.log(`    × ${name}`);
    if (result.archived.length === 0 && result.pruned.length === 0) {
      console.log("  Nothing to archive or prune.");
    }
  }

  console.log("");
  console.log("=== Structural Drift (manifest) ===");
  const drift = driftReport();
  console.log(`  ${drift.output || `[PASS] manifest valid — no drift (exit ${drift.exit})`}`);
  if (drift.exit !== 0) {
    console.log("");
    console.log("=== Sweep: drift detected (report-only — nothing was mutated outside traces) ===");
    process.exit(1);
  }
  console.log("");
  console.log("=== Sweep complete — instance state untouched ===");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
