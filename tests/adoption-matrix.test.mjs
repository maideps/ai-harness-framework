import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { normalizeFixtureScripts } from "../scripts/adoption-matrix.mjs";

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
      "npm run lint && npm run typecheck && npm run test && npm run build && npm run e2e",
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
