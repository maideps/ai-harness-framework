import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { missingSelfChecks } from "../scripts/harness-audit.mjs";

function tempDir() {
  return mkdtempSync(path.join(os.tmpdir(), "cw-harness-audit-"));
}

function write(root, rel, content) {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), content);
}

// #25: replacing a layer's package.json script with a product tool silently drops every
// harness self-check that layer carries (skills, progress log, placeholders, command-surface
// drift for lint; dependency graph, WIP contract, and runner unit tests for test; etc.), with
// nothing else — check-arch included — covering the gap. harness-audit should flag it.
test("missingSelfChecks: flags a layer whose script no longer invokes the harness's own check", () => {
  const root = tempDir();
  write(root, "package.json", JSON.stringify({
    scripts: {
      lint: "eslint .",
      typecheck: "node scripts/framework-check.mjs typecheck",
      test: "node scripts/framework-check.mjs test",
      build: "node scripts/framework-check.mjs build",
    },
  }));
  try {
    assert.deepEqual(missingSelfChecks(root), ["lint"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("missingSelfChecks: a chained command that still invokes the harness check is not flagged", () => {
  const root = tempDir();
  write(root, "package.json", JSON.stringify({
    scripts: {
      lint: "node scripts/framework-check.mjs lint && eslint .",
      typecheck: "node scripts/framework-check.mjs typecheck && tsc --noEmit",
      test: "node scripts/framework-check.mjs test",
      build: "node scripts/framework-check.mjs build",
    },
  }));
  try {
    assert.deepEqual(missingSelfChecks(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("missingSelfChecks: a layer the adopter never defined is not flagged (a different, pre-existing concern)", () => {
  const root = tempDir();
  write(root, "package.json", JSON.stringify({ scripts: { lint: "node scripts/framework-check.mjs lint" } }));
  try {
    assert.deepEqual(missingSelfChecks(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("missingSelfChecks: nothing to report without a package.json", () => {
  const root = tempDir();
  try {
    assert.deepEqual(missingSelfChecks(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
