import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { missingHarnessScripts, missingMakeTargets, upgrade } from "../scripts/harness-upgrade.mjs";

// These tests also run inside adopters (tests/ is CORE), where the harness root is the adopter
// itself: they compare against whatever harness root they run in, never against fixed content.
const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const harnessFile = (rel) => readFileSync(path.join(HARNESS_ROOT, rel), "utf8");

function tempDir() {
  return mkdtempSync(path.join(os.tmpdir(), "cw-harness-upgrade-"));
}

function write(root, rel, content) {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), content);
}

function adopter() {
  const root = tempDir();
  write(root, "package.json", `${JSON.stringify({ name: "adopter", scripts: {} }, null, 2)}\n`);
  // As an older harness shipped them.
  write(root, "tests/framework-check.test.mjs", "// tests from an older harness\n");
  write(root, "templates/ci.yml", "# an older CI skeleton\n");
  write(root, "templates/sprint-contract.md", "# Our own sprint contract\n");
  write(root, ".harness/manifest.json", `${JSON.stringify({
    harness: "old",
    version: "0.0.1",
    core: ["scripts/"],
    instance: ["README.md"],
    templates: [],
    productRoots: ["app/", "web/"],
    featureIdPattern: "^ours-\\d+$",
  }, null, 2)}\n`);
  return root;
}

test("harness-upgrade: refreshes the runner's own tests along with the runner (feat-019)", () => {
  const root = adopter();
  try {
    const report = upgrade(root);
    assert.ok(report.overwritten.includes("tests/"), JSON.stringify(report.overwritten));
    assert.equal(readFileSync(path.join(root, "tests/framework-check.test.mjs"), "utf8"), harnessFile("tests/framework-check.test.mjs"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("harness-upgrade: refreshes template skeletons but keeps the customisable templates", () => {
  const root = adopter();
  try {
    upgrade(root);
    assert.equal(readFileSync(path.join(root, "templates/ci.yml"), "utf8"), harnessFile("templates/ci.yml"));
    assert.equal(readFileSync(path.join(root, "templates/sprint-contract.md"), "utf8"), "# Our own sprint contract\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("harness-upgrade: updates the manifest classification and keeps the adopter's own keys", () => {
  const root = adopter();
  try {
    const report = upgrade(root);
    const ours = JSON.parse(harnessFile(".harness/manifest.json"));
    const theirs = JSON.parse(readFileSync(path.join(root, ".harness/manifest.json"), "utf8"));
    for (const key of ["harness", "version", "core", "instance", "templates", "optionalComponents", "customizationPoints"]) {
      assert.deepEqual(theirs[key], ours[key], key);
    }
    assert.deepEqual(theirs.productRoots, ["app/", "web/"]);
    assert.equal(theirs.featureIdPattern, "^ours-\\d+$");
    assert.ok(report.overwritten.some((surface) => surface.startsWith(".harness/manifest.json")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("harness-upgrade: creates missing instance files from templates, never overwrites, never optional ones", () => {
  const root = adopter();
  write(root, "LICENSE", "Copyright (c) Adopter\n");
  try {
    const report = upgrade(root);
    const manifest = JSON.parse(harnessFile(".harness/manifest.json"));
    const gitattributes = manifest.templates.find((entry) => entry.to === ".gitattributes");
    if (gitattributes && manifest.instance.includes(".gitattributes")) {
      assert.ok(report.created.includes(".gitattributes"), JSON.stringify(report.created));
      assert.equal(readFileSync(path.join(root, ".gitattributes"), "utf8"), harnessFile(gitattributes.from));
    }
    assert.equal(readFileSync(path.join(root, "LICENSE"), "utf8"), "Copyright (c) Adopter\n");
    assert.ok(!report.created.includes("LICENSE"));
    assert.ok(!report.created.some((file) => file.startsWith("repositories/")), JSON.stringify(report.created));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("missingHarnessScripts: lists harness commands the adopter lacks, never its own variants", () => {
  const harness = tempDir();
  const root = tempDir();
  write(harness, "package.json", JSON.stringify({
    scripts: {
      lint: "node scripts/framework-check.mjs lint",
      "harness-docs": "node scripts/harness-docs.mjs",
      activate: "node scripts/framework-check.mjs activate",
      prepublishOnly: "npm run check",
    },
  }));
  const adopterPackage = `${JSON.stringify({ scripts: { lint: "node scripts/framework-check.mjs lint && eslint ." } }, null, 2)}\n`;
  write(root, "package.json", adopterPackage);
  try {
    assert.deepEqual(missingHarnessScripts(root, harness), [
      { name: "harness-docs", command: "node scripts/harness-docs.mjs" },
      { name: "activate", command: "node scripts/framework-check.mjs activate" },
    ]);
    assert.equal(readFileSync(path.join(root, "package.json"), "utf8"), adopterPackage);
  } finally {
    rmSync(harness, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("missingMakeTargets: gives each missing target with its help lines and recipe, never edits", () => {
  const harness = tempDir();
  const root = tempDir();
  write(harness, "Makefile", [
    ".PHONY: check activate",
    "",
    "## Full verification",
    "check:",
    "\t@node scripts/framework-check.mjs check",
    "",
    "## Activate a feature after its dependencies pass.",
    "## Usage: make activate F=<feature-id>",
    "activate:",
    "\t@node scripts/framework-check.mjs activate $(F)",
    "",
  ].join("\n"));
  const ours = "check:\n\t@npm run check\n";
  write(root, "Makefile", ours);
  try {
    assert.deepEqual(missingMakeTargets(root, harness), [
      {
        target: "activate",
        block: [
          "## Activate a feature after its dependencies pass.",
          "## Usage: make activate F=<feature-id>",
          "activate:",
          "\t@node scripts/framework-check.mjs activate $(F)",
        ].join("\n"),
      },
    ]);
    assert.equal(readFileSync(path.join(root, "Makefile"), "utf8"), ours);
  } finally {
    rmSync(harness, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("missingHarnessScripts: nothing to report without a package.json", () => {
  const root = tempDir();
  try {
    assert.deepEqual(missingHarnessScripts(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
