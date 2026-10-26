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

// A layer package.json may legitimately replace (lint, typecheck, test, build — the layers
// with a harness self-check baked into framework-check.mjs's own implementation of that
// mode, docs/ARCHITECTURE.md's documented customization point). Dropping the harness's own
// invocation from one of these loses everything that layer checks (skills structure,
// progress log, placeholder docs, and command-surface drift for lint; feature-tracker shape
// for typecheck; the dependency graph, WIP contract, and runner unit tests for test; Make
// target/shell-shim wiring for build) with no warning, since check-arch (arch-001..006)
// does not cover any of that (#25). Warn, never fail: a layer intentionally chaining both
// (`node scripts/framework-check.mjs lint && eslint .`, USAGE.md's documented pattern) is
// fine and is not flagged.
const SELF_CHECK_LAYERS = ["lint", "typecheck", "test", "build"];

export function missingSelfChecks(root) {
  const pkgPath = path.join(root, "package.json");
  if (!existsSync(pkgPath)) return [];
  let scripts;
  try {
    scripts = JSON.parse(readFileSync(pkgPath, "utf8")).scripts ?? {};
  } catch {
    return [];
  }
  return SELF_CHECK_LAYERS.filter((layer) => {
    const command = scripts[layer];
    return typeof command === "string" && !command.includes(`framework-check.mjs ${layer}`);
  });
}

export function audit(root) {
  const report = { manifest: false, coverage: false, templatesPlaced: [], templatesMissing: [], skills: false };
  const runner = path.join(root, "scripts", "framework-check.mjs");
  const run = (args) => spawnSync(process.execPath, [runner, ...args], { cwd: root, encoding: "utf8" });

  if (!existsSync(runner)) {
    return { ...report, missingRunner: true };
  }
  report.missingSelfChecks = missingSelfChecks(root);

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
  for (const layer of report.missingSelfChecks ?? []) {
    console.log(`  [WARN] "${layer}" no longer runs the harness's own check (\`node scripts/framework-check.mjs ${layer}\`) — chain it`
      + ` alongside your product tool (e.g. "node scripts/framework-check.mjs ${layer} && <your command>") to keep both (#25, see USAGE.md).`);
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
