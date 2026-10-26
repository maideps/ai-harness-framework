import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { adopt, HARNESS_ROOT, placeTemplates } from "../scripts/create-harness.mjs";

function fixture(name) {
  return mkdtempSync(path.join(os.tmpdir(), `cw-create-harness-${name}-`));
}

function cleanup(root) {
  rmSync(root, { recursive: true, force: true });
}

// H11 (2026-09-08 external review): create-harness used to copy the
// framework's own package.json byte-for-byte into every new adopter repo —
// same npm name, same publishConfig.access=public, same repository URL —
// so a fresh instance was indistinguishable from the framework itself.

test("adopt: a brand-new target gets an instance-specific, private package.json", () => {
  const root = fixture("fresh");
  try {
    adopt(root, { skipExisting: true });
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    const frameworkPkg = JSON.parse(readFileSync(path.join(HARNESS_ROOT, "package.json"), "utf8"));

    assert.notEqual(pkg.name, frameworkPkg.name);
    assert.equal(pkg.private, true);
    assert.equal(pkg.publishConfig, undefined);
    assert.equal(pkg.repository, undefined);
    assert.equal(pkg.version, "0.1.0");
    // The reusable command surface must still come from the framework.
    assert.deepEqual(pkg.scripts, frameworkPkg.scripts);
  } finally {
    cleanup(root);
  }
});

test("adopt: an already-customized package.json is never rewritten", () => {
  const root = fixture("existing");
  try {
    mkdirSync(root, { recursive: true });
    const customPkg = { name: "my-own-app", version: "3.2.1", private: true, scripts: { build: "echo hi" } };
    writeFileSync(path.join(root, "package.json"), `${JSON.stringify(customPkg, null, 2)}\n`, "utf8");

    adopt(root, { skipExisting: true });

    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    assert.deepEqual(pkg, customPkg);
  } finally {
    cleanup(root);
  }
});

test("adopt: the sanitized name is derived from the target directory name", () => {
  const parent = fixture("naming");
  const root = path.join(parent, "My Cool Project!!");
  try {
    adopt(root, { skipExisting: true });
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    assert.equal(pkg.name, "my-cool-project");
  } finally {
    cleanup(parent);
  }
});

// #24: a plain adopter must not acquire the multi-repo component (or any other optional
// component) unasked — only an explicit `components` opt-in places it.
test("adopt: a plain adoption places no optional-component files", () => {
  const root = fixture("plain");
  try {
    adopt(root, { skipExisting: true });
    assert.ok(!existsSync(path.join(root, "repositories")));
    assert.ok(!existsSync(path.join(root, "contracts")));
    assert.ok(!existsSync(path.join(root, "tasks")));
    assert.ok(!existsSync(path.join(root, "scripts", "verify-all")));
    assert.ok(!existsSync(path.join(root, "scripts", "verify-all.mjs")));
  } finally {
    cleanup(root);
  }
});

test("adopt: components opts into an optional component's templates", () => {
  const root = fixture("opt-in");
  try {
    adopt(root, { skipExisting: true, components: ["multi-repo"] });
    assert.ok(existsSync(path.join(root, "repositories", "example", "scripts", "verify.mjs")));
    assert.ok(existsSync(path.join(root, "scripts", "verify-all.mjs")));
    assert.ok(existsSync(path.join(root, "contracts", "README.md")));
  } finally {
    cleanup(root);
  }
});

test("placeTemplates: rerunning with the same component against an existing adopter only adds what's missing", () => {
  const root = fixture("activate-later");
  try {
    adopt(root, { skipExisting: true });
    assert.ok(!existsSync(path.join(root, "scripts", "verify-all.mjs")));
    const before = readFileSync(path.join(root, "AGENTS.md"), "utf8");
    const placed = placeTemplates(root, { skipExisting: true, components: ["multi-repo"] });
    assert.ok(placed.includes("scripts/verify-all.mjs"));
    assert.ok(existsSync(path.join(root, "scripts", "verify-all.mjs")));
    // Re-running the same activation is idempotent and never touches unrelated CORE files.
    const placedAgain = placeTemplates(root, { skipExisting: true, components: ["multi-repo"] });
    assert.deepEqual(placedAgain, []);
    assert.equal(readFileSync(path.join(root, "AGENTS.md"), "utf8"), before);
  } finally {
    cleanup(root);
  }
});
