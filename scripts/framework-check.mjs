#!/usr/bin/env node

import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { EOL } from "node:os";

const mode = process.argv[2];
const args = process.argv.slice(3);

const requiredFiles = [
  "AGENTS.md",
  "CLAUDE.md",
  "feature_list.json",
  "DECISIONS.md",
  "session-handoff.md",
  "Makefile",
  "init.sh",
];

const requiredDirs = ["docs", "templates", "scripts", ".harness"];
const placeholderChecks = [
  { file: "docs/PRODUCT.md", text: "[Describe what this system does and who it serves.]" },
  { file: "docs/PRODUCT.md", text: "[Primary user flow 1]" },
  { file: "docs/quality-document.md", text: "[module-name]" },
  { file: "docs/quality-document.md", text: "[module or surface name]" },
  { file: "README.md", text: "[Add license information]" },
];
const requiredMakeTargets = [
  "check",
  "lint",
  "typecheck",
  "test",
  "build",
  "e2e",
  "check-arch",
  "verify-feature",
  "session-start",
  "session-end",
  "clean-check",
  "setup",
  "dev",
  "help",
];
const allowedStates = new Set(["planned", "active", "blocked", "passing"]);
const allowedStatusValues = new Set(["not_started", "in_progress", "blocked", "passing"]);

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

function readText(path) {
  return readFileSync(path, "utf8");
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function ensureExists(path) {
  if (!existsSync(path)) {
    fail(`${path} is missing`);
  }
}

function ensureProgressArtifact() {
  if (
    !existsSync("PROGRESS.md") &&
    !existsSync("progress.md") &&
    !existsSync("claude-progress.md")
  ) {
    fail(
      "missing progress artifact: require PROGRESS.md (or legacy progress.md) or claude-progress.md",
    );
  }
}

function getFeatureState(feature) {
  if (typeof feature.state === "string") {
    return feature.state;
  }
  if (typeof feature.status === "string") {
    if (feature.status === "not_started") return "planned";
    if (feature.status === "in_progress") return "active";
    return feature.status;
  }
  return undefined;
}

function getFeatureDependencies(feature) {
  return Array.isArray(feature.dependencies) ? feature.dependencies : [];
}

function ensureNoPlaceholders() {
  for (const check of placeholderChecks) {
    if (readText(check.file).includes(check.text)) {
      fail(`${check.file} still contains template placeholder text`);
    }
  }
}

function loadFeatures() {
  const data = readJson("feature_list.json");
  if (!Array.isArray(data.features)) {
    fail("feature_list.json must contain a top-level features array");
  }
  return data;
}

function ensureFeatureShape() {
  const { features } = loadFeatures();
  for (const feature of features) {
    if (!("id" in feature)) {
      fail("feature <unknown> is missing required key id");
    }
    if (!("name" in feature) && !("title" in feature)) {
      fail(`feature ${feature.id} must define name or title`);
    }
    if (!("behavior" in feature) && !("user_visible_behavior" in feature)) {
      fail(`feature ${feature.id} must define behavior or user_visible_behavior`);
    }
    if (!("verification" in feature)) {
      fail(`feature ${feature.id} is missing required key verification`);
    }
    if (!("evidence" in feature)) {
      fail(`feature ${feature.id} is missing required key evidence`);
    }

    const lifecycle = getFeatureState(feature);
    if (!lifecycle) {
      fail(`feature ${feature.id} must define state or status`);
    }

    if (typeof feature.state === "string" && !allowedStates.has(feature.state)) {
      fail(`feature ${feature.id} has invalid state ${feature.state}`);
    }
    if (typeof feature.status === "string" && !allowedStatusValues.has(feature.status)) {
      fail(`feature ${feature.id} has invalid status ${feature.status}`);
    }

    if ("dependencies" in feature && !Array.isArray(feature.dependencies)) {
      fail(`feature ${feature.id} dependencies must be an array`);
    }
    if (!Array.isArray(feature.layers) || feature.layers.length === 0) {
      fail(`feature ${feature.id} must define at least one verification layer`);
    }
    if (typeof feature.evidence !== "string") {
      fail(`feature ${feature.id} evidence must be a string`);
    }
    for (const layer of feature.layers) {
      if (!layer.label || !layer.cmd || !layer.repair) {
        fail(`feature ${feature.id} contains an incomplete verification layer`);
      }
    }
  }
}

function ensureFeatureGraph() {
  const { features } = loadFeatures();
  const ids = new Set();
  for (const feature of features) {
    if (ids.has(feature.id)) {
      fail(`duplicate feature id ${feature.id}`);
    }
    ids.add(feature.id);
  }

  const active = features.filter((feature) => getFeatureState(feature) === "active");
  if (active.length > 1) {
    fail(`WIP=1 violated: found ${active.length} active features`);
  }

  for (const feature of features) {
    for (const dependency of getFeatureDependencies(feature)) {
      if (!ids.has(dependency)) {
        fail(`feature ${feature.id} depends on missing feature ${dependency}`);
      }
    }
  }

  if (active.length === 1) {
    const notPassingDeps = getFeatureDependencies(active[0]).filter((dependency) => {
      const match = features.find((feature) => feature.id === dependency);
      return match && getFeatureState(match) !== "passing";
    });
    if (notPassingDeps.length > 0) {
      fail(
        `active feature ${active[0].id} has unmet dependencies: ${notPassingDeps.join(", ")}`,
      );
    }
  }
}

function ensureMakeTargets() {
  const contents = readText("Makefile");
  for (const target of requiredMakeTargets) {
    const pattern = new RegExp(`^${target}:`, "m");
    if (!pattern.test(contents)) {
      fail(`Makefile is missing target ${target}`);
    }
  }
}

function ensureShellScripts() {
  const shellScripts = [
    "init.sh",
    "scripts/check-arch.sh",
    "scripts/clean-state-check.sh",
    "scripts/session-trace.sh",
    "scripts/verify-feature.sh",
  ];
  for (const path of shellScripts) {
    ensureExists(path);
    const contents = readText(path);
    if (!contents.startsWith("#!/bin/bash")) {
      fail(`${path} must begin with #!/bin/bash`);
    }
  }
}

const MANIFEST_KEYS = ["harness", "version", "schemaVersions", "core", "instance", "optionalComponents", "customizationPoints"];

function ensureManifest() {
  if (!existsSync(".harness/manifest.json")) {
    fail(".harness/manifest.json is missing");
  }
  const manifest = readJson(".harness/manifest.json");
  for (const key of MANIFEST_KEYS) {
    if (!(key in manifest)) {
      fail("manifest is missing required key " + key);
    }
  }
  if (!Array.isArray(manifest.core) || !Array.isArray(manifest.instance)) {
    fail("manifest core and instance must be arrays");
  }
  for (const surface of manifest.core) {
    if (!existsSync(surface) && !isDirectorySafe(surface)) {
      fail("manifest core surface is missing: " + surface);
    }
  }
  for (const surface of manifest.instance) {
    if (!existsSync(surface)) {
      fail("manifest instance surface is missing: " + surface);
    }
  }
  pass("Harness manifest is valid and matches the repository layout");
}
function recordTrail(kind) {
  const trailsDir = ".harness/trails";
  mkdirSync(trailsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  let commit = "unknown";
  try {
    commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    commit = "not-a-git-repo";
  }
  const record = {
    kind,
    recorded_at: new Date().toISOString(),
    git_commit: commit,
    active_feature: getActiveFeatureId(),
  };
  const path = trailsDir + "/" + stamp + "-" + kind + ".json";
  writeFileSync(path, JSON.stringify(record, null, 2) + EOL, "utf8");
  pass("Verification trail recorded: " + path);
}

function getActiveFeatureId() {
  if (!existsSync("feature_list.json")) {
    return "";
  }
  const { features } = readJson("feature_list.json");
  const active = features.find((feature) => getFeatureState(feature) === "active");
  return active ? active.id : "";
}

function isDirectorySafe(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function reportE2eStatus() {
  const markers = ["playwright.config.ts", "playwright.config.js", "cypress.config.ts", "cypress.config.js", "tests/e2e", "test/e2e", "e2e"];
  const configured = markers.some((marker) => existsSync(marker) || isDirectorySafe(marker));
  if (configured) {
    console.log("[FAIL] E2E markers detected but no runner is wired into the e2e mode");
    process.exit(1);
  }
  console.log("[SKIP] No e2e tests configured - this layer does not count as verified");
  process.exit(0);
}

function reportDevStatus() {
  console.log("[SKIP] No dev server configured - wire a real dev flow before claiming this layer");
  process.exit(0);
}
function recordFeaturePass(featureId, evidence) {
  const data = loadFeatures();
  const feature = data.features.find((item) => item.id === featureId);
  if (!feature) {
    fail(`feature ${featureId} not found`);
  }

  if ("state" in feature || !("status" in feature)) {
    feature.state = "passing";
  }
  if ("status" in feature) {
    feature.status = "passing";
  }
  feature.evidence = evidence;
  writeFileSync("feature_list.json", `${JSON.stringify(data, null, 2)}${EOL}`, "utf8");
  pass(`Recorded passing evidence for ${featureId}`);
}

switch (mode) {
  case "lint": {
    for (const path of requiredFiles) {
      ensureExists(path);
    }
    ensureProgressArtifact();
    for (const path of requiredDirs) {
      ensureExists(path);
      if (!statSync(path).isDirectory()) {
        fail(`${path} must be a directory`);
      }
    }
    if (existsSync("package.json")) {
      readJson("package.json");
    }
    readJson("feature_list.json");
    readJson(".harness/arch-rules.json");
    ensureNoPlaceholders();
    pass("Harness files, JSON manifests, and framework docs are present");
    break;
  }
  case "typecheck": {
    ensureFeatureShape();
    pass("Feature tracker schema is consistent");
    break;
  }
  case "test": {
    ensureFeatureGraph();
    pass("Feature dependency graph and WIP contract are valid");
    break;
  }
  case "build": {
    ensureMakeTargets();
    ensureShellScripts();
    pass("Command surfaces and shell entrypoints are wired correctly");
    break;
  }
  case "arch:required-surfaces": {
    for (const path of requiredFiles) {
      ensureExists(path);
    }
    ensureProgressArtifact();
    for (const path of requiredDirs) {
      ensureExists(path);
    }
    console.log("PASS");
    break;
  }
  case "arch:wip-contract": {
    ensureFeatureGraph();
    console.log("PASS");
    break;
  }
  case "arch:no-placeholders": {
    ensureNoPlaceholders();
    console.log("PASS");
    break;
  }
  case "record-feature-pass": {
    const [featureId, ...evidenceParts] = args;
    if (!featureId || evidenceParts.length === 0) {
      fail("usage: node scripts/framework-check.mjs record-feature-pass <feature-id> <evidence>");
    }
    recordFeaturePass(featureId, evidenceParts.join(" "));
    break;
  }
  case "e2e": {
    reportE2eStatus();
    break;
  }
  case "dev": {
    reportDevStatus();
    break;
  }
  case "record-trail": {
    recordTrail(args[0] || "check");
    break;
  }
  case "manifest": {
    ensureManifest();
    break;
  }
  default:
    fail(`unknown mode ${mode ?? "<none>"}`);
}
