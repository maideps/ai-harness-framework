#!/usr/bin/env node

// harness-upgrade — applies a harness upgrade to an adopter repository
// (feat-006, D-010 upgrade contract):
//   - mustNotEdit CORE surfaces are overwritten (they deliver the fixes)
//   - every surface an adopter may own is never overwritten (customizations survive)
//
//   node scripts/harness-upgrade.mjs <adopter-dir>

import { copyFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { HARNESS_ROOT } from "./create-harness.mjs";

// Surfaces that ship as-is and must not be edited by adopters — the only
// surfaces an upgrade overwrites. Everything else is adopter-owned (D-010).
export const MUST_NOT_EDIT_SURFACES = [
  "AGENTS.md",
  "CLAUDE.md",
  "codex.md",
  "GEMINI.md",
  "LICENSE",
  ".nvmrc",
  "scripts/",
];

function copyRecursive(src, dest, { skipExisting = false } = {}) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath, { skipExisting });
    } else if (skipExisting && existsSync(destPath)) {
      continue;
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

export function upgrade(root) {
  const report = { overwritten: [], preserved: [] };
  for (const surface of MUST_NOT_EDIT_SURFACES) {
    const src = path.join(HARNESS_ROOT, surface);
    const dest = path.join(root, surface);
    if (!existsSync(src)) continue;
    if (surface.endsWith("/")) {
      copyRecursive(src, dest.replace(/[\\/]$/, ""));
      report.overwritten.push(surface);
    } else {
      copyFileSync(src, dest);
      report.overwritten.push(surface);
    }
  }
  // Skeleton updates reach adopters, but files they already created are kept.
  copyRecursive(path.join(HARNESS_ROOT, "templates"), path.join(root, "templates"), { skipExisting: true });
  report.preserved.push(
    "Makefile, package.json, init.sh, .harness/manifest.json (productRoots), .harness/arch-rules.json, skills/ additions, docs/, README.md, all INSTANCE state",
  );
  return report;
}

function main() {
  const target = process.argv[2];
  if (!target) {
    console.error("usage: node scripts/harness-upgrade.mjs <adopter-dir>");
    process.exit(1);
  }
  const root = path.resolve(target);
  const report = upgrade(root);
  console.log(`=== harness-upgrade: ${root} ===`);
  console.log("  Overwritten (mustNotEdit CORE):");
  for (const surface of report.overwritten) console.log(`    ${surface}`);
  console.log("  Never overwritten (adopter-owned):");
  for (const surface of report.preserved) console.log(`    ${surface}`);
  console.log("");
  console.log("  Verify the upgraded repo: npm run check && npm run check-arch");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
