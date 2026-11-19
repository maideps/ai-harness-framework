import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  PY_COMPILE_EXCLUDE,
  detectRuntime,
  detectPackageManager,
  getInstallCommand,
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

function addPythonStub(root) {
  const executable = process.platform === "win32"
    ? path.join(root, ".venv", "Scripts", "python.exe")
    : path.join(root, ".venv", "bin", "python");
  mkdirSync(path.dirname(executable), { recursive: true });
  writeFileSync(executable, process.platform === "win32" ? "@exit /b 0\n" : "#!/bin/sh\nexit 0\n", "utf8");
  if (process.platform !== "win32") chmodSync(executable, 0o755);
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

test("getInstallCommand: skips empty node projects and uses lock-preserving installs", () => {
  const empty = fixture({ "package.json": JSON.stringify({}) });
  assert.equal(getInstallCommand(empty), "");
  rmSync(empty, { recursive: true, force: true });

  const invalid = fixture({ "package.json": "{invalid" });
  assert.equal(getInstallCommand(invalid), "npm install");
  rmSync(invalid, { recursive: true, force: true });

  const locked = fixture({
    "package.json": JSON.stringify({ dependencies: { example: "^1.0.0" } }),
    "package-lock.json": "{}",
  });
  assert.equal(getInstallCommand(locked), "npm ci");
  rmSync(locked, { recursive: true, force: true });

  const unlocked = fixture({ "package.json": JSON.stringify({ devDependencies: { example: "^1.0.0" } }) });
  assert.equal(getInstallCommand(unlocked), "npm install");
  rmSync(unlocked, { recursive: true, force: true });
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
    assert.match(lint.cmd, /ruff check \.$/);
  } else {
    assert.match(lint.skip, /ruff is not installed|uv is not installed|poetry is not installed/);
  }
  rmSync(root, { recursive: true, force: true });
});

test("resolveLayer: python lockfiles select uv and poetry runners", () => {
  const bin = mkdtempSync(path.join(os.tmpdir(), "cw-python-runners-"));
  const originalPath = process.env.PATH;
  for (const name of ["uv", "poetry"]) {
    const executable = path.join(bin, process.platform === "win32" ? `${name}.cmd` : name);
    writeFileSync(executable, process.platform === "win32" ? "@exit /b 0\n" : "#!/bin/sh\nexit 0\n", "utf8");
    if (process.platform !== "win32") chmodSync(executable, 0o755);
  }
  process.env.PATH = `${bin}${path.delimiter}${originalPath ?? ""}`;
  try {
    for (const [lockfile, runner] of [["uv.lock", "uv run"], ["poetry.lock", "poetry run"]]) {
      const root = fixture({ "pyproject.toml": "[project]\nname = \"x\"\n", [lockfile]: "" });
      assert.equal(resolveLayer("python", "lint", root).cmd, `${runner} ruff check .`);
      assert.equal(resolveLayer("python", "typecheck", root).cmd, `${runner} mypy src/`);
      assert.equal(resolveLayer("python", "test", root).cmd, `${runner} python -m pytest -q`);
      rmSync(root, { recursive: true, force: true });
    }
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    rmSync(bin, { recursive: true, force: true });
  }
});

test("resolveLayer: python .venv uses its interpreter and configured mypy files", { skip: process.platform === "win32" }, () => {
  const root = fixture({
    "pyproject.toml": "[project]\nname = \"x\"\n[tool.mypy]\nfiles = [\"apps\", \"packages\"]\n",
  });
  addPythonStub(root);
  const python = '"./.venv/bin/python"';
  assert.equal(resolveLayer("python", "lint", root).cmd, `${python} -m ruff check .`);
  assert.equal(resolveLayer("python", "typecheck", root).cmd, `${python} -m mypy`);
  assert.equal(resolveLayer("python", "test", root).cmd, `${python} -m pytest -q`);
  rmSync(root, { recursive: true, force: true });
});

test("resolveLayer: mypy uses configured files from supported configs and defaults to src/", { skip: process.platform === "win32" }, () => {
  for (const [config, content] of [
    ["pyproject.toml", "[project]\nname = \"x\"\n[tool.mypy]\nfiles = [\"apps\", \"packages\"]\n"],
    ["mypy.ini", "[mypy]\nfiles = apps, packages\n"],
    [".mypy.ini", "[mypy]\nfiles = apps, packages\n"],
    ["setup.cfg", "[mypy]\nfiles = apps, packages\n"],
  ]) {
    const root = fixture({ "pyproject.toml": "[project]\nname = \"x\"\n", [config]: content });
    addPythonStub(root);
    assert.equal(resolveLayer("python", "typecheck", root).cmd, '"./.venv/bin/python" -m mypy');
    rmSync(root, { recursive: true, force: true });
  }

  const root = fixture({ "pyproject.toml": "[project]\nname = \"x\"\n" });
  addPythonStub(root);
  assert.equal(resolveLayer("python", "typecheck", root).cmd, '"./.venv/bin/python" -m mypy src/');
  rmSync(root, { recursive: true, force: true });
});
