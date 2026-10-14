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

for (const repo of repositories) {
  const scriptsDir = path.join(REPOS_DIR, repo, "scripts");
  const verify = VERIFY_SCRIPTS.map((name) => path.join(scriptsDir, name)).find(existsSync);
  if (!verify) {
    console.log(`  [SKIP] ${repo}: no scripts/${VERIFY_SCRIPTS.join(", scripts/")}`);
    continue;
  }
  console.log(`=== verify-all: ${repo} ===`);
  // argv array, no shell — immune to spaces in the Node executable path
  const result = spawnSync(process.execPath, [verify], { stdio: "inherit" });
  if (result.error || (result.status ?? 1) !== 0) {
    console.log(`  [FAIL] ${repo} (exit ${result.error ? 1 : result.status})`);
    failures += 1;
  } else {
    console.log(`  [PASS] ${repo}`);
  }
}

console.log("");
if (failures > 0) {
  console.log(`=== verify-all: ${failures} repository failure(s) ===`);
  process.exit(1);
}
console.log("=== verify-all: all repositories pass ===");
