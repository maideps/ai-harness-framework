// Builds one throwaway adopter repository for an eval task (feat-033): the harness as
// create-harness places it, docs filled in so lint passes, the task's features and files,
// and git history the agent starts from. Everything happens in a fresh temporary folder.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CREATE_HARNESS = path.join(FRAMEWORK_ROOT, "scripts", "create-harness.mjs");
const GIT_IDENTITY = ["-c", "user.name=eval", "-c", "user.email=eval@example.com"];

// The three docs create-harness asks an adopter to fill in (lint fails while they match the
// templates). README must link the generated command reference.
const FILLED_DOCS = {
  "README.md": "# Eval App\n\nA small project used to evaluate an agent working under the harness.\n\nCommands: [Harness Command Reference](docs/HARNESS.md)\n",
  "docs/PRODUCT.md": "# Product\n\nA small project used to evaluate an agent working under the harness.\n",
  "docs/quality-document.md": "# Quality\n\nNothing rated yet.\n",
};

function run(cmd, args, cwd, { allowFail = false } = {}) {
  // NODE_TEST_CONTEXT from a `node --test` parent would make the fixture's own tests skip.
  const env = { ...process.env, CW_INIT_SH: "" };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(cmd, args, { cwd, encoding: "utf8", env });
  const exit = result.error ? 1 : (result.status ?? 1);
  if (exit !== 0 && !allowFail) {
    throw new Error(`fixture: ${cmd} ${args.join(" ")} failed (exit ${exit})\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  }
  return { exit, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

const runner = (root, ...args) => run(process.execPath, [path.join("scripts", "framework-check.mjs"), ...args], root);
const git = (root, ...args) => run("git", [...GIT_IDENTITY, ...args], root);

function writeFiles(root, files = {}) {
  for (const [rel, content] of Object.entries(files)) {
    const dest = path.join(root, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, content, "utf8");
  }
}

function commitAll(root, message) {
  git(root, "add", "-A");
  // Nothing to commit is fine: a step may only touch ignored files.
  run("git", [...GIT_IDENTITY, "commit", "-q", "-m", message], root, { allowFail: true });
}

// A task feature becomes a real declaration through the runner's own add-feature, so the
// fixture follows the same rules the agent does.
function declareFeature(root, feature) {
  const args = ["add-feature", feature.id, feature.name, "--behavior", feature.behavior, "--verification", feature.verification ?? feature.behavior];
  if (feature.depends?.length) args.push("--depends", feature.depends.join(","));
  for (const layer of feature.layers ?? []) args.push("--layer", `${layer.label}=${layer.cmd}`);
  runner(root, ...args);
}

function featureStates(root) {
  const dir = path.join(root, ".harness", "state");
  const states = {};
  if (!existsSync(dir)) return states;
  for (const name of readdirSync(dir).filter((file) => file.endsWith(".json"))) {
    try {
      states[name.replace(/\.json$/, "")] = JSON.parse(readFileSync(path.join(dir, name), "utf8")).state;
    } catch {
      // an unreadable shard is graded later, not here
    }
  }
  return states;
}

/**
 * Build the fixture for one task. Returns { root, baseline } where baseline records the commit
 * and feature states the agent starts from, and the files present in progress/.
 *
 * Setup order: create-harness, filled docs, task files, declared features, commit; features
 * marked "passing" go through activate + a bound verify-feature; features marked "active" are
 * activated; then `setup.afterFiles` (for example a regression) is committed on top.
 */
export function buildFixture(task, { parent } = {}) {
  const base = parent ?? mkdtempSync(path.join(os.tmpdir(), "harness-eval-"));
  const root = path.join(base, task.id);
  run(process.execPath, [CREATE_HARNESS, root], FRAMEWORK_ROOT);
  writeFiles(root, FILLED_DOCS);
  writeFiles(root, task.setup?.files);
  // A real adopter replaces the template's placeholder feature with its own.
  const listPath = path.join(root, "feature_list.json");
  const list = JSON.parse(readFileSync(listPath, "utf8"));
  list.features = list.features.filter((feature) => feature.name !== "Example Feature");
  writeFileSync(listPath, `${JSON.stringify(list, null, 2)}\n`, "utf8");
  // Product tests chained into the harness's own layer scripts, as docs/USAGE.md describes.
  if (task.setup?.packageScripts) {
    const pkgPath = path.join(root, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    Object.assign(pkg.scripts, task.setup.packageScripts);
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  }
  run("git", ["init", "-q"], root);
  commitAll(root, "Adopt the harness");

  for (const feature of task.setup?.features ?? []) declareFeature(root, feature);
  runner(root, "progress-update");
  commitAll(root, "Declare features");

  for (const feature of (task.setup?.features ?? []).filter((item) => item.state === "passing")) {
    runner(root, "activate", feature.id);
    commitAll(root, `Start ${feature.id}`);
    runner(root, "verify-feature", feature.id);
    // What a compliant earlier session leaves: clean-check expects every gate-verified feature
    // named in the quality document (feat-034).
    const quality = path.join(root, "docs", "quality-document.md");
    writeFileSync(quality, `${readFileSync(quality, "utf8").trimEnd()}\n\n- ${feature.id} (${feature.name}): verified in an earlier session.\n`, "utf8");
    commitAll(root, `Verify ${feature.id}`);
  }
  for (const feature of (task.setup?.features ?? []).filter((item) => item.state === "active")) {
    runner(root, "activate", feature.id);
    commitAll(root, `Start ${feature.id}`);
  }
  // A later commit changes a feature's declared layers, making its evidence stale (feat-030).
  if (task.setup?.afterLayers) {
    const declarations = JSON.parse(readFileSync(listPath, "utf8"));
    for (const [id, layers] of Object.entries(task.setup.afterLayers)) {
      const feature = declarations.features.find((item) => item.id === id);
      if (!feature) throw new Error(`fixture: afterLayers names unknown feature ${id}`);
      for (const layer of layers) feature.layers.push({ ...layer, repair: layer.repair ?? `Fix ${layer.label} failures and rerun the layer command.` });
    }
    writeFileSync(listPath, `${JSON.stringify(declarations, null, 2)}\n`, "utf8");
  }
  if (task.setup?.afterFiles) writeFiles(root, task.setup.afterFiles);
  if (task.setup?.afterLayers || task.setup?.afterFiles) commitAll(root, task.setup.afterMessage ?? "Later change");
  // Work a previous session left in the working tree, never committed.
  if (task.setup?.uncommitted) writeFiles(root, task.setup.uncommitted);

  const commit = git(root, "rev-parse", "HEAD").output.trim();
  const progressDir = path.join(root, "progress");
  const baseline = {
    commit,
    states: featureStates(root),
    features: JSON.parse(readFileSync(listPath, "utf8")).features.map((feature) => feature.id),
    progressFiles: existsSync(progressDir) ? readdirSync(progressDir) : [],
  };
  return { root, baseline };
}

export { featureStates, writeFiles };
