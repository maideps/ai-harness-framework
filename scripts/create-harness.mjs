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
import { generateHarnessDocs } from "./harness-docs.mjs";
import { detectRuntime } from "./stack-detect.mjs";

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

// A template destination belongs to an optional component when it matches one of that
// component's declared markers (prefix match for a "/"-suffixed marker, exact otherwise).
function optionalComponentFor(manifest, to) {
  for (const component of manifest.optionalComponents ?? []) {
    for (const marker of component.markers ?? []) {
      if (marker.endsWith("/") ? to.startsWith(marker) : to === marker) return component.name;
    }
  }
  return null;
}

// Every optional component's declared name, for validating --with/components input.
export function optionalComponentNames(manifest = loadManifest()) {
  return (manifest.optionalComponents ?? []).map((component) => component.name);
}

// Place every copy-kind template at its declared destination. Optional-component templates
// (manifest.optionalComponents' markers) are skipped unless the component is explicitly
// requested via `components` — a fresh adopter gets none of them by default, so a plain
// single-repo project never acquires, say, the multi-repo control plane unasked (#24).
// Pass `components` again (or rerun with the same flag) against an existing adopter to
// activate one later: already-placed files are left alone by skipExisting, so only the
// component's still-missing files are added.
export function placeTemplates(root, { skipExisting = false, components = [] } = {}) {
  const manifest = loadManifest();
  const wanted = new Set(components);
  const placed = [];
  for (const entry of manifest.templates) {
    if (typeof entry === "string" || entry.keep) continue;
    const component = optionalComponentFor(manifest, entry.to);
    if (component && !wanted.has(component)) continue;
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

// package.json is CORE (its "scripts"/"bin"/"engines" must stay in sync with
// the framework's own), but its identity fields are not: copying it verbatim
// into a brand-new adopter repo leaves that repo named after the framework
// itself, publishable to npm as the framework's own package, and licensed
// as if the adopter's own content were the framework's MIT-licensed output
// (2026-09-08 external review, finding H11). Only touches package.json when
// this adopt() run is what just created it — an already-customized adopter
// package.json (skipExisting path) is never rewritten.
function instantiatePackageJson(root, { wasFreshlyCreated }) {
  if (!wasFreshlyCreated) return;
  const pkgPath = path.join(root, "package.json");
  if (!existsSync(pkgPath)) return;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const instanceName =
    path
      .basename(root)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "my-project";
  pkg.name = instanceName;
  pkg.version = "0.1.0";
  pkg.private = true;
  delete pkg.publishConfig;
  delete pkg.repository;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
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
  mkdirSync(path.join(root, ".harness", "state"), { recursive: true });
  mkdirSync(path.join(root, "progress"), { recursive: true });
  if (!existsSync(path.join(root, "docs", "HARNESS.md"))) {
    generateHarnessDocs(root);
  }
  write(".harness/traces/.gitkeep", "");
  write(".harness/trails/.gitkeep", "");
  write(".claude/settings.json", "{}\n");
  write("package-lock.json", "{}\n");
  write("claude-progress.md", "# Claude Progress\n\nCompatibility alias for PROGRESS.md.\n");
}

// Dev container features that install each product stack's toolchain (feat-024). Node is
// always present because the harness itself runs on it.
const STACK_FEATURES = {
  python: ["ghcr.io/devcontainers/features/python:1", {}],
  go: ["ghcr.io/devcontainers/features/go:1", {}],
  rust: ["ghcr.io/devcontainers/features/rust:1", {}],
  dotnet: ["ghcr.io/devcontainers/features/dotnet:2", {}],
};

function stackFeature(root, runtime) {
  if (runtime === "jvm") {
    const gradle = existsSync(path.join(root, "build.gradle")) || existsSync(path.join(root, "build.gradle.kts"));
    return ["ghcr.io/devcontainers/features/java:1", gradle ? { installGradle: "true" } : { installMaven: "true" }];
  }
  return STACK_FEATURES[runtime] ?? null;
}

// The devcontainer template is stack-neutral; when this run just placed it, pin its Node to
// the project's .nvmrc and add the toolchain of the product already in the target directory.
// A devcontainer.json the adopter already had is never rewritten.
function instantiateDevcontainer(root, { wasFreshlyCreated }) {
  if (!wasFreshlyCreated) return;
  const file = path.join(root, ".devcontainer", "devcontainer.json");
  const config = JSON.parse(readFileSync(file, "utf8"));
  const nvmrc = path.join(root, ".nvmrc");
  if (existsSync(nvmrc)) {
    const version = readFileSync(nvmrc, "utf8").trim().replace(/^v/, "");
    if (version) config.features["ghcr.io/devcontainers/features/node:1"] = { version };
  }
  const feature = stackFeature(root, detectRuntime(root));
  if (feature) config.features[feature[0]] = feature[1];
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

// Full adoption: CORE + templates + runtime surfaces. `components` opts into optional
// components (by name, e.g. "multi-repo"); omit it for a plain single-repo adopter.
export function adopt(root, { skipExisting = false, components = [] } = {}) {
  mkdirSync(root, { recursive: true });
  const core = copyCore(root, { skipExisting });
  instantiatePackageJson(root, { wasFreshlyCreated: core.includes("package.json") });
  const templates = placeTemplates(root, { skipExisting, components });
  instantiateDevcontainer(root, { wasFreshlyCreated: templates.includes(".devcontainer/devcontainer.json") });
  createRuntimeSurfaces(root);
  return { core, templates };
}

function main() {
  const args = process.argv.slice(2);
  const components = [];
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--with") {
      i += 1;
      if (args[i]) components.push(args[i]);
    } else {
      positional.push(args[i]);
    }
  }
  const target = positional[0];
  if (!target) {
    console.error("usage: node scripts/create-harness.mjs <target-dir> [--with <component>]...");
    process.exit(1);
  }
  const known = optionalComponentNames();
  for (const name of components) {
    if (!known.includes(name)) {
      console.error(`unknown optional component "${name}" (known: ${known.join(", ") || "none"})`);
      process.exit(1);
    }
  }
  const root = path.resolve(target);
  const result = adopt(root, { skipExisting: true, components });
  console.log(`=== create-harness: ${root} ===`);
  console.log(`  CORE surfaces copied: ${result.core.length}`);
  console.log(`  Templates placed: ${result.templates.length}`);
  if (components.length > 0) console.log(`  Optional components activated: ${components.join(", ")}`);
  console.log("  Existing files were never overwritten.");
  console.log("  Rerun with --with <component> any time to activate one later — already-placed files are left alone.");
  console.log("");
  console.log("  Next steps:");
  console.log("  1. Review and customize the project docs, README, and feature list.");
  console.log("  2. Declare product directories in .harness/manifest.json productRoots.");
  console.log(
    "  3. package.json was given a private, instance-specific name — review LICENSE too: " +
      "it was copied as MIT (the framework's own license). If this project's content isn't " +
      "MIT, replace LICENSE with your own before publishing anything."
  );
  console.log("  4. Run node scripts/framework-check.mjs progress-update after customizing feature declarations.");
  console.log("  5. Run ./init.sh, then npm run check.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
