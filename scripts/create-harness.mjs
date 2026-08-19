#!/usr/bin/env node

// create-harness — generates an adopter repository from the seam manifest
// (feat-006). The manifest is the single source of truth: CORE ships as-is,
// templates are placed at their declared {from, to} destinations, and runtime
// instance surfaces are created. Never overwrites existing files — adoption is
// idempotent by construction (the lidr-style never-overwrite rule).
//
//   node scripts/create-harness.mjs <target-dir>
//   npx create-harness <target-dir>          (after publish)

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadManifest() {
  return JSON.parse(readFileSync(path.join(HARNESS_ROOT, ".harness", "manifest.json"), "utf8"));
}

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

// Copy every CORE surface (exact files and directories) into the target.
export function copyCore(root, { skipExisting = false } = {}) {
  const manifest = loadManifest();
  const copied = [];
  for (const surface of manifest.core) {
    const src = path.join(HARNESS_ROOT, surface);
    if (!existsSync(src)) continue;
    const dest = path.join(root, surface);
    if (surface.endsWith("/")) {
      copyRecursive(src, dest.replace(/[\\/]$/, ""), { skipExisting });
    } else {
      mkdirSync(path.dirname(dest), { recursive: true });
      if (skipExisting && existsSync(dest)) continue;
      copyFileSync(src, dest);
    }
    copied.push(surface);
  }
  return copied;
}

// Place every copy-kind template at its declared destination.
export function placeTemplates(root, { skipExisting = false } = {}) {
  const manifest = loadManifest();
  const placed = [];
  for (const entry of manifest.templates) {
    if (typeof entry === "string" || entry.keep) continue;
    const src = path.join(HARNESS_ROOT, entry.from);
    const dest = path.join(root, entry.to);
    if (!existsSync(src)) continue;
    mkdirSync(path.dirname(dest), { recursive: true });
    if (skipExisting && existsSync(dest)) continue;
    copyFileSync(src, dest);
    placed.push(entry.to);
  }
  return placed;
}

// Create the runtime/generated instance surfaces the manifest expects to
// exist in an operating repository.
export function createRuntimeSurfaces(root) {
  const write = (rel, content) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    if (!existsSync(path.join(root, rel))) {
      writeFileSync(path.join(root, rel), content, "utf8");
    }
  };
  mkdirSync(path.join(root, ".harness", "trails"), { recursive: true });
  write(".harness/traces/.gitkeep", "");
  write(".claude/settings.json", "{}\n");
  write("package-lock.json", "{}\n");
  write("claude-progress.md", "# Claude Progress\n\nCompatibility alias for PROGRESS.md.\n");
}

// Full adoption: CORE + templates + runtime surfaces.
export function adopt(root, { skipExisting = false } = {}) {
  mkdirSync(root, { recursive: true });
  const core = copyCore(root, { skipExisting });
  const templates = placeTemplates(root, { skipExisting });
  createRuntimeSurfaces(root);
  return { core, templates };
}

function main() {
  const target = process.argv[2];
  if (!target) {
    console.error("usage: node scripts/create-harness.mjs <target-dir>");
    process.exit(1);
  }
  const root = path.resolve(target);
  const result = adopt(root, { skipExisting: true });
  console.log(`=== create-harness: ${root} ===`);
  console.log(`  CORE surfaces copied: ${result.core.length}`);
  console.log(`  Templates placed: ${result.templates.length}`);
  console.log("  Existing files were never overwritten.");
  console.log("");
  console.log("  Next steps:");
  console.log("  1. Fill the skeletons (docs, README, feature list) — lint fails until they are project-specific.");
  console.log("  2. Declare product directories in .harness/manifest.json productRoots.");
  console.log("  3. Run ./init.sh, then npm run check.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
