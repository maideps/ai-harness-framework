import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { adopt } from "../../scripts/create-harness.mjs";

// scripts/framework-check.mjs is a monolithic CLI (fail() calls process.exit
// directly, every mode reads relative to process.cwd()) rather than a module
// of pure exported functions. Unit-testing its rules in isolation means
// spawning it against small fixture repositories and asserting on exit code
// + output — the same technique scripts/adoption-matrix.mjs already uses to
// exercise check-arch and verify-feature in throwaway directories.

const RUNNER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "framework-check.mjs");

function fixture() {
  return mkdtempSync(path.join(os.tmpdir(), "cw-framework-check-"));
}

function write(root, rel, content) {
  const dest = path.join(root, rel);
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, content, "utf8");
}

function run(root, mode, args = [], env = {}, { unset = [] } = {}) {
  // ./init.sh runs this suite with CW_INIT_SH=1 set, which turns lint's placeholder check
  // into a warning. Drop it from the inherited environment so a test only sees it when it
  // passes it explicitly; otherwise the #23 lint assertions pass alone but fail under init.sh.
  // `unset` drops more inherited variables for the tests that depend on their absence.
  const inheritedEnv = { ...process.env };
  delete inheritedEnv.CW_INIT_SH;
  // verify-feature sets HARNESS_CHECK_FULL=1 for its layers (feat-056); inherited, it would
  // make every scoped-check test see a full run when the suite runs inside the gate.
  delete inheritedEnv.HARNESS_CHECK_FULL;
  for (const name of unset) delete inheritedEnv[name];
  const result = spawnSync(process.execPath, [RUNNER, mode, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 30000,
    env: { ...inheritedEnv, ...env },
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const exit = result.error ? 1 : (result.status ?? 1);
  return { exit, stdout, stderr, output: `${stdout}${stderr}` };
}

function cleanup(root) {
  rmSync(root, { recursive: true, force: true });
}

// #23: a fresh create-harness output must fail lint/arch-003 until its docs are actually
// filled in, diffed against their own template source rather than matched against bracketed
// placeholder text (which had drifted out of the templates' prose and gone silently vacuous).
test("ensureNoPlaceholders: a fresh create-harness output fails lint and arch-003 (#23)", () => {
  const root = fixture();
  try {
    adopt(root, { skipExisting: true });
    const lint = run(root, "lint");
    assert.equal(lint.exit, 1, lint.output);
    assert.match(lint.output, /README\.md is unchanged from its template/);
    assert.match(lint.output, /docs\/PRODUCT\.md is unchanged from its template/);
    assert.match(lint.output, /docs\/quality-document\.md is unchanged from its template/);
    const archCheck = run(root, "arch:no-placeholders");
    assert.equal(archCheck.exit, 1, archCheck.output);
  } finally {
    cleanup(root);
  }
});

test("ensureNoPlaceholders: passes once a doc is edited; still fails for any doc left unfilled", () => {
  const root = fixture();
  try {
    adopt(root, { skipExisting: true });
    writeFileSync(path.join(root, "README.md"), "# Real Project\n\nActual project-specific content.\n", "utf8");
    const lint = run(root, "lint");
    assert.equal(lint.exit, 1, lint.output);
    assert.doesNotMatch(lint.output, /README\.md is unchanged/);
    assert.match(lint.output, /docs\/PRODUCT\.md is unchanged from its template/);
    assert.match(lint.output, /docs\/quality-document\.md is unchanged from its template/);
  } finally {
    cleanup(root);
  }
});

test("ensureNoPlaceholders: warns when package description is still the framework description", () => {
  const root = fixture();
  try {
    adopt(root, { skipExisting: true });
    const pkgPath = path.join(root, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    pkg.description =
      "A general-purpose AI agent harness framework for building reliable, predictable multi-session engineering workflows";
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");

    const lint = run(root, "lint", [], { CW_INIT_SH: "1" });
    assert.equal(lint.exit, 0, lint.output);
    assert.match(lint.output, /\[WARN\] package\.json description is still the framework's description/);

    pkg.description = "A description for my project";
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
    const customizedLint = run(root, "lint", [], { CW_INIT_SH: "1" });
    assert.doesNotMatch(customizedLint.output, /package\.json description is still/);
  } finally {
    cleanup(root);
  }
});

test("ensureNoPlaceholders: init.sh's CW_INIT_SH warns instead of failing, so a first run completes", () => {
  const root = fixture();
  try {
    adopt(root, { skipExisting: true });
    const result = run(root, "lint", [], { CW_INIT_SH: "1" });
    assert.equal(result.exit, 0, result.output);
    assert.match(result.stdout, /\[WARN\] README\.md is unchanged from its template/);
    // arch-003 is unaffected by CW_INIT_SH — it is the hard gate check-arch still enforces.
    const archCheck = run(root, "arch:no-placeholders", [], { CW_INIT_SH: "1" });
    assert.equal(archCheck.exit, 1, archCheck.output);
  } finally {
    cleanup(root);
  }
});

test("clean-state-check: scans the directories derived from productRoots, not hardcoded roots", () => {
  const root = fixture();
  try {
    write(root, ".harness/manifest.json", `${JSON.stringify(baseManifest({ productRoots: ["repositories/"] }))}\n`);
    write(root, "repositories/app/debug.js", "debugger;\n");
    write(root, "src/unrelated.js", "debugger;\n");
    const result = run(root, "clean-state-check", [], { DEBUG_SCAN_PATHS: "" });
    assert.match(result.output, /repositories[\\/]app[\\/]debug\.js:1: debugger;/);
    assert.doesNotMatch(result.output, /src[\\/]unrelated\.js/);
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

// #24: the multi-repo component's own verify-all can be present but have verified nothing
// yet (e.g. only the untouched example scaffold). It signals that with a reserved exit code
// (42) rather than a silent exit 0, so this runner reports it as SKIP, not a pass.
test("verify-all: a reserved exit code from the script is reported as SKIP, not a silent pass", () => {
  const root = fixture();
  try {
    write(root, "scripts/verify-all.mjs", "process.exit(42);\n");
    const result = run(root, "verify-all");
    assert.equal(result.exit, 0, result.output);
    assert.match(result.stdout, /\[SKIP\] verify-all ran but nothing was verified yet/);
  } finally {
    cleanup(root);
  }
});

test("verify-all: a real failure (any other non-zero exit) still fails the layer", () => {
  const root = fixture();
  try {
    write(root, "scripts/verify-all.mjs", "process.exit(1);\n");
    const result = run(root, "verify-all");
    assert.equal(result.exit, 1, result.output);
    assert.match(result.stdout, /\[FAIL\] verify-all failed \(exit 1\)/);
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

// ---- feat-029: harness self-tests leave an adopter's per-feature path ------
//
// A fixture is an adopter unless its manifest sets frameworkRepository: true. Its
// .harness/selftest/ holds a failing *.selftest.mjs, so a mode that runs the harness self-tests fails
// and one that skips them passes; its scripts/adoption-matrix.mjs is a stub that only prints a
// marker. The matrix runs
// this suite inside adoption cells (CW_ADOPTION_CELL=1), and CI may set CW_SKIP_ADOPTION_MATRIX,
// so the tests that depend on their absence unset both. node:test marks this file's process with
// NODE_TEST_CONTEXT, and a nested `node --test` that inherits it skips every file and exits 0, so
// the tests that need the fixture's self-test to really run unset it too.

const MATRIX_VARS = ["CW_ADOPTION_CELL", "CW_SKIP_ADOPTION_MATRIX"];
const NESTED_TEST_VARS = ["NODE_TEST_CONTEXT"];

function selfTestFixture({ framework = false, failing = true } = {}) {
  const root = fixture();
  write(root, "feature_list.json", `${JSON.stringify({ features: [] }, null, 2)}\n`);
  write(
    root,
    "tests/harness.test.mjs",
    `import { test } from "node:test";\nimport assert from "node:assert/strict";\ntest("product test", () => assert.equal(1, 1));\n`,
  );
  write(
    root,
    ".harness/selftest/harness.selftest.mjs",
    `import { test } from "node:test";\nimport assert from "node:assert/strict";\ntest("harness self-test", () => assert.equal(1, ${failing ? 2 : 1}));\n`,
  );
  write(root, "scripts/adoption-matrix.mjs", "console.log('STUB ADOPTION MATRIX RAN');\n");
  if (framework) {
    write(root, ".harness/manifest.json", `${JSON.stringify({ frameworkRepository: true }, null, 2)}\n`);
  }
  return root;
}

test("test: in an adopter the layer checks the feature graph but does not run the harness self-tests", () => {
  const root = selfTestFixture();
  try {
    const result = run(root, "test", [], {}, { unset: NESTED_TEST_VARS });
    assert.equal(result.exit, 0, result.output);
    assert.match(result.stdout, /PASS: Feature dependency graph and WIP contract are valid/);
    assert.match(result.stdout, /NOTE: harness self-tests are not part of this layer/);
    assert.doesNotMatch(result.output, /Runner unit tests|runner unit tests failed/);
  } finally {
    cleanup(root);
  }
});

test("test: in the framework repository the layer still runs the harness self-tests", () => {
  const root = selfTestFixture({ framework: true });
  try {
    const result = run(root, "test", [], {}, { unset: NESTED_TEST_VARS });
    assert.equal(result.exit, 1, result.output);
    assert.match(result.output, /FAIL: runner unit tests failed/);
  } finally {
    cleanup(root);
  }
});

test("selftest: runs .harness/selftest/*.selftest.mjs on demand and fails when one fails", () => {
  const failing = selfTestFixture();
  const passing = selfTestFixture({ failing: false });
  try {
    const failed = run(failing, "selftest", [], {}, { unset: NESTED_TEST_VARS });
    assert.equal(failed.exit, 1, failed.output);
    assert.match(failed.output, /FAIL: runner unit tests failed/);
    assert.doesNotMatch(failed.output, /product test/);
    const passed = run(passing, "selftest", [], {}, { unset: NESTED_TEST_VARS });
    assert.equal(passed.exit, 0, passed.output);
    assert.match(passed.stdout, /PASS: Runner unit tests pass/);
  } finally {
    cleanup(failing);
    cleanup(passing);
  }
});

test("node --test discovers product tests without discovering harness self-tests", () => {
  const root = fixture();
  try {
    write(root, "tests/product.test.mjs", `import { test } from "node:test";\ntest("product test", () => {});\n`);
    write(root, ".harness/selftest/harness.selftest.mjs", `import { test } from "node:test";\ntest("harness self-test", () => { throw new Error("should not run"); });\n`);
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ["--test"], { cwd: root, encoding: "utf8", env });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.match(result.stdout, /product test/);
    assert.doesNotMatch(result.stdout, /harness self-test/);
  } finally {
    cleanup(root);
  }
});

test("selftest: reports SKIP when there are no harness self-tests", () => {
  const root = fixture();
  try {
    const result = run(root, "selftest");
    assert.equal(result.exit, 0, result.output);
    assert.match(result.stdout, /\[SKIP\] No harness self-tests found/);
  } finally {
    cleanup(root);
  }
});

test("verify-chain: an adopter runs the harness self-tests once per session (./init.sh)", () => {
  const adopterRoot = selfTestFixture();
  const frameworkRoot = selfTestFixture({ framework: true });
  try {
    const adopterRun = run(adopterRoot, "verify-chain", [], {}, { unset: NESTED_TEST_VARS });
    assert.equal(adopterRun.exit, 1, adopterRun.output);
    assert.match(adopterRun.stdout, /--- Running: harness self-tests/);
    assert.match(adopterRun.output, /FAIL: runner unit tests failed/);
    // In the framework repository the test layer of the project chain runs them instead; this
    // fixture has no runtime, so the chain is empty and nothing runs the failing test.
    const frameworkRun = run(frameworkRoot, "verify-chain", [], {}, { unset: NESTED_TEST_VARS });
    assert.equal(frameworkRun.exit, 0, frameworkRun.output);
    assert.doesNotMatch(frameworkRun.stdout, /harness self-tests/);
  } finally {
    cleanup(adopterRoot);
    cleanup(frameworkRoot);
  }
});

test("e2e: an adopter reports SKIP instead of running the framework's adoption matrix", () => {
  const root = selfTestFixture();
  try {
    const result = run(root, "e2e", [], {}, { unset: MATRIX_VARS });
    assert.equal(result.exit, 0, result.output);
    assert.match(result.stdout, /\[SKIP\] No end-to-end tests configured/);
    assert.doesNotMatch(result.stdout, /STUB ADOPTION MATRIX RAN/);
  } finally {
    cleanup(root);
  }
});

test("e2e: the framework repository still runs its adoption matrix", () => {
  const root = selfTestFixture({ framework: true });
  try {
    const result = run(root, "e2e", [], {}, { unset: MATRIX_VARS });
    assert.equal(result.exit, 0, result.output);
    assert.match(result.stdout, /STUB ADOPTION MATRIX RAN/);
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

// feat-029: a quoted "true" would read as false and silently turn the framework's self-tests off.
test("ensureManifest: frameworkRepository must be a boolean", () => {
  const valid = manifestFixture(baseManifest({ frameworkRepository: true }));
  const invalid = manifestFixture(baseManifest({ frameworkRepository: "true" }));
  try {
    const ok = run(valid, "manifest");
    assert.equal(ok.exit, 0, ok.output);
    const bad = run(invalid, "manifest");
    assert.equal(bad.exit, 1, bad.output);
    assert.match(bad.output, /manifest frameworkRepository must be true or false/);
  } finally {
    cleanup(valid);
    cleanup(invalid);
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

test("ensureManifest: fails when a shipped skill named in shippedSkills has no SKILL.md (feat-026)", () => {
  const manifest = baseManifest({ core: [...baseManifest().core, "skills/"], shippedSkills: ["verification", "gone"] });
  const root = manifestFixture(manifest, {
    extraTrackedFiles: { "skills/verification/SKILL.md": "---\nname: verification\ndescription: x\n---\n## When to Use\n" },
  });
  try {
    const result = run(root, "manifest");
    assert.equal(result.exit, 1);
    assert.match(result.stderr, /manifest shipped skill is missing: skills\/gone\/SKILL\.md/);
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
  const declarations = features.map(({ state, evidence, clarifications, ...decl }) => decl);
  write(root, "feature_list.json", `${JSON.stringify({ features: declarations }, null, 2)}\n`);
  for (const feature of features) {
    if ("state" in feature || "evidence" in feature) {
      write(
        root,
        `.harness/state/${feature.id}.json`,
        `${JSON.stringify({ state: feature.state ?? "planned", evidence: feature.evidence ?? "", ...("clarifications" in feature ? { clarifications: feature.clarifications } : {}) }, null, 2)}\n`,
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

// ---- check-arch "forbid" rules (feat-041) ----------------------------------

function forbidRule(overrides = {}) {
  return {
    id: "arch-ban",
    kind: "forbid",
    description: "no legacyCall",
    pattern: "legacyCall\\(",
    paths: ["src/**/*.{js,mjs}"],
    what: "legacyCall is banned",
    why: "it hides errors",
    fix: "call modernCall instead",
    ...overrides,
  };
}

// A git repository with the given rules and files; untracked files are written after `git add`.
function forbidFixture(rules, files, untracked = {}) {
  const root = archRulesFixture(rules);
  for (const [rel, content] of Object.entries(files)) write(root, rel, content);
  spawnSync("git", ["init", "-q"], { cwd: root });
  spawnSync("git", ["add", "."], { cwd: root });
  for (const [rel, content] of Object.entries(untracked)) write(root, rel, content);
  return root;
}

test("check-arch forbid: passes when no tracked file in its paths matches (feat-041)", () => {
  const root = forbidFixture([forbidRule()], {
    "src/app.mjs": "modernCall();\n",
    "docs/notes.md": "legacyCall( is mentioned outside the rule's paths\n",
  });
  try {
    const result = run(root, "check-arch");
    assert.equal(result.exit, 0, result.output);
    assert.match(result.stdout, /All architecture rules pass/);
  } finally {
    cleanup(root);
  }
});

test("check-arch forbid: fails listing every hit as file:line, then what/why/fix (feat-041)", () => {
  const root = forbidFixture([forbidRule()], {
    "src/a.js": "ok();\nlegacyCall(1);\n",
    "src/deep/nested/b.mjs": "legacyCall(2);\r\nok();\r\nlegacyCall(3);\r\n",
  });
  try {
    const result = run(root, "check-arch");
    assert.equal(result.exit, 1, result.output);
    assert.match(result.stdout, /\[FAIL\] 3 forbidden match\(es\)/);
    assert.match(result.stdout, /src\/a\.js:2: legacyCall\(1\);/);
    assert.match(result.stdout, /src\/deep\/nested\/b\.mjs:1: legacyCall\(2\);/);
    assert.match(result.stdout, /src\/deep\/nested\/b\.mjs:3: legacyCall\(3\);/);
    assert.match(result.stdout, /What: legacyCall is banned/);
    assert.match(result.stdout, /Why: it hides errors/);
    assert.match(result.stdout, /Fix: call modernCall instead/);
  } finally {
    cleanup(root);
  }
});

test("check-arch forbid: never reports allowed or untracked paths (feat-041)", () => {
  const root = forbidFixture(
    [forbidRule({ allow: ["src/legacy/**"] })],
    { "src/legacy/old.js": "legacyCall();\n", "src/app.ts": "legacyCall(); // .ts is outside the paths glob\n" },
    { "src/new.js": "legacyCall();\n" },
  );
  try {
    const result = run(root, "check-arch");
    assert.equal(result.exit, 0, result.output);
    assert.doesNotMatch(result.stdout, /forbidden match/);
  } finally {
    cleanup(root);
  }
});

test("check-arch forbid: an invalid pattern or missing paths fail naming the rule; outside git it SKIPs (feat-041)", () => {
  const cases = [
    [forbidRule({ pattern: "(unclosed" }), /rule arch-ban: invalid pattern/],
    [forbidRule({ pattern: undefined }), /rule arch-ban: a forbid rule needs a pattern/],
    [forbidRule({ paths: [] }), /rule arch-ban: a forbid rule needs a non-empty paths list/],
    [forbidRule({ allow: "src/**" }), /rule arch-ban: allow must be a list of globs/],
  ];
  for (const [rule, message] of cases) {
    const root = forbidFixture([rule], { "src/a.js": "ok();\n" });
    try {
      const result = run(root, "check-arch");
      assert.equal(result.exit, 1, result.output);
      assert.match(result.stdout, message);
    } finally {
      cleanup(root);
    }
  }
  const outside = archRulesFixture([forbidRule()]);
  try {
    const result = run(outside, "check-arch", [], { GIT_CEILING_DIRECTORIES: path.dirname(outside) });
    assert.equal(result.exit, 0, result.output);
    assert.match(result.stdout, /\[SKIP\] not a git repository — forbid rules search tracked files/);
    const broken = archRulesFixture([forbidRule({ pattern: "(unclosed" })]);
    try {
      const invalid = run(broken, "check-arch", [], { GIT_CEILING_DIRECTORIES: path.dirname(broken) });
      assert.equal(invalid.exit, 1, invalid.output);
      assert.match(invalid.stdout, /rule arch-ban: invalid pattern/);
    } finally {
      cleanup(broken);
    }
  } finally {
    cleanup(outside);
  }
});

// ---- Every MUST names its gate (feat-048) ----------------------------------

function mustRulesFixture(agents) {
  const root = archRulesFixture([{ id: "arch-001" }]);
  write(root, "AGENTS.md", agents);
  return root;
}

test("lint:must-rules: passes a fully tagged AGENTS.md and reports gate and none counts (feat-048)", () => {
  const root = mustRulesFixture([
    "## Constraints",
    "",
    "- **MUST** run the check <!-- enforced-by: npm run check -->",
    "- **MUST NOT** break the layout",
    "  <!-- source: some template -->",
    "  <!-- enforced-by: arch-001 -->",
    "- **MUST** keep features small",
    "  <!-- enforced-by: none — a judgment call -->",
    "- A plain rule that mentions MUST in passing needs no tag",
    "",
  ].join("\n"));
  try {
    const result = run(root, "lint:must-rules");
    assert.equal(result.exit, 0, result.output);
    assert.match(result.stdout, /MUST rules name what enforces them \(2 by a gate, 1 prose only/);
  } finally {
    cleanup(root);
  }
});

test("lint:must-rules: fails an untagged rule, an unknown arch rule id and a none without a reason (feat-048)", () => {
  const root = mustRulesFixture([
    "- **MUST** do one thing",
    "",
    "  <!-- enforced-by: npm run check -->",
    "- **MUST NOT** do another",
    "  <!-- enforced-by: arch-001, arch-042 -->",
    "- **MUST** do a third",
    "  <!-- enforced-by: none -->",
    "",
  ].join("\n"));
  try {
    const result = run(root, "lint:must-rules");
    assert.equal(result.exit, 1, result.output);
    assert.match(result.stderr, /AGENTS\.md:1 "- \*\*MUST\*\* do one thing…" has no <!-- enforced-by/, "a tag after a blank line does not count");
    assert.match(result.stderr, /AGENTS\.md:4 .* names arch-042, not in \.harness\/arch-rules\.json/);
    assert.doesNotMatch(result.stderr, /names arch-001/);
    assert.match(result.stderr, /AGENTS\.md:6 .* says enforced-by: none without a reason/);
  } finally {
    cleanup(root);
  }
});

// ---- Opt-in pre-commit hook (feat-043) -------------------------------------

// A git repository holding a copy of the runner (with scripts/hooks/), a lint script that fails
// while LINT_FAIL exists, and one forbid rule. Git's global and system config are replaced by a
// throwaway file, so the developer's own hooksPath or signing settings cannot leak in.
function hookFixture() {
  const root = forbidFixture([forbidRule()], { "src/app.mjs": "modernCall();\n" });
  cpSync(path.dirname(RUNNER), path.join(root, "scripts"), { recursive: true });
  write(root, "lint.mjs", "import { existsSync } from 'node:fs';\nif (existsSync('LINT_FAIL')) { console.log('lint found a problem'); process.exit(1); }\n");
  write(root, "package.json", `${JSON.stringify({
    name: "hooked",
    private: true,
    scripts: { lint: "node lint.mjs", "check-arch": "node scripts/framework-check.mjs check-arch" },
  }, null, 2)}\n`);
  const globalConfig = path.join(root, "..", `${path.basename(root)}.gitconfig`);
  writeFileSync(globalConfig, "[user]\n\tname = Test\n\temail = test@example.com\n[commit]\n\tgpgsign = false\n", "utf8");
  const env = { GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: "1" };
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, ...env } });
    return { exit: result.status ?? 1, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
  };
  const commit = (message) => {
    git("add", "-A");
    return git("commit", "-q", "-m", message);
  };
  return { root, env, git, commit, done: () => { cleanup(root); rmSync(globalConfig, { force: true }); } };
}

test("hooks-install: commits run lint and the architecture rules, and a failing one is blocked (feat-043)", () => {
  const repo = hookFixture();
  try {
    const install = run(repo.root, "hooks-install", [], repo.env);
    assert.equal(install.exit, 0, install.output);
    assert.equal(repo.git("config", "--get", "core.hooksPath").output.trim(), "scripts/hooks");
    assert.equal(run(repo.root, "hooks-install", [], repo.env).exit, 0, "installing twice is a no-op");

    const clean = repo.commit("clean");
    assert.equal(clean.exit, 0, clean.output);
    assert.match(clean.output, /lint and architecture rules pass/);

    write(repo.root, "src/bad.js", "legacyCall();\n");
    const banned = repo.commit("banned pattern");
    assert.notEqual(banned.exit, 0, banned.output);
    assert.match(banned.output, /src\/bad\.js:1: legacyCall\(\);/);
    assert.match(banned.output, /Commit blocked: npm run check-arch failed/);

    rmSync(path.join(repo.root, "src", "bad.js"));
    write(repo.root, "LINT_FAIL", "x\n");
    const linted = repo.commit("lint failure");
    assert.notEqual(linted.exit, 0, linted.output);
    assert.match(linted.output, /Commit blocked: npm run lint failed/);
    assert.doesNotMatch(linted.output, /\[pre-commit\] npm run check-arch/, "a failing lint stops before the architecture rules");
    assert.equal(repo.git("log", "--oneline").output.trim().split("\n").length, 1, "only the clean commit landed");
  } finally {
    repo.done();
  }
});

test("hooks-install: never replaces a foreign core.hooksPath or switches the user's own hooks off (feat-043)", () => {
  const repo = hookFixture();
  try {
    repo.git("config", "core.hooksPath", ".githooks");
    const foreign = run(repo.root, "hooks-install", [], repo.env);
    assert.equal(foreign.exit, 1, foreign.output);
    assert.match(foreign.stderr, /core\.hooksPath already points at \.githooks, and it will not be replaced/);
    assert.match(foreign.stderr, /"scripts\/hooks\/pre-commit" \|\| exit 1/);
    assert.equal(repo.git("config", "--get", "core.hooksPath").output.trim(), ".githooks");
    assert.match(run(repo.root, "hooks-uninstall", [], repo.env).stdout, /points at \.githooks, not the harness hooks — left unchanged/);
    assert.equal(repo.git("config", "--get", "core.hooksPath").output.trim(), ".githooks");

    repo.git("config", "--unset", "core.hooksPath");
    write(repo.root, ".git/hooks/pre-commit", "#!/bin/sh\nexit 0\n");
    const own = run(repo.root, "hooks-install", [], repo.env);
    assert.equal(own.exit, 1, own.output);
    assert.match(own.stderr, /has hooks of your own \(pre-commit\) that core\.hooksPath would switch off/);
    assert.equal(repo.git("config", "--get", "core.hooksPath").exit, 1, "nothing was set");
  } finally {
    repo.done();
  }
});

test("hooks-uninstall: restores git's default hooks folder; outside git both commands fail clearly (feat-043)", () => {
  const repo = hookFixture();
  try {
    assert.equal(run(repo.root, "hooks-install", [], repo.env).exit, 0);
    const uninstall = run(repo.root, "hooks-uninstall", [], repo.env);
    assert.equal(uninstall.exit, 0, uninstall.output);
    assert.match(uninstall.stdout, /Removed the harness pre-commit hook/);
    assert.equal(repo.git("config", "--get", "core.hooksPath").exit, 1);
    assert.match(run(repo.root, "hooks-uninstall", [], repo.env).stdout, /not installed — nothing to do/);
  } finally {
    repo.done();
  }
  const outside = fixture();
  try {
    const result = run(outside, "hooks-install", [], { GIT_CEILING_DIRECTORIES: path.dirname(outside) });
    assert.equal(result.exit, 1);
    assert.match(result.stderr, /not a git repository — run git init first/);
  } finally {
    cleanup(outside);
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

// ---- lane-suggest (feat-021) ------------------------------------------------
// Advisory only: never creates a worktree, writes no state. These tests assert
// it reports the right *set* of startable features and excludes anything
// already claimed, without exercising git worktree mechanics (lane-new's own
// tests above already cover that) — a plain `git branch` is enough to
// simulate "a lane already claims this feature".

test("lane-suggest: reports nothing to start when no feature is planned", () => {
  const root = gitFeatureFixture([{ id: "feat-001", state: "passing", dependencies: [], layers: [] }]);
  try {
    const result = run(root, "lane-suggest");
    assert.equal(result.exit, 0, result.output);
    assert.match(result.stdout, /No features are currently startable in parallel/);
  } finally {
    cleanup(root);
  }
});

test("lane-suggest: suggests a single startable feature directly instead of a parallel set", () => {
  const root = gitFeatureFixture([{ id: "feat-001", name: "Solo Feature", state: "planned", dependencies: [], layers: [] }]);
  try {
    const result = run(root, "lane-suggest");
    assert.equal(result.exit, 0, result.output);
    assert.match(result.stdout, /Only one feature is startable right now: feat-001 \(Solo Feature\)/);
    assert.match(result.stdout, /npm run lane-new -- feat-001/);
  } finally {
    cleanup(root);
  }
});

test("lane-suggest: lists every independent startable feature with dependency status and suggested commands", () => {
  const root = gitFeatureFixture([
    { id: "feat-001", name: "Already Done", state: "passing", dependencies: [], layers: [] },
    { id: "feat-002", name: "No Deps", state: "planned", dependencies: [], layers: [] },
    { id: "feat-003", name: "Satisfied Deps", state: "planned", dependencies: ["feat-001"], layers: [] },
  ]);
  try {
    const result = run(root, "lane-suggest");
    assert.equal(result.exit, 0, result.output);
    assert.match(result.stdout, /2 feature\(s\) are startable right now and independent of each other/);
    assert.match(result.stdout, /feat-002: No Deps \(no dependencies\)/);
    assert.match(result.stdout, /feat-003: Satisfied Deps \(depends on: feat-001 \[passing\]\)/);
    assert.match(result.stdout, /npm run lane-new -- feat-002/);
    assert.match(result.stdout, /npm run lane-new -- feat-003/);
    assert.doesNotMatch(result.stdout, /feat-001:/);
  } finally {
    cleanup(root);
  }
});

test("lane-suggest: excludes a planned feature with unmet dependencies", () => {
  const root = gitFeatureFixture([
    { id: "feat-001", name: "Not Done Yet", state: "planned", dependencies: [], layers: [] },
    { id: "feat-002", name: "No Deps", state: "planned", dependencies: [], layers: [] },
    { id: "feat-003", name: "Blocked On 001", state: "planned", dependencies: ["feat-001"], layers: [] },
  ]);
  try {
    const result = run(root, "lane-suggest");
    assert.equal(result.exit, 0, result.output);
    // feat-001 and feat-002 are both startable (two candidates); feat-003 is not.
    assert.match(result.stdout, /2 feature\(s\) are startable/);
    assert.doesNotMatch(result.stdout, /feat-003:/);
  } finally {
    cleanup(root);
  }
});

test("lane-suggest: excludes active and blocked features", () => {
  const root = gitFeatureFixture([
    { id: "feat-001", name: "In Progress", state: "active", dependencies: [], layers: [] },
    { id: "feat-002", name: "Blocked", state: "blocked", dependencies: [], layers: [] },
    { id: "feat-003", name: "Startable", state: "planned", dependencies: [], layers: [] },
  ]);
  try {
    const result = run(root, "lane-suggest");
    assert.equal(result.exit, 0, result.output);
    assert.match(result.stdout, /Only one feature is startable right now: feat-003/);
  } finally {
    cleanup(root);
  }
});

test("lane-suggest: excludes a feature already claimed by an existing lane/* branch", () => {
  const root = gitFeatureFixture([
    { id: "feat-001", name: "Already Claimed", state: "planned", dependencies: [], layers: [] },
    { id: "feat-002", name: "Still Open", state: "planned", dependencies: [], layers: [] },
  ]);
  try {
    spawnSync("git", ["branch", "lane/feat-001"], { cwd: root });
    const result = run(root, "lane-suggest");
    assert.equal(result.exit, 0, result.output);
    assert.match(result.stdout, /Only one feature is startable right now: feat-002/);
  } finally {
    cleanup(root);
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
    { id: "feat-001", name: "One", behavior: "b", verification: "v", dependencies: [], layers: [{ label: "L", cmd: "true", repair: "r" }], state: "passing", evidence: "All verification layers passed via scripts/verify-feature.sh" },
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
            { label: "Optional", cmd: `${NODE} -e "console.log('[SKIP] optional')"`, repair: "r", required: false },
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

    assert.equal(cleanEvidence.bound, true);
    assert.match(cleanEvidence.checksHash, /^[0-9a-f]{16}$/);

    write(root, "dirty-marker.txt", "dirty\n");
    const dirtyResult = run(root, "verify-feature", ["feat-001", "--allow-dirty"]);
    assert.equal(dirtyResult.exit, 0, dirtyResult.output);
    const dirtyShard = JSON.parse(readFileSync(path.join(root, ".harness/state/feat-001.json"), "utf8"));
    const dirtyEvidence = JSON.parse(dirtyShard.evidence);
    assert.equal(dirtyEvidence.dirty, true);
    assert.equal(dirtyEvidence.bound, false);
    assert.match(dirtyEvidence.summary, /unbound: verified with uncommitted changes/);
  } finally {
    cleanup(root);
  }
});

// ---- feat-030 (D-041): evidence is bound to committed code ----------------

function evidenceFeature(overrides = {}) {
  return {
    id: "feat-001",
    name: "One",
    behavior: "b",
    verification: "v",
    dependencies: [],
    layers: [{ label: "L", cmd: `${NODE} -e "process.exit(0)"`, repair: "r" }],
    ...overrides,
  };
}

function readEvidence(root, featureId = "feat-001") {
  const shard = JSON.parse(readFileSync(path.join(root, `.harness/state/${featureId}.json`), "utf8"));
  return { state: shard.state, evidence: shard.evidence ? JSON.parse(shard.evidence) : null };
}

function writeDeclarations(root, features) {
  write(root, "feature_list.json", `${JSON.stringify({ features }, null, 2)}\n`);
}

test("verify-feature: uncommitted code refuses before any layer runs (feat-030)", () => {
  const root = gitFeatureFixture([
    evidenceFeature({ state: "active", layers: [{ label: "L", cmd: `${NODE} -e "require('fs').writeFileSync('layer-ran.txt','x')"`, repair: "r" }] }),
  ]);
  try {
    write(root, "src/app.js", "console.log('uncommitted');\n");
    const result = run(root, "verify-feature", ["feat-001"]);
    assert.equal(result.exit, 1, result.output);
    assert.match(result.output, /1 uncommitted change\(s\) outside harness bookkeeping/);
    assert.match(result.output, /src\/app\.js/);
    assert.match(result.output, /--allow-dirty/);
    assert.equal(existsSync(path.join(root, "layer-ran.txt")), false, "no layer may run on a refused tree");
    assert.equal(readEvidence(root).state, "active");
  } finally {
    cleanup(root);
  }
});

test("verify-feature: a modified tracked file refuses too, not only untracked ones (feat-030)", () => {
  const root = gitFeatureFixture([evidenceFeature({ state: "active" })]);
  try {
    write(root, "feature_list.json", `${readFileSync(path.join(root, "feature_list.json"), "utf8")}\n`);
    const result = run(root, "verify-feature", ["feat-001"]);
    assert.equal(result.exit, 1, result.output);
    assert.match(result.output, /feature_list\.json/);
  } finally {
    cleanup(root);
  }
});

test("verify-feature: uncommitted harness bookkeeping does not block, and the evidence is bound (feat-030)", () => {
  const root = gitFeatureFixture([evidenceFeature({ state: "active" })]);
  try {
    // activate rewrote the shard; a session note and dashboard are in progress
    write(root, ".harness/state/feat-001.json", `${JSON.stringify({ state: "active", evidence: "" }, null, 2)}\n`);
    write(root, "progress/001-2026-11-05.md", "### Session 001\n");
    write(root, "PROGRESS.md", "# Progress\n");
    write(root, "session-handoff.md", "notes\n");
    write(root, ".harness/traces/session-start-1.json", "{}\n");
    const result = run(root, "verify-feature", ["feat-001"]);
    assert.equal(result.exit, 0, result.output);
    const { state, evidence } = readEvidence(root);
    assert.equal(state, "passing");
    assert.equal(evidence.bound, true);
    assert.equal(evidence.dirty, false);
    assert.doesNotMatch(evidence.summary, /unbound/);
  } finally {
    cleanup(root);
  }
});

test("verify-feature: a layer that leaves a new file behind fails instead of recording evidence (feat-030)", () => {
  const root = gitFeatureFixture([
    evidenceFeature({ state: "active", layers: [{ label: "Writes", cmd: `${NODE} -e "require('fs').writeFileSync('coverage.out','x')"`, repair: "r" }] }),
  ]);
  try {
    const result = run(root, "verify-feature", ["feat-001"]);
    assert.equal(result.exit, 1, result.output);
    assert.match(result.output, /verification layers left 1 uncommitted change/);
    assert.match(result.output, /coverage\.out/);
    assert.equal(readEvidence(root).state, "active");
  } finally {
    cleanup(root);
  }
});

test("verify-feature: outside a git repository the evidence is recorded unbound with a NOTE (feat-030)", () => {
  const root = fixture();
  writeDeclarations(root, [evidenceFeature()]);
  try {
    const result = run(root, "verify-feature", ["feat-001"]);
    assert.equal(result.exit, 0, result.output);
    assert.match(result.output, /NOTE: not a git repository/);
    const { evidence } = readEvidence(root);
    assert.equal(evidence.bound, false);
    assert.match(evidence.summary, /unbound: not a git repository/);
  } finally {
    cleanup(root);
  }
});

test("verify-feature: an unknown option fails instead of being taken as the feature id (feat-030)", () => {
  const root = fixture();
  writeDeclarations(root, [evidenceFeature()]);
  try {
    const result = run(root, "verify-feature", ["feat-001", "--alow-dirty"]);
    assert.equal(result.exit, 1);
    assert.match(result.stderr, /unknown verify-feature option --alow-dirty/);
  } finally {
    cleanup(root);
  }
});

test("typecheck: warns when a passing feature's label, cmd or required changed after it was verified, not its repair hint (feat-030)", () => {
  const root = fixture();
  const layer = { label: "L", cmd: `${NODE} -e "process.exit(0)"`, repair: "r" };
  writeDeclarations(root, [evidenceFeature({ layers: [layer] })]);
  try {
    assert.equal(run(root, "verify-feature", ["feat-001"]).exit, 0);
    const fresh = run(root, "typecheck");
    assert.equal(fresh.exit, 0, fresh.output);
    assert.doesNotMatch(fresh.output, /\[WARN\]/);

    writeDeclarations(root, [evidenceFeature({ layers: [{ ...layer, repair: "a different hint" }] })]);
    assert.doesNotMatch(run(root, "typecheck").output, /\[WARN\]/, "repair text is not a check");

    for (const changed of [{ ...layer, cmd: `${NODE} -e "process.exit(0) // changed"` }, { ...layer, label: "Renamed" }, { ...layer, required: false }]) {
      writeDeclarations(root, [evidenceFeature({ layers: [changed] })]);
      const stale = run(root, "typecheck");
      assert.equal(stale.exit, 0, "stale evidence warns, it does not fail the layer");
      assert.match(stale.output, /\[WARN\] feat-001 is passing, but its verification layers changed after it was verified/);
    }
  } finally {
    cleanup(root);
  }
});

// ---- feat-034 (D-045): the end-of-session steps agents skipped ------------

test("verify-feature: a bound pass records a verify-feature trail; an unbound pass does not (feat-034)", () => {
  const root = gitFeatureFixture([evidenceFeature({ state: "active" })]);
  const unbound = fixture();
  writeDeclarations(unbound, [evidenceFeature()]);
  try {
    assert.equal(run(root, "verify-feature", ["feat-001"]).exit, 0);
    const trails = readdirSync(path.join(root, ".harness", "trails")).filter((name) => /-verify-feature-feat-001\.json$/.test(name));
    assert.equal(trails.length, 1, "one trail named after the feature");
    const trail = JSON.parse(readFileSync(path.join(root, ".harness", "trails", trails[0]), "utf8"));
    const { evidence } = readEvidence(root);
    assert.equal(trail.kind, "verify-feature");
    assert.equal(trail.feature, "feat-001");
    assert.equal(trail.commit, evidence.commit);
    assert.equal(trail.checksHash, evidence.checksHash);

    assert.equal(run(unbound, "verify-feature", ["feat-001"]).exit, 0);
    assert.equal(existsSync(path.join(unbound, ".harness", "trails")), false, "no trail for evidence that names no commit");
  } finally {
    cleanup(root);
    cleanup(unbound);
  }
});

// ---- feat-052 (D-061): README contrasted with the repository ----------------

const GOOD_README = [
  "# Greeter",
  "",
  "[![CI](https://example.com/badge.svg)](https://example.com/ci)",
  "",
  "Greets people by name from the command line.",
  "",
  "<!-- a draft link that is not published yet: [demo](docs/demo.gif) -->",
  "",
  "## Install",
  "",
  "```bash",
  "npm install",
  "npm run check   # verify (make check works too; make and npm forms mirror each other)",
  "```",
  "",
  "## Usage",
  "",
  "Run `npm start` or `node app/greet.mjs`. Per-feature state lives in `.harness/state/<id>.json`; notes in `progress/NNN-YYYY-MM-DD.md`.",
  "See the [guide](docs/GUIDE.md#setup) and [the spec](https://example.com/spec).",
  "",
  "## License",
  "",
  "MIT",
  "",
].join("\n");

function readmeRepo(readme, { scripts = { check: "x", start: "x" }, makefile = "check:\n\t@echo ok\n", files = { "app/greet.mjs": "", "docs/GUIDE.md": "# Guide\n" } } = {}) {
  const root = fixture();
  write(root, "README.md", readme);
  write(root, "package.json", `${JSON.stringify({ name: "greeter", scripts }, null, 2)}\n`);
  if (makefile !== null) write(root, "Makefile", makefile);
  for (const [rel, content] of Object.entries(files)) write(root, rel, content);
  return root;
}

test("lint:readme: passes a conventional README whose commands, links and paths exist (feat-052)", () => {
  const root = readmeRepo(GOOD_README);
  try {
    const result = run(root, "lint:readme");
    assert.equal(result.exit, 0, result.output);
    assert.match(result.stdout, /README\.md follows the conventional structure and names only what exists/);
  } finally {
    cleanup(root);
  }
});

test("lint:readme: reports missing sections and claims the repository does not back, by line (feat-052)", () => {
  const readme = [
    "Greets people.",
    "",
    "## Usage",
    "",
    "```bash",
    "npm run deploy",
    "make release",
    "```",
    "",
    "Edit `app/missing.mjs`; read [the guide](docs/NOPE.md).",
    "",
  ].join("\n");
  const root = readmeRepo(readme);
  try {
    const result = run(root, "lint:readme");
    assert.equal(result.exit, 1, result.output);
    for (const expected of [
      /README\.md:3: start with exactly one level-1 title \(found 0\)/,
      /add an install section/,
      /add a License section/,
      /README\.md:6: "npm run deploy" names a script package\.json does not define/,
      /README\.md:7: "make release" names a target the Makefile does not define/,
      /README\.md:10: `app\/missing\.mjs` does not exist in the repository/,
      /README\.md:10: the link to docs\/NOPE\.md points to a file that does not exist/,
    ]) {
      assert.match(result.stderr, expected);
    }
    assert.doesNotMatch(result.stderr, /add a usage section/);
    // A title followed straight by a section (badges alone don't describe anything).
    write(root, "README.md", GOOD_README.replace("Greets people by name from the command line.\n", ""));
    assert.match(run(root, "lint:readme").stderr, /README\.md:1: add a short description of what the project does right after the title/);
  } finally {
    cleanup(root);
  }
});

test("lint:readme: ignores routes and slash-delimited identifiers that are not repository paths (#65)", () => {
  const readme = GOOD_README.replace(
    "Run `npm start` or `node app/greet.mjs`.",
    "Run `npm start` or `node app/greet.mjs`. The service answers `GET /health/live` and `GET /app/health` with `{\"status\": \"ok\"}`, `application/json`, `openai/gpt-4o-mini`, `groq/llama-3.1-8b-instant` and `pgvector/pgvector:pg17`.",
  );
  const root = readmeRepo(readme);
  try {
    const result = run(root, "lint:readme");
    assert.equal(result.exit, 0, result.output);
  } finally {
    cleanup(root);
  }
});

test("lint:readme: a path under a missing root directory is still reported when it reads as a path (#65)", () => {
  const readme = GOOD_README.replace(
    "Run `npm start` or `node app/greet.mjs`.",
    "Run `npm start` or `node app/greet.mjs`. Edit `aap/greet.mjs`, `src/components/` and `./lib/util`.",
  );
  const root = readmeRepo(readme);
  try {
    const result = run(root, "lint:readme");
    assert.equal(result.exit, 1, result.output);
    for (const missing of ["aap/greet.mjs", "src/components/", "./lib/util"]) {
      assert.match(result.stderr, new RegExp("`" + missing.replace(/[./]/g, "\\$&") + "` does not exist in the repository"));
    }
  } finally {
    cleanup(root);
  }
});

test("lint:readme: the README template create-harness places passes the contract in the adopter (feat-052)", () => {
  const root = fixture();
  try {
    adopt(root);
    if (!existsSync(path.join(root, "docs", "HARNESS.md"))) {
      spawnSync(process.execPath, [path.join(root, "scripts", "harness-docs.mjs")], { cwd: root, encoding: "utf8" });
    }
    const result = run(root, "lint:readme");
    assert.equal(result.exit, 0, result.output);
  } finally {
    cleanup(root);
  }
});

test("lint:readme: a README over 100 lines needs a table of contents (feat-052)", () => {
  const long = `${GOOD_README}${"\nMore detail.".repeat(90)}\n`;
  const root = readmeRepo(long);
  try {
    assert.match(run(root, "lint:readme").stderr, /a README over 100 lines needs a "Table of Contents" section/);
    write(root, "README.md", long.replace("## Install", "## Table of Contents\n\n- [Install](#install)\n\n## Install"));
    assert.equal(run(root, "lint:readme").exit, 0);
  } finally {
    cleanup(root);
  }
});

// ---- feat-053 (D-062): README command claims come only from shell fences ----

test("lint:readme: a fence tagged with a non-shell language is not read as commands (feat-053)", () => {
  const sample = [
    "Sample output:",
    "",
    "```text",
    "Finding: make the computed-target calls explicit before release.",
    "Then npm run nothing ever happens here.",
    "```",
    "",
    "```JSON",
    "{ \"note\": \"make sense of it\" }",
    "```",
    "",
  ].join("\n");
  const root = readmeRepo(GOOD_README.replace("## License", `${sample}## License`));
  try {
    const result = run(root, "lint:readme");
    assert.equal(result.exit, 0, result.output);
  } finally {
    cleanup(root);
  }
});

test("lint:readme: shell-tagged and untagged fences are still read as commands (feat-053)", () => {
  const readme = (fence) => GOOD_README.replace("## License", `${fence}\nmake release   # make nothing here\n\`\`\`\n\n## License`);
  const releaseLine = readme("```bash").split("\n").indexOf("make release   # make nothing here") + 1;
  for (const fence of ["```bash", "```Shell title=\"run\"", "```console", "```pwsh", "```"]) {
    const root = readmeRepo(readme(fence));
    try {
      const result = run(root, "lint:readme");
      assert.equal(result.exit, 1, `${fence}: ${result.output}`);
      assert.match(result.stderr, new RegExp(`README\\.md:${releaseLine}: "make release" names a target the Makefile does not define`), fence);
      assert.doesNotMatch(result.stderr, /"make nothing"/, `${fence}: a shell comment is not a command`);
    } finally {
      cleanup(root);
    }
  }
});

// ---- feat-051 (D-060): README stays current with the app --------------------

// A git repository where README.md is committed first and feat-001's code later; feat-001 is
// passing with bound evidence naming the code commit (`at`: "readme" or "code").
function readmeFixture({ readmeAfter = false, extra = [] } = {}) {
  const root = gitFeatureFixture([evidenceFeature({ state: "active" }), ...extra]);
  const gitIn = (...args) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: root, encoding: "utf8" });
  write(root, "README.md", "# App\n\nGreets people.\n");
  gitIn("add", "-A");
  gitIn("commit", "-q", "-m", "readme");
  write(root, "app.mjs", "export const greet = () => 'hi';\n");
  gitIn("add", "-A");
  gitIn("commit", "-q", "-m", "code");
  const codeCommit = gitIn("rev-parse", "--short", "HEAD").stdout.trim();
  const evidence = JSON.stringify({ summary: "All verification layers passed via node scripts/framework-check.mjs verify-feature", timestamp: "2026-11-17T10:00:00.000Z", commit: codeCommit, dirty: false, bound: true, checksHash: "0123456789abcdef", layers: [] });
  write(root, ".harness/state/feat-001.json", `${JSON.stringify({ state: "passing", evidence }, null, 2)}\n`);
  if (readmeAfter) {
    write(root, "README.md", "# App\n\nGreets people with hi.\n");
    gitIn("add", "README.md");
    gitIn("commit", "-q", "-m", "describe hi");
  }
  return { root, gitIn, codeCommit };
}

const readmeLine = (result) => result.output.split(/\r?\n/).find((line) => line.includes("README.md") && /\[(PASS|FAIL|WARN)\]/.test(line)) ?? "";

test("clean-state-check: fails while README.md predates the latest verified feature, passes once it changes (feat-051)", () => {
  const stale = readmeFixture();
  try {
    assert.match(readmeLine(run(stale.root, "clean-state-check")), new RegExp(`\\[FAIL\\] README\\.md was last changed before feat-001 passed \\(${stale.codeCommit}\\)\\. Contrast it with the repository \\(the readme-review skill\\) and update it to describe what the app does now`));
    write(stale.root, "README.md", "# App\n\nGreets people with hi.\n");
    assert.match(readmeLine(run(stale.root, "clean-state-check")), /\[PASS\] README\.md has changes since feat-001 passed \(uncommitted\)/);
  } finally {
    cleanup(stale.root);
  }
  const fresh = readmeFixture({ readmeAfter: true });
  try {
    assert.match(readmeLine(run(fresh.root, "clean-state-check")), new RegExp(`\\[PASS\\] README\\.md changed at or after feat-001 passed \\(${fresh.codeCommit}\\)`));
  } finally {
    cleanup(fresh.root);
  }
});

test("clean-state-check: a feature that declares readme is skipped; an unknown commit warns (feat-051)", () => {
  const { root } = readmeFixture({ readmeAfter: true });
  try {
    // feat-002 passed later with no user-visible change: the README is still judged against feat-001.
    const declarations = JSON.parse(readFileSync(path.join(root, "feature_list.json"), "utf8"));
    declarations.features.push({ ...evidenceFeature({ id: "feat-002", name: "Two" }), readme: "internal refactor, nothing users see" });
    writeDeclarations(root, declarations.features);
    const evidence = JSON.stringify({ summary: "All verification layers passed via node scripts/framework-check.mjs verify-feature", timestamp: "2026-11-18T10:00:00.000Z", commit: "fffffff", dirty: false, bound: true, checksHash: "0123456789abcdef", layers: [] });
    write(root, ".harness/state/feat-002.json", `${JSON.stringify({ state: "passing", evidence }, null, 2)}\n`);
    assert.match(readmeLine(run(root, "clean-state-check")), /\[PASS\] README\.md changed at or after feat-001 passed/);

    delete declarations.features[1].readme;
    writeDeclarations(root, declarations.features);
    assert.match(readmeLine(run(root, "clean-state-check")), /\[WARN\] cannot tell whether README\.md changed after feat-002 passed: commit fffffff is not in this clone's history/);
  } finally {
    cleanup(root);
  }
});

test("typecheck: a readme opt-out must be a non-empty reason (feat-051)", () => {
  for (const readme of ["", "  ", true]) {
    const root = featureListFixture([evidenceFeature({ readme })]);
    try {
      const result = run(root, "typecheck");
      assert.equal(result.exit, 1, `${JSON.stringify(readme)}: ${result.output}`);
      assert.match(result.stderr, /readme must be a non-empty reason why README\.md needs no change/);
    } finally {
      cleanup(root);
    }
  }
});

test("clean-state-check: fails until docs/quality-document.md mentions every gate-verified feature (feat-034)", () => {
  const bound = JSON.stringify({ summary: "s", commit: "abc1234", dirty: false, bound: true, checksHash: "0123456789abcdef", layers: [] });
  const legacy = JSON.stringify({ summary: "s", commit: "abc1234", dirty: true, layers: [] });
  const root = featureListFixture([
    evidenceFeature({ state: "passing", evidence: bound }),
    evidenceFeature({ id: "feat-002", name: "Two", state: "passing", evidence: legacy }),
  ]);
  try {
    const qualityLine = (result) => result.output.split(/\r?\n/).find((line) => line.includes("quality-document")) ?? "";
    assert.match(qualityLine(run(root, "clean-state-check")), /\[WARN\] docs\/quality-document\.md is missing/);

    write(root, "docs/quality-document.md", "# Quality\n\nNothing rated yet.\n");
    const missing = run(root, "clean-state-check");
    assert.equal(missing.exit, 1);
    assert.match(qualityLine(missing), /\[FAIL\] docs\/quality-document\.md does not mention feat-001\. Add a line/);
    assert.doesNotMatch(qualityLine(missing), /feat-002/, "evidence recorded before feat-030 is not checked");

    write(root, "docs/quality-document.md", "# Quality\n\n## Notes\n\n- feat-001: greeting, app/greet.mjs rated A.\n");
    assert.match(qualityLine(run(root, "clean-state-check")), /\[PASS\] docs\/quality-document\.md mentions every gate-verified feature \(1\)/);
    // A longer id that merely contains the feature's id does not count.
    write(root, "docs/quality-document.md", "- feat-0010 only\n");
    assert.match(qualityLine(run(root, "clean-state-check")), /\[FAIL\]/);
  } finally {
    cleanup(root);
  }
});

test("clean-state-check: nothing to rate when no feature has gate evidence (feat-034)", () => {
  const root = featureListFixture([evidenceFeature({ state: "planned" })]);
  try {
    assert.match(run(root, "clean-state-check").output, /\[PASS\] No gate-verified features to rate yet/);
  } finally {
    cleanup(root);
  }
});

test("typecheck: evidence recorded before feat-030 (no checksHash) is never reported stale", () => {
  const root = featureListFixture([
    evidenceFeature({ state: "passing", evidence: JSON.stringify({ summary: "All verification layers passed via node scripts/framework-check.mjs verify-feature", commit: "abc1234", dirty: true, layers: [] }) }),
    evidenceFeature({ id: "feat-002", state: "passing", evidence: "All verification layers passed via scripts/verify-feature.sh at 2026-01-01" }),
  ]);
  try {
    const result = run(root, "typecheck");
    assert.equal(result.exit, 0, result.output);
    assert.doesNotMatch(result.output, /\[WARN\]/);
  } finally {
    cleanup(root);
  }
});

// ---- feat-044 (D-057): captures collected by verify-feature ----------------

// A committed git fixture whose layer runs shoot.mjs, which writes the named files under
// shots/; shots/old.png is left over from an earlier run (an hour old). `ignore` decides whether
// shots/ is gitignored, as the docs require.
function captureFixture({ writes = ["shots/a.png", "shots/sub/b.png"], captures = ["shots/**/*.png"], ignore = true } = {}) {
  const root = gitFeatureFixture([
    evidenceFeature({ state: "active", layers: [{ label: "E2E shots", cmd: `${NODE} shoot.mjs`, repair: "r", captures }] }),
  ]);
  write(root, "shoot.mjs", `import { mkdirSync, writeFileSync } from "node:fs";\nimport path from "node:path";\nfor (const file of ${JSON.stringify(writes)}) { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, "png:" + file); }\nconsole.log("[PASS] shots taken");\n`);
  if (ignore) write(root, ".gitignore", "shots/\n");
  spawnSync("git", ["add", "-A"], { cwd: root });
  spawnSync("git", ["commit", "-q", "-m", "shoot"], { cwd: root });
  write(root, "shots/old.png", "png:old");
  const hourAgo = new Date(Date.now() - 3600 * 1000);
  utimesSync(path.join(root, "shots/old.png"), hourAgo, hourAgo);
  return root;
}

test("verify-feature: collects the captures a layer wrote this run, copies and hashes them, ignores leftovers (feat-044)", () => {
  const root = captureFixture();
  try {
    const result = run(root, "verify-feature", ["feat-001"]);
    assert.equal(result.exit, 0, result.output);
    assert.match(result.stdout, /Captures \(2\) — open each one and compare it to the feature's declared behavior/);
    const { state, evidence } = readEvidence(root);
    assert.equal(state, "passing");
    const captures = evidence.layers[0].captures;
    assert.deepEqual(captures.map((capture) => capture.path), [
      ".harness/logs/feat-001/captures/01-e2e-shots/shots/a.png",
      ".harness/logs/feat-001/captures/01-e2e-shots/shots/sub/b.png",
    ]);
    for (const capture of captures) {
      const bytes = readFileSync(path.join(root, capture.path));
      assert.equal(capture.bytes, bytes.length);
      assert.equal(capture.sha256, createHash("sha256").update(bytes).digest("hex"));
    }
    assert.doesNotMatch(result.stdout, /old\.png/, "a file from an earlier run is not evidence");
  } finally {
    cleanup(root);
  }
});

test("verify-feature: a layer that declares captures but writes none fails (feat-044)", () => {
  const root = captureFixture({ writes: [] });
  try {
    const result = run(root, "verify-feature", ["feat-001"]);
    assert.equal(result.exit, 1, result.output);
    assert.match(result.stdout, /declares captures \(shots\/\*\*\/\*\.png\) but this run wrote none/);
    assert.notEqual(readEvidence(root).state, "passing");
  } finally {
    cleanup(root);
  }
});

test("verify-feature: captures in a folder git tracks fail with the folder to ignore, before or after the layers (feat-044)", () => {
  const root = captureFixture({ ignore: false });
  try {
    const leftover = run(root, "verify-feature", ["feat-001"]);
    assert.equal(leftover.exit, 1, leftover.output);
    assert.match(leftover.stdout, /uncommitted change\(s\) outside harness bookkeeping[\s\S]*Declared captures are among them: add shots\/ to \.gitignore/);
    rmSync(path.join(root, "shots"), { recursive: true, force: true });
    const fresh = run(root, "verify-feature", ["feat-001"]);
    assert.equal(fresh.exit, 1, fresh.output);
    assert.match(fresh.stdout, /The verification layers left[\s\S]*Declared captures are among them: add shots\/ to \.gitignore/);
  } finally {
    cleanup(root);
  }
});

test("typecheck: malformed captures fail; declaring captures changes the checks hash only where declared (feat-044)", () => {
  for (const captures of [[], [""], "shots/*.png"]) {
    const root = featureListFixture([evidenceFeature({ layers: [{ label: "L", cmd: "true", repair: "r", captures }] })]);
    try {
      const result = run(root, "typecheck");
      assert.equal(result.exit, 1, `${JSON.stringify(captures)}: ${result.output}`);
      assert.match(result.stderr, /captures must be a non-empty list of globs/);
    } finally {
      cleanup(root);
    }
  }
  const root = gitFeatureFixture([evidenceFeature({ state: "active" })]);
  try {
    assert.equal(run(root, "verify-feature", ["feat-001"]).exit, 0);
    assert.doesNotMatch(run(root, "typecheck").output, /\[WARN\]/, "a layer without captures keeps its hash");
    const declarations = JSON.parse(readFileSync(path.join(root, "feature_list.json"), "utf8"));
    declarations.features[0].layers[0].captures = ["shots/*.png"];
    writeDeclarations(root, declarations.features);
    assert.match(run(root, "typecheck").output, /\[WARN\] feat-001 is passing, but its verification layers changed/);
  } finally {
    cleanup(root);
  }
});

// ---- feat-045: agents look at captures (shipped skills) ---------------------

test("shipped skills tell agents to look at captures before committing and at the gate, screenshots not video (feat-045)", () => {
  const skill = (name) => readFileSync(path.resolve(path.dirname(RUNNER), "..", "skills", name, "SKILL.md"), "utf8");
  const verification = skill("verification");
  assert.match(verification, /During development, before committing/);
  assert.match(verification, /At the gate/);
  assert.match(verification, /you can read images but not watch video/);
  assert.match(skill("review"), /If a layer declares `captures`, open each copy/);
  assert.match(skill("testing"), /"captures": \["test-results\/\*\*\/\*\.png"\]/);
  for (const name of ["verification", "review", "testing"]) {
    assert.match(skill(name), /video/i, `${name} says what video is for`);
  }
});

// ---- feat-049 (D-056): a passing state needs gate evidence -----------------

// Default timestamp: after the fixtures' trail (2026-11-10), as for any pass since trails existed.
function gateEvidence({ commit = "abc1234", bound = true, timestamp = "2026-11-12T00:00:00.000Z", checksHash = "1111222233334444" } = {}) {
  return JSON.stringify({ summary: "All verification layers passed via node scripts/framework-check.mjs verify-feature", timestamp, commit, dirty: !bound, bound, checksHash, layers: [{ label: "L", result: "PASS" }] });
}

function writeTrail(root, { feature, commit = "abc1234", checksHash = "1111222233334444", at = "2026-11-10T00:00:01.000Z" }) {
  write(root, `.harness/trails/${at.replace(/[:.]/g, "-")}-verify-feature-${feature}.json`, `${JSON.stringify({ kind: "verify-feature", recorded_at: at, feature, commit, checksHash }, null, 2)}\n`);
}

test("typecheck: accepts passing features whose evidence came from the gate, in every format it has written (feat-049)", () => {
  const root = featureListFixture([
    evidenceFeature({ id: "feat-001", state: "passing", evidence: gateEvidence() }),
    evidenceFeature({ id: "feat-002", state: "passing", evidence: gateEvidence({ bound: false }) }),
    evidenceFeature({ id: "feat-003", state: "passing", evidence: gateEvidence({ commit: "0ld0000", timestamp: "2026-11-01T00:00:00.000Z" }) }),
    evidenceFeature({ id: "feat-004", state: "passing", evidence: "All verification layers passed via scripts/verify-feature.sh at 2026-08-17" }),
    evidenceFeature({ id: "feat-005", state: "passing", evidence: JSON.stringify({ summary: "All verification layers passed via node scripts/framework-check.mjs verify-feature", commit: "abc1234", layers: [] }) }),
    evidenceFeature({ id: "feat-006", state: "planned" }),
  ]);
  writeTrail(root, { feature: "feat-001" });
  try {
    const result = run(root, "typecheck");
    assert.equal(result.exit, 0, result.output);
    assert.match(result.stdout, /Every passing feature carries evidence from verify-feature \(5\)/);
  } finally {
    cleanup(root);
  }
});

test("typecheck: fails a hand-marked passing feature and bound evidence without its trail (feat-049)", () => {
  const root = featureListFixture([
    evidenceFeature({ id: "feat-001", state: "passing", evidence: "" }),
    evidenceFeature({ id: "feat-002", state: "passing", evidence: "Implemented and tested; all checks green" }),
    evidenceFeature({ id: "feat-003", state: "passing", evidence: JSON.stringify({ summary: "done", commit: "abc1234" }) }),
    evidenceFeature({ id: "feat-004", state: "passing", evidence: gateEvidence() }),
    evidenceFeature({ id: "feat-005", state: "passing", evidence: gateEvidence({ commit: "fffffff" }) }),
  ]);
  writeTrail(root, { feature: "feat-005", commit: "abc1234" });
  try {
    const result = run(root, "typecheck");
    assert.equal(result.exit, 1, result.output);
    for (const id of ["feat-001", "feat-002", "feat-003"]) {
      assert.match(result.stderr, new RegExp(`${id} is passing, but its evidence was not written by verify-feature`));
    }
    assert.match(result.stderr, /feat-004 is passing, but its evidence names commit abc1234, but no verify-feature trail/);
    assert.match(result.stderr, /feat-005 is passing, but its evidence names commit fffffff, but no verify-feature trail/);
    assert.match(result.stderr, /run node scripts\/framework-check\.mjs verify-feature feat-001 \(npm run verify-feature -- feat-001\)/);
  } finally {
    cleanup(root);
  }
});

test("verify-feature: a dependency whose layers changed after it passed blocks its dependents (feat-030)", () => {
  const root = fixture();
  const dependency = evidenceFeature();
  const dependent = evidenceFeature({ id: "feat-002", name: "Two", dependencies: ["feat-001"] });
  writeDeclarations(root, [dependency, dependent]);
  try {
    assert.equal(run(root, "verify-feature", ["feat-001"]).exit, 0);
    writeDeclarations(root, [evidenceFeature({ layers: [{ ...dependency.layers[0], cmd: `${NODE} -e "process.exit(0) // v2"` }] }), dependent]);
    const blocked = run(root, "verify-feature", ["feat-002"]);
    assert.equal(blocked.exit, 1, blocked.output);
    assert.match(blocked.output, /depends on features whose verification layers changed after they passed: feat-001/);

    assert.equal(run(root, "verify-feature", ["feat-001"]).exit, 0, "re-verifying the dependency refreshes its evidence");
    const unblocked = run(root, "verify-feature", ["feat-002"]);
    assert.equal(unblocked.exit, 0, unblocked.output);
  } finally {
    cleanup(root);
  }
});

// ---- H01: a required layer that only reports SKIP must not pass -----------
// (2026-09-08 external review of a downstream adopter: a feature went
// "passing" while its required layer printed only [SKIP] and did nothing.)

test("verify-feature: a required layer that only reports SKIP fails, not passes", () => {
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
            { label: "Vacuous", cmd: `${NODE} -e "console.log('[SKIP] nothing was configured')"`, repair: "r" },
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
    assert.match(result.output, /\[FAIL\] Vacuous .* required layer reported only SKIP, nothing was verified/);
    assert.match(result.output, /set "required": false on it in feature_list\.json/);
    assert.equal(existsSync(path.join(root, ".harness/state/feat-001.json")), false);
  } finally {
    cleanup(root);
  }
});

test("verify-feature: a layer with required:false may report only SKIP and still pass", () => {
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
              label: "Vacuous but optional",
              cmd: `${NODE} -e "console.log('[SKIP] optional toolchain not installed')"`,
              repair: "r",
              required: false,
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
    assert.equal(result.exit, 0, result.output);
    const shard = JSON.parse(readFileSync(path.join(root, ".harness/state/feat-001.json"), "utf8"));
    assert.equal(shard.state, "passing");
  } finally {
    cleanup(root);
  }
});

test("verify-feature: a SKIP alongside a real PASS in the same layer is informational, not a failure", () => {
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
              label: "Mixed",
              cmd: `${NODE} -e "console.log('[PASS] core check'); console.log('[SKIP] optional toolchain cell')"`,
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
    assert.equal(result.exit, 0, result.output);
    const shard = JSON.parse(readFileSync(path.join(root, ".harness/state/feat-001.json"), "utf8"));
    assert.equal(shard.state, "passing");
    assert.match(JSON.parse(shard.evidence).summary, /SKIP reported in: Mixed/);
  } finally {
    cleanup(root);
  }
});

test("verify-feature: a layer whose own pass evidence uses \"PASS:\" (not \"[PASS]\") alongside a nested [SKIP] is not vacuous", () => {
  // framework-check.mjs's own pass()/fail() helpers print "PASS: <message>"
  // (no brackets) — a layer like "npm run check" that only emits that
  // colon-style convention at its own level, while nested output elsewhere
  // contains bracket-style [SKIP] lines, must not be misread as vacuous.
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
              label: "Colon style",
              cmd: `${NODE} -e "console.log('PASS: core command result'); console.log('[SKIP] nested optional toolchain')"`,
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
    assert.equal(result.exit, 0, result.output);
    const shard = JSON.parse(readFileSync(path.join(root, ".harness/state/feat-001.json"), "utf8"));
    assert.equal(shard.state, "passing");
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
        { id: "feat-001", name: "One", behavior: "b", verification: "v", dependencies: [], state: "passing", evidence: "All verification layers passed via scripts/verify-feature.sh", layers: [{ label: "L", cmd: "true", repair: "r" }] },
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
    assert.equal(shard1.evidence, "All verification layers passed via scripts/verify-feature.sh");
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
    { id: "feat-002", state: "planned", dependencies: ["feat-001"], clarifications: "none" },
  ]);
  try {
    const result = run(root, "activate", ["feat-002"]);
    assert.equal(result.exit, 0, result.output);
    assert.deepEqual(JSON.parse(readFileSync(path.join(root, ".harness/state/feat-002.json"), "utf8")), {
      state: "active",
      evidence: "",
      clarifications: "none",
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

// ---- feat-054 (D-064): clarify a feature before activating it -------------

function clarifyFixture(extra = {}) {
  return featureListFixture([
    {
      id: "feat-001",
      name: "Export",
      behavior: "The export command writes a CSV file of every invoice. It handles errors properly, etc. Archived customers receive a reminder email.",
      verification: "Manual check that the export looks right.",
      dependencies: [],
      layers: [{ label: "Layer 1", cmd: "node -e 0", repair: "rerun" }],
      state: "planned",
      ...extra,
    },
  ]);
}

test("clarify: prints the checklist and flags vague words, an unnamed check and an uncovered sentence (feat-054)", () => {
  const root = clarifyFixture();
  try {
    const result = run(root, "clarify", ["feat-001"]);
    assert.equal(result.exit, 0, result.output);
    assert.match(result.stdout, /=== Clarify feat-001 — Export \(planned\) ===/);
    assert.match(result.stdout, /1\. Which terms does the behavior use without defining them/);
    assert.match(result.stdout, /5\. Is every sentence of the behavior checked/);
    assert.match(result.stdout, /vague wording in behavior: "properly"/);
    assert.match(result.stdout, /vague wording in behavior: "etc"/);
    assert.match(result.stdout, /verification names no test or command/);
    assert.match(result.stdout, /no counterpart in the verification: "Archived customers receive a reminder email\."/);
    assert.match(result.stdout, /Recorded: nothing yet/);
    assert.match(result.stdout, /clarify -- feat-001 --record <answers\.json>/);
  } finally {
    cleanup(root);
  }
});

test("clarify: a precise declaration has no flags (feat-054)", () => {
  const root = clarifyFixture({
    behavior: "The export command writes a CSV file of every invoice.",
    verification: "Runner tests: the export command writes one CSV row per invoice.",
  });
  try {
    const result = run(root, "clarify", ["feat-001"]);
    assert.equal(result.exit, 0, result.output);
    assert.match(result.stdout, /^Flags: none$/m);
  } finally {
    cleanup(root);
  }
});

test("clarify --record: writes clarifications to the state shard, [] as none (feat-054)", () => {
  const root = clarifyFixture();
  write(root, "docs/USAGE.md", "# Usage\n");
  try {
    write(root, "answers.json", JSON.stringify([
      { question: "Which errors?", answer: "A missing output folder is reported and nothing is written.", source: "human" },
      { question: "Which columns?", answer: "Those listed in the usage doc.", source: "docs/USAGE.md:1" },
    ]));
    const recorded = run(root, "clarify", ["feat-001", "--record", "answers.json"]);
    assert.equal(recorded.exit, 0, recorded.output);
    const shard = JSON.parse(readFileSync(path.join(root, ".harness/state/feat-001.json"), "utf8"));
    assert.equal(shard.state, "planned");
    assert.equal(shard.clarifications.length, 2);
    assert.equal(shard.clarifications[1].source, "docs/USAGE.md:1");
    assert.equal(run(root, "arch:sharded-state").exit, 0);
    assert.match(run(root, "clarify", ["feat-001"]).stdout, /Recorded: 2 clarification\(s\)/);

    write(root, "none.json", "[]");
    assert.equal(run(root, "clarify", ["feat-001", "--record", "none.json"]).exit, 0);
    assert.equal(JSON.parse(readFileSync(path.join(root, ".harness/state/feat-001.json"), "utf8")).clarifications, "none");
  } finally {
    cleanup(root);
  }
});

test("clarify --record: rejects entries without question, answer or source, and unknown sources (feat-054)", () => {
  const root = clarifyFixture();
  try {
    for (const [entry, message] of [
      [{ answer: "a", source: "human" }, /entry 1 is missing question/],
      [{ question: "q", source: "human" }, /entry 1 is missing answer/],
      [{ question: "q", answer: "a", source: "  " }, /entry 1 is missing source/],
      [{ question: "q", answer: "a", source: "docs/NOPE.md" }, /source docs\/NOPE\.md is neither "human" nor a path/],
    ]) {
      write(root, "answers.json", JSON.stringify([entry]));
      const result = run(root, "clarify", ["feat-001", "--record", "answers.json"]);
      assert.equal(result.exit, 1, result.output);
      assert.match(result.stderr, message);
    }
    write(root, "answers.json", '"skipped"');
    assert.match(run(root, "clarify", ["feat-001", "--record", "answers.json"]).stderr, /only by activate --skip-clarify/);
    assert.equal("clarifications" in JSON.parse(readFileSync(path.join(root, ".harness/state/feat-001.json"), "utf8")), false);
  } finally {
    cleanup(root);
  }
});

test("activate: refuses an unclarified feature and names clarify (feat-054)", () => {
  const root = clarifyFixture();
  try {
    const result = run(root, "activate", ["feat-001"]);
    assert.equal(result.exit, 1);
    assert.match(result.stderr, /feat-001 has no clarifications recorded — run npm run clarify -- feat-001/);
    assert.equal(JSON.parse(readFileSync(path.join(root, ".harness/state/feat-001.json"), "utf8")).state, "planned");
  } finally {
    cleanup(root);
  }
});

test("activate: accepts recorded clarifications and keeps them through verify-feature's shard rewrite (feat-054)", () => {
  const answers = [{ question: "q", answer: "a", source: "human" }];
  const root = clarifyFixture({ clarifications: answers });
  try {
    assert.equal(run(root, "activate", ["feat-001"]).exit, 0);
    assert.equal(run(root, "record-feature-pass", ["feat-001", "verified"]).exit, 0);
    const shard = JSON.parse(readFileSync(path.join(root, ".harness/state/feat-001.json"), "utf8"));
    assert.equal(shard.state, "passing");
    assert.deepEqual(shard.clarifications, answers);
  } finally {
    cleanup(root);
  }
});

test("activate --skip-clarify: activates, records skipped, and the brief shows it (feat-054)", () => {
  const root = clarifyFixture();
  try {
    assert.equal(run(root, "activate", ["feat-001", "--bogus"]).exit, 1);
    const result = run(root, "activate", ["feat-001", "--skip-clarify"]);
    assert.equal(result.exit, 0, result.output);
    assert.match(result.stdout, /without clarification/);
    assert.deepEqual(JSON.parse(readFileSync(path.join(root, ".harness/state/feat-001.json"), "utf8")), {
      state: "active",
      evidence: "",
      clarifications: "skipped",
    });
    assert.match(run(root, "brief").stdout, /clarifications: skipped — activated with --skip-clarify/);
  } finally {
    cleanup(root);
  }
});

test("typecheck: rejects a malformed clarifications record in a shard (feat-054)", () => {
  const root = clarifyFixture({ clarifications: [{ question: "q" }] });
  try {
    const result = run(root, "arch:sharded-state");
    assert.equal(result.exit, 1);
    assert.match(result.stderr, /feat-001\.json clarifications entry 1 is missing answer/);
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

    const activated = run(root, "activate", ["feat-002", "--skip-clarify"]);
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
    assert.equal(run(root, "activate", ["feat-002", "--skip-clarify"]).exit, 0);
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

// ---- feat-036 (D-047): session notes start from a generated skeleton ------

const todayLocal = () => {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

test("progress-new: writes the next note with the exact heading and sections, and lint's progress check passes right after (feat-036)", () => {
  const root = progressFixture([], [{ id: "feat-001", name: "First", state: "planned" }]);
  try {
    const first = run(root, "progress-new", ["Greeting", "feature"]);
    assert.equal(first.exit, 0, first.output);
    const date = todayLocal();
    const note = readFileSync(path.join(root, "progress", `001-${date}.md`), "utf8");
    assert.equal(note.split("\n")[0], `### Session 001 — ${date} — Greeting feature`);
    for (const section of ["Goal", "Sprint contract", "Completed", "Verification run", "Files or artifacts updated", "Known risk or unresolved issue", "Next best step"]) {
      assert.match(note, new RegExp(`^- ${section}: `, "m"), section);
    }
    const lint = run(root, "lint:progress-log");
    assert.equal(lint.exit, 0, lint.output);
    assert.match(lint.output, /Progress dashboard is current \(1 session\)/);

    assert.equal(run(root, "progress-new", ["Second"]).exit, 0);
    assert.ok(existsSync(path.join(root, "progress", `002-${date}.md`)), "numbers continue");
  } finally {
    cleanup(root);
  }
});

// ---- feat-042 (D-053): every caught mistake becomes a check ----------------

// Session notes 001..n with the given "Mistakes caught" text (null leaves the line out), a rule
// file declaring arch-001, and a regenerated dashboard.
function mistakesFixture(sections) {
  const root = progressFixture([], []);
  write(root, ".harness/arch-rules.json", `${JSON.stringify({ rules: [{ id: "arch-001" }] })}\n`);
  sections.forEach((section, index) => {
    const number = String(index + 1).padStart(3, "0");
    const body = section === null ? "" : `- Mistakes caught:${section}\n`;
    write(root, `progress/${number}-2026-10-01.md`, `### Session ${number} — 2026-10-01 — S\n\n- Goal: g\n${body}- Next best step: n\n`);
  });
  const update = run(root, "progress-update");
  assert.equal(update.exit, 0, update.output);
  return root;
}

test("progress-new: the skeleton has a Mistakes caught section, and lint still passes right after (feat-042)", () => {
  const root = progressFixture([], []);
  try {
    assert.equal(run(root, "progress-new", ["One"]).exit, 0);
    const note = readFileSync(path.join(root, "progress", `001-${todayLocal()}.md`), "utf8");
    assert.match(note, /^- Files or artifacts updated: \n- Mistakes caught: \n- Known risk or unresolved issue: /m);
    const lint = run(root, "lint:progress-log");
    assert.equal(lint.exit, 0, lint.output);
  } finally {
    cleanup(root);
  }
});

test("lint:progress-log: accepts none and each of the four forms, inline or nested (feat-042)", () => {
  const root = mistakesFixture([
    " none",
    " Skipped the quality doc → rule: arch-001",
    "\n  - Off-by-one in add → test: add handles zero\n  - Debug print left in -> lint: no-console\n  - Misread the spec → no check possible: a judgment call, not a pattern",
  ]);
  try {
    const lint = run(root, "lint:progress-log");
    assert.equal(lint.exit, 0, lint.output);
    assert.match(lint.output, /Session notes record what each caught mistake became/);
  } finally {
    cleanup(root);
  }
});

test("lint:progress-log: fails an entry with no check, an undeclared rule, or a later note without the section (feat-042)", () => {
  const root = mistakesFixture([
    null,
    "\n  - Forgot to rerun the tests\n  - Banned call slipped in → rule: arch-999\n  - Wrong layer → test: ",
    null,
  ]);
  try {
    const lint = run(root, "lint:progress-log");
    assert.equal(lint.exit, 1, lint.output);
    assert.doesNotMatch(lint.stderr, /001-2026-10-01/, "notes before the first section are not checked");
    assert.match(lint.stderr, /002-2026-10-01\.md: "Forgot to rerun the tests" does not say what it became/);
    assert.match(lint.stderr, /names rule arch-999, which is not in \.harness\/arch-rules\.json/);
    assert.match(lint.stderr, /"Wrong layer → test:" does not say what it became/);
    assert.match(lint.stderr, /003-2026-10-01\.md has no "- Mistakes caught:" line/);
  } finally {
    cleanup(root);
  }
});

test("clean-state-check: fails while the latest note leaves Mistakes caught blank (feat-042)", () => {
  const root = mistakesFixture([" none", ""]);
  try {
    const blank = run(root, "clean-state-check", [], { DEBUG_SCAN_PATHS: "" });
    assert.match(blank.output, /\[FAIL\] progress\/002-2026-10-01\.md leaves "- Mistakes caught:" blank/);
    assert.equal(run(root, "lint:progress-log").exit, 0, "a blank section still passes lint");
    write(root, "progress/002-2026-10-01.md", "### Session 002 — 2026-10-01 — S\n\n- Mistakes caught: none\n");
    assert.equal(run(root, "progress-update").exit, 0);
    const filled = run(root, "clean-state-check", [], { DEBUG_SCAN_PATHS: "" });
    assert.match(filled.output, /\[PASS\] progress\/002-2026-10-01\.md records the mistakes caught this session/);
  } finally {
    cleanup(root);
  }
});

test("progress-new: refuses a blank or multi-line title, and never overwrites a note (feat-036)", () => {
  const root = progressFixture([], []);
  try {
    assert.match(run(root, "progress-new").stderr, /usage: node scripts\/framework-check\.mjs progress-new/);
    assert.match(run(root, "progress-new", ["two\nlines"]).stderr, /one-line session title/);
    const date = todayLocal();
    write(root, `progress/001-${date}.md`, `### Session 001 — ${date} — Mine\n\n- Goal: kept\n`);
    // A second note today with number 001 would collide only if the index thought 001 was free.
    const again = run(root, "progress-new", ["Next"]);
    assert.equal(again.exit, 0, again.output);
    assert.equal(readFileSync(path.join(root, "progress", `001-${date}.md`), "utf8"), `### Session 001 — ${date} — Mine\n\n- Goal: kept\n`);
    assert.ok(existsSync(path.join(root, "progress", `002-${date}.md`)));
  } finally {
    cleanup(root);
  }
});

test("progress lint: a hand-written '# Session' heading fails with the exact heading and the progress-new hint (feat-036)", () => {
  const root = progressFixture([{ number: 1, date: "2026-10-01", heading: "# Session 001 - 2026-10-01" }], [], { generate: false });
  try {
    const result = run(root, "lint:progress-log");
    assert.equal(result.exit, 1);
    assert.match(result.stderr, /must start with a matching "### Session 001 — 2026-10-01" heading/);
    assert.match(result.stderr, /progress-new "<title>" writes a new note with the right heading/);
  } finally {
    cleanup(root);
  }
});

// ---- feat-037 (D-048): the start-of-session brief -------------------------

test("brief: names the active feature, what can start, what waits, stale evidence and the last session's risk and next step (feat-037)", () => {
  const staleEvidence = JSON.stringify({ summary: "s", commit: "abc1234", bound: true, checksHash: "0000000000000000", layers: [] });
  const root = gitFeatureFixture([
    { id: "feat-001", name: "Base", behavior: "b", verification: "v", dependencies: [], layers: [{ label: "L", cmd: "node -e 0", repair: "r" }], state: "passing", evidence: staleEvidence },
    { id: "feat-002", name: "Doing", behavior: "the thing being built", verification: "v", dependencies: [], layers: [{ label: "L", cmd: "node --test app/doing.test.mjs", repair: "r" }], state: "active" },
    { id: "feat-003", name: "Free", behavior: "b", verification: "v", dependencies: [], layers: [] },
    { id: "feat-004", name: "After", behavior: "b", verification: "v", dependencies: ["feat-002"], layers: [] },
    { id: "feat-005", name: "OnStale", behavior: "b", verification: "v", dependencies: ["feat-001"], layers: [] },
    { id: "feat-006", name: "Stuck", behavior: "b", verification: "v", dependencies: [], layers: [], state: "blocked" },
  ]);
  try {
    write(root, "progress/001-2026-11-01.md", "### Session 001 — 2026-11-01 — First\n\n- Goal: g\n- Known risk or unresolved issue: flaky network test\n- Next best step: finish feat-002\n");
    write(root, "session-handoff.md", "# Session Handoff\n");
    spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "add", "-A"], { cwd: root });
    spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "notes"], { cwd: root });
    const result = run(root, "brief");
    assert.equal(result.exit, 0, result.output);
    const out = result.stdout;
    assert.match(out, /^Features: 6 \(1 passing, 1 active, 3 planned, 1 blocked\)$/m);
    assert.match(out, /^Active: feat-002 — Doing$/m);
    assert.match(out, /behavior: the thing being built/);
    assert.match(out, /layers: node --test app\/doing\.test\.mjs/);
    assert.match(out, /^Can start next: feat-003 Free$/m, "feat-004 waits on an active feature, feat-005 on stale evidence");
    assert.match(out, /^Waiting on dependencies: feat-004 \(needs feat-002\); feat-005 \(needs feat-001\)$/m);
    assert.match(out, /^Blocked: feat-006$/m);
    assert.match(out, /^Stale evidence .*: feat-001$/m);
    assert.match(out, /^Last session: Session 001 — 2026-11-01 — First$/m);
    assert.match(out, /known risk: flaky network test/);
    assert.match(out, /next step: finish feat-002/);
    assert.match(out, /session-handoff\.md last changed \d{4}-\d{2}-\d{2}/);
    assert.ok(out.length < 2048, `brief stays short (${out.length} bytes)`);
  } finally {
    cleanup(root);
  }
});

test("brief: works with no git, no progress notes and no features, and flags a handoff older than the latest note (feat-037)", () => {
  const bare = fixture();
  write(bare, "feature_list.json", '{ "features": [] }\n');
  const dated = gitFeatureFixture([]);
  try {
    const result = run(bare, "brief");
    assert.equal(result.exit, 0, result.output);
    assert.match(result.stdout, /Features: 0 \(\)/);
    assert.match(result.stdout, /Active: none/);

    write(dated, "session-handoff.md", "# Handoff\n");
    const env = { ...process.env, GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z", GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z" };
    spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "add", "-A"], { cwd: dated });
    spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "old handoff"], { cwd: dated, env });
    write(dated, "progress/001-2026-11-01.md", "### Session 001 — 2026-11-01 — Later\n\n- Next best step: x\n");
    assert.match(run(dated, "brief").stdout, /session-handoff\.md last changed 2026-01-01 — older than the latest session note/);
  } finally {
    cleanup(bare);
    cleanup(dated);
  }
});

// ---- feat-038 (D-049): new features run each check once -------------------

function addFeatureLayer3(checkScript) {
  const root = featureListFixture([]);
  try {
    if (checkScript !== undefined) {
      write(root, "package.json", `${JSON.stringify({ name: "x", scripts: checkScript === null ? {} : { check: checkScript } }, null, 2)}\n`);
    }
    const result = run(root, "add-feature", ["feat-001", "One"]);
    assert.equal(result.exit, 0, result.output);
    const layers = JSON.parse(readFileSync(path.join(root, "feature_list.json"), "utf8")).features[0].layers;
    assert.deepEqual(layers.slice(0, 2).map((layer) => layer.cmd), ["npm run lint", "npm run test"]);
    return layers[2].cmd;
  } finally {
    cleanup(root);
  }
}

test("add-feature: Layer 3 runs the check chain without the lint and test steps Layers 1-2 already ran (feat-038)", () => {
  assert.equal(
    addFeatureLayer3("npm run lint && npm run typecheck && npm run test && npm run build && npm run e2e && npm run verify-all && npm run quality"),
    "npm run typecheck && npm run build && npm run e2e && npm run verify-all && npm run quality",
  );
  // This repository's own check script reduces the same way.
  const own = JSON.parse(readFileSync(path.resolve(path.dirname(RUNNER), "..", "package.json"), "utf8")).scripts["check-full"];
  assert.doesNotMatch(addFeatureLayer3(own), /npm run (lint|test)\b/);
});

test("add-feature: with check-arch in the check chain, new features' Layer 3 runs the architecture rules (feat-040)", () => {
  assert.equal(
    addFeatureLayer3("npm run lint && npm run check-arch && npm run typecheck && npm run test && npm run build && npm run e2e && npm run verify-all && npm run quality"),
    "npm run check-arch && npm run typecheck && npm run build && npm run e2e && npm run verify-all && npm run quality",
  );
});

test("check chain: a failing architecture rule stops npm run check before the later layers (feat-040)", () => {
  const root = featureListFixture([]);
  try {
    write(root, ".harness/arch-rules.json", JSON.stringify({
      rules: [{ id: "arch-x", description: "always fails", check: "node -e \"console.log('nope')\"", expect: "^PASS", what: "w", why: "y", fix: "f" }],
    }));
    const runner = RUNNER.replace(/\\/g, "/");
    write(root, "package.json", `${JSON.stringify({
      name: "x",
      scripts: {
        lint: "node -e \"console.log('lint ran')\"",
        "check-arch": `node "${runner}" check-arch`,
        test: "node -e \"console.log('TEST LAYER RAN')\"",
        check: "npm run lint && npm run check-arch && npm run test",
      },
    }, null, 2)}\n`);
    const result = spawnSync("npm run check", { cwd: root, encoding: "utf8", shell: true });
    const output = `${result.stdout}${result.stderr}`;
    assert.notEqual(result.status, 0, output);
    assert.match(output, /lint ran/);
    assert.match(output, /\[FAIL\] w/);
    assert.doesNotMatch(output, /TEST LAYER RAN/);
  } finally {
    cleanup(root);
  }
});

test("add-feature: Layer 3 keeps npm run check whenever the check script is not a plain chain with both steps (feat-038)", () => {
  assert.equal(addFeatureLayer3(undefined), "npm run check", "no package.json");
  assert.equal(addFeatureLayer3(null), "npm run check", "no check script");
  assert.equal(addFeatureLayer3("make check"), "npm run check", "not npm run steps");
  assert.equal(addFeatureLayer3("npm run lint && npm run test || true"), "npm run check", "||");
  assert.equal(addFeatureLayer3("npm run lint; npm run test; npm run build"), "npm run check", ";");
  assert.equal(addFeatureLayer3("npm run lint && npm run build"), "npm run check", "no test step to skip");
  assert.equal(addFeatureLayer3("npm run lint && npm run test"), "npm run check", "nothing left after removing both");
});

// ---- feat-055 (D-065): pull requests carry evidence for the commit they merge ----

function git(root, ...args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return (result.stdout ?? "").trim();
}

function commitAll(root, message) {
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", message);
  return git(root, "rev-parse", "--short", "HEAD");
}

function markPassing(root, featureId, commit, { bound = true } = {}) {
  const evidence = JSON.stringify({ summary: "All verification layers passed", commit, bound, checksHash: "x", layers: [] });
  write(root, `.harness/state/${featureId}.json`, `${JSON.stringify({ state: "passing", evidence }, null, 2)}\n`);
}

// master holds feat-001 planned; branch work adds its code, and the returned commit is the
// one the evidence will name.
function evidenceFixture() {
  const root = splitFeatureFixture([{ id: "feat-001", name: "One", dependencies: [], state: "planned" }]);
  git(root, "init", "-q", "-b", "master");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  commitAll(root, "base");
  git(root, "checkout", "-q", "-b", "work");
  write(root, "src/app.js", "export const x = 1;\n");
  return { root, evidenceCommit: commitAll(root, "feat-001 code") };
}

test("evidence-check: passes when only bookkeeping changed after the evidence commit (feat-055)", () => {
  const { root, evidenceCommit } = evidenceFixture();
  try {
    markPassing(root, "feat-001", evidenceCommit);
    write(root, "progress/001-2026-01-01.md", "# Session 001\n");
    write(root, "README.md", "# App\n");
    commitAll(root, "record evidence, session note, README");
    const result = run(root, "evidence-check");
    assert.equal(result.exit, 0, result.output);
    assert.match(result.output, /Base: master/);
    assert.match(result.output, /Evidence matches the merged code for feat-001/);
  } finally {
    cleanup(root);
  }
});

test("evidence-check: a code edit committed after the evidence commit fails, naming the feature and the file (feat-055)", () => {
  const { root, evidenceCommit } = evidenceFixture();
  try {
    markPassing(root, "feat-001", evidenceCommit);
    commitAll(root, "record evidence");
    write(root, "src/app.js", "export const x = 2;\n");
    commitAll(root, "late edit");
    const result = run(root, "evidence-check");
    assert.equal(result.exit, 1, result.output);
    assert.match(result.output, new RegExp(`feat-001: changed after its evidence commit ${evidenceCommit}`));
    assert.match(result.output, /src\/app\.js/);
    assert.match(result.output, /npm run verify-feature -- feat-001/);
  } finally {
    cleanup(root);
  }
});

test("evidence-check: an evidence commit that is not an ancestor of HEAD, or unbound evidence, fails (feat-055)", () => {
  const { root } = evidenceFixture();
  try {
    git(root, "checkout", "-q", "-b", "elsewhere", "master");
    write(root, "src/other.js", "1\n");
    const foreign = commitAll(root, "unrelated");
    git(root, "checkout", "-q", "work");
    markPassing(root, "feat-001", foreign);
    commitAll(root, "record foreign evidence");
    let result = run(root, "evidence-check");
    assert.equal(result.exit, 1, result.output);
    assert.match(result.output, new RegExp(`evidence commit ${foreign} is not an ancestor of HEAD`));

    markPassing(root, "feat-001", git(root, "rev-parse", "--short", "HEAD"), { bound: false });
    commitAll(root, "record unbound evidence");
    result = run(root, "evidence-check");
    assert.equal(result.exit, 1, result.output);
    assert.match(result.output, /feat-001: its evidence is not bound to a commit/);
  } finally {
    cleanup(root);
  }
});

test("evidence-check: a branch with no newly passing feature passes; base commits merged in are not counted (feat-055)", () => {
  const { root, evidenceCommit } = evidenceFixture();
  try {
    let result = run(root, "evidence-check");
    assert.equal(result.exit, 0, result.output);
    assert.match(result.output, /No feature became passing on this branch/);

    markPassing(root, "feat-001", evidenceCommit);
    commitAll(root, "record evidence");
    git(root, "checkout", "-q", "master");
    write(root, "src/master-only.js", "1\n");
    commitAll(root, "work landed on master meanwhile");
    git(root, "checkout", "-q", "work");
    git(root, "merge", "-q", "--no-edit", "master");
    result = run(root, "evidence-check");
    assert.equal(result.exit, 0, result.output);
    assert.doesNotMatch(result.output, /master-only/);
  } finally {
    cleanup(root);
  }
});

test("evidence-check: --base selects the base; an unknown base or none found fails clearly (feat-055)", () => {
  const { root, evidenceCommit } = evidenceFixture();
  try {
    markPassing(root, "feat-001", evidenceCommit);
    commitAll(root, "record evidence");
    git(root, "branch", "release");
    write(root, "src/app.js", "export const x = 3;\n");
    commitAll(root, "edit after release was cut");
    // Against release, feat-001 was already passing there: nothing new to check.
    let result = run(root, "evidence-check", ["--base", "release"]);
    assert.equal(result.exit, 0, result.output);
    assert.match(result.output, /Base: release/);
    assert.match(result.output, /No feature became passing/);
    // Against master (the default), the late edit is caught.
    assert.equal(run(root, "evidence-check").exit, 1);

    result = run(root, "evidence-check", ["--base", "no-such-ref"]);
    assert.equal(result.exit, 1);
    assert.match(result.output, /base no-such-ref is not a commit/);
    git(root, "branch", "-m", "master", "trunk");
    result = run(root, "evidence-check");
    assert.equal(result.exit, 1);
    assert.match(result.output, /cannot find the base branch.*pass --base <ref>/);
  } finally {
    cleanup(root);
  }
});

test("lint:ci-evidence: the framework's workflows must run evidence-check on pull requests with full history (feat-055)", () => {
  const root = fixture();
  const workflow = "on:\n  pull_request:\njobs:\n  check:\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          fetch-depth: 0\n      - run: npm run evidence-check\n";
  try {
    write(root, ".harness/manifest.json", JSON.stringify({ frameworkRepository: true }));
    write(root, ".github/workflows/ci.yml", workflow);
    write(root, "templates/ci.yml", workflow);
    let result = run(root, "lint:ci-evidence");
    assert.equal(result.exit, 0, result.output);
    assert.match(result.output, /CI workflows run evidence-check on pull requests/);

    write(root, "templates/ci.yml", workflow.replace("      - run: npm run evidence-check\n", ""));
    result = run(root, "lint:ci-evidence");
    assert.equal(result.exit, 1);
    assert.match(result.output, /templates\/ci\.yml must run npm run evidence-check/);
    write(root, "templates/ci.yml", workflow.replace("fetch-depth: 0", "fetch-depth: 1"));
    assert.match(run(root, "lint:ci-evidence").output, /fetch-depth: 0/);

    // An adopter's ci.yml is its own: not inspected.
    write(root, ".harness/manifest.json", JSON.stringify({ frameworkRepository: false }));
    assert.equal(run(root, "lint:ci-evidence").exit, 0);
  } finally {
    cleanup(root);
  }
});

// ---- feat-056 (D-066): checks scoped to what the change touched ----------------

const SCOPE_STEPS = ["lint", "typecheck", "test", "build"];

// A git repository on master whose check-full chains four steps that each print RAN-<step>,
// and a branch `work` to change things on.
function scopeFixture({ failingLint = false } = {}) {
  const root = featureListFixture([{ id: "feat-001", name: "One", behavior: "b", verification: "v", dependencies: [], layers: [{ label: "L3", cmd: "npm run check", repair: "r" }], state: "active" }]);
  const runner = RUNNER.replace(/\\/g, "/");
  const scripts = { check: `node "${runner}" check`, "check-full": SCOPE_STEPS.map((step) => `npm run ${step}`).join(" && ") };
  for (const step of SCOPE_STEPS) scripts[step] = `node say.js ${step}`;
  // A script file, not an unquoted node -e one-liner: sh rejects its parentheses (arch-009).
  if (failingLint) scripts.lint = "node say.js lint && node fail.js";
  write(root, "package.json", `${JSON.stringify({ name: "x", private: true, scripts }, null, 2)}\n`);
  write(root, "say.js", "console.log('RAN-' + process.argv[2]);\n");
  write(root, "fail.js", "process.exit(3);\n");
  write(root, "README.md", "# X\n");
  write(root, "src/app.js", "1\n");
  git(root, "init", "-q", "-b", "master");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  commitAll(root, "base");
  git(root, "checkout", "-q", "-b", "work");
  return root;
}

function ran(output) {
  return SCOPE_STEPS.filter((step) => output.includes(`RAN-${step}`));
}

test("check: a docs-only change runs lint and reports the other steps as SKIP, never PASS (feat-056)", () => {
  const root = scopeFixture();
  try {
    write(root, "README.md", "# X\n\nMore.\n");
    write(root, "docs/demo/clip.gif", "binary");
    commitAll(root, "docs");
    write(root, "DECISIONS.md", "# Decisions\n"); // uncommitted docs count too
    const result = run(root, "check");
    assert.equal(result.exit, 0, result.output);
    assert.deepEqual(ran(result.output), ["lint"]);
    assert.match(result.output, /check scope: docs-only change \(3 file\(s\) against master\)/);
    for (const step of ["typecheck", "test", "build"]) {
      assert.match(result.output, new RegExp(`\\[SKIP\\] npm run ${step} — docs-only change \\(not verified\\)`));
    }
    assert.doesNotMatch(result.output, /\[PASS\]/);
  } finally {
    cleanup(root);
  }
});

test("check: code, a SKILL.md or a template next to docs runs every step (feat-056)", () => {
  for (const extra of ["src/app.js", "skills/x/SKILL.md", "templates/docs/USAGE.md"]) {
    const root = scopeFixture();
    try {
      write(root, "README.md", "# X\n\nMore.\n");
      write(root, extra, "changed\n");
      const result = run(root, "check");
      assert.equal(result.exit, 0, result.output);
      assert.deepEqual(ran(result.output), SCOPE_STEPS, extra);
      assert.match(result.output, /check scope: full \(1 non-documentation file\(s\) changed\)/, extra);
    } finally {
      cleanup(root);
    }
  }
});

test("check: --full, HARNESS_CHECK_FULL=1, no changes and no base each run every step (feat-056)", () => {
  const root = scopeFixture();
  try {
    let result = run(root, "check");
    assert.deepEqual(ran(result.output), SCOPE_STEPS);
    assert.match(result.output, /full \(no changed files\)/);

    write(root, "README.md", "# X\n\nMore.\n");
    result = run(root, "check", ["--full"]);
    assert.deepEqual(ran(result.output), SCOPE_STEPS);
    assert.match(result.output, /full \(--full\)/);
    result = run(root, "check", [], { HARNESS_CHECK_FULL: "1" });
    assert.deepEqual(ran(result.output), SCOPE_STEPS);

    git(root, "branch", "-m", "master", "trunk");
    result = run(root, "check");
    assert.deepEqual(ran(result.output), SCOPE_STEPS);
    assert.match(result.output, /full \(no default-branch base to compare with\)/);
  } finally {
    cleanup(root);
  }
});

test("check: a failing lint fails a docs-only check; a missing check-full fails clearly (feat-056)", () => {
  let root = scopeFixture({ failingLint: true });
  try {
    write(root, "README.md", "# X\n\nMore.\n");
    const result = run(root, "check");
    assert.notEqual(result.exit, 0);
    assert.match(result.output, /check scope: docs-only change/);
    assert.deepEqual(ran(result.output), ["lint"]);
    assert.doesNotMatch(result.output, /\[SKIP\]/);
  } finally {
    cleanup(root);
  }
  root = scopeFixture();
  try {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    delete pkg.scripts["check-full"];
    write(root, "package.json", JSON.stringify(pkg));
    const result = run(root, "check");
    assert.equal(result.exit, 1);
    assert.match(result.output, /check needs a "check-full" script/);
  } finally {
    cleanup(root);
  }
});

test("verify-feature: a Layer 3 of npm run check runs every step even on a docs-only change (feat-056)", () => {
  const root = scopeFixture();
  try {
    write(root, "README.md", "# X\n\nMore.\n");
    commitAll(root, "docs only");
    const result = run(root, "verify-feature", ["feat-001"]);
    assert.equal(result.exit, 0, result.output);
    const logDir = path.join(root, ".harness", "logs", "feat-001");
    const log = readdirSync(logDir).map((file) => readFileSync(path.join(logDir, file), "utf8")).join("\n");
    assert.deepEqual(ran(log), SCOPE_STEPS);
    assert.match(log, /full \(HARNESS_CHECK_FULL=1\)/);
  } finally {
    cleanup(root);
  }
});

// ---- feat-057 (D-067): lanes get their own ports and environment ---------------

function laneEnv(worktreePath) {
  return Object.fromEntries(
    readFileSync(path.join(worktreePath, ".env.lane"), "utf8")
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split("=")),
  );
}

function laneRegistryOf(root) {
  const commonDir = path.resolve(root, git(root, "rev-parse", "--git-common-dir"));
  const file = path.join(commonDir, "harness-lane-ports.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
}

function twoFeatureLaneFixture() {
  return gitFeatureFixture([
    { id: "feat-001", state: "planned", dependencies: [], layers: [] },
    { id: "feat-002", state: "planned", dependencies: [], layers: [] },
    { id: "feat-003", state: "planned", dependencies: [], layers: [] },
  ]);
}

test("lane-new: two lanes get non-overlapping port blocks from 4100 and a .env.lane git ignores (feat-057)", () => {
  const root = twoFeatureLaneFixture();
  const one = laneWorktreePathFor(root, "feat-001");
  const two = laneWorktreePathFor(root, "feat-002");
  try {
    let result = run(root, "lane-new", ["feat-001"]);
    assert.equal(result.exit, 0, result.output);
    assert.match(result.output, /Ports: 4100-4109/);
    result = run(root, "lane-new", ["feat-002"]);
    assert.equal(result.exit, 0, result.output);
    assert.match(result.output, /Ports: 4110-4119/);
    assert.deepEqual(laneEnv(one), { HARNESS_LANE: "feat-001", HARNESS_PORT_BASE: "4100", HARNESS_DB_SUFFIX: "_feat_001" });
    assert.equal(laneEnv(two).HARNESS_PORT_BASE, "4110");
    assert.deepEqual(laneRegistryOf(root), { "feat-001": 4100, "feat-002": 4110 });
    // Ignored in the lane through info/exclude, not tracked, and .gitignore untouched.
    assert.equal(spawnSync("git", ["check-ignore", "-q", ".env.lane"], { cwd: one }).status, 0);
    assert.doesNotMatch(git(one, "status", "--porcelain"), /\.env\.lane/);
    assert.ok(!existsSync(path.join(root, ".gitignore")));

    result = run(root, "lane-list");
    assert.match(result.output, /lane\/feat-001 .*ports=4100-4109/);
    assert.match(result.output, /lane\/feat-002 .*ports=4110-4119/);
  } finally {
    cleanupLane(root, one, two);
  }
});

test("lane-new: lanePortBase in the manifest moves the first block; an invalid one fails manifest validation (feat-057)", () => {
  const root = twoFeatureLaneFixture();
  const one = laneWorktreePathFor(root, "feat-001");
  try {
    write(root, ".harness/manifest.json", JSON.stringify({ lanePortBase: 5200 }));
    commitAll(root, "manifest");
    const result = run(root, "lane-new", ["feat-001"]);
    assert.equal(result.exit, 0, result.output);
    assert.equal(laneEnv(one).HARNESS_PORT_BASE, "5200");
  } finally {
    cleanupLane(root, one);
  }
  const bad = fixture();
  try {
    for (const value of [80, 65530, "4100", 4100.5]) {
      write(bad, ".harness/manifest.json", JSON.stringify(baseManifest({ lanePortBase: value })));
      const result = run(bad, "manifest");
      assert.equal(result.exit, 1, `lanePortBase ${JSON.stringify(value)}`);
      assert.match(result.output, /lanePortBase must be an integer from 1024 to 65526/);
    }
  } finally {
    cleanup(bad);
  }
});

test("lane-new: copies an ignored .env, refuses an unignored one with a reason, creates none when absent (feat-057)", () => {
  const root = twoFeatureLaneFixture();
  const one = laneWorktreePathFor(root, "feat-001");
  const two = laneWorktreePathFor(root, "feat-002");
  const three = laneWorktreePathFor(root, "feat-003");
  try {
    let result = run(root, "lane-new", ["feat-001"]);
    assert.equal(result.exit, 0, result.output);
    assert.ok(!existsSync(path.join(one, ".env")), "no .env in main, none in the lane");

    write(root, ".env", "SECRET=1\n");
    result = run(root, "lane-new", ["feat-002"]);
    assert.equal(result.exit, 0, result.output);
    assert.match(result.output, /\.env was not copied into the lane — git does not ignore it here/);
    assert.ok(!existsSync(path.join(two, ".env")));

    write(root, ".gitignore", ".env\n");
    commitAll(root, "ignore .env");
    result = run(root, "lane-new", ["feat-003"]);
    assert.equal(result.exit, 0, result.output);
    assert.match(result.output, /Copied \.env from the main checkout/);
    assert.equal(readFileSync(path.join(three, ".env"), "utf8"), "SECRET=1\n");
    assert.doesNotMatch(git(three, "status", "--porcelain"), /\.env/);
  } finally {
    cleanupLane(root, one, two, three);
  }
});

test("lane-drop and lane-land release a block for reuse; a hand-deleted branch's block is reclaimed (feat-057)", () => {
  const root = twoFeatureLaneFixture();
  const one = laneWorktreePathFor(root, "feat-001");
  const two = laneWorktreePathFor(root, "feat-002");
  const three = laneWorktreePathFor(root, "feat-003");
  try {
    run(root, "lane-new", ["feat-001"]);
    run(root, "lane-new", ["feat-002"]);
    commitAll(one, "lane state"); // lane-drop refuses a worktree with uncommitted changes
    let result = run(root, "lane-drop", ["feat-001"]);
    assert.equal(result.exit, 0, result.output);
    assert.match(result.output, /Released lane ports 4100-4109/);
    assert.deepEqual(laneRegistryOf(root), { "feat-002": 4110 });

    // lane-land: commit a passing shard in feat-002's lane, then land it.
    write(two, ".harness/state/feat-002.json", `${JSON.stringify({ state: "passing", evidence: "" }, null, 2)}\n`);
    commitAll(two, "feat-002 passing");
    result = run(root, "lane-land", ["feat-002"]);
    assert.equal(result.exit, 0, result.output);
    assert.match(result.output, /Released lane ports 4110-4119/);
    assert.deepEqual(laneRegistryOf(root), {});

    // A lane whose branch was deleted by hand: its block is reclaimed by the next lane-new.
    git(root, "branch", "-D", "lane/feat-001");
    run(root, "lane-new", ["feat-003"]);
    git(root, "worktree", "remove", "--force", three);
    git(root, "branch", "-D", "lane/feat-003");
    assert.deepEqual(laneRegistryOf(root), { "feat-003": 4100 });
    result = run(root, "lane-new", ["feat-001"]);
    assert.equal(result.exit, 0, result.output);
    assert.match(result.output, /Ports: 4100-4109/);
    assert.deepEqual(laneRegistryOf(root), { "feat-001": 4100 });
  } finally {
    cleanupLane(root, one, two, three);
  }
});

// ---- feat-058 (D-068): opt-in push and commit-message hooks --------------------

// hookFixture plus a bare remote named origin, with the harness hooks installed.
function pushFixture() {
  const repo = hookFixture();
  const remote = `${repo.root}-remote.git`;
  spawnSync("git", ["init", "-q", "--bare", remote]);
  repo.git("init", "-q", "-b", "master");
  repo.git("remote", "add", "origin", remote);
  const install = run(repo.root, "hooks-install", [], repo.env);
  assert.equal(install.exit, 0, install.output);
  const first = repo.commit("feat: first");
  assert.equal(first.exit, 0, first.output);
  const push = (args, env = {}) => {
    const result = spawnSync("git", ["push", ...args], { cwd: repo.root, encoding: "utf8", env: { ...process.env, ...repo.env, ...env } });
    return { exit: result.status ?? 1, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
  };
  return { ...repo, push, done: () => { repo.done(); rmSync(remote, { recursive: true, force: true }); } };
}

test("pre-push: a push to the default branch is refused naming it; a feature branch pushes; the override lets it through (feat-058)", () => {
  const repo = pushFixture();
  try {
    let result = repo.push(["-q", "origin", "master"], { HARNESS_ALLOW_DEFAULT_PUSH: "" });
    assert.notEqual(result.exit, 0, result.output);
    assert.match(result.output, /Push blocked: master is the default branch of origin/);
    assert.match(result.output, /HARNESS_ALLOW_DEFAULT_PUSH=1/);
    assert.equal(spawnSync("git", ["ls-remote", "--heads", "origin"], { cwd: repo.root, encoding: "utf8" }).stdout.trim(), "", "nothing reached the remote");

    repo.git("checkout", "-q", "-b", "feat/x");
    result = repo.push(["-q", "origin", "feat/x"]);
    assert.equal(result.exit, 0, result.output);

    result = repo.push(["-q", "origin", "feat/x:main"]);
    assert.notEqual(result.exit, 0, "main is default too while the remote has no HEAD ref");
    assert.match(result.output, /Push blocked: main is the default branch/);

    result = repo.push(["-q", "origin", "master"], { HARNESS_ALLOW_DEFAULT_PUSH: "1" });
    assert.equal(result.exit, 0, result.output);
    assert.match(result.output, /allowed by HARNESS_ALLOW_DEFAULT_PUSH=1/);

    // A remote whose HEAD names trunk: only trunk is the default.
    repo.push(["-q", "origin", "feat/x:trunk"]);
    repo.git("fetch", "-q", "origin");
    repo.git("remote", "set-head", "origin", "trunk");
    assert.equal(repo.push(["-q", "origin", "feat/x:master"]).exit, 0, "master is not the default once origin/HEAD names trunk");
    write(repo.root, "next.txt", "1\n");
    assert.equal(repo.commit("feat: next").exit, 0); // git skips pre-push when nothing is new
    assert.notEqual(repo.push(["-q", "origin", "feat/x:trunk"]).exit, 0);

    // hooks-uninstall removes the push hook along with the others.
    assert.equal(run(repo.root, "hooks-uninstall", [], repo.env).exit, 0);
    result = repo.push(["-q", "origin", "feat/x:trunk"]);
    assert.equal(result.exit, 0, result.output);
    assert.equal(
      spawnSync("git", ["rev-parse", "origin/trunk"], { cwd: repo.root, encoding: "utf8" }).stdout.trim(),
      repo.git("rev-parse", "HEAD").output.trim(),
      "the new commit reached trunk once the hook was gone",
    );
  } finally {
    repo.done();
  }
});

test("commit-msg: enabled rules refuse a subject, a long subject and a forbidden line by name; merges and disabled rules pass (feat-058)", () => {
  const repo = pushFixture();
  try {
    // Disabled (the shipped default): anything goes.
    write(repo.root, ".harness/commit-rules.json", `${JSON.stringify({ enabled: false, subjectPattern: "^feat: ", maxSubjectLength: 20, forbid: ["WIP"] })}\n`);
    let result = repo.commit("whatever WIP message that is long");
    assert.equal(result.exit, 0, result.output);

    write(repo.root, ".harness/commit-rules.json", `${JSON.stringify({ enabled: true, subjectPattern: "^(feat|fix): ", maxSubjectLength: 30, forbid: ["WIP"] })}\n`);
    result = repo.commit("feat: enable the rules");
    assert.equal(result.exit, 0, result.output);

    write(repo.root, "a.txt", "1\n");
    result = repo.commit("update a");
    assert.notEqual(result.exit, 0, result.output);
    assert.match(result.output, /Commit blocked by \.harness\/commit-rules\.json/);
    assert.match(result.output, /subjectPattern .* does not match the first line: "update a"/);

    result = repo.commit("feat: a subject that is far too long for the rule");
    assert.notEqual(result.exit, 0);
    assert.match(result.output, /maxSubjectLength 30: the first line has 49 characters/);

    result = spawnSync("git", ["commit", "-q", "-m", "fix: short", "-m", "still WIP here"], { cwd: repo.root, encoding: "utf8", env: { ...process.env, ...repo.env } });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /forbid WIP matches the line: "still WIP here"/);

    result = repo.commit("fix: a");
    assert.equal(result.exit, 0, result.output);

    // A merge git writes the message for is accepted.
    repo.git("checkout", "-q", "-b", "side", "HEAD~1");
    write(repo.root, "b.txt", "1\n");
    assert.equal(repo.commit("feat: side").exit, 0);
    repo.git("checkout", "-q", "master");
    const merge = spawnSync("git", ["merge", "--no-ff", "--no-edit", "side"], { cwd: repo.root, encoding: "utf8", env: { ...process.env, ...repo.env } });
    assert.equal(merge.status, 0, `${merge.stdout}${merge.stderr}`);
    assert.match(repo.git("log", "-1", "--format=%s").output, /^Merge branch 'side'/);
  } finally {
    repo.done();
  }
});

test("lint:commit-rules: a missing file passes; a malformed one fails naming the problem (feat-058)", () => {
  const root = fixture();
  try {
    assert.equal(run(root, "lint:commit-rules").exit, 0);
    const cases = [
      [{ subjectPattern: "x" }, /enabled must be true or false/],
      [{ enabled: true, subjectPattern: "(" }, /subjectPattern is not a valid regular expression/],
      [{ enabled: true, maxSubjectLength: 0 }, /maxSubjectLength must be a positive integer/],
      [{ enabled: true, forbid: "WIP" }, /forbid must be an array/],
      [{ enabled: true, forbid: ["ok", "["] }, /forbid\[1\] is not a valid regular expression/],
      [{ enabled: true, subject: "x" }, /unknown key\(s\): subject/],
    ];
    for (const [rules, message] of cases) {
      write(root, ".harness/commit-rules.json", JSON.stringify(rules));
      const result = run(root, "lint:commit-rules");
      assert.equal(result.exit, 1, JSON.stringify(rules));
      assert.match(result.output, message);
    }
    write(root, ".harness/commit-rules.json", readFileSync(path.resolve(path.dirname(RUNNER), "..", "templates", "commit-rules.json"), "utf8"));
    const shipped = run(root, "lint:commit-rules");
    assert.equal(shipped.exit, 0, shipped.output);
    assert.match(shipped.output, /valid \(disabled\)/);
  } finally {
    cleanup(root);
  }
});
