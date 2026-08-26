import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
