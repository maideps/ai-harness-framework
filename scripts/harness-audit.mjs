#!/usr/bin/env node

// harness-audit — local health report for an adopted repository (feat-006).
// Reads the manifest and reports:
//   1. manifest validity + classification coverage (via the runner)
//   2. template placement status (which {from, to} skeletons are in place)
//   3. skills structure (via the runner's lint layer)
// Exits non-zero when any check fails.
//
//   node scripts/harness-audit.mjs [repo-dir]   (defaults to the current directory)

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function audit(root) {
  const report = { manifest: false, coverage: false, templatesPlaced: [], templatesMissing: [], skills: false };
  const runner = path.join(root, "scripts", "framework-check.mjs");
  const run = (args) => spawnSync(process.execPath, [runner, ...args], { cwd: root, encoding: "utf8" });

  if (!existsSync(runner)) {
    return { ...report, missingRunner: true };
  }

  const manifestPath = path.join(root, ".harness", "manifest.json");
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const manifestCheck = run(["manifest"]);
    report.manifest = (manifestCheck.status ?? 1) === 0;
    for (const entry of manifest.templates ?? []) {
      if (typeof entry === "string" || entry.keep) continue;
      if (existsSync(path.join(root, entry.to))) {
        report.templatesPlaced.push(entry.to);
      } else {
        report.templatesMissing.push(entry.to);
      }
    }
  }
  const archCheck = run(["check-arch"]);
  report.coverage = (archCheck.status ?? 1) === 0;
  const lintCheck = run(["lint"]);
  report.skills = (lintCheck.status ?? 1) === 0;
  return report;
}

function main() {
  const root = path.resolve(process.argv[2] ?? ".");
  console.log(`=== harness-audit: ${root} ===`);
  const report = audit(root);
  let failures = 0;

  if (report.missingRunner) {
    console.log("  [FAIL] scripts/framework-check.mjs is missing — this is not a harness-enabled repository");
    process.exit(1);
  }
  const line = (ok, message) => {
    console.log(`  [${ok ? "PASS" : "FAIL"}] ${message}`);
    if (!ok) failures += 1;
  };
  line(report.manifest, "manifest is valid");
  line(report.coverage, "check-arch passes (classification coverage included)");
  line(report.skills, "skills structure is valid (lint layer)");
  line(report.templatesMissing.length === 0, `templates placed: ${report.templatesPlaced.length}/${report.templatesPlaced.length + report.templatesMissing.length}`);
  for (const missing of report.templatesMissing) {
    console.log(`           missing destination: ${missing}`);
  }

  console.log("");
  if (failures > 0) {
    console.log(`=== harness-audit: ${failures} FAILURE(S) ===`);
    process.exit(1);
  }
  console.log("=== harness-audit: ALL PASS ===");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
