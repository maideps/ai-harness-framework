#!/usr/bin/env node

// harness-upgrade — applies a harness upgrade to an adopter repository
// (feat-006, D-010 upgrade contract):
//   - mustNotEdit CORE surfaces are overwritten (they deliver the fixes)
//   - every surface an adopter may own is never overwritten (customizations survive)
//
//   node scripts/harness-upgrade.mjs <adopter-dir>

import { copyFileSync, existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { HARNESS_ROOT } from "./create-harness.mjs";
import { createBackup } from "./harness-backup.mjs";

// Surfaces that ship as-is and must not be edited by adopters — the only
// surfaces an upgrade overwrites. Everything else is adopter-owned (D-010).
export const MUST_NOT_EDIT_SURFACES = [
  "AGENTS.md",
  "CLAUDE.md",
  "codex.md",
  "GEMINI.md",
  "scripts/",
  // The runner's own tests travel with the runner: left behind, old tests run against new
  // scripts and fail the adopter's npm run test (feat-019).
  "tests/",
];

// The manifest's classification belongs to the framework (customizationPoints.mustNotEdit);
// the adopter's productRoots and any keys of its own (such as featureIdPattern) stay (feat-019).
const FRAMEWORK_MANIFEST_KEYS = [
  "harness",
  "version",
  "schemaVersions",
  "core",
  "instance",
  "templates",
  "optionalComponents",
  "customizationPoints",
];

function copyRecursive(src, dest, { keepExisting = () => false } = {}) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath, { keepExisting });
    } else if (existsSync(destPath) && keepExisting(destPath)) {
      continue;
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// Templates are framework skeletons and follow the framework, except those the manifest marks
// `keep` (the sprint contract, rubric and checklist), which adopters customise in place.
function upgradeTemplates(root) {
  const manifest = readJson(path.join(HARNESS_ROOT, ".harness", "manifest.json")) ?? {};
  const kept = new Set(
    (manifest.templates ?? [])
      .filter((entry) => entry && typeof entry === "object" && entry.keep)
      .map((entry) => path.resolve(root, entry.from)),
  );
  copyRecursive(path.join(HARNESS_ROOT, "templates"), path.join(root, "templates"), {
    keepExisting: (destPath) => kept.has(path.resolve(destPath)),
  });
  return [...kept].map((file) => path.relative(root, file).split(path.sep).join("/"));
}

// Instance files a newer harness declares (for example .gitattributes) are created from their
// templates when missing, as create-harness would; existing files are never touched, and
// optional components (such as repositories/example) are not instance surfaces, so they are
// never recreated. From then on the files are the adopter's.
function createMissingInstanceFiles(root) {
  const manifest = readJson(path.join(HARNESS_ROOT, ".harness", "manifest.json")) ?? {};
  const instance = new Set(manifest.instance ?? []);
  const created = [];
  for (const entry of manifest.templates ?? []) {
    if (!entry || typeof entry !== "object" || !entry.to || !instance.has(entry.to)) continue;
    const src = path.join(HARNESS_ROOT, entry.from);
    const dest = path.join(root, entry.to);
    if (existsSync(dest) || !existsSync(src)) continue;
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    created.push(entry.to);
  }
  return created;
}

function upgradeManifest(root) {
  const file = path.join(root, ".harness", "manifest.json");
  const theirs = readJson(file);
  const ours = readJson(path.join(HARNESS_ROOT, ".harness", "manifest.json"));
  if (!theirs || !ours) return false;
  const merged = { ...theirs };
  for (const key of FRAMEWORK_MANIFEST_KEYS) {
    if (key in ours) merged[key] = ours[key];
  }
  const text = `${JSON.stringify(merged, null, 2)}\n`;
  if (text === readFileSync(file, "utf8")) return false;
  writeFileSync(file, text, "utf8");
  return true;
}

// Harness commands (`node scripts/...`) the adopter's package.json does not define yet.
// package.json is adopter-owned, so the upgrade reports them with the line to add instead of
// editing it. Only missing names count: adopters legitimately extend commands such as lint.
export function missingHarnessScripts(root, harnessRoot = HARNESS_ROOT) {
  const scripts = (file) => {
    try {
      return JSON.parse(readFileSync(file, "utf8")).scripts ?? {};
    } catch {
      return null;
    }
  };
  const ours = scripts(path.join(harnessRoot, "package.json")) ?? {};
  const theirs = scripts(path.join(root, "package.json"));
  if (!theirs) return [];
  return Object.entries(ours)
    .filter(([name, command]) => /^node scripts\//.test(command) && !(name in theirs))
    .map(([name, command]) => ({ name, command }));
}

// Make targets the adopter's Makefile lacks, each with the framework's block (its ## help lines,
// the target and the recipe) to paste: the Makefile is adopter-owned, and npm run check
// requires every harness target (feat-019).
export function missingMakeTargets(root, harnessRoot = HARNESS_ROOT) {
  const read = (file) => {
    try {
      return readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    } catch {
      return null;
    }
  };
  const ours = read(path.join(harnessRoot, "Makefile"));
  const theirs = read(path.join(root, "Makefile"));
  if (!ours || theirs === null) return [];
  const defined = new Set([...theirs.matchAll(/^([A-Za-z][\w-]*):/gm)].map((match) => match[1]));
  const lines = ours.split("\n");
  const missing = [];
  lines.forEach((line, index) => {
    const target = /^([A-Za-z][\w-]*):/.exec(line)?.[1];
    if (!target || defined.has(target)) return;
    let start = index;
    while (start > 0 && lines[start - 1].startsWith("##")) start -= 1;
    let end = index + 1;
    while (end < lines.length && lines[end].startsWith("\t")) end += 1;
    missing.push({ target, block: lines.slice(start, end).join("\n") });
  });
  return missing;
}

export function upgrade(root) {
  // Snapshot what's about to be overwritten before touching anything — a
  // safety net independent of git, for a dirty tree or a mustNotEdit file an
  // adopter edited against policy (feat-012, backups live in
  // .harness/backups/, gitignored).
  const backup = createBackup(root, [...MUST_NOT_EDIT_SURFACES, "templates/", ".harness/manifest.json"], HARNESS_ROOT);
  const report = { overwritten: [], preserved: [], backup };
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
  const keptTemplates = upgradeTemplates(root);
  report.overwritten.push("templates/ (framework skeletons)");
  if (upgradeManifest(root)) report.overwritten.push(".harness/manifest.json classification (productRoots kept)");
  report.created = createMissingInstanceFiles(root);
  report.preserved.push(
    `Makefile, package.json, init.sh, .harness/manifest.json productRoots, .harness/arch-rules.json, skills/ additions, docs/, README.md, the customisable templates (${keptTemplates.join(", ")}), all INSTANCE state`,
  );
  report.missingScripts = missingHarnessScripts(root);
  report.missingMakeTargets = missingMakeTargets(root);
  const progressFile = ["PROGRESS.md", "progress.md", "claude-progress.md"]
    .map((name) => path.join(root, name))
    .find(existsSync);
  report.legacyProgress = Boolean(progressFile) && !readFileSync(progressFile, "utf8").includes("<!-- BEGIN GENERATED PROGRESS -->");
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
  if (report.backup.skipped) {
    console.log(`  Backup: skipped (${report.backup.reason})`);
  } else {
    console.log(`  Backup: ${report.backup.id} (${report.backup.fileCount} file(s)) — restore with: node scripts/harness-backup.mjs restore ${report.backup.id}`);
  }
  console.log("  Overwritten (mustNotEdit CORE):");
  for (const surface of report.overwritten) console.log(`    ${surface}`);
  if (report.created.length > 0) {
    console.log("  Created (new instance files, yours from now on):");
    for (const file of report.created) console.log(`    ${file}`);
    if (report.created.includes(".gitattributes")) {
      console.log("    Line-ending rules are new: apply them once, as their own commit, with");
      console.log('      git add --renormalize . && git commit -m "Normalize line endings"');
    }
  }
  console.log("  Never overwritten (adopter-owned):");
  for (const surface of report.preserved) console.log(`    ${surface}`);
  if (report.missingScripts.length > 0) {
    console.log("  New harness commands — add them to package.json \"scripts\":");
    for (const { name, command } of report.missingScripts) console.log(`    "${name}": "${command}",`);
  }
  if (report.missingMakeTargets.length > 0) {
    console.log("  New make targets — add them to your Makefile:");
    for (const { block } of report.missingMakeTargets) {
      console.log("");
      for (const line of block.split("\n")) console.log(`    ${line}`);
    }
    console.log("");
  }
  if (report.legacyProgress) {
    console.log("  PROGRESS.md predates the generated dashboard — move its sessions to progress/ with:");
    console.log("    node scripts/framework-check.mjs progress-migrate");
  }
  console.log("");
  console.log("  Verify the upgraded repo: npm run check && npm run check-arch");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
