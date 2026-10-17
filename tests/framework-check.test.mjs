import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// scripts/framework-check.mjs is a monolithic CLI (fail() calls process.exit
// directly, every mode reads relative to process.cwd()) rather than a module
// of pure exported functions. Unit-testing its rules in isolation means
// spawning it against small fixture repositories and asserting on exit code
// + output — the same technique scripts/adoption-matrix.mjs already uses to
// exercise check-arch and verify-feature in throwaway directories.

const RUNNER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "framework-check.mjs");

function fixture() {
  return mkdtempSync(path.join(os.tmpdir(), "cw-framework-check-"));
}

function write(root, rel, content) {
  const dest = path.join(root, rel);
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, content, "utf8");
}

function run(root, mode, args = [], env = {}) {
  const result = spawnSync(process.execPath, [RUNNER, mode, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 30000,
    env: { ...process.env, ...env },
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const exit = result.error ? 1 : (result.status ?? 1);
  return { exit, stdout, stderr, output: `${stdout}${stderr}` };
}

function cleanup(root) {
  rmSync(root, { recursive: true, force: true });
}

test("clean-state-check: scans the directories derived from productRoots, not hardcoded roots", () => {
  const root = fixture();
  try {
    write(root, ".harness/manifest.json", `${JSON.stringify(baseManifest({ productRoots: ["repositories/"] }))}\n`);
    write(root, "repositories/app/debug.js", "debugger;\n");
    write(root, "src/unrelated.js", "debugger;\n");
    const result = run(root, "clean-state-check", [], { DEBUG_SCAN_PATHS: "" });
    assert.match(result.output, /repositories[\\/]app[\\/]debug\.js:1: debugger;/);
    assert.doesNotMatch(result.output, /src[\/]unrelated\.js/);
  } finally {
    cleanup(root);
  }
});

test("verify-all: skips cleanly when the optional component is absent", () => {
  const root = fixture();
  try {
    const result = run(root, "verify-all");
    assert.equal(result.exit, 0, result.output);
    assert.match(result.stdout, /\[SKIP\] Multi-repo component not activated/);
  } finally {
    cleanup(root);
  }
});

test("verify-all: accepts an ESM root script in a module-typed adopter", () => {
  const root = fixture();
  try {
    write(root, "package.json", JSON.stringify({ type: "module" }));
    write(root, "scripts/verify-all.mjs", "console.log('ESM root script');\n");
    const result = run(root, "verify-all");
    assert.equal(result.exit, 0, result.output);
    assert.match(result.stdout, /ESM root script/);
  } finally {
    cleanup(root);
  }
});

test("e2e: adopter CI skips the framework adoption matrix", () => {
  const root = fixture();
  try {
    const result = run(root, "e2e", [], { CW_SKIP_ADOPTION_MATRIX: "1" });
    assert.equal(result.exit, 0, result.output);
    assert.match(result.stdout, /\[SKIP\] Adoption matrix is reserved for framework repository CI/);
  } finally {
    cleanup(root);
  }
});

// ---- ensureManifest (mode: "manifest") -------------------------------------

function baseManifest(overrides = {}) {
  return {
    harness: "fixture",
    version: "0.0.0",
    schemaVersions: { featureList: 1, archRules: 1, trace: 1, manifest: 1 },
    core: [".harness/manifest.json", ".harness/arch-rules.json", "core-file.txt"],
    instance: ["instance-file.txt"],
    templates: [],
    productRoots: [],
    optionalComponents: [],
    customizationPoints: { mustEdit: [], mayEdit: [], mustNotEdit: [] },
    ...overrides,
  };
}

function manifestFixture(manifest = baseManifest(), { extraTrackedFiles = {}, skipCoreFile = false, skipInstanceFile = false } = {}) {
  const root = fixture();
  write(root, ".harness/manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  write(root, ".harness/arch-rules.json", `${JSON.stringify({ rules: [] }, null, 2)}\n`);
  if (!skipCoreFile) write(root, "core-file.txt", "core\n");
  if (!skipInstanceFile) write(root, "instance-file.txt", "instance\n");
  for (const [rel, content] of Object.entries(extraTrackedFiles)) {
    write(root, rel, content);
  }
  spawnSync("git", ["init", "-q"], { cwd: root });
  spawnSync("git", ["add", "-A"], { cwd: root });
  return root;
}

test("ensureManifest: passes on a fully classified, self-consistent manifest", () => {
  const root = manifestFixture();
  try {
    const result = run(root, "manifest");
    assert.equal(result.exit, 0, result.output);
    assert.match(result.stdout, /PASS: Harness manifest is valid/);
  } finally {
    cleanup(root);
  }
});

test("ensureManifest: fails when .harness/manifest.json is missing", () => {
  const root = fixture();
  try {
    const result = run(root, "manifest");
    assert.equal(result.exit, 1);
    assert.match(result.stderr, /\.harness\/manifest\.json is missing/);
  } finally {
    cleanup(root);
  }
});

test("ensureManifest: fails when a required top-level key is absent", () => {
  const manifest = baseManifest();
  delete manifest.productRoots;
  const root = manifestFixture(manifest);
  try {
    const result = run(root, "manifest");
    assert.equal(result.exit, 1);
    assert.match(result.stderr, /missing required key productRoots/);
  } finally {
    cleanup(root);
  }
});

test("ensureManifest: fails when a declared CORE surface does not exist on disk", () => {
  const root = manifestFixture(baseManifest(), { skipCoreFile: true });
  try {
    const result = run(root, "manifest");
    assert.equal(result.exit, 1);
    assert.match(result.stderr, /manifest core surface is missing: core-file\.txt/);
  } finally {
    cleanup(root);
  }
});

test("ensureManifest: fails when a git-tracked file is not classified by the manifest", () => {
  const root = manifestFixture(baseManifest(), { extraTrackedFiles: { "stray.txt": "unclassified\n" } });
  try {
    const result = run(root, "manifest");
    assert.equal(result.exit, 1);
    assert.match(result.stderr, /manifest does not classify tracked file: stray\.txt/);
  } finally {
    cleanup(root);
  }
});

test("ensureManifest: defaults unlisted docs files to product-owned", () => {
  const root = manifestFixture(baseManifest(), {
    extraTrackedFiles: {
      "docs/INSTALL.md": "product docs\n",
      "docs/images/logo.svg": "<svg />\n",
    },
  });
  try {
    const result = run(root, "manifest");
    assert.equal(result.exit, 0, result.output);
  } finally {
    cleanup(root);
  }
});

test("ensureManifest: explicit docs classifications take precedence over the product default", () => {
  const manifest = baseManifest({
    core: [".harness/manifest.json", ".harness/arch-rules.json", "core-file.txt", "docs/core.md"],
    instance: ["instance-file.txt", "docs/instance.md", "docs/template-output.md"],
    templates: [{ from: "template-source.md", to: "docs/template-output.md" }],
  });
  const root = manifestFixture(manifest, {
    extraTrackedFiles: {
      "docs/core.md": "core docs\n",
      "docs/instance.md": "instance docs\n",
      "docs/template-output.md": "generated docs\n",
      "template-source.md": "template skeleton\n",
    },
  });
  try {
    const result = run(root, "manifest");
    assert.equal(result.exit, 0, result.output);
  } finally {
    cleanup(root);
  }
});

test("ensureManifest: fails when a file is claimed as both instance and template", () => {
  const manifest = baseManifest({
    instance: ["instance-file.txt", "dual.txt"],
    templates: [{ from: "dual.txt", to: "instance-file.txt" }],
  });
  const root = manifestFixture(manifest, { extraTrackedFiles: { "dual.txt": "dual\n" } });
  try {
    const result = run(root, "manifest");
    assert.equal(result.exit, 1);
    assert.match(result.stderr, /manifest classifies dual\.txt as both instance and template/);
  } finally {
    cleanup(root);
  }
});

// ---- WIP=1 gate (mode: "arch:wip-contract", function ensureFeatureGraph) --

// Feature declarations (feature_list.json) and mutable state (.harness/state/<id>.json)
// are separate files as of feat-011 (D-017). Fixtures below still pass `state`/
// `evidence` inline on each feature spec for readability — this helper splits
// them into the declaration file plus one shard per feature that declares them,
// so callers don't need to know the on-disk split.
function splitFeatureFixture(features) {
  const root = fixture();
  const declarations = features.map(({ state, evidence, ...decl }) => decl);
  write(root, "feature_list.json", `${JSON.stringify({ features: declarations }, null, 2)}\n`);
  for (const feature of features) {
    if ("state" in feature || "evidence" in feature) {
      write(
        root,
        `.harness/state/${feature.id}.json`,
        `${JSON.stringify({ state: feature.state ?? "planned", evidence: feature.evidence ?? "" }, null, 2)}\n`,
      );
    }
  }
  return root;
}

function featureListFixture(features) {
  return splitFeatureFixture(features);
}

test("WIP=1: passes with zero active features", () => {
  const root = featureListFixture([{ id: "feat-001", state: "planned", dependencies: [] }]);
  try {
    const result = run(root, "arch:wip-contract");
    assert.equal(result.exit, 0, result.output);
  } finally {
    cleanup(root);
  }
});

test("WIP=1: passes with exactly one active feature whose dependencies are all passing", () => {
  const root = featureListFixture([
    { id: "feat-001", state: "passing", dependencies: [] },
    { id: "feat-002", state: "active", dependencies: ["feat-001"] },
  ]);
  try {
    const result = run(root, "arch:wip-contract");
    assert.equal(result.exit, 0, result.output);
  } finally {
    cleanup(root);
  }
});

test("WIP=1: rejects two simultaneously active features", () => {
  const root = featureListFixture([
    { id: "feat-001", state: "active", dependencies: [] },
    { id: "feat-002", state: "active", dependencies: [] },
  ]);
  try {
    const result = run(root, "arch:wip-contract");
    assert.equal(result.exit, 1);
    assert.match(result.stderr, /WIP=1 violated: found 2 active features/);
  } finally {
    cleanup(root);
  }
});

test("WIP=1: rejects an active feature whose dependency has not reached passing", () => {
  const root = featureListFixture([
    { id: "feat-001", state: "planned", dependencies: [] },
    { id: "feat-002", state: "active", dependencies: ["feat-001"] },
  ]);
  try {
    const result = run(root, "arch:wip-contract");
    assert.equal(result.exit, 1);
    assert.match(result.stderr, /active feature feat-002 has unmet dependencies: feat-001/);
  } finally {
    cleanup(root);
  }
});

test("WIP=1: rejects a duplicate feature id", () => {
  const root = featureListFixture([
    { id: "feat-001", state: "planned", dependencies: [] },
    { id: "feat-001", state: "planned", dependencies: [] },
  ]);
  try {
    const result = run(root, "arch:wip-contract");
    assert.equal(result.exit, 1);
    assert.match(result.stderr, /duplicate feature id feat-001/);
  } finally {
    cleanup(root);
  }
});

test("WIP=1: rejects a dependency that references a feature id that does not exist", () => {
  const root = featureListFixture([{ id: "feat-001", state: "planned", dependencies: ["feat-999"] }]);
  try {
    const result = run(root, "arch:wip-contract");
    assert.equal(result.exit, 1);
    assert.match(result.stderr, /feature feat-001 depends on missing feature feat-999/);
  } finally {
    cleanup(root);
  }
});

// ---- check-arch rule evaluation (mode: "check-arch", function checkArch) --

function archRulesFixture(rules) {
  const root = fixture();
  write(root, ".harness/arch-rules.json", `${JSON.stringify({ rules }, null, 2)}\n`);
  return root;
}

const NODE = JSON.stringify(process.execPath);

test("check-arch: skips cleanly when arch-rules.json is absent", () => {
  const root = fixture();
  try {
    const result = run(root, "check-arch");
    assert.equal(result.exit, 0, result.output);
    assert.match(result.stdout, /Architecture check skipped: no arch-rules\.json found/);
  } finally {
    cleanup(root);
  }
});

test("check-arch: passes with an empty rules array", () => {
  const root = archRulesFixture([]);
  try {
    const result = run(root, "check-arch");
    assert.equal(result.exit, 0, result.output);
    assert.match(result.stdout, /No architecture rules defined/);
  } finally {
    cleanup(root);
  }
});

test("check-arch: passes a rule whose command output matches the expect pattern", () => {
  const root = archRulesFixture([
    {
      id: "arch-fixture-001",
      description: "fixture rule that always matches",
      check: `${NODE} -e "console.log('OK')"`,
      expect: "OK",
      what: "should never trigger",
      why: "fixture",
      fix: "fixture",
    },
  ]);
  try {
    const result = run(root, "check-arch");
    assert.equal(result.exit, 0, result.output);
    assert.match(result.stdout, /All architecture rules pass/);
    assert.match(result.stdout, /\[PASS\]/);
  } finally {
    cleanup(root);
  }
});

test("check-arch: fails and reports what/why/fix when a rule's output does not match", () => {
  const root = archRulesFixture([
    {
      id: "arch-fixture-002",
      description: "fixture rule that never matches",
      check: `${NODE} -e "console.log('actual output')"`,
      expect: "this-will-not-match",
      what: "the fixture condition was not met",
      why: "this rule is designed to fail",
      fix: "no fix — this is a test fixture",
    },
  ]);
  try {
    const result = run(root, "check-arch");
    assert.equal(result.exit, 1);
    assert.match(result.stdout, /\[FAIL\] the fixture condition was not met/);
    assert.match(result.stdout, /Why: this rule is designed to fail/);
    assert.match(result.stdout, /Fix: no fix — this is a test fixture/);
    assert.match(result.stdout, /Architecture constraint violations found/);
  } finally {
    cleanup(root);
  }
});

test("check-arch: fails on an invalid expect regex", () => {
  const root = archRulesFixture([
    {
      id: "arch-fixture-003",
      description: "fixture rule with a broken expect pattern",
      check: `${NODE} -e "console.log('irrelevant')"`,
      expect: "(unclosed",
      what: "fixture",
      why: "fixture",
      fix: "fixture",
    },
  ]);
  try {
    const result = run(root, "check-arch");
    assert.equal(result.exit, 1);
    assert.match(result.stderr, /has an invalid expect pattern/);
  } finally {
    cleanup(root);
  }
});

// ---- Worktree lanes (feat-010, D-017) --------------------------------------
// Lane commands (lane-new/list/land/drop) and the lane-aware WIP=1 check
// (ensureLaneWipContract, wired into "arch:wip-contract" and "test") operate
// on real git worktrees — these tests exercise real `git` against throwaway
// repos rather than mocking git, matching the technique the manifest tests
// above already use for a different subsystem.

function gitFeatureFixture(features) {
  const root = splitFeatureFixture(features);
  spawnSync("git", ["init", "-q"], { cwd: root });
  spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  spawnSync("git", ["config", "user.name", "Test"], { cwd: root });
  spawnSync("git", ["add", "-A"], { cwd: root });
  spawnSync("git", ["commit", "-q", "-m", "init"], { cwd: root });
  return root;
}

function laneWorktreePathFor(root, featureId) {
  const resolvedRoot = path.resolve(root);
  return path.join(path.dirname(resolvedRoot), `${path.basename(resolvedRoot)}-lane-${featureId}`);
}

// Sibling worktrees live outside `root`, so cleanup removes both explicitly
// rather than relying on a single recursive delete of the fixture root.
function cleanupLane(root, ...worktreePaths) {
  for (const worktreePath of worktreePaths) {
    rmSync(worktreePath, { recursive: true, force: true });
  }
  cleanup(root);
}

test("lane-new: creates a sibling worktree on lane/<id> and marks the feature active", () => {
  const root = gitFeatureFixture([{ id: "feat-001", state: "planned", dependencies: [], layers: [] }]);
  const worktreePath = laneWorktreePathFor(root, "feat-001");
  try {
    const result = run(root, "lane-new", ["feat-001"]);
    assert.equal(result.exit, 0, result.output);
    assert.ok(existsSync(worktreePath), "expected sibling worktree directory to exist");
    const shard = JSON.parse(readFileSync(path.join(worktreePath, ".harness/state/feat-001.json"), "utf8"));
    assert.equal(shard.state, "active");
  } finally {
    cleanupLane(root, worktreePath);
  }
});

test("lane-new: refuses a feature with unmet dependencies", () => {
  const root = gitFeatureFixture([
    { id: "feat-001", state: "planned", dependencies: [], layers: [] },
    { id: "feat-002", state: "planned", dependencies: ["feat-001"], layers: [] },
  ]);
  const worktreePath = laneWorktreePathFor(root, "feat-002");
  try {
    const result = run(root, "lane-new", ["feat-002"]);
    assert.equal(result.exit, 1);
    assert.match(result.stderr, /feature feat-002 has unmet dependencies: feat-001/);
    assert.ok(!existsSync(worktreePath), "should not create a worktree for an unstartable feature");
  } finally {
    cleanupLane(root, worktreePath);
  }
});

test("lane-new: refuses a feature that is already passing", () => {
  const root = gitFeatureFixture([{ id: "feat-001", state: "passing", dependencies: [], layers: [] }]);
  try {
    const result = run(root, "lane-new", ["feat-001"]);
    assert.equal(result.exit, 1);
    assert.match(result.stderr, /feature feat-001 is already passing/);
  } finally {
    cleanup(root);
  }
});

test("lane-new: is idempotent — a second call reports the existing lane instead of failing", () => {
  const root = gitFeatureFixture([{ id: "feat-001", state: "planned", dependencies: [], layers: [] }]);
  const worktreePath = laneWorktreePathFor(root, "feat-001");
  try {
    assert.equal(run(root, "lane-new", ["feat-001"]).exit, 0);
    const second = run(root, "lane-new", ["feat-001"]);
    assert.equal(second.exit, 0, second.output);
    assert.match(second.stdout, /Lane already exists: lane\/feat-001/);
  } finally {
    cleanupLane(root, worktreePath);
  }
});

test("lane-list: reports each lane's feature, state, and worktree path", () => {
  const root = gitFeatureFixture([{ id: "feat-001", state: "planned", dependencies: [], layers: [] }]);
  const worktreePath = laneWorktreePathFor(root, "feat-001");
  try {
    run(root, "lane-new", ["feat-001"]);
    const result = run(root, "lane-list");
    assert.equal(result.exit, 0, result.output);
    assert.match(result.stdout, /lane\/feat-001\s+feature=feat-001\s+state=active/);
  } finally {
    cleanupLane(root, worktreePath);
  }
});

test("lane-list: reports no lanes on a repo with no lane/* branches", () => {
  const root = gitFeatureFixture([{ id: "feat-001", state: "planned", dependencies: [], layers: [] }]);
  try {
    const result = run(root, "lane-list");
    assert.equal(result.exit, 0, result.output);
    assert.match(result.stdout, /No lanes found/);
  } finally {
    cleanup(root);
  }
});

test("lane-land: refuses to merge a lane whose feature is not marked passing", () => {
  const root = gitFeatureFixture([{ id: "feat-001", state: "planned", dependencies: [], layers: [] }]);
  const worktreePath = laneWorktreePathFor(root, "feat-001");
  try {
    run(root, "lane-new", ["feat-001"]);
    // Commit the lane's work while the feature is still "active", not "passing".
    spawnSync("git", ["add", "-A"], { cwd: worktreePath });
    spawnSync("git", ["commit", "-q", "-m", "wip"], { cwd: worktreePath });
    const result = run(root, "lane-land", ["feat-001"]);
    assert.equal(result.exit, 1);
    assert.match(result.stderr, /feature feat-001 is not marked passing on lane\/feat-001/);
    assert.ok(existsSync(worktreePath), "worktree should survive a refused land");
  } finally {
    cleanupLane(root, worktreePath);
  }
});

test("lane-land: merges a passing lane, removes the worktree, and deletes the branch", () => {
  const root = gitFeatureFixture([{ id: "feat-001", state: "planned", dependencies: [], layers: [] }]);
  const worktreePath = laneWorktreePathFor(root, "feat-001");
  try {
    run(root, "lane-new", ["feat-001"]);
    write(worktreePath, ".harness/state/feat-001.json", `${JSON.stringify(
      { state: "passing", evidence: "test" },
      null,
      2,
    )}\n`);
    spawnSync("git", ["add", "-A"], { cwd: worktreePath });
    spawnSync("git", ["commit", "-q", "-m", "feat-001 passing"], { cwd: worktreePath });

    const result = run(root, "lane-land", ["feat-001"]);
    assert.equal(result.exit, 0, result.output);
    assert.ok(!existsSync(worktreePath), "worktree should be removed after landing");

    // feature_list.json is declaration-only and must never be rewritten by a
    // land — the whole point of sharding (feat-011, D-017) is that landing
    // touches only this feature's own shard.
    const declarationsUntouched = JSON.parse(readFileSync(path.join(root, "feature_list.json"), "utf8"));
    assert.ok(!("state" in declarationsUntouched.features[0]), "feature_list.json must stay declaration-only");
    const landedShard = JSON.parse(readFileSync(path.join(root, ".harness/state/feat-001.json"), "utf8"));
    assert.equal(landedShard.state, "passing");

    const branches = spawnSync("git", ["branch", "--list", "lane/feat-001"], { cwd: root, encoding: "utf8" });
    assert.equal(branches.stdout.trim(), "", "lane branch should be deleted after a successful land");
  } finally {
    cleanupLane(root, worktreePath);
  }
});

test("lane-land: refuses when the branch to merge into has uncommitted changes", () => {
  const root = gitFeatureFixture([{ id: "feat-001", state: "planned", dependencies: [], layers: [] }]);
  const worktreePath = laneWorktreePathFor(root, "feat-001");
  try {
    run(root, "lane-new", ["feat-001"]);
    write(worktreePath, ".harness/state/feat-001.json", `${JSON.stringify(
      { state: "passing", evidence: "test" },
      null,
      2,
    )}\n`);
    spawnSync("git", ["add", "-A"], { cwd: worktreePath });
    spawnSync("git", ["commit", "-q", "-m", "feat-001 passing"], { cwd: worktreePath });

    write(root, "dirty.txt", "uncommitted\n");
    const result = run(root, "lane-land", ["feat-001"]);
    assert.equal(result.exit, 1);
    assert.match(result.stderr, /uncommitted changes/);
  } finally {
    cleanupLane(root, worktreePath);
  }
});

test("lane-drop: refuses to discard an uncommitted lane, then removes it cleanly once committed", () => {
  const root = gitFeatureFixture([{ id: "feat-001", state: "planned", dependencies: [], layers: [] }]);
  const worktreePath = laneWorktreePathFor(root, "feat-001");
  try {
    run(root, "lane-new", ["feat-001"]);
    const dirty = run(root, "lane-drop", ["feat-001"]);
    assert.equal(dirty.exit, 1);
    assert.match(dirty.stderr, /could not remove worktree/);
    assert.ok(existsSync(worktreePath), "uncommitted lane must survive a refused drop");

    spawnSync("git", ["add", "-A"], { cwd: worktreePath });
    spawnSync("git", ["commit", "-q", "-m", "wip"], { cwd: worktreePath });
    const clean = run(root, "lane-drop", ["feat-001"]);
    assert.equal(clean.exit, 0, clean.output);
    assert.ok(!existsSync(worktreePath), "worktree should be removed after a clean drop");

    const branches = spawnSync("git", ["branch", "--list", "lane/feat-001"], { cwd: root, encoding: "utf8" });
    assert.match(branches.stdout, /lane\/feat-001/, "branch should survive a drop (abandon, not delete)");
  } finally {
    cleanupLane(root, worktreePath);
  }
});

// ---- Lane-aware WIP=1 (ensureLaneWipContract, via arch:wip-contract) ------

function laneBranchFixture(branch, features) {
  const root = splitFeatureFixture(features);
  spawnSync("git", ["init", "-q"], { cwd: root });
  spawnSync("git", ["checkout", "-q", "-b", branch], { cwd: root });
  return root;
}

test("lane WIP: passes on a lane branch when the active feature matches the lane's id", () => {
  const root = laneBranchFixture("lane/feat-002", [
    { id: "feat-001", state: "passing", dependencies: [] },
    { id: "feat-002", state: "active", dependencies: ["feat-001"] },
  ]);
  try {
    const result = run(root, "arch:wip-contract");
    assert.equal(result.exit, 0, result.output);
  } finally {
    cleanup(root);
  }
});

test("lane WIP: fails on a lane branch when the active feature does not match the lane's id", () => {
  const root = laneBranchFixture("lane/feat-002", [
    { id: "feat-001", state: "active", dependencies: [] },
    { id: "feat-002", state: "planned", dependencies: [] },
  ]);
  try {
    const result = run(root, "arch:wip-contract");
    assert.equal(result.exit, 1);
    assert.match(
      result.stderr,
      /lane branch lane\/feat-002 owns feature feat-002, but feature_list\.json marks feat-001 active/,
    );
  } finally {
    cleanup(root);
  }
});

test("lane WIP: passes on a non-lane branch regardless of which feature is active (unchanged behavior)", () => {
  const root = laneBranchFixture("master", [{ id: "feat-001", state: "active", dependencies: [] }]);
  try {
    const result = run(root, "arch:wip-contract");
    assert.equal(result.exit, 0, result.output);
  } finally {
    cleanup(root);
  }
});

// ---- Sharded feature state shape (feat-011, D-017, mode: "typecheck") ----

test("typecheck: passes a declaration-only feature_list.json with no shard", () => {
  const root = fixture();
  write(root, "feature_list.json", `${JSON.stringify(
    { features: [{ id: "feat-001", name: "One", behavior: "b", verification: "v", dependencies: [], layers: [{ label: "L", cmd: "true", repair: "r" }] }] },
    null,
    2,
  )}\n`);
  try {
    const result = run(root, "typecheck");
    assert.equal(result.exit, 0, result.output);
  } finally {
    cleanup(root);
  }
});

test("typecheck: fails when feature_list.json still declares inline state", () => {
  const root = fixture();
  write(root, "feature_list.json", `${JSON.stringify(
    {
      features: [
        {
          id: "feat-001",
          name: "One",
          behavior: "b",
          verification: "v",
          dependencies: [],
          state: "active",
          layers: [{ label: "L", cmd: "true", repair: "r" }],
        },
      ],
    },
    null,
    2,
  )}\n`);
  try {
    const result = run(root, "typecheck");
    assert.equal(result.exit, 1);
    assert.match(result.stderr, /feature feat-001 declares mutable state in feature_list\.json/);
    assert.match(result.stderr, /migrate-feature-state/);
  } finally {
    cleanup(root);
  }
});

test("typecheck: passes a valid shard that matches a declared feature", () => {
  const root = splitFeatureFixture([
    { id: "feat-001", name: "One", behavior: "b", verification: "v", dependencies: [], layers: [{ label: "L", cmd: "true", repair: "r" }], state: "passing", evidence: "e" },
  ]);
  try {
    const result = run(root, "typecheck");
    assert.equal(result.exit, 0, result.output);
  } finally {
    cleanup(root);
  }
});

test("typecheck: fails on a shard with no matching declared feature (stray shard)", () => {
  const root = splitFeatureFixture([
    { id: "feat-001", name: "One", behavior: "b", verification: "v", dependencies: [], layers: [{ label: "L", cmd: "true", repair: "r" }] },
  ]);
  write(root, ".harness/state/feat-999.json", `${JSON.stringify({ state: "passing", evidence: "" }, null, 2)}\n`);
  try {
    const result = run(root, "typecheck");
    assert.equal(result.exit, 1);
    assert.match(result.stderr, /\.harness\/state\/feat-999\.json does not correspond to any feature declared/);
  } finally {
    cleanup(root);
  }
});

test("typecheck: fails on a shard with an invalid state value", () => {
  const root = splitFeatureFixture([
    { id: "feat-001", name: "One", behavior: "b", verification: "v", dependencies: [], layers: [{ label: "L", cmd: "true", repair: "r" }] },
  ]);
  write(root, ".harness/state/feat-001.json", `${JSON.stringify({ state: "done", evidence: "" }, null, 2)}\n`);
  try {
    const result = run(root, "typecheck");
    assert.equal(result.exit, 1);
    assert.match(result.stderr, /\.harness\/state\/feat-001\.json has invalid state done/);
  } finally {
    cleanup(root);
  }
});

// ---- verify-feature writes only the shard (feat-011, D-017) --------------

test("verify-feature: records passing evidence in the shard, never rewrites feature_list.json", () => {
  const root = fixture();
  write(root, "feature_list.json", `${JSON.stringify(
    {
      features: [
        {
          id: "feat-001",
          name: "One",
          behavior: "b",
          verification: "v",
          dependencies: [],
          layers: [
            { label: "L", cmd: `${NODE} -e "process.exit(0)"`, repair: "r" },
            { label: "Optional", cmd: `${NODE} -e "console.log('[SKIP] optional')"`, repair: "r" },
          ],
        },
      ],
    },
    null,
    2,
  )}\n`);
  spawnSync("git", ["init", "-q"], { cwd: root });
  spawnSync("git", ["config", "user.name", "Test"], { cwd: root });
  spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  spawnSync("git", ["add", "feature_list.json"], { cwd: root });
  spawnSync("git", ["commit", "-qm", "fixture"], { cwd: root });
  const declarationsBefore = readFileSync(path.join(root, "feature_list.json"), "utf8");
  try {
    const result = run(root, "verify-feature", ["feat-001"]);
    assert.equal(result.exit, 0, result.output);
    assert.equal(readFileSync(path.join(root, "feature_list.json"), "utf8"), declarationsBefore, "feature_list.json must be byte-identical after verify-feature");
    const shard = JSON.parse(readFileSync(path.join(root, ".harness/state/feat-001.json"), "utf8"));
    assert.equal(shard.state, "passing");
    const cleanEvidence = JSON.parse(shard.evidence);
    assert.match(cleanEvidence.summary, /All verification layers passed/);
    assert.equal(cleanEvidence.commit, spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim());
    assert.equal(cleanEvidence.dirty, false);
    assert.deepEqual(
      cleanEvidence.layers.map(({ label, result, skipReported }) => ({ label, result, skipReported })),
      [
        { label: "L", result: "PASS", skipReported: false },
        { label: "Optional", result: "PASS", skipReported: true },
      ],
    );
    for (const [index, layer] of cleanEvidence.layers.entries()) {
      assert.equal(layer.cmd, index === 0 ? `${NODE} -e "process.exit(0)"` : `${NODE} -e "console.log('[SKIP] optional')"`);
      assert.equal(typeof layer.durationMs, "number");
      assert.ok(layer.durationMs >= 0);
      assert.ok(existsSync(path.join(root, layer.log)), `missing log ${layer.log}`);
    }
    assert.equal(cleanEvidence.layers[1].log, ".harness/logs/feat-001/02-optional.log");
    assert.match(readFileSync(path.join(root, cleanEvidence.layers[1].log), "utf8"), /\[SKIP\] optional/);

    write(root, "dirty-marker.txt", "dirty\n");
    const dirtyResult = run(root, "verify-feature", ["feat-001"]);
    assert.equal(dirtyResult.exit, 0, dirtyResult.output);
    const dirtyShard = JSON.parse(readFileSync(path.join(root, ".harness/state/feat-001.json"), "utf8"));
    assert.equal(JSON.parse(dirtyShard.evidence).dirty, true);
  } finally {
    cleanup(root);
  }
});

test("verify-feature: a failing layer shows its last output lines and names its log", () => {
  const root = fixture();
  write(root, "feature_list.json", `${JSON.stringify(
    {
      features: [
        {
          id: "feat-001",
          name: "One",
          behavior: "b",
          verification: "v",
          dependencies: [],
          layers: [
            {
              label: "Unit tests",
              cmd: `${NODE} -e "console.log('step one ran'); console.error('broke on step two'); process.exit(3)"`,
              repair: "r",
            },
          ],
        },
      ],
    },
    null,
    2,
  )}\n`);
  try {
    const result = run(root, "verify-feature", ["feat-001"]);
    assert.equal(result.exit, 1, result.output);
    assert.match(result.output, /Last lines of output:/);
    assert.match(result.output, /step one ran/);
    assert.match(result.output, /broke on step two/);
    assert.match(result.output, /\[FAIL\] Unit tests \(\d+(\.\d)? m?s\) — full output: \.harness\/logs\/feat-001\/01-unit-tests\.log/);
    const log = readFileSync(path.join(root, ".harness/logs/feat-001/01-unit-tests.log"), "utf8");
    assert.match(log, /step one ran/);
    assert.match(log, /--- stderr ---[\s\S]*broke on step two/);
    // Logs are local diagnostics: the folder ignores itself.
    assert.equal(readFileSync(path.join(root, ".harness/logs/.gitignore"), "utf8"), "*\n");
    // A failed run records nothing.
    assert.equal(existsSync(path.join(root, ".harness/state/feat-001.json")), false);
  } finally {
    cleanup(root);
  }
});

// ---- migrate-feature-state -------------------------------------------------

test("migrate-feature-state: moves inline state/evidence into shards and strips them from feature_list.json", () => {
  const root = fixture();
  write(root, "feature_list.json", `${JSON.stringify(
    {
      features: [
        { id: "feat-001", name: "One", behavior: "b", verification: "v", dependencies: [], state: "passing", evidence: "old evidence", layers: [{ label: "L", cmd: "true", repair: "r" }] },
        { id: "feat-002", name: "Two", behavior: "b", verification: "v", dependencies: [], status: "not_started", layers: [{ label: "L", cmd: "true", repair: "r" }] },
      ],
    },
    null,
    2,
  )}\n`);
  try {
    const result = run(root, "migrate-feature-state");
    assert.equal(result.exit, 0, result.output);

    const declarations = JSON.parse(readFileSync(path.join(root, "feature_list.json"), "utf8"));
    for (const feature of declarations.features) {
      assert.ok(!("state" in feature) && !("status" in feature) && !("evidence" in feature), `${feature.id} must have no inline mutable fields after migration`);
    }

    const shard1 = JSON.parse(readFileSync(path.join(root, ".harness/state/feat-001.json"), "utf8"));
    assert.equal(shard1.state, "passing");
    assert.equal(shard1.evidence, "old evidence");
    const shard2 = JSON.parse(readFileSync(path.join(root, ".harness/state/feat-002.json"), "utf8"));
    assert.equal(shard2.state, "planned");

    const typecheck = run(root, "typecheck");
    assert.equal(typecheck.exit, 0, typecheck.output);
  } finally {
    cleanup(root);
  }
});

test("migrate-feature-state: is idempotent and does not clobber an existing shard", () => {
  const root = splitFeatureFixture([
    { id: "feat-001", name: "One", behavior: "b", verification: "v", dependencies: [], layers: [], state: "active", evidence: "current" },
  ]);
  // Simulate a legacy repo where feature_list.json still has stale inline
  // fields alongside an already-migrated (and more current) shard.
  const declarations = JSON.parse(readFileSync(path.join(root, "feature_list.json"), "utf8"));
  declarations.features[0].state = "planned";
  writeFileSync(path.join(root, "feature_list.json"), `${JSON.stringify(declarations, null, 2)}\n`);
  try {
    const result = run(root, "migrate-feature-state");
    assert.equal(result.exit, 0, result.output);
    const shard = JSON.parse(readFileSync(path.join(root, ".harness/state/feat-001.json"), "utf8"));
    assert.equal(shard.state, "active", "existing shard must win over stale inline data");

    const second = run(root, "migrate-feature-state");
    assert.equal(second.exit, 0, second.output);
    assert.match(second.stdout, /Nothing to migrate/);
  } finally {
    cleanup(root);
  }
});

// ---- add-feature (dogfooding feedback Tier 1 item 2) ----------------------

test("add-feature: appends a declaration-only stub with no inline state", () => {
  const root = fixture();
  write(root, "feature_list.json", `${JSON.stringify(
    { features: [{ id: "feat-001", name: "One", behavior: "b", verification: "v", dependencies: [], layers: [{ label: "L", cmd: "true", repair: "r" }] }] },
    null,
    2,
  )}\n`);
  try {
    const result = run(root, "add-feature", ["feat-002", "Some", "New", "Feature"]);
    assert.equal(result.exit, 0, result.output);
    assert.match(result.stdout, /Added feat-002 to feature_list\.json/);

    const data = JSON.parse(readFileSync(path.join(root, "feature_list.json"), "utf8"));
    assert.equal(data.features.length, 2);
    const added = data.features[1];
    assert.equal(added.id, "feat-002");
    assert.equal(added.name, "Some New Feature", "multi-word name is rejoined from separate argv entries");
    assert.deepEqual(added.dependencies, []);
    assert.equal(added.layers.length, 3);
    assert.ok(!("state" in added) && !("evidence" in added), "stub must be declaration-only (feat-011 schema)");

    // The gate must accept the generated shape as-is.
    const typecheck = run(root, "typecheck");
    assert.equal(typecheck.exit, 0, typecheck.output);
  } finally {
    cleanup(root);
  }
});

test("add-feature: refuses a duplicate feature id", () => {
  const root = fixture();
  write(root, "feature_list.json", `${JSON.stringify(
    { features: [{ id: "feat-001", name: "One", behavior: "b", verification: "v", dependencies: [], layers: [] }] },
    null,
    2,
  )}\n`);
  try {
    const result = run(root, "add-feature", ["feat-001", "Duplicate"]);
    assert.equal(result.exit, 1);
    assert.match(result.stderr, /feature feat-001 already exists/);
  } finally {
    cleanup(root);
  }
});

test("add-feature: accepts configured behavior, verification, dependencies, and extra layers", () => {
  const root = fixture();
  write(root, "feature_list.json", `${JSON.stringify(
    { features: [{ id: "feat-001", name: "One", behavior: "b", verification: "v", dependencies: [], layers: [{ label: "L", cmd: "true", repair: "r" }] }] },
    null,
    2,
  )}\n`);
  write(root, ".harness/manifest.json", JSON.stringify({ featureIdPattern: "^feat-\\d{3}$" }));
  try {
    const result = run(root, "add-feature", [
      "feat-002",
      "Configured",
      "Feature",
      "--behavior",
      "Describe this behavior",
      "--verification",
      "Run all checks",
      "--depends",
      "feat-001",
      "--layer",
      "Multi-repo verification=npm run verify-all",
    ]);
    assert.equal(result.exit, 0, result.output);
    const added = JSON.parse(readFileSync(path.join(root, "feature_list.json"), "utf8")).features[1];
    assert.equal(added.name, "Configured Feature");
    assert.equal(added.behavior, "Describe this behavior");
    assert.equal(added.verification, "Run all checks");
    assert.deepEqual(added.dependencies, ["feat-001"]);
    assert.equal(added.layers.length, 4);
    assert.deepEqual(added.layers[3], {
      label: "Multi-repo verification",
      cmd: "npm run verify-all",
      repair: "Fix Multi-repo verification failures and rerun the layer command.",
    });
  } finally {
    cleanup(root);
  }
});

test("add-feature: enforces an optional manifest feature ID pattern", () => {
  const root = fixture();
  write(root, "feature_list.json", '{"features":[]}\n');
  write(root, ".harness/manifest.json", JSON.stringify({ featureIdPattern: "^feat-\\d{3}$" }));
  try {
    const result = run(root, "add-feature", ["polish-portfolio", "Bad Id"]);
    assert.equal(result.exit, 1);
    assert.match(result.stderr, /does not match manifest featureIdPattern/);
    assert.deepEqual(JSON.parse(readFileSync(path.join(root, "feature_list.json"), "utf8")).features, []);
  } finally {
    cleanup(root);
  }
});

test("add-feature: accepts IDs when the manifest does not define a pattern", () => {
  const root = fixture();
  write(root, "feature_list.json", '{"features":[]}\n');
  try {
    const result = run(root, "add-feature", ["polish-portfolio", "Flexible ID"]);
    assert.equal(result.exit, 0, result.output);
    assert.equal(JSON.parse(readFileSync(path.join(root, "feature_list.json"), "utf8")).features[0].id, "polish-portfolio");
  } finally {
    cleanup(root);
  }
});

test("activate: writes active state when dependencies pass", () => {
  const root = featureListFixture([
    { id: "feat-001", state: "passing", dependencies: [] },
    { id: "feat-002", state: "planned", dependencies: ["feat-001"] },
  ]);
  try {
    const result = run(root, "activate", ["feat-002"]);
    assert.equal(result.exit, 0, result.output);
    assert.deepEqual(JSON.parse(readFileSync(path.join(root, ".harness/state/feat-002.json"), "utf8")), {
      state: "active",
      evidence: "",
    });
  } finally {
    cleanup(root);
  }
});

test("activate: refuses a second active feature without writing its shard", () => {
  const root = featureListFixture([
    { id: "feat-001", state: "active", dependencies: [] },
    { id: "feat-002", state: "planned", dependencies: [] },
  ]);
  try {
    const result = run(root, "activate", ["feat-002"]);
    assert.equal(result.exit, 1);
    assert.match(result.stderr, /feat-001 is already active/);
    assert.equal(
      JSON.parse(readFileSync(path.join(root, ".harness/state/feat-002.json"), "utf8")).state,
      "planned",
    );
  } finally {
    cleanup(root);
  }
});

test("activate: refuses dependencies that are not passing", () => {
  const root = featureListFixture([
    { id: "feat-001", state: "planned", dependencies: [] },
    { id: "feat-002", state: "planned", dependencies: ["feat-001"] },
  ]);
  try {
    const result = run(root, "activate", ["feat-002"]);
    assert.equal(result.exit, 1);
    assert.match(result.stderr, /unmet dependencies: feat-001/);
    assert.equal(
      JSON.parse(readFileSync(path.join(root, ".harness/state/feat-002.json"), "utf8")).state,
      "planned",
    );
  } finally {
    cleanup(root);
  }
});

// ---- check-arch: untracked-file warning (dogfooding feedback Tier 1 item 1) -

test("check-arch: warns (does not fail) when untracked files exist", () => {
  const root = archRulesFixture([]);
  spawnSync("git", ["init", "-q"], { cwd: root });
  spawnSync("git", ["add", ".harness/arch-rules.json"], { cwd: root });
  write(root, "stray.txt", "untracked\n");
  try {
    const result = run(root, "check-arch");
    assert.equal(result.exit, 0, result.output);
    assert.match(result.stdout, /\[WARN\] 1 untracked file\(s\) exist/);
    assert.match(result.stdout, /stray\.txt/);
  } finally {
    cleanup(root);
  }
});

test("check-arch: no warning when the working tree has no untracked files", () => {
  const root = archRulesFixture([]);
  spawnSync("git", ["init", "-q"], { cwd: root });
  spawnSync("git", ["add", "-A"], { cwd: root });
  try {
    const result = run(root, "check-arch");
    assert.equal(result.exit, 0, result.output);
    assert.doesNotMatch(result.stdout, /untracked file/);
  } finally {
    cleanup(root);
  }
});

test("check-arch: no warning (and no crash) outside a git repository", () => {
  const root = archRulesFixture([]);
  try {
    const result = run(root, "check-arch");
    assert.equal(result.exit, 0, result.output);
    assert.doesNotMatch(result.stdout, /untracked file/);
  } finally {
    cleanup(root);
  }
});

// ---- Generated progress state and per-session index -------------------------

function progressFixture(sessions = [], features = [], { generate = true } = {}) {
  const root = fixture();
  write(root, "PROGRESS.md", "# Progress Log\n\n<!-- BEGIN GENERATED PROGRESS -->\n<!-- END GENERATED PROGRESS -->\n");
  write(root, "feature_list.json", `${JSON.stringify({
    features: features.map(({ state, evidence, ...feature }) => feature),
  }, null, 2)}\n`);
  for (const feature of features) {
    if ("state" in feature || "evidence" in feature) {
      write(root, `.harness/state/${feature.id}.json`, `${JSON.stringify({
        state: feature.state ?? "planned",
        evidence: feature.evidence ?? "",
      }, null, 2)}\n`);
    }
  }
  for (const session of sessions) {
    const number = String(session.number).padStart(3, "0");
    const date = session.date ?? "2026-10-01";
    const heading = session.heading ?? `### Session ${number} — ${date} — Session ${number}`;
    write(root, `progress/${number}-${date}.md`, `${heading}\n\n- Session notes.\n`);
  }
  if (generate) {
    const result = run(root, "progress-update");
    assert.equal(result.exit, 0, result.output);
  }
  return root;
}

test("lifecycle commands refresh the generated PROGRESS.md, so the next lint passes", () => {
  const root = progressFixture([{ number: 1, date: "2026-10-01" }], [
    { id: "feat-001", name: "First", state: "passing", evidence: "verified" },
  ]);
  try {
    const added = run(root, "add-feature", ["feat-002", "Second", "--depends", "feat-001"]);
    assert.equal(added.exit, 0, added.output);
    assert.match(readFileSync(path.join(root, "PROGRESS.md"), "utf8"), /Planned features \(1\): feat-002 — Second/);
    assert.equal(run(root, "lint:progress-log").exit, 0);

    const activated = run(root, "activate", ["feat-002"]);
    assert.equal(activated.exit, 0, activated.output);
    assert.match(readFileSync(path.join(root, "PROGRESS.md"), "utf8"), /Active feature: feat-002 — Second/);
    const lint = run(root, "lint:progress-log");
    assert.equal(lint.exit, 0, lint.output);
  } finally {
    cleanup(root);
  }
});

test("lifecycle commands leave a progress log without a generated block alone", () => {
  const root = progressFixture([], [{ id: "feat-001", name: "First", state: "passing", evidence: "verified" }], {
    generate: false,
  });
  const legacy = "# Progress Log\n\nHand-written notes, from before the generated dashboard.\n";
  write(root, "PROGRESS.md", legacy);
  try {
    const added = run(root, "add-feature", ["feat-002", "Second"]);
    assert.equal(added.exit, 0, added.output);
    assert.equal(readFileSync(path.join(root, "PROGRESS.md"), "utf8"), legacy);
  } finally {
    cleanup(root);
  }
});

test("harness files are written with LF line endings on every OS", () => {
  const root = progressFixture([], [{ id: "feat-001", name: "First", state: "passing", evidence: "verified" }]);
  try {
    assert.equal(run(root, "add-feature", ["feat-002", "Second", "--depends", "feat-001"]).exit, 0);
    assert.equal(run(root, "activate", ["feat-002"]).exit, 0);
    for (const rel of ["feature_list.json", ".harness/state/feat-002.json", "PROGRESS.md"]) {
      assert.equal(readFileSync(path.join(root, rel), "utf8").includes("\r"), false, `${rel} contains CR`);
    }
  } finally {
    cleanup(root);
  }
});

test("progress-migrate: moves a single-file log into progress/ and generates the dashboard (feat-019)", () => {
  const root = progressFixture([], [{ id: "feat-001", name: "First", state: "passing", evidence: "verified" }], {
    generate: false,
  });
  write(root, "PROGRESS.md", "# Progress Log\n\n## Current Verified State\n\n- Kept by hand, before the generated dashboard.\n\n## Session Log\n\n### Session 1 — 2026-10-01\n\n- Scaffolded.\n\n### Session 002 — 2026-10-02 — Second\n\n- Built the first feature.\n");
  try {
    const result = run(root, "progress-migrate");
    assert.equal(result.exit, 0, result.output);
    assert.equal(readFileSync(path.join(root, "progress/001-2026-10-01.md"), "utf8"), "### Session 001 — 2026-10-01\n\n- Scaffolded.\n");
    assert.match(readFileSync(path.join(root, "progress/002-2026-10-02.md"), "utf8"), /^### Session 002 — 2026-10-02 — Second\n\n- Built the first feature\.\n$/);
    const dashboard = readFileSync(path.join(root, "PROGRESS.md"), "utf8");
    assert.match(dashboard, /<!-- BEGIN GENERATED PROGRESS -->/);
    assert.match(dashboard, /\(progress\/002-2026-10-02\.md\)/);
    assert.doesNotMatch(dashboard, /Kept by hand/);
    const lint = run(root, "lint:progress-log");
    assert.equal(lint.exit, 0, lint.output);
    const again = run(root, "progress-migrate");
    assert.equal(again.exit, 0, again.output);
    assert.match(again.output, /already uses the generated dashboard/);
  } finally {
    cleanup(root);
  }
});

test("progress-migrate: refuses a log with gaps and changes nothing", () => {
  const root = progressFixture([], [], { generate: false });
  const content = "# Progress Log\n\n## Current Verified State\n\n- Kept by hand, before the generated dashboard.\n\n## Session Log\n\n### Session 001 — 2026-10-01\n\n- One.\n\n### Session 003 — 2026-10-03\n\n- Three.\n";
  write(root, "PROGRESS.md", content);
  try {
    const result = run(root, "progress-migrate");
    assert.equal(result.exit, 1, result.output);
    assert.match(result.output, /without gaps or repeats; nothing was migrated/);
    assert.equal(existsSync(path.join(root, "progress")), false);
    assert.equal(readFileSync(path.join(root, "PROGRESS.md"), "utf8"), content);
  } finally {
    cleanup(root);
  }
});

test("lint:progress-log: checks a generated dashboard and contiguous session index", () => {
  const root = progressFixture([
    { number: 1, date: "2026-10-01" },
    { number: 2, date: "2026-10-02" },
  ], [
    { id: "feat-001", name: "First", state: "passing", evidence: "verified at 2026-10-01T10:00:00Z" },
    { id: "feat-002", name: "Second", state: "active", evidence: "started" },
    { id: "feat-003", name: "Third", state: "blocked" },
  ]);
  try {
    const result = run(root, "lint:progress-log");
    assert.equal(result.exit, 0, result.output);
    assert.match(result.stdout, /dashboard is current \(2 sessions\)/);
    const dashboard = readFileSync(path.join(root, "PROGRESS.md"), "utf8");
    assert.match(dashboard, /Active feature: feat-002 — Second/);
    assert.match(dashboard, /Passing features \(1\): feat-001 — First/);
    assert.match(dashboard, /Failing\/blocked features: feat-003 — Third/);
    assert.match(dashboard, /Last evidence: feat-001 — First — verified at 2026-10-01T10:00:00Z/);
    assert.match(dashboard, /\[Session 002 — 2026-10-02 — Session 002\]\(progress\/002-2026-10-02\.md\)/);
  } finally {
    cleanup(root);
  }
});

test("progress-update: displays structured verification evidence and selects the latest timestamp", () => {
  const root = progressFixture([], [
    {
      id: "feat-001",
      name: "First",
      state: "passing",
      evidence: JSON.stringify({ summary: "Earlier verification passed", timestamp: "2026-10-01T10:00:00Z" }),
    },
    {
      id: "feat-002",
      name: "Second",
      state: "passing",
      evidence: JSON.stringify({ summary: "Latest verification passed", timestamp: "2026-10-02T10:00:00Z" }),
    },
  ]);
  try {
    const dashboard = readFileSync(path.join(root, "PROGRESS.md"), "utf8");
    assert.match(dashboard, /Last evidence: feat-002 — Second — Latest verification passed \(2026-10-02T10:00:00Z\)/);
    assert.doesNotMatch(dashboard, /"summary"/);
  } finally {
    cleanup(root);
  }
});

test("lint:progress-log: allows session files created out of order", () => {
  const root = progressFixture([
    { number: 1, date: "2026-10-01" },
    { number: 3, date: "2026-10-03" },
    { number: 2, date: "2026-10-02" },
  ]);
  try {
    const result = run(root, "lint:progress-log");
    assert.equal(result.exit, 0, result.output);
    const dashboard = readFileSync(path.join(root, "PROGRESS.md"), "utf8");
    assert.ok(dashboard.indexOf("Session 002") < dashboard.indexOf("Session 003"));
  } finally {
    cleanup(root);
  }
});

test("lint:progress-log: fails when two files use the same session number", () => {
  const root = progressFixture([
    { number: 1, date: "2026-10-01" },
    { number: 1, date: "2026-10-02" },
  ], [], { generate: false });
  try {
    const result = run(root, "lint:progress-log");
    assert.equal(result.exit, 1);
    assert.match(result.stderr, /duplicate session number: Session 1/);
  } finally {
    cleanup(root);
  }
});

test("lint:progress-log: fails on a gap in the session files", () => {
  const root = progressFixture([
    { number: 1, date: "2026-10-01" },
    { number: 3, date: "2026-10-03" },
  ], [], { generate: false });
  try {
    const result = run(root, "lint:progress-log");
    assert.equal(result.exit, 1);
    assert.match(result.stderr, /missing Session 2/);
  } finally {
    cleanup(root);
  }
});

test("lint:progress-log: passes with no session files yet", () => {
  const root = progressFixture();
  try {
    const result = run(root, "lint:progress-log");
    assert.equal(result.exit, 0, result.output);
    assert.match(readFileSync(path.join(root, "PROGRESS.md"), "utf8"), /No sessions recorded yet/);
  } finally {
    cleanup(root);
  }
});

test("lint:progress-log: fails when the state shards change without regenerating the dashboard", () => {
  const root = progressFixture([], [
    { id: "feat-001", name: "First", state: "planned" },
  ]);
  try {
    write(root, ".harness/state/feat-001.json", `${JSON.stringify({ state: "passing", evidence: "new evidence" }, null, 2)}\n`);
    const result = run(root, "lint:progress-log");
    assert.equal(result.exit, 1);
    assert.match(result.stderr, /is out of date/);
    assert.match(result.stderr, /progress-update/);
  } finally {
    cleanup(root);
  }
});

test("progress-update: regenerates feature state and session index from their sources", () => {
  const root = progressFixture([
    { number: 1, date: "2026-10-01" },
  ], [
    { id: "feat-001", name: "First", state: "passing", evidence: "verified" },
  ]);
  try {
    write(root, ".harness/state/feat-001.json", `${JSON.stringify({ state: "blocked", evidence: "blocked evidence" }, null, 2)}\n`);
    const update = run(root, "progress-update");
    assert.equal(update.exit, 0, update.output);
    const lint = run(root, "lint:progress-log");
    assert.equal(lint.exit, 0, lint.output);
    const dashboard = readFileSync(path.join(root, "PROGRESS.md"), "utf8");
    assert.match(dashboard, /Failing\/blocked features: feat-001 — First/);
    assert.match(dashboard, /Last evidence: feat-001 — First — blocked evidence/);
  } finally {
    cleanup(root);
  }
});

test("lint:progress-log: fails when the session filename and heading disagree", () => {
  const root = progressFixture([
    { number: 1, date: "2026-10-01", heading: "### Session 001 — 2026-10-02 — Wrong date" },
  ], [], { generate: false });
  try {
    const result = run(root, "lint:progress-log");
    assert.equal(result.exit, 1);
    assert.match(result.stderr, /must start with a matching/);
  } finally {
    cleanup(root);
  }
});
