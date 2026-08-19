import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  PY_COMPILE_EXCLUDE,
  detectRuntime,
  detectPackageManager,
  resolveLayer,
} from "../scripts/stack-detect.mjs";

function fixture(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), "cw-unit-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  return root;
}

test("detectRuntime: product stacks take precedence over the harness package.json", () => {
  const root = fixture({
    "package.json": "{}",
    "pyproject.toml": "[project]\nname = \"x\"\n",
  });
  assert.equal(detectRuntime(root), "python");
  rmSync(root, { recursive: true, force: true });
});

test("detectRuntime: each manifest marker resolves to its stack", () => {
  const cases = [
    [["go.mod"], "go"],
    [["Cargo.toml"], "rust"],
    [["pom.xml"], "jvm"],
    [["app.csproj"], "dotnet"],
    [["package.json"], "node"],
    [["requirements.txt"], "python"],
  ];
  for (const [files, expected] of cases) {
    const entries = {};
    for (const file of files) entries[file] = "";
    const root = fixture(entries);
    assert.equal(detectRuntime(root), expected, `${files[0]} should resolve to ${expected}`);
    rmSync(root, { recursive: true, force: true });
  }
  const empty = fixture({});
  assert.equal(detectRuntime(empty), "none");
  rmSync(empty, { recursive: true, force: true });
});

test("detectPackageManager: lockfiles win, npm is the default", () => {
  const npmRoot = fixture({ "package.json": "{}" });
  assert.equal(detectPackageManager(npmRoot), "npm");
  rmSync(npmRoot, { recursive: true, force: true });

  const pnpmRoot = fixture({ "package.json": "{}", "pnpm-lock.yaml": "" });
  assert.equal(detectPackageManager(pnpmRoot), "pnpm");
  rmSync(pnpmRoot, { recursive: true, force: true });

  const empty = fixture({});
  assert.equal(detectPackageManager(empty), "");
  rmSync(empty, { recursive: true, force: true });
});

test("PY_COMPILE_EXCLUDE matches both path separators", () => {
  const re = new RegExp(PY_COMPILE_EXCLUDE);
  assert.ok(re.test("/project/node_modules/pkg.py"), "POSIX separator");
  assert.ok(re.test("C:\\project\\node_modules\\pkg.py"), "Windows separator");
  assert.ok(re.test("C:\\project\\.venv\\lib\\x.py"), "Windows .venv");
  assert.ok(!re.test("/project/src/main.py"), "product code is not excluded");
});

test("resolveLayer: node layers come from package.json scripts, missing ones SKIP", () => {
  const root = fixture({
    "package.json": JSON.stringify({ scripts: { lint: "eslint .", typecheck: "tsc --noEmit" } }),
  });
  assert.equal(resolveLayer("node", "lint", root).cmd, "eslint .");
  assert.equal(resolveLayer("node", "typecheck", root).cmd, "tsc --noEmit");
  assert.equal(resolveLayer("node", "test", root).cmd, "");
  assert.match(resolveLayer("node", "test", root).skip, /no test script/);
  rmSync(root, { recursive: true, force: true });
});

test("resolveLayer: python test resolves or SKIPs honestly", () => {
  const root = fixture({ "pyproject.toml": "[project]\nname = \"x\"\n" });
  const resolved = resolveLayer("python", "test", root);
  if (resolved.cmd) {
    assert.match(resolved.cmd, /-m pytest/);
  } else {
    assert.match(resolved.skip, /pytest is not installed|python interpreter not found/);
  }
  const lint = resolveLayer("python", "lint", root);
  if (lint.cmd) {
    assert.equal(lint.cmd, "ruff check .");
  } else {
    assert.match(lint.skip, /ruff is not installed/);
  }
  rmSync(root, { recursive: true, force: true });
});
