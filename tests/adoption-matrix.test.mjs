import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { normalizeFixtureScripts } from "../scripts/adoption-matrix.mjs";
import { adopt, HARNESS_ROOT, loadManifest } from "../scripts/create-harness.mjs";
import { upgrade } from "../scripts/harness-upgrade.mjs";

test("adopter scaffold has project CI and an editable Node version", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "cw-adopter-test-"));
  try {
    adopt(root);
    const manifest = loadManifest();
    const workflow = readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
    assert.ok(!manifest.core.includes(".nvmrc"));
    assert.ok(manifest.instance.includes(".nvmrc"));
    assert.doesNotMatch(
      readFileSync(path.join(root, "docs/PRODUCT.md"), "utf8"),
      /\[Describe what this system does|\[Primary user flow/,
    );
    assert.equal(readFileSync(path.join(HARNESS_ROOT, "templates/nvmrc"), "utf8"), "24\n");
    assert.equal(
      readFileSync(path.join(root, ".nvmrc"), "utf8"),
      readFileSync(path.join(HARNESS_ROOT, "templates/nvmrc"), "utf8"),
    );
    assert.match(workflow, /node-version-file: \.nvmrc/);
    assert.match(workflow, /CW_SKIP_ADOPTION_MATRIX: "1"/);
    assert.match(workflow, /npm run setup --if-present/);
    assert.match(workflow, /run: npm run check\b/);
    assert.match(workflow, /run: npm run check-arch\b/);
    assert.doesNotMatch(workflow, /matrix:|setup-python|setup-go|rust-toolchain|make check|branches: \[master\]/);

    writeFileSync(path.join(root, ".nvmrc"), "22.14.0\n", "utf8");
    adopt(root, { skipExisting: true });
    assert.equal(readFileSync(path.join(root, ".nvmrc"), "utf8"), "22.14.0\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function fixtureWith(scripts) {
  const root = mkdtempSync(path.join(os.tmpdir(), "cw-matrix-test-"));
  writeFileSync(path.join(root, "package.json"), `${JSON.stringify({ name: "x", scripts }, null, 2)}\n`, "utf8");
  return root;
}

function scriptsOf(root) {
  return JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).scripts;
}

test("normalizeFixtureScripts: resets customised layer scripts to the canonical harness values", () => {
  const root = fixtureWith({
    lint: "node scripts/framework-check.mjs lint && node tools/py.mjs -m ruff check .",
    test: "pytest",
    e2e: "node tools/skip.mjs no e2e yet",
    check: "node tools/everything.mjs",
  });
  try {
    normalizeFixtureScripts(root);
    const scripts = scriptsOf(root);
    for (const layer of ["lint", "typecheck", "test", "build", "e2e", "dev"]) {
      assert.equal(scripts[layer], `node scripts/framework-check.mjs ${layer}`, `${layer} is canonical`);
    }
    assert.equal(
      scripts.check,
      "npm run lint && npm run typecheck && npm run test && npm run build && npm run e2e && npm run verify-all",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("normalizeFixtureScripts: leaves unrelated adopter scripts alone", () => {
  const root = fixtureWith({ "setup:backend": "node tools/py.mjs setup", custom: "echo custom" });
  try {
    normalizeFixtureScripts(root);
    const scripts = scriptsOf(root);
    assert.equal(scripts["setup:backend"], "node tools/py.mjs setup");
    assert.equal(scripts.custom, "echo custom");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("normalizeFixtureScripts: tolerates a package.json with no scripts block", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "cw-matrix-test-"));
  writeFileSync(path.join(root, "package.json"), '{ "name": "x" }\n', "utf8");
  try {
    normalizeFixtureScripts(root);
    assert.equal(scriptsOf(root).lint, "node scripts/framework-check.mjs lint");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("adopt: installs default line-ending rules and upgrades preserve adopter rules", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "cw-gitattributes-test-"));
  try {
    adopt(root, { skipExisting: true });
    const attributesPath = path.join(root, ".gitattributes");
    assert.equal(
      readFileSync(attributesPath, "utf8"),
      "* text=auto eol=lf\n*.cmd text eol=crlf\n*.bat text eol=crlf\n",
    );

    const customRules = "*.ps1 text eol=crlf\n";
    writeFileSync(attributesPath, customRules, "utf8");
    upgrade(root);
    assert.equal(readFileSync(attributesPath, "utf8"), customRules);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
