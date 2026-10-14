import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderHarnessDocs } from "../scripts/harness-docs.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNNER = path.join(ROOT, "scripts", "framework-check.mjs");
const GENERATOR = path.join(ROOT, "scripts", "harness-docs.mjs");

function fixture() {
  return mkdtempSync(path.join(os.tmpdir(), "harness-docs-"));
}

function write(root, rel, content) {
  const dest = path.join(root, rel);
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, content, "utf8");
}

function run(root, script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: "utf8",
  });
  return {
    exit: result.error ? 1 : (result.status ?? 1),
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function commandSurfaceFixture() {
  const root = fixture();
  const makefile = readFileSync(path.join(ROOT, "Makefile"), "utf8");
  const packageJson = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  write(root, "Makefile", makefile);
  write(root, "package.json", JSON.stringify(packageJson, null, 2));
  write(root, "AGENTS.md", readFileSync(path.join(ROOT, "AGENTS.md"), "utf8"));
  write(root, "README.md", "[Harness Command Reference](docs/HARNESS.md)\n");
  write(root, "docs/HARNESS.md", renderHarnessDocs(makefile, packageJson));
  return root;
}

test("renderHarnessDocs documents Make targets and npm-only scripts", () => {
  const docs = renderHarnessDocs(
    ".PHONY: check lint\ncheck: lint\nlint:\n\t@echo lint\n",
    { scripts: { check: "make lint", lint: "echo lint", "harness-docs": "node docs.mjs" } },
  );

  assert.match(docs, /\| `make check` \| `npm run check` \|/);
  assert.match(docs, /\| `make lint` \| `npm run lint` \|/);
  assert.match(docs, /\| — \| `npm run harness-docs` \|/);
  assert.doesNotMatch(docs, /make \.PHONY/);
});

test("harness-docs CLI generates docs/HARNESS.md from the current surfaces", () => {
  const root = fixture();
  try {
    write(root, "Makefile", "check:\n\t@echo check\n");
    write(root, "package.json", JSON.stringify({ scripts: { check: "echo check", docs: "node docs.mjs" } }));

    const result = run(root, GENERATOR);
    assert.equal(result.exit, 0, result.output);
    assert.equal(
      readFileSync(path.join(root, "docs", "HARNESS.md"), "utf8"),
      renderHarnessDocs("check:\n\t@echo check\n", { scripts: { check: "echo check", docs: "node docs.mjs" } }),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("command-surface lint accepts a linked, current reference", () => {
  const root = commandSurfaceFixture();
  try {
    const result = run(root, RUNNER, ["lint:command-surfaces"]);
    assert.equal(result.exit, 0, result.output);
    assert.match(result.output, /README links to the current command reference/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("command-surface lint requires the README link even without a Command Targets heading", () => {
  const root = commandSurfaceFixture();
  try {
    write(root, "README.md", "# Product\n\nA project README with no command table.\n");
    const result = run(root, RUNNER, ["lint:command-surfaces"]);
    assert.equal(result.exit, 1);
    assert.match(result.output, /README\.md must link to docs\/HARNESS\.md/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("command-surface lint detects changes to either source surface", () => {
  const root = commandSurfaceFixture();
  try {
    write(root, "Makefile", `${readFileSync(path.join(root, "Makefile"), "utf8")}custom-target:\n\t@echo custom\n`);
    const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    packageJson.scripts["custom-target"] = "echo custom";
    write(root, "package.json", JSON.stringify(packageJson, null, 2));

    const result = run(root, RUNNER, ["lint:command-surfaces"]);
    assert.equal(result.exit, 1);
    assert.match(result.output, /docs\/HARNESS\.md is out of date/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
