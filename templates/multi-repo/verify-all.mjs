#!/usr/bin/env node

// verify-all — root multi-repo gate (optional component).
// Runs every repositories/*/scripts/verify, verify.mjs, or verify.cjs and aggregates the results.
// Runs on Node ≥ 18; no dependencies. Absent repositories are not a failure —
// the component simply has nothing to verify.

import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const REPOS_DIR = "repositories";
const VERIFY_SCRIPTS = ["verify", "verify.mjs", "verify.cjs"];

if (!existsSync(REPOS_DIR)) {
  console.log("=== verify-all: no repositories/ component — nothing to verify ===");
  process.exit(0);
}

const repositories = readdirSync(REPOS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
  .map((entry) => entry.name);

if (repositories.length === 0) {
  console.log("=== verify-all: repositories/ is empty — nothing to verify ===");
  process.exit(0);
}

console.log(`=== verify-all: ${repositories.length} repositories ===`);
let failures = 0;
let passed = 0;
let skipped = 0;
// "example" is the create-harness scaffold placeholder present in every
// adopter by default (templates/multi-repo/repositories/example) — it is
// not a real repository until the adopter adds its own check.js. Its SKIP
// must not, by itself, make a freshly-scaffolded repo with no real repos
// yet look like a broken required gate.
let meaningfulSkipped = 0;

for (const repo of repositories) {
  const scriptsDir = path.join(REPOS_DIR, repo, "scripts");
  const verify = VERIFY_SCRIPTS.map((name) => path.join(scriptsDir, name)).find(existsSync);
  if (!verify) {
    console.log(`  [SKIP] ${repo}: no scripts/${VERIFY_SCRIPTS.join(", scripts/")}`);
    skipped += 1;
    if (repo !== "example") meaningfulSkipped += 1;
    continue;
  }
  console.log(`=== verify-all: ${repo} ===`);
  // argv array, no shell — immune to spaces in the Node executable path. stdout
  // is piped (not inherited) so it can be inspected below, then replayed so
  // nothing is lost from the live log.
  const result = spawnSync(process.execPath, [verify], { stdio: ["inherit", "pipe", "inherit"], encoding: "utf8" });
  const output = result.stdout ?? "";
  process.stdout.write(output);
  const outputLines = output.split(/\r?\n/);
  const reportedSkip = outputLines.some((line) => line.includes("[SKIP]"));
  // Match both the bracket convention ([PASS]) most verify scripts use and
  // the colon convention (PASS:) framework-check.mjs's own pass() helper
  // uses, in case a repo's verify script shells out to it.
  const reportedPass = outputLines.some((line) => line.includes("[PASS]") || /^PASS:/.test(line.trim()));
  // A sub-repo's own verify script can itself use the [SKIP]/[PASS] convention
  // (e.g. the example scaffold) and exit 0 while having verified nothing —
  // that must count the same as "no verify script at all", not as a pass.
  const isVacuousSkip = reportedSkip && !reportedPass;

  if (result.error || (result.status ?? 1) !== 0) {
    console.log(`  [FAIL] ${repo} (exit ${result.error ? 1 : result.status})`);
    failures += 1;
  } else if (isVacuousSkip) {
    console.log(`  [SKIP] ${repo}: verify script ran but reported only SKIP, nothing was verified`);
    skipped += 1;
    if (repo !== "example") meaningfulSkipped += 1;
  } else {
    console.log(`  [PASS] ${repo}`);
    passed += 1;
  }
}

console.log("");
if (failures > 0) {
  console.log(`=== verify-all: ${failures} repository failure(s) ===`);
  process.exit(1);
}
// A repository list that exists but never produced a single real PASS from a
// real (non-scaffold) repository — e.g. submodules not checked out in CI —
// must not report success: that is exactly how a gate silently verifies
// nothing while claiming "all pass" (2026-09-08 external review, finding H01).
if (passed === 0 && meaningfulSkipped > 0) {
  console.log(`=== verify-all: ${meaningfulSkipped} repositories exist but none had a verify script to run — nothing was actually verified ===`);
  process.exit(1);
}
if (passed === 0) {
  console.log("=== verify-all: nothing to verify yet (only the unconfigured example scaffold is present) ===");
  process.exit(0);
}
console.log("=== verify-all: all repositories pass ===");
