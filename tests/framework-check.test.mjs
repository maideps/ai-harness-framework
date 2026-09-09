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

function run(root, mode, args = []) {
  const result = spawnSync(process.execPath, [RUNNER, mode, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 30000,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const exit = result.error ? 1 : (result.status ?? 1);
  return { exit, stdout, stderr, output: `${stdout}${stderr}` };
}

function cleanup(root) {
  rmSync(root, { recursive: true, force: true });
}

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

function featureListFixture(features) {
  const root = fixture();
  write(root, "feature_list.json", `${JSON.stringify({ features }, null, 2)}\n`);
  return root;
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
  const root = fixture();
  write(root, "feature_list.json", `${JSON.stringify({ features }, null, 2)}\n`);
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
    const laneList = JSON.parse(readFileSync(path.join(worktreePath, "feature_list.json"), "utf8"));
    assert.equal(laneList.features.find((f) => f.id === "feat-001").state, "active");
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
    write(worktreePath, "feature_list.json", `${JSON.stringify(
      { features: [{ id: "feat-001", state: "passing", evidence: "test", dependencies: [], layers: [] }] },
      null,
      2,
    )}\n`);
    spawnSync("git", ["add", "-A"], { cwd: worktreePath });
    spawnSync("git", ["commit", "-q", "-m", "feat-001 passing"], { cwd: worktreePath });

    const result = run(root, "lane-land", ["feat-001"]);
    assert.equal(result.exit, 0, result.output);
    assert.ok(!existsSync(worktreePath), "worktree should be removed after landing");

    const landed = JSON.parse(readFileSync(path.join(root, "feature_list.json"), "utf8"));
    assert.equal(landed.features.find((f) => f.id === "feat-001").state, "passing");

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
    write(worktreePath, "feature_list.json", `${JSON.stringify(
      { features: [{ id: "feat-001", state: "passing", evidence: "test", dependencies: [], layers: [] }] },
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
  const root = fixture();
  write(root, "feature_list.json", `${JSON.stringify({ features }, null, 2)}\n`);
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
