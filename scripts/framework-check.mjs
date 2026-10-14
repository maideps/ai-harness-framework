#!/usr/bin/env node

import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { EOL } from "node:os";
import path from "node:path";

import {
  LAYERS,
  detectRuntime,
  resolveLayer,
  getInstallCommand,
  getVerifyChain,
} from "./stack-detect.mjs";

const mode = process.argv[2];
const args = process.argv.slice(3);

const requiredFiles = [
  "AGENTS.md",
  "CLAUDE.md",
  "codex.md",
  "GEMINI.md",
  "feature_list.json",
  "DECISIONS.md",
  "session-handoff.md",
  "Makefile",
  "init.sh",
];

const requiredDirs = ["docs", "templates", "scripts", ".harness", "skills"];
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
  "verify-all",
  "lane-new",
  "lane-list",
  "lane-land",
  "lane-drop",
  "migrate-feature-state",
  "add-feature",
  "activate",
  "create-harness",
  "harness-upgrade",
  "harness-audit",
  "backup-list",
  "backup-pin",
  "backup-unpin",
  "backup-restore",
  "report",
  "sweep",
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

// Dogfooding feedback Tier 1 item 3: nothing caught a duplicate "### Session
// 016" entry across many sessions of re-reading PROGRESS.md for context.
// Checks the *set* of session numbers, not file order — a legitimate
// out-of-order insertion (a same-day hotfix session written up after a
// later-numbered one) is not a bug, only a duplicate or a gap is.
function ensureProgressLog() {
  const progressFile = ["PROGRESS.md", "progress.md", "claude-progress.md"].find(existsSync);
  if (!progressFile) {
    return; // ensureProgressArtifact already requires one to exist; nothing to lint yet
  }
  const numbers = [...readText(progressFile).matchAll(/^###\s+Session\s+(\d+)\b/gm)].map((match) => Number(match[1]));
  if (numbers.length === 0) {
    return; // no numbered sessions logged yet
  }

  const seen = new Set();
  for (const number of numbers) {
    if (seen.has(number)) {
      fail(`${progressFile} has a duplicate session number: Session ${number} appears more than once`);
    }
    seen.add(number);
  }
  const sorted = [...seen].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i - 1] + 1) {
      fail(`${progressFile} is missing Session ${sorted[i - 1] + 1} — session numbers jump from ${sorted[i - 1]} to ${sorted[i]}`);
    }
  }
  pass(`Progress log session numbers are unique and contiguous (${sorted.length} sessions)`);
}

function ensureNoPlaceholders() {
  for (const check of placeholderChecks) {
    if (!existsSync(check.file)) {
      fail(`${check.file} is missing — copy the skeleton from templates/ and fill it in for this project`);
    }
    if (readText(check.file).includes(check.text)) {
      fail(`${check.file} still contains template placeholder text`);
    }
  }
}

function ensureSkills() {
  if (!existsSync("skills")) {
    pass("No skills directory — skills are optional for this repository");
    return;
  }
  const entries = readdirSync("skills", { withFileTypes: true });
  const stray = entries.filter((entry) => !entry.isDirectory());
  if (stray.length > 0) {
    fail(`skills/ must contain only skill folders, found: ${stray.map((entry) => entry.name).join(", ")}`);
  }
  const skillDirs = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."));
  for (const dir of skillDirs) {
    const skillFile = path.join("skills", dir.name, "SKILL.md");
    if (!existsSync(skillFile)) {
      fail(`skill ${dir.name} is missing SKILL.md`);
    }
    const contents = readText(skillFile);
    const frontmatter = contents.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatter) {
      fail(`skill ${dir.name} SKILL.md is missing YAML frontmatter`);
    }
    const nameMatch = frontmatter[1].match(/^name:\s*(.+)$/m);
    if (!nameMatch || !nameMatch[1].trim()) {
      fail(`skill ${dir.name} frontmatter is missing a name`);
    }
    if (nameMatch[1].trim() !== dir.name) {
      fail(`skill ${dir.name} frontmatter name (${nameMatch[1].trim()}) must match its folder`);
    }
    const descriptionMatch = frontmatter[1].match(/^description:\s*(.+)$/m);
    if (!descriptionMatch || !descriptionMatch[1].trim()) {
      fail(`skill ${dir.name} frontmatter is missing a description`);
    }
    if (!/^## When to Use/m.test(contents)) {
      fail(`skill ${dir.name} SKILL.md is missing a "## When to Use" section`);
    }
  }
  pass(`Skills validated (${skillDirs.length} skills)`);
}

function loadFeatures() {
  const data = readJson("feature_list.json");
  if (!Array.isArray(data.features)) {
    fail("feature_list.json must contain a top-level features array");
  }
  return data;
}

// ---- Sharded feature state (feat-011, D-017) ----------------------------
// feature_list.json holds declarations only (id, name, behavior, verification,
// dependencies, layers). The mutable fields — state, evidence — live one file
// per feature under .harness/state/<id>.json, so verify-feature and lane
// landings never rewrite the shared feature_list.json again: two lanes
// finishing two different features touch two different files and merge
// without conflict by construction.

const featureStateDir = ".harness/state";

function featureStatePath(featureId) {
  return path.join(featureStateDir, `${featureId}.json`);
}

// Missing shard = never touched = "planned" with no evidence yet.
function readFeatureState(featureId) {
  return readFeatureStateFrom(featureStatePath(featureId));
}

function readFeatureStateFrom(shardPath) {
  if (!existsSync(shardPath)) {
    return { state: "planned", evidence: "" };
  }
  const shard = JSON.parse(readFileSync(shardPath, "utf8"));
  return {
    state: getFeatureState(shard) ?? "planned",
    evidence: typeof shard.evidence === "string" ? shard.evidence : "",
  };
}

function writeFeatureState(featureId, { state, evidence }) {
  mkdirSync(featureStateDir, { recursive: true });
  writeFileSync(featureStatePath(featureId), `${JSON.stringify({ state, evidence }, null, 2)}${EOL}`, "utf8");
}

// The merged view every runtime consumer uses: declaration fields from
// feature_list.json overlaid with that feature's current shard (state,
// evidence). Kept separate from loadFeatures() because ensureFeatureShape
// needs the raw declaration to confirm it carries no leftover mutable field.
function loadFeaturesWithState() {
  const { features } = loadFeatures();
  return { features: features.map((feature) => ({ ...feature, ...readFeatureState(feature.id) })) };
}

function ensureFeatureShape() {
  const { features } = loadFeatures();
  const declaredIds = new Set();
  for (const feature of features) {
    if (!("id" in feature)) {
      fail("feature <unknown> is missing required key id");
    }
    declaredIds.add(feature.id);
    if (!("name" in feature) && !("title" in feature)) {
      fail(`feature ${feature.id} must define name or title`);
    }
    if (!("behavior" in feature) && !("user_visible_behavior" in feature)) {
      fail(`feature ${feature.id} must define behavior or user_visible_behavior`);
    }
    if (!("verification" in feature)) {
      fail(`feature ${feature.id} is missing required key verification`);
    }
    if ("state" in feature || "status" in feature || "evidence" in feature) {
      fail(
        `feature ${feature.id} declares mutable state in feature_list.json — state/evidence now live in .harness/state/${feature.id}.json (run node scripts/framework-check.mjs migrate-feature-state to move it)`,
      );
    }

    if ("dependencies" in feature && !Array.isArray(feature.dependencies)) {
      fail(`feature ${feature.id} dependencies must be an array`);
    }
    if (!Array.isArray(feature.layers) || feature.layers.length === 0) {
      fail(`feature ${feature.id} must define at least one verification layer`);
    }
    for (const layer of feature.layers) {
      if (!layer.label || !layer.cmd || !layer.repair) {
        fail(`feature ${feature.id} contains an incomplete verification layer`);
      }
    }
  }
  ensureShardedStateShape(declaredIds);
}

function ensureShardedStateShape(declaredIds) {
  if (!existsSync(featureStateDir)) {
    return;
  }
  for (const entry of readdirSync(featureStateDir)) {
    if (!entry.endsWith(".json")) {
      continue;
    }
    const featureId = entry.slice(0, -".json".length);
    if (!declaredIds.has(featureId)) {
      fail(`${featureStateDir}/${entry} does not correspond to any feature declared in feature_list.json`);
    }
    let shard;
    try {
      shard = JSON.parse(readFileSync(path.join(featureStateDir, entry), "utf8"));
    } catch {
      fail(`${featureStateDir}/${entry} is not valid JSON`);
    }
    const lifecycle = getFeatureState(shard);
    if (!lifecycle) {
      fail(`${featureStateDir}/${entry} must define state or status`);
    }
    if (typeof shard.state === "string" && !allowedStates.has(shard.state)) {
      fail(`${featureStateDir}/${entry} has invalid state ${shard.state}`);
    }
    if (typeof shard.status === "string" && !allowedStatusValues.has(shard.status)) {
      fail(`${featureStateDir}/${entry} has invalid status ${shard.status}`);
    }
    if (typeof shard.evidence !== "string") {
      fail(`${featureStateDir}/${entry} evidence must be a string`);
    }
  }
}

// Dogfooding feedback Tier 1 item 2: every feature in one real adopter
// project (15 of them) was added via a one-off `node -e` script hand-building
// the JSON object — repetitive, and one typo away from a malformed
// feature_list.json. Appends a correctly-shaped, declaration-only stub
// (feat-011's schema — no inline state/evidence) with the standard 3-layer
// verification chain; options can configure these declaration fields while
// omitted behavior and verification retain their TODO defaults.
function parseAddFeatureArgs(args) {
  const options = { layers: [] };
  const nameParts = [];
  const seenOptions = new Set();
  const valueOptions = new Set(["--behavior", "--verification", "--depends", "--layer"]);
  let parsingOptions = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!parsingOptions && !arg.startsWith("--")) {
      nameParts.push(arg);
      continue;
    }
    parsingOptions = true;
    if (!valueOptions.has(arg)) {
      fail(`unknown add-feature option ${arg}`);
    }
    const value = args[++i];
    if (!value || value.startsWith("--")) {
      fail(`add-feature option ${arg} requires a value`);
    }
    if (arg === "--layer") {
      const separator = value.indexOf("=");
      if (separator < 1 || separator === value.length - 1) {
        fail('add-feature --layer must use "label=cmd"');
      }
      const label = value.slice(0, separator);
      options.layers.push({
        label,
        cmd: value.slice(separator + 1),
        repair: `Fix ${label} failures and rerun the layer command.`,
      });
      continue;
    }
    if (seenOptions.has(arg)) {
      fail(`add-feature option ${arg} may only be specified once`);
    }
    seenOptions.add(arg);
    if (arg === "--depends") {
      const dependencies = value.split(",").map((dependency) => dependency.trim());
      if (dependencies.some((dependency) => !dependency)) {
        fail("add-feature --depends requires comma-separated feature ids");
      }
      options.dependencies = dependencies;
    } else {
      options[arg.slice(2)] = value;
    }
  }
  return { name: nameParts.join(" "), options };
}

function validateFeatureId(featureId) {
  if (!existsSync(".harness/manifest.json")) {
    return;
  }
  const manifest = readJson(".harness/manifest.json");
  if (manifest.featureIdPattern === undefined) {
    return;
  }
  if (typeof manifest.featureIdPattern !== "string") {
    fail(".harness/manifest.json featureIdPattern must be a regular expression string");
  }
  let pattern;
  try {
    pattern = new RegExp(manifest.featureIdPattern);
  } catch {
    fail(`.harness/manifest.json featureIdPattern is not a valid regular expression: ${manifest.featureIdPattern}`);
  }
  if (!pattern.test(featureId)) {
    fail(`feature id ${featureId} does not match manifest featureIdPattern ${manifest.featureIdPattern}`);
  }
}

function addFeature(featureId, featureArgs) {
  const { name, options } = parseAddFeatureArgs(featureArgs);
  if (!featureId || !name.trim()) {
    fail("usage: node scripts/framework-check.mjs add-feature <id> <name> [--behavior <text>] [--verification <text>] [--depends a,b] [--layer label=cmd]");
  }
  validateFeatureId(featureId);
  const data = loadFeatures();
  if (data.features.some((feature) => feature.id === featureId)) {
    fail(`feature ${featureId} already exists in feature_list.json`);
  }
  for (const dependency of options.dependencies ?? []) {
    if (!data.features.some((feature) => feature.id === dependency)) {
      fail(`feature ${featureId} depends on unknown feature ${dependency}`);
    }
  }
  data.features.push({
    id: featureId,
    name,
    behavior: options.behavior ?? "TODO: describe the single target behavior this feature implements.",
    verification: options.verification ?? "TODO: describe how completion is verified end-to-end.",
    dependencies: options.dependencies ?? [],
    layers: [
      { label: "Layer 1: Static checks", cmd: "npm run lint", repair: "Fix static-analysis issues and rerun the layer command." },
      { label: "Layer 2: Runtime tests", cmd: "npm run test", repair: "Fix failing tests and rerun the layer command." },
      { label: "Layer 3: System confirmation", cmd: "npm run check", repair: "Resolve cross-layer issues and rerun full verification." },
      ...options.layers,
    ],
  });
  writeFileSync("feature_list.json", `${JSON.stringify(data, null, 2)}${EOL}`, "utf8");
  pass(`Added ${featureId} to feature_list.json`);
}

function activateFeature(featureId) {
  if (!featureId) {
    fail("usage: node scripts/framework-check.mjs activate <feature-id>");
  }
  const { features } = loadFeaturesWithState();
  const feature = features.find((item) => item.id === featureId);
  if (!feature) {
    fail(`feature ${featureId} not found in feature_list.json`);
  }
  const otherActive = features.find((item) => item.state === "active" && item.id !== featureId);
  if (otherActive) {
    fail(`cannot activate ${featureId}: feature ${otherActive.id} is already active`);
  }
  if (feature.state === "active") {
    pass(`Feature ${featureId} is already active`);
    return;
  }
  if (feature.state === "passing" || feature.state === "blocked") {
    fail(`feature ${featureId} is ${feature.state} — it cannot be activated`);
  }
  if (feature.state !== "planned") {
    fail(`feature ${featureId} has unsupported state ${feature.state}`);
  }
  const unmet = getFeatureDependencies(feature).filter((dependencyId) => {
    const dependency = features.find((item) => item.id === dependencyId);
    return !dependency || dependency.state !== "passing";
  });
  if (unmet.length > 0) {
    fail(`feature ${featureId} has unmet dependencies: ${unmet.join(", ")} — complete those first`);
  }
  const laneFeatureId = laneFeatureIdFromBranch(getCurrentBranch());
  if (laneFeatureId && laneFeatureId !== featureId) {
    fail(`lane branch lane/${laneFeatureId} may only activate feature ${laneFeatureId}`);
  }
  writeFeatureState(featureId, { state: "active", evidence: "" });
  pass(`Activated ${featureId}`);
}

function migrateFeatureState() {
  const data = loadFeatures();
  let migrated = 0;
  for (const feature of data.features) {
    const hasInline = "state" in feature || "status" in feature || "evidence" in feature;
    if (!hasInline) {
      continue;
    }
    if (!existsSync(featureStatePath(feature.id))) {
      const state = getFeatureState(feature) ?? "planned";
      const evidence = typeof feature.evidence === "string" ? feature.evidence : "";
      writeFeatureState(feature.id, { state, evidence });
      console.log(`  migrated ${feature.id}: state=${state}`);
    } else {
      console.log(`  skipped ${feature.id}: shard already exists at ${featureStatePath(feature.id)}`);
    }
    delete feature.state;
    delete feature.status;
    delete feature.evidence;
    migrated += 1;
  }
  if (migrated === 0) {
    console.log("Nothing to migrate — feature_list.json already declares no inline state.");
    return;
  }
  writeFileSync("feature_list.json", `${JSON.stringify(data, null, 2)}${EOL}`, "utf8");
  pass(`Migrated ${migrated} feature(s) to ${featureStateDir}/`);
}

function ensureFeatureGraph() {
  const { features } = loadFeaturesWithState();
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

function ensureCommandSurfaces() {
  // Every make target must be documented: README's Command Targets table and
  // AGENTS.md's command mirrors. Docs that drift from the actual surface are
  // the failure mode this harness exists to prevent.
  const readme = readText("README.md");
  if (/## Command Targets/.test(readme)) {
    for (const target of requiredMakeTargets) {
      if (!readme.includes(`make ${target}`)) {
        fail(`README.md Command Targets table does not document the ${target} target`);
      }
    }
  }
  const agents = readText("AGENTS.md");
  for (const target of requiredMakeTargets) {
    if (!agents.includes(`make ${target}`) && !agents.includes(`\`${target}\``)) {
      fail(`AGENTS.md does not mention the ${target} command`);
    }
  }
  pass("README and AGENTS document every make target");
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

const MANIFEST_KEYS = ["harness", "version", "schemaVersions", "core", "instance", "templates", "productRoots", "optionalComponents", "customizationPoints"];

function matchesEntry(file, entry) {
  return entry.endsWith("/") ? file.startsWith(entry) : file === entry;
}

function templateEntries(templates) {
  return templates.map((entry) => {
    if (typeof entry === "string") {
      // legacy form: a bare path means a skeleton that stays under templates/
      return { from: entry, keep: true };
    }
    if (entry && typeof entry.from === "string") {
      return entry;
    }
    return null;
  });
}

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
  for (const key of ["core", "instance", "templates", "productRoots"]) {
    if (!Array.isArray(manifest[key])) {
      fail("manifest " + key + " must be an array");
    }
  }
  const templates = templateEntries(manifest.templates);
  if (templates.some((entry) => entry === null)) {
    fail("manifest template entries must be paths or { from, to | keep } objects");
  }
  // Every declared surface must exist in the repository.
  for (const surface of manifest.core) {
    if (!existsSync(surface)) {
      fail("manifest core surface is missing: " + surface);
    }
  }
  for (const surface of manifest.instance) {
    if (!existsSync(surface)) {
      fail("manifest instance surface is missing: " + surface);
    }
  }
  for (const entry of templates) {
    if (!existsSync(entry.from)) {
      fail("manifest template skeleton is missing: " + entry.from);
    }
    if (entry.keep) continue;
    if (typeof entry.to !== "string" || !entry.to) {
      fail("manifest template " + entry.from + " must declare a destination to");
    }
    const optionalMarkers = (manifest.optionalComponents ?? []).flatMap((component) => component.markers ?? []);
    const optionalCovered = optionalMarkers.some((marker) => matchesEntry(entry.to, marker));
    const coreCollision = manifest.core.some((surface) => matchesEntry(entry.to, surface));
    if (coreCollision && !optionalCovered) {
      fail("manifest template destination collides with a CORE surface: " + entry.to);
    }
    const instanceCovered = manifest.instance.some((surface) => matchesEntry(entry.to, surface));
    if (!instanceCovered && !optionalCovered) {
      fail("manifest template destination is not declared as INSTANCE or an optional component: " + entry.to);
    }
  }
  // Classification coverage: every tracked file must be CORE, INSTANCE,
  // TEMPLATE, optional-component, or product-owned. Precedence when a file
  // matches several categories: instance > templates > core (a specific
  // claim overrides a directory-level CORE claim). Ambiguity between
  // INSTANCE and TEMPLATES is an error.
  let tracked = [];
  try {
    tracked = execSync("git ls-files", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    // not a git repository — coverage cannot be checked
  }
  if (tracked.length > 0) {
    const category = (file) => {
      const inInstance = manifest.instance.some((entry) => matchesEntry(file, entry));
      const inTemplates = templates.some((entry) => matchesEntry(file, entry.from));
      const inOptional = (manifest.optionalComponents ?? []).some((component) =>
        (component.markers ?? []).some((marker) => matchesEntry(file, marker)),
      );
      const inCore = manifest.core.some((entry) => matchesEntry(file, entry));
      const inProduct = manifest.productRoots.some((entry) => matchesEntry(file, entry));
      if (inInstance && inTemplates) return "ambiguous";
      if (inInstance) return "instance";
      if (inTemplates) return "template";
      if (inOptional) return "optional";
      if (inCore) return "core";
      if (inProduct) return "product";
      return "unclassified";
    };
    for (const file of tracked) {
      const result = category(file);
      if (result === "unclassified") {
        fail("manifest does not classify tracked file: " + file);
      }
      if (result === "ambiguous") {
        fail("manifest classifies " + file + " as both instance and template");
      }
    }
  }
  pass("Harness manifest is valid and classifies every tracked file");
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
  const { features } = loadFeaturesWithState();
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
  // The adoption matrix is the real e2e layer (feat-004). It generates
  // throwaway adopter repos from the manifest and runs the harness in each.
  if (process.env.CW_ADOPTION_CELL === "1") {
    console.log("[SKIP] e2e skipped inside an adoption cell (matrix recursion guard)");
    return;
  }
  const matrix = path.join("scripts", "adoption-matrix.mjs");
  if (!existsSync(matrix)) {
    console.log("[SKIP] Adoption matrix not present — e2e layer not configured");
    return;
  }
  const result = spawnSync(process.execPath, [matrix], { stdio: "inherit" });
  const exit = result.error ? 1 : (result.status ?? 1);
  if (exit !== 0) {
    process.exit(1);
  }
}

function reportDevStatus() {
  console.log("[SKIP] No dev server configured - wire a real dev flow before claiming this layer");
  process.exit(0);
}
function recordFeaturePass(featureId, evidence) {
  const { features } = loadFeatures();
  if (!features.some((item) => item.id === featureId)) {
    fail(`feature ${featureId} not found`);
  }
  // Writes only the shard — feature_list.json is never rewritten here, which
  // is the entire point: two lanes recording evidence for two different
  // features touch two different files and merge without conflict.
  writeFeatureState(featureId, { state: "passing", evidence });
  pass(`Recorded passing evidence for ${featureId}`);
}

// ---- Ported harness operations (previously bash) -----------------------

const LAYER_BANNERS = {
  lint: "Layer 1: Static Analysis",
  typecheck: "Layer 1b: Type Checking",
  test: "Layer 2: Runtime Tests",
  build: "Layer 3: Build",
  e2e: "Layer 3b: E2E Tests",
  dev: "Dev Server",
};

// Run one verification layer against the detected project stack.
// PASS when the resolved command exits with an allowed code, SKIP when the
// layer is not configured, FAIL otherwise (non-zero exit stops the chain).
function runLayer(layer) {
  const banner = LAYER_BANNERS[layer];
  if (!banner) {
    fail(`run-layer: unknown layer ${layer ?? "<none>"} (expected one of ${LAYERS.join(", ")})`);
  }

  console.log(`=== ${banner} ===`);
  const stack = detectRuntime();
  const { cmd, skip } = resolveLayer(stack, layer);

  if (!cmd) {
    console.log(`  [SKIP] ${skip}`);
    return;
  }
  // Guard against a layer script that delegates straight back to the runner
  // (e.g. a generator that injected `run-layer` as the script itself).
  if (cmd.includes("run-layer")) {
    console.log("  [SKIP] layer script delegates back to the harness runner without a direct layer command");
    return;
  }

  // Node scripts rely on node_modules/.bin (eslint, tsc, …); npm adds it to
  // PATH when running scripts, so mirror that here for direct execution.
  const env = stack === "node"
    ? {
        ...process.env,
        PATH: `${path.join(process.cwd(), "node_modules", ".bin")}${path.delimiter}${process.env.PATH ?? ""}`,
      }
    : process.env;

  try {
    execSync(cmd, { stdio: "inherit", shell: true, env });
    console.log(`  [PASS] ${banner} complete (${cmd})`);
  } catch (err) {
    // pytest exits 5 when no tests were collected — not a failure.
    const allowed = stack === "python" && layer === "test" ? [0, 5] : [0];
    if (allowed.includes(err.status ?? 1)) {
      console.log(`  [PASS] ${banner} complete (${cmd})`);
    } else {
      console.log(`  [FAIL] ${banner} failed (exit ${err.status ?? 1})`);
      process.exit(1);
    }
  }
}

// arch-005 (and any rule built on the "manifest" mode's classification
// coverage) only sees git-tracked files via `git ls-files` — a new file
// silently passes coverage until it's `git add`ed, then fails once it is,
// often first noticed in CI rather than locally (dogfooding feedback,
// Tier 1 item 1). Warn, don't fail: this is a heads-up about what the rule
// results below can and can't see yet, not a violation of anything.
function warnUntrackedFiles() {
  let untracked = [];
  try {
    untracked = execSync("git ls-files --others --exclude-standard", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    return; // not a git repository — nothing to warn about
  }
  if (untracked.length === 0) {
    return;
  }
  console.log(
    `[WARN] ${untracked.length} untracked file(s) exist — coverage rules below (e.g. arch-005) only see files git already tracks. Run \`git add\` then re-run check-arch to see what CI will actually evaluate:`,
  );
  for (const file of untracked.slice(0, 10)) {
    console.log(`         ${file}`);
  }
  if (untracked.length > 10) {
    console.log(`         ...and ${untracked.length - 10} more`);
  }
  console.log("");
}

function checkArch() {
  const rulesPath = ".harness/arch-rules.json";
  if (!existsSync(rulesPath)) {
    console.log("=== Architecture check skipped: no arch-rules.json found ===");
    return;
  }

  console.log("=== Architecture Constraint Check ===");
  console.log("");
  warnUntrackedFiles();
  const rules = readJson(rulesPath).rules ?? [];
  if (!Array.isArray(rules) || rules.length === 0) {
    console.log("[PASS] No architecture rules defined (acceptable for bootstrap)");
    return;
  }

  console.log(`Evaluating ${rules.length} rules...`);
  console.log("");
  let passing = true;

  for (const rule of rules) {
    console.log(`Rule: ${rule.id} — ${rule.description}`);
    let output = "";
    try {
      output = execSync(rule.check, { encoding: "utf8", shell: true });
    } catch (err) {
      output = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    }

    let matched = false;
    try {
      matched = new RegExp(rule.expect).test(output);
    } catch {
      fail(`rule ${rule.id} has an invalid expect pattern: ${rule.expect}`);
    }

    if (matched) {
      console.log("  [PASS]");
    } else {
      console.log(`  [FAIL] ${rule.what}`);
      console.log(`  Why: ${rule.why}`);
      console.log(`  Fix: ${rule.fix}`);
      console.log("");
      passing = false;
    }
  }

  console.log("");
  if (passing) {
    console.log("=== All architecture rules pass ===");
  } else {
    console.log("=== Architecture constraint violations found ===");
    process.exit(1);
  }
}

function verifyFeature(featureId) {
  if (!featureId) {
    fail("usage: node scripts/framework-check.mjs verify-feature <feature-id>");
  }

  console.log(`=== Verifying feature: ${featureId} ===`);
  console.log("");

  const { features } = loadFeaturesWithState();
  const feature = features.find((item) => item.id === featureId);
  if (!feature) {
    console.log(`[FAIL] Feature ${featureId} not found in feature_list.json`);
    process.exit(1);
  }

  console.log(`Feature: ${feature.name}`);
  console.log("");

  const unmet = (feature.dependencies ?? []).filter((dependencyId) => {
    const dependency = features.find((item) => item.id === dependencyId);
    return !dependency || getFeatureState(dependency) !== "passing";
  });
  if (unmet.length > 0) {
    console.log(`[FAIL] Feature ${featureId} has unmet dependencies: ${unmet.join(", ")}`);
    console.log("Complete and verify the dependency features first.");
    console.log("");
    console.log(`=== Feature ${featureId}: VERIFICATION FAILED ===`);
    process.exit(1);
  }

  const skippedLayers = [];
  for (const layer of feature.layers) {
    console.log(`--- ${layer.label} ---`);
    console.log(`Running: ${layer.cmd}`);
    console.log("");

    try {
      const output = execSync(layer.cmd, { encoding: "utf8", stdio: ["inherit", "pipe", "inherit"], shell: true });
      const reportedSkip = output.split(/\r?\n/).some((line) => line.includes("[SKIP]"));
      if (reportedSkip) skippedLayers.push(layer.label);
      console.log("");
      console.log(`  [PASS] ${layer.label}`);
      console.log("");
    } catch {
      console.log("");
      console.log(`  [FAIL] ${layer.label}`);
      console.log("");
      if (layer.repair) {
        console.log(`Repair hint: ${layer.repair}`);
      }
      console.log("");
      console.log(`=== Feature ${featureId}: VERIFICATION FAILED ===`);
      process.exit(1);
    }
  }

  console.log(`=== Feature ${featureId}: ALL LAYERS PASS ===`);
  if (skippedLayers.length > 0) {
    console.log(`Note: these layers reported SKIP inside a passing run: ${skippedLayers.join(", ")}`);
  }
  const skipNote = skippedLayers.length > 0 ? ` (SKIP reported in: ${skippedLayers.join(", ")})` : "";
  const evidence = `All verification layers passed via node scripts/framework-check.mjs verify-feature at ${new Date().toISOString()}${skipNote}`;
  recordFeaturePass(featureId, evidence);
  console.log(`Evidence recorded in ${featureStatePath(featureId)}`);
}

function tryGit(args) {
  try {
    return execSync(`git ${args}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || "unknown";
  } catch {
    return "unknown";
  }
}

function isGitRepo() {
  try {
    execSync("git rev-parse --git-dir", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// ---- Worktree lanes (feat-010, D-017) -----------------------------------
// A lane is a sibling git worktree checked out on branch `lane/<feature-id>`.
// Git's own branch-checkout exclusivity — a branch can only be checked out
// in one worktree at a time — is the coordination primitive; no lock file
// or lease is needed. Args are passed via spawnSync argv arrays (no shell)
// so worktree paths containing spaces are never reinterpreted.

function gitCapture(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.error || (result.status ?? 1) !== 0) {
    return null;
  }
  return (result.stdout ?? "").replace(/\r?\n$/, "");
}

function getCurrentBranch() {
  // symbolic-ref (not rev-parse --abbrev-ref) so this resolves on an unborn
  // branch too (a freshly created branch with zero commits) — rev-parse
  // fails with "ambiguous argument 'HEAD'" until the first commit exists.
  return gitCapture(["symbolic-ref", "--short", "HEAD"]) ?? "";
}

function laneFeatureIdFromBranch(branch) {
  const match = /^lane\/(.+)$/.exec(branch ?? "");
  return match ? match[1] : null;
}

function laneBranchName(featureId) {
  return `lane/${featureId}`;
}

function branchExists(branch) {
  const result = spawnSync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
  return (result.status ?? 1) === 0;
}

function findWorktreeForBranch(branch) {
  const list = gitCapture(["worktree", "list", "--porcelain"]) ?? "";
  for (const block of list.split(/\r?\n\r?\n/)) {
    const pathMatch = /^worktree (.+)$/m.exec(block);
    const branchMatch = /^branch refs\/heads\/(.+)$/m.exec(block);
    if (pathMatch && branchMatch && branchMatch[1] === branch) {
      return pathMatch[1];
    }
  }
  return null;
}

function ensureLaneWipContract() {
  const laneFeatureId = laneFeatureIdFromBranch(getCurrentBranch());
  if (!laneFeatureId || !existsSync("feature_list.json")) {
    return;
  }
  const { features } = loadFeaturesWithState();
  const active = features.filter((feature) => getFeatureState(feature) === "active");
  if (active.length === 1 && active[0].id !== laneFeatureId) {
    fail(
      `lane branch lane/${laneFeatureId} owns feature ${laneFeatureId}, but feature_list.json marks ${active[0].id} active — a lane may only activate the feature it is named for`,
    );
  }
}

function repoRoot() {
  const root = gitCapture(["rev-parse", "--show-toplevel"]);
  if (!root) {
    fail("not a git repository — worktree lanes require git");
  }
  return path.resolve(root);
}

function laneWorktreePath(featureId) {
  const root = repoRoot();
  return path.join(path.dirname(root), `${path.basename(root)}-lane-${featureId}`);
}

function laneNew(featureId) {
  if (!featureId) {
    fail("usage: node scripts/framework-check.mjs lane-new <feature-id>");
  }
  const branch = laneBranchName(featureId);
  const existingWorktree = findWorktreeForBranch(branch);
  if (existingWorktree) {
    console.log(`Lane already exists: ${branch} at ${existingWorktree}`);
    return;
  }

  const { features } = loadFeaturesWithState();
  const feature = features.find((item) => item.id === featureId);
  if (!feature) {
    fail(`feature ${featureId} not found in feature_list.json`);
  }
  const currentState = feature.state;
  if (currentState === "passing") {
    fail(`feature ${featureId} is already passing — nothing to do`);
  }
  if (currentState === "blocked") {
    fail(`feature ${featureId} is blocked — unblock it before starting a lane`);
  }
  const unmet = getFeatureDependencies(feature).filter((dependencyId) => {
    const dependency = features.find((item) => item.id === dependencyId);
    return !dependency || dependency.state !== "passing";
  });
  if (unmet.length > 0) {
    fail(`feature ${featureId} has unmet dependencies: ${unmet.join(", ")} — complete those first`);
  }

  const worktreeDir = laneWorktreePath(featureId);
  const addArgs = branchExists(branch)
    ? ["worktree", "add", worktreeDir, branch]
    : ["worktree", "add", "-b", branch, worktreeDir];
  console.log(`=== Creating lane: ${branch} ===`);
  const result = spawnSync("git", addArgs, { stdio: "inherit" });
  if ((result.status ?? 1) !== 0) {
    fail(`git worktree add failed for ${branch}`);
  }

  if (currentState !== "active") {
    const shardDir = path.join(worktreeDir, featureStateDir);
    mkdirSync(shardDir, { recursive: true });
    writeFileSync(
      path.join(shardDir, `${featureId}.json`),
      `${JSON.stringify({ state: "active", evidence: feature.evidence }, null, 2)}${EOL}`,
      "utf8",
    );
  }

  console.log("");
  console.log(`Lane ready: ${worktreeDir}`);
  console.log(`Branch: ${branch}`);
  console.log(`Feature ${featureId} marked active in the lane's ${featureStateDir}/${featureId}.json (uncommitted).`);
  console.log("Next: work the feature inside that worktree, verify, commit, then run lane-land from the branch you want to merge into.");
}

function readFeatureStateAt(worktreePath, featureId) {
  return readFeatureStateFrom(path.join(worktreePath, featureStatePath(featureId)));
}

function readFeatureStateAtRef(branch, featureId) {
  // git object pathspecs are always forward-slash, regardless of host OS —
  // featureStatePath() uses path.join (backslashes on Windows), so build the
  // pathspec directly instead of reusing it here.
  const content = gitCapture(["show", `${branch}:${featureStateDir}/${featureId}.json`]);
  if (!content) {
    return { state: "planned", evidence: "" };
  }
  try {
    const shard = JSON.parse(content);
    return { state: getFeatureState(shard) ?? "planned", evidence: typeof shard.evidence === "string" ? shard.evidence : "" };
  } catch {
    return { state: "planned", evidence: "" };
  }
}

function laneList() {
  const laneRefs = (gitCapture(["for-each-ref", "--format=%(refname:short)", "refs/heads/lane"]) ?? "")
    .split(/\r?\n/)
    .filter(Boolean);
  if (laneRefs.length === 0) {
    console.log("No lanes found (no local lane/* branches).");
    return;
  }
  console.log("=== Lanes ===");
  console.log("");
  for (const branch of laneRefs) {
    const featureId = laneFeatureIdFromBranch(branch);
    const worktreePath = findWorktreeForBranch(branch);
    const { state } = worktreePath
      ? readFeatureStateAt(worktreePath, featureId)
      : readFeatureStateAtRef(branch, featureId);
    console.log(`  ${branch}  feature=${featureId}  state=${state}  worktree=${worktreePath ?? "(none)"}`);
  }
}

function laneLand(featureId) {
  if (!featureId) {
    fail("usage: node scripts/framework-check.mjs lane-land <feature-id>");
  }
  const branch = laneBranchName(featureId);
  if (!branchExists(branch)) {
    fail(`lane branch ${branch} does not exist`);
  }
  const { state } = readFeatureStateAtRef(branch, featureId);
  if (state !== "passing") {
    fail(`feature ${featureId} is not marked passing on ${branch} — verify and commit it in the lane before landing`);
  }

  const status = gitCapture(["status", "--porcelain"]) ?? "";
  if (status.trim()) {
    fail("current branch has uncommitted changes — commit or stash before landing a lane");
  }

  console.log(`=== Landing lane: ${branch} into ${getCurrentBranch()} ===`);
  const merge = spawnSync("git", ["merge", "--no-ff", branch, "-m", `Merge lane ${branch} (feature ${featureId})`], {
    stdio: "inherit",
  });
  if ((merge.status ?? 1) !== 0) {
    fail(`merge of ${branch} failed — resolve conflicts, then finish the merge manually`);
  }

  const worktreePath = findWorktreeForBranch(branch);
  if (worktreePath) {
    const remove = spawnSync("git", ["worktree", "remove", worktreePath], { stdio: "inherit" });
    if ((remove.status ?? 1) !== 0) {
      console.log(`[WARN] could not remove worktree ${worktreePath} automatically — remove it manually once clean`);
    }
  }
  const deleteBranch = spawnSync("git", ["branch", "-d", branch], { stdio: "inherit" });
  if ((deleteBranch.status ?? 1) !== 0) {
    console.log(`[WARN] could not delete branch ${branch} automatically — delete it manually if no longer needed`);
  }

  console.log("");
  console.log(`Lane landed: ${branch} merged, worktree and branch cleaned up.`);
}

function laneDrop(featureId) {
  if (!featureId) {
    fail("usage: node scripts/framework-check.mjs lane-drop <feature-id>");
  }
  const branch = laneBranchName(featureId);
  const worktreePath = findWorktreeForBranch(branch);
  if (!worktreePath) {
    fail(`no worktree found for lane ${branch}`);
  }
  console.log(`=== Dropping lane: ${branch} ===`);
  const result = spawnSync("git", ["worktree", "remove", worktreePath], { stdio: "inherit" });
  if ((result.status ?? 1) !== 0) {
    fail(
      `could not remove worktree ${worktreePath} — commit, stash, or discard its changes first (git worktree remove --force will discard them, run it yourself if that is what you intend)`,
    );
  }
  console.log("");
  console.log(`Worktree removed. Branch ${branch} still exists — delete it manually (git branch -D ${branch}) if it's no longer needed.`);
}

function collectModifiedFiles() {
  const files = new Set();
  for (const cmd of ["git diff --name-only --relative", "git ls-files --others --exclude-standard"]) {
    try {
      const output = execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      for (const line of output.split(/\r?\n/)) {
        if (line.trim()) files.add(line.trim());
      }
    } catch {
      // not a git repository — leave empty
    }
  }
  return Array.from(files);
}

function collectDecisionsSummary() {
  let count = 0;
  let latest = "";
  if (existsSync("DECISIONS.md")) {
    for (const line of readText("DECISIONS.md").split(/\r?\n/)) {
      // Only real decision records (D-001, D-002, …) count; the template
      // block at the top of the file must not be counted.
      if (/^### D-\d+:/.test(line)) {
        count += 1;
        latest = line.replace(/^### /, "");
      }
    }
  }
  return { count, latest };
}

function collectVerificationSummary(timestamp, activeFeature) {
  if (!existsSync("feature_list.json")) {
    return { timestamp, active_feature: activeFeature, feature_evidence: "", layers: [] };
  }
  const { features } = loadFeaturesWithState();
  const active = features.find((feature) => getFeatureState(feature) === "active") ?? {};
  return {
    timestamp,
    active_feature: activeFeature,
    feature_evidence: active.evidence ?? "",
    layers: (active.layers ?? []).map((layer) => ({ label: layer.label, cmd: layer.cmd })),
  };
}

function sessionTrace(submode) {
  if (submode !== "start" && submode !== "end") {
    fail("usage: node scripts/framework-check.mjs session-trace start|end");
  }

  const tracesDir = ".harness/traces";
  mkdirSync(tracesDir, { recursive: true });
  const now = new Date();
  const iso = now.toISOString();
  const digits = iso.replace(/\D/g, "");
  const stamp = `${digits.slice(0, 8)}-${digits.slice(8, 14)}`;
  const gitBranch = tryGit("branch --show-current");
  const gitCommit = tryGit("rev-parse --short HEAD");
  const activeFeature = getActiveFeatureId();

  if (submode === "start") {
    const record = {
      session_start: iso,
      git_branch: gitBranch,
      git_commit: gitCommit,
      active_feature: activeFeature,
    };
    const file = path.join(tracesDir, `session-start-${stamp}.json`);
    writeFileSync(file, `${JSON.stringify(record, null, 2)}${EOL}`, "utf8");
    console.log(`Session start recorded: ${file}`);
    console.log(`Active feature: ${activeFeature || "none"}`);
    return;
  }

  const endFields = {
    session_end: iso,
    end_git_branch: gitBranch,
    end_git_commit: gitCommit,
    end_active_feature: activeFeature,
    verification_results: collectVerificationSummary(iso, activeFeature),
    files_modified: collectModifiedFiles(),
    decisions_recorded: collectDecisionsSummary(),
  };

  // Zero-padded stamps sort chronologically, so the last name is the newest start.
  const startFiles = readdirSync(tracesDir)
    .filter((name) => name.startsWith("session-start-") && name.endsWith(".json"))
    .sort();
  const latestStart = startFiles.length > 0 ? path.join(tracesDir, startFiles[startFiles.length - 1]) : "";

  if (!latestStart) {
    const file = path.join(tracesDir, `session-${stamp}-end.json`);
    const record = {
      ...endFields,
      git_branch: gitBranch,
      git_commit: gitCommit,
      active_feature: activeFeature,
      note: "No matching session-start trace found",
    };
    writeFileSync(file, `${JSON.stringify(record, null, 2)}${EOL}`, "utf8");
    console.log(`Session end recorded (no start trace): ${file}`);
    return;
  }

  const merged = { ...readJson(latestStart), ...endFields };
  const tmp = `${latestStart}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(merged, null, 2)}${EOL}`, "utf8");
  renameSync(tmp, latestStart);
  console.log(`Session end recorded in: ${latestStart}`);
}

function scanDebugArtifacts(scanPaths, excludeDirs) {
  const patterns = [
    { exts: new Set([".ts", ".js", ".tsx", ".jsx"]), re: /console\.(log|debug|dir)\(|debugger/ },
    { exts: new Set([".py"]), re: /print\(|pdb\.set_trace/ },
    { exts: new Set([".go"]), re: /fmt\.Println\(|log\.Print/ },
  ];
  const hits = [];

  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!excludeDirs.has(entry.name)) walk(full);
        continue;
      }
      const ext = path.extname(entry.name);
      for (const pattern of patterns) {
        if (!pattern.exts.has(ext)) continue;
        try {
          const lines = readText(full).split(/\r?\n/);
          lines.forEach((line, index) => {
            if (pattern.re.test(line)) hits.push(`${full}:${index + 1}: ${line.trim()}`);
          });
        } catch {
          // unreadable file — skip
        }
      }
    }
  };

  for (const scanPath of scanPaths) {
    walk(scanPath);
  }
  return hits;
}

function cleanStateCheck() {
  console.log("=== Clean State Check ===");
  console.log("");
  let passing = true;
  const check = (ok, passMessage, failMessage) => {
    if (ok) {
      console.log(`  [PASS] ${passMessage}`);
    } else {
      console.log(`  [FAIL] ${failMessage}`);
      passing = false;
    }
  };

  console.log("--- Harness Files ---");
  for (const file of ["AGENTS.md", "CLAUDE.md", "codex.md", "GEMINI.md", "feature_list.json", "DECISIONS.md", "session-handoff.md", "Makefile"]) {
    check(existsSync(file), file, `${file} is missing`);
  }
  if (existsSync("PROGRESS.md")) {
    console.log("  [PASS] PROGRESS.md");
  } else if (existsSync("progress.md")) {
    console.log("  [PASS] progress.md (legacy naming)");
  } else if (existsSync("claude-progress.md")) {
    console.log("  [PASS] claude-progress.md");
  } else {
    check(false, "", "PROGRESS.md (or legacy progress.md) or claude-progress.md is missing");
  }
  for (const dir of ["docs", "templates", "scripts", ".harness", "skills"]) {
    check(existsSync(dir) && statSync(dir).isDirectory(), `${dir}/`, `${dir}/ is missing`);
  }

  console.log("");
  console.log("--- Git Status ---");
  if (isGitRepo()) {
    const status = execSync("git status --porcelain", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    if (status.trim()) {
      console.log("  [FAIL] Uncommitted changes:");
      console.log(execSync("git status --short", { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trimEnd());
      passing = false;
    } else {
      console.log("  [PASS] Working tree clean");
    }
  } else {
    console.log("  [WARN] Not a git repository");
  }

  console.log("");
  console.log("--- Debug Artifacts ---");
  const envScanPaths = (process.env.DEBUG_SCAN_PATHS ?? "").split(/\s+/).filter(Boolean);
  const candidates = ["src", "app", "apps", "lib", "packages", "services", "backend", "frontend"];
  const scanPaths = envScanPaths.length > 0
    ? envScanPaths
    : candidates.filter((dir) => existsSync(dir) && statSync(dir).isDirectory());
  const finalScanPaths = scanPaths.length > 0 ? scanPaths : ["."];
  const excludeDirs = new Set(
    (process.env.DEBUG_SCAN_EXCLUDE_DIRS ?? ".git node_modules dist build .harness base").split(/\s+/).filter(Boolean),
  );
  const hits = scanDebugArtifacts(finalScanPaths, excludeDirs);
  if (hits.length > 0) {
    console.log("  [WARN] Potential debug statements found (review before committing):");
    for (const hit of hits) {
      console.log(`    ${hit}`);
    }
  } else {
    console.log("  [PASS] No obvious debug artifacts");
  }

  console.log("");
  console.log("--- Feature State ---");
  if (existsSync("feature_list.json")) {
    const { features } = loadFeaturesWithState();
    const activeCount = features.filter((feature) => getFeatureState(feature) === "active").length;
    check(activeCount <= 1, `WIP=${activeCount} (at most 1 active feature)`, `WIP=${activeCount} (multiple active features)`);
  } else {
    console.log("  [WARN] Cannot verify feature state (feature_list.json missing)");
  }

  console.log("");
  console.log("--- OS Artifacts ---");
  let staged = "";
  try {
    staged = execSync("git diff --cached --name-only", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    // not a git repository — nothing staged
  }
  const osArtifacts = staged.split(/\r?\n/).filter((line) => /\.DS_Store$|Thumbs\.db$/.test(line));
  check(
    osArtifacts.length === 0,
    "No OS artifacts staged",
    `OS artifacts staged: ${osArtifacts.join(", ")}`,
  );

  console.log("");
  if (passing) {
    console.log("=== Clean state check: ALL PASS ===");
    console.log("Ready to commit.");
  } else {
    console.log("=== Clean state check: FAILURES DETECTED ===");
    console.log("Fix issues above before committing.");
    process.exit(1);
  }
}

function runSetup() {
  console.log("=== Installing dependencies ===");
  const command = getInstallCommand();
  if (!command) {
    console.log("  [INFO] No dependency manifest found — skipping");
  } else {
    execSync(command, { stdio: "inherit", shell: true });
  }
  console.log("  [PASS] Setup complete");
}

function runVerifyAll() {
  const script = "scripts/verify-all";
  if (!existsSync(script)) {
    console.log("[SKIP] Multi-repo component not activated (scripts/verify-all absent)");
    console.log("  Activate it by copying the templates/multi-repo skeletons to their declared destinations.");
    return;
  }
  try {
    const result = spawnSync(process.execPath, [script], { stdio: "inherit" });
    if (result.error || (result.status ?? 1) !== 0) {
      console.log(`[FAIL] verify-all failed (exit ${result.error ? 1 : result.status})`);
      process.exit(1);
    }
  } catch (err) {
    console.log(`[FAIL] verify-all failed (${err.message})`);
    process.exit(1);
  }
}

function runVerifyChain() {
  const chain = getVerifyChain();
  if (chain.length === 0) {
    console.log("=== No application runtime detected (harness-only bootstrap) ===");
    console.log("This is expected during initial harness setup.");
    return;
  }
  for (const step of chain) {
    const display = step.args ? `${step.cmd} ${step.args.join(" ")}` : step.cmd;
    console.log(`--- Running: ${display} ---`);
    const allowed = step.allowedExitCodes ?? [0];
    if (Array.isArray(step.args)) {
      // Run without a shell so argument characters (|, quotes, $) are never
      // reinterpreted — cmd.exe treats single quotes as literal and `|` as a
      // pipe, which broke python's compileall regex on Windows.
      const result = spawnSync(step.cmd, step.args, { stdio: "inherit" });
      const code = result.error ? 1 : (result.status ?? 1);
      if (!allowed.includes(code)) {
        process.exit(1);
      }
    } else {
      try {
        execSync(step.cmd, { stdio: "inherit", shell: true });
      } catch (err) {
        if (!allowed.includes(err.status ?? 1)) {
          process.exit(1);
        }
      }
    }
  }
}

function printHelp() {
  console.log("Available targets (every make target is mirrored by an npm script):");
  console.log("");
  console.log("  setup          Install all dependencies from scratch");
  console.log("  dev            Start local development server");
  console.log("  check          Full verification: lint → typecheck → test → build → e2e");
  console.log("  lint           Layer 1: static analysis");
  console.log("  typecheck      Layer 1b: type checking");
  console.log("  test           Layer 2: runtime tests");
  console.log("  build          Layer 3: build verification");
  console.log("  e2e            Layer 3b: end-to-end tests");
  console.log("  check-arch     Architecture constraint enforcement");
  console.log("  verify-feature F=<id>  Run all verification layers for a feature");
  console.log("  activate F=<id>        Activate a feature when dependencies allow");
  console.log("  lane-new F=<id>   Create a sibling git worktree lane on branch lane/<id>");
  console.log("  lane-list         List local lane/* branches, their feature, state, worktree");
  console.log("  lane-land F=<id>  Merge a passing lane back and clean up its worktree/branch");
  console.log("  lane-drop F=<id>  Abandon a lane's worktree without merging");
  console.log("  migrate-feature-state  Move inline state/evidence into .harness/state/<id>.json");
  console.log("  add-feature ID=<id> NAME=<name>  Append a declaration-only feature stub");
  console.log("  vcr            verify + check-arch + record trail");
  console.log("  session-start  Record session start");
  console.log("  session-end    Record session end");
  console.log("  clean-check    Pre-commit clean state verification");
  console.log("  help           Show this help");
  console.log("");
  console.log("Make form:  make <target>            npm form:  npm run <target>");
  console.log("Feature verification: make verify-feature F=<id>   or   npm run verify-feature -- <id>");
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
    ensureSkills();
    ensureCommandSurfaces();
    ensureProgressLog();
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
    ensureLaneWipContract();
    pass("Feature dependency graph and WIP contract are valid");
    // Unit tests for the runner's own logic (node:test) run as part of Layer 2.
    // Files are enumerated and passed explicitly: glob patterns in --test args
    // are expanded by Node on Windows but passed literally on Linux.
    if (existsSync("tests")) {
      const testFiles = readdirSync("tests")
        .filter((name) => name.endsWith(".test.mjs"))
        .map((name) => path.join("tests", name));
      if (testFiles.length > 0) {
        const result = spawnSync(process.execPath, ["--test", ...testFiles], { stdio: "inherit" });
        const exit = result.error ? 1 : (result.status ?? 1);
        if (exit !== 0) {
          fail("runner unit tests failed");
        }
        pass("Runner unit tests pass");
      }
    }
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
    ensureLaneWipContract();
    console.log("PASS");
    break;
  }
  case "arch:no-placeholders": {
    ensureNoPlaceholders();
    console.log("PASS");
    break;
  }
  case "lint:progress-log": {
    ensureProgressLog();
    break;
  }
  case "arch:sharded-state": {
    ensureFeatureShape();
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
  case "run-layer": {
    runLayer(args[0]);
    break;
  }
  case "check-arch": {
    checkArch();
    break;
  }
  case "verify-feature": {
    verifyFeature(args[0]);
    break;
  }
  case "session-trace": {
    sessionTrace(args[0]);
    break;
  }
  case "clean-state-check": {
    cleanStateCheck();
    break;
  }
  case "setup": {
    runSetup();
    break;
  }
  case "verify-all": {
    runVerifyAll();
    break;
  }
  case "lane-new": {
    laneNew(args[0]);
    break;
  }
  case "lane-list": {
    laneList();
    break;
  }
  case "lane-land": {
    laneLand(args[0]);
    break;
  }
  case "lane-drop": {
    laneDrop(args[0]);
    break;
  }
  case "migrate-feature-state": {
    migrateFeatureState();
    break;
  }
  case "add-feature": {
    addFeature(args[0], args.slice(1));
    break;
  }
  case "activate": {
    activateFeature(args[0]);
    break;
  }
  case "verify-chain": {
    runVerifyChain();
    break;
  }
  case "help": {
    printHelp();
    break;
  }
  default:
    fail(`unknown mode ${mode ?? "<none>"}`);
}
