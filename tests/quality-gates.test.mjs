import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { adopt } from "../scripts/create-harness.mjs";
import { extractMetric, validateQualityConfig } from "../scripts/quality-gates.mjs";
import { resolveQualityPreset } from "../scripts/stack-detect.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.join(HERE, "..", "scripts", "framework-check.mjs");
const TEMPLATE = path.join(HERE, "..", "templates", "quality.json");
const NODE = `"${process.execPath}"`;

// A stand-in for a coverage/mutation tool: prints a table row, writes a JSON report, or exits
// with a chosen code, so every gate outcome can be produced without a real toolchain.
const FAKE_TOOL = `
import { mkdirSync, writeFileSync } from "node:fs";
const [mode, value, code] = process.argv.slice(2);
if (mode === "print") console.log("File      | % Lines |\\nAll files |   " + value + " |");
if (mode === "report") {
  mkdirSync(".harness/quality", { recursive: true });
  writeFileSync(".harness/quality/report.json", JSON.stringify({ totals: [{ percent: value }] }));
}
process.exit(Number(code ?? 0));
`;

function fixture(config) {
  const root = mkdtempSync(path.join(os.tmpdir(), "cw-quality-"));
  writeFileSync(path.join(root, "tool.mjs"), FAKE_TOOL, "utf8");
  if (config !== undefined) {
    mkdirSync(path.join(root, ".harness"), { recursive: true });
    writeFileSync(path.join(root, ".harness", "quality.json"), JSON.stringify(config, null, 2), "utf8");
  }
  return root;
}

function quality(root, mode = "quality", env = {}) {
  // Like run() in framework-check.test.mjs (D-032): ./init.sh's CW_INIT_SH must not leak in.
  const inherited = { ...process.env };
  delete inherited.CW_INIT_SH;
  const result = spawnSync(process.execPath, [RUNNER, mode], {
    cwd: root,
    encoding: "utf8",
    env: { ...inherited, ...env },
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

function gate(fields) {
  return { enabled: true, gates: [{ name: "coverage", min: 80, ...fields }] };
}

const PRINT_METRIC = { pattern: "all files\\s*\\|\\s*([\\d.]+)" };

test("validateQualityConfig: the shipped template is valid and disabled", () => {
  const template = JSON.parse(readFileSync(TEMPLATE, "utf8"));
  assert.deepEqual(validateQualityConfig(template), []);
  assert.equal(template.enabled, false);
});

test("validateQualityConfig: names every problem instead of stopping at the first", () => {
  const errors = validateQualityConfig({
    gates: [
      { name: "coverage", min: 80, cmd: "x" },
      { name: "coverage", min: "80", colour: "red" },
      { name: "eval", min: 1, cmd: "x", metric: { pattern: "(" } },
      { name: "mutation", min: 1, exitCodes: [] },
    ],
  });
  const text = errors.join("\n");
  assert.match(text, /"enabled" must be true or false/);
  assert.match(text, /declares a cmd, so it must also declare a "metric"/);
  assert.match(text, /gate name "coverage" is declared twice/);
  assert.match(text, /"min" must be a number/);
  assert.match(text, /unknown key "colour"/);
  assert.match(text, /not a valid regular expression/);
  assert.match(text, /"exitCodes" must be a non-empty array of integers/);
});

test("validateQualityConfig: a metric needs exactly one source", () => {
  const both = validateQualityConfig(gate({ cmd: "x", metric: { pattern: "(\\d+)", file: "a.json", path: "x" } }));
  assert.match(both.join("\n"), /either "pattern" or "file" \+ "path"/);
  const half = validateQualityConfig(gate({ cmd: "x", metric: { file: "a.json" } }));
  assert.match(half.join("\n"), /"metric.file" and "metric.path" must both be non-empty strings/);
});

test("extractMetric: a pattern reads the last match, case-insensitively", () => {
  const output = "All files | 40.0 |\nretry\nALL FILES | 85.5 |\n";
  assert.equal(extractMetric(PRINT_METRIC, output), 85.5);
  assert.equal(extractMetric(PRINT_METRIC, "no table here"), null);
});

test("extractMetric: named groups num and den give a percentage", () => {
  const metric = { pattern: "(?<den>\\d+) mutants tested.*?(?<num>\\d+) caught" };
  assert.equal(extractMetric(metric, "40 mutants tested in 1m: 10 missed, 30 caught"), 75);
});

test("extractMetric: a file metric walks a dot path into a JSON report", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "cw-quality-metric-"));
  try {
    writeFileSync(path.join(root, "r.json"), JSON.stringify({ data: [{ lines: 91.25 }], badge: { message: "87.5%" } }));
    assert.equal(extractMetric({ file: "r.json", path: "data.0.lines" }, "", root), 91.25);
    assert.equal(extractMetric({ file: "r.json", path: "badge.message" }, "", root), 87.5);
    assert.equal(extractMetric({ file: "r.json", path: "data.1.lines" }, "", root), null);
    assert.equal(extractMetric({ file: "missing.json", path: "x" }, "", root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("quality: SKIPs when there is no config, and when the config is disabled", () => {
  for (const config of [undefined, { enabled: false, gates: [] }]) {
    const root = fixture(config);
    try {
      const { status, out } = quality(root);
      assert.equal(status, 0, out);
      assert.match(out, /\[SKIP\]/);
      assert.doesNotMatch(out, /\[PASS\]/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("quality: PASS at or above min, FAIL below it", () => {
  const passing = fixture(gate({ cmd: `${NODE} tool.mjs print 85.5`, metric: PRINT_METRIC }));
  const failing = fixture(gate({ cmd: `${NODE} tool.mjs print 72`, metric: PRINT_METRIC }));
  try {
    const pass = quality(passing);
    assert.equal(pass.status, 0, pass.out);
    assert.match(pass.out, /\[PASS\] coverage: 85\.50 ≥ 80/);
    const fail = quality(failing);
    assert.equal(fail.status, 1, fail.out);
    assert.match(fail.out, /\[FAIL\] coverage: 72 is below the minimum 80/);
  } finally {
    rmSync(passing, { recursive: true, force: true });
    rmSync(failing, { recursive: true, force: true });
  }
});

test("quality: a failing command fails the gate unless its exit code is allowed", () => {
  const strict = fixture(gate({ cmd: `${NODE} tool.mjs print 90 2`, metric: PRINT_METRIC }));
  const lenient = fixture(gate({ cmd: `${NODE} tool.mjs print 90 2`, metric: PRINT_METRIC, exitCodes: [0, 2] }));
  try {
    const fail = quality(strict);
    assert.equal(fail.status, 1, fail.out);
    assert.match(fail.out, /\[FAIL\] coverage: command failed \(exit 2\)/);
    const pass = quality(lenient);
    assert.equal(pass.status, 0, pass.out);
    assert.match(pass.out, /\[PASS\] coverage: 90 ≥ 80/);
  } finally {
    rmSync(strict, { recursive: true, force: true });
    rmSync(lenient, { recursive: true, force: true });
  }
});

test("quality: a metric that cannot be read fails instead of passing", () => {
  const root = fixture(gate({ cmd: `${NODE} tool.mjs none`, metric: PRINT_METRIC }));
  try {
    const { status, out } = quality(root);
    assert.equal(status, 1, out);
    assert.match(out, /\[FAIL\] coverage: metric not found/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("quality: a file metric is read from this run's report, never a stale one", () => {
  const metric = { file: ".harness/quality/report.json", path: "totals.0.percent" };
  const fresh = fixture(gate({ cmd: `${NODE} tool.mjs report 93`, metric }));
  const stale = fixture(gate({ cmd: `${NODE} tool.mjs none`, metric }));
  try {
    const pass = quality(fresh);
    assert.equal(pass.status, 0, pass.out);
    assert.match(pass.out, /\[PASS\] coverage: 93 ≥ 80/);
    assert.equal(readFileSync(path.join(fresh, ".harness", "quality", ".gitignore"), "utf8"), "*\n");

    mkdirSync(path.join(stale, ".harness", "quality"), { recursive: true });
    writeFileSync(path.join(stale, ".harness", "quality", "report.json"), JSON.stringify({ totals: [{ percent: 99 }] }));
    const fail = quality(stale);
    assert.equal(fail.status, 1, fail.out);
    assert.match(fail.out, /metric not found/);
  } finally {
    rmSync(fresh, { recursive: true, force: true });
    rmSync(stale, { recursive: true, force: true });
  }
});

test("quality: disabled and unresolvable gates SKIP while the others still run", () => {
  const root = fixture({
    enabled: true,
    gates: [
      { name: "coverage", min: 80 },
      { name: "mutation", enabled: false, min: 80 },
      { name: "eval", min: 0.5, cmd: `${NODE} tool.mjs print 0.75`, metric: PRINT_METRIC },
    ],
  });
  try {
    const { status, out } = quality(root);
    assert.equal(status, 0, out);
    assert.match(out, /\[SKIP\] coverage: no coverage preset for none/);
    assert.match(out, /\[SKIP\] mutation: disabled/);
    assert.match(out, /\[PASS\] eval: 0\.75 ≥ 0\.50/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("quality: an invalid config fails with every problem listed", () => {
  const root = fixture({ enabled: "yes", gates: [{ name: "coverage" }] });
  try {
    const { status, out } = quality(root);
    assert.equal(status, 1, out);
    assert.match(out, /\[FAIL\] .*"enabled" must be true or false/);
    assert.match(out, /\[FAIL\] gate 1 "min" must be a number/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveQualityPreset: node uses the product's coverage script, never the harness tests", () => {
  const withScript = fixture();
  const without = fixture();
  try {
    writeFileSync(path.join(withScript, "package.json"), JSON.stringify({ scripts: { coverage: "c8 node --test" } }));
    writeFileSync(path.join(without, "package.json"), JSON.stringify({ scripts: {} }));
    const preset = resolveQualityPreset("node", "coverage", withScript);
    assert.equal(preset.cmd, "c8 node --test");
    assert.equal(extractMetric(preset.metric, "All files |  88.1 | 70 |"), 88.1);
    assert.match(resolveQualityPreset("node", "coverage", without).skip, /no coverage script/);
  } finally {
    rmSync(withScript, { recursive: true, force: true });
    rmSync(without, { recursive: true, force: true });
  }
});

test("resolveQualityPreset: python measures src/ when it exists, or skips without pytest-cov", () => {
  const root = fixture();
  try {
    mkdirSync(path.join(root, "src"));
    const preset = resolveQualityPreset("python", "coverage", root);
    if (preset.cmd) {
      assert.match(preset.cmd, /-m pytest -q --cov=src .*--cov-report=json:\.harness\/quality\/coverage\.json/);
      assert.deepEqual(preset.metric, { file: ".harness/quality/coverage.json", path: "totals.percent_covered" });
    } else {
      assert.match(preset.skip, /pytest-cov is not installed|python interpreter not found/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveQualityPreset: go reads the total line; mutation and jvm have no preset", () => {
  const go = resolveQualityPreset("go", "coverage");
  if (go.cmd) {
    assert.equal(extractMetric(go.metric, "ok\nmain.go:3:\tmain\t100.0%\ntotal:\t\t\t(statements)\t82.4%\n"), 82.4);
  } else {
    assert.match(go.skip, /go toolchain is not installed/);
  }
  assert.match(resolveQualityPreset("node", "mutation").skip, /no mutation preset — set "cmd" and "metric"/);
  assert.match(resolveQualityPreset("jvm", "coverage").skip, /no coverage preset for jvm/);
});

test("a fresh adopter gets the disabled config, quality SKIPs, and lint rejects a malformed one", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "cw-quality-adopter-"));
  try {
    adopt(root);
    assert.ok(existsSync(path.join(root, ".harness", "quality.json")));
    const skipped = quality(root);
    assert.equal(skipped.status, 0, skipped.out);
    assert.match(skipped.out, /\[SKIP\] Quality gates are disabled/);

    // CW_INIT_SH turns the unfilled-docs failure into a warning, isolating the config check.
    const before = quality(root, "lint", { CW_INIT_SH: "1" });
    assert.doesNotMatch(before.out, /invalid \.harness\/quality\.json/);
    writeFileSync(path.join(root, ".harness", "quality.json"), JSON.stringify({ enabled: true, gates: [{ name: "coverage" }] }));
    const lint = quality(root, "lint", { CW_INIT_SH: "1" });
    assert.equal(lint.status, 1, lint.out);
    assert.match(lint.out, /invalid \.harness\/quality\.json: gate 1 "min" must be a number/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
