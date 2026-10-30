#!/usr/bin/env node

// Quality gates (feat-023) — opt-in metric thresholds on top of the verification layers.
//
// .harness/quality.json declares the gates. Each gate runs one command, reads one number
// (coverage %, mutation score, an eval accuracy…) from its output or from a JSON report,
// and fails when that number is below the gate's min. A gate without a cmd uses the
// detected stack's preset (scripts/stack-detect.mjs resolveQualityPreset). Tri-state like
// every layer: a disabled gate, or one whose tool is missing, reports SKIP — never PASS.
//
//   node scripts/framework-check.mjs quality      (make quality / npm run quality)

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { QUALITY_REPORT_DIR, detectRuntime, resolveQualityPreset } from "./stack-detect.mjs";

export const QUALITY_CONFIG = ".harness/quality.json";

const GATE_KEYS = new Set(["name", "enabled", "min", "cmd", "probe", "metric", "exitCodes", "$comment"]);

// Returns the list of problems with a parsed quality config; empty when it is valid.
export function validateQualityConfig(config) {
  const errors = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return [`${QUALITY_CONFIG} must be a JSON object`];
  }
  if (typeof config.enabled !== "boolean") errors.push(`${QUALITY_CONFIG} "enabled" must be true or false`);
  if (!Array.isArray(config.gates)) {
    errors.push(`${QUALITY_CONFIG} "gates" must be an array`);
    return errors;
  }
  const names = new Set();
  config.gates.forEach((gate, index) => {
    const where = `gate ${index + 1}`;
    if (!gate || typeof gate !== "object" || Array.isArray(gate)) {
      errors.push(`${where} must be an object`);
      return;
    }
    for (const key of Object.keys(gate)) {
      if (!GATE_KEYS.has(key)) errors.push(`${where} has unknown key "${key}"`);
    }
    if (typeof gate.name !== "string" || !gate.name.trim()) {
      errors.push(`${where} needs a "name"`);
    } else if (names.has(gate.name)) {
      errors.push(`gate name "${gate.name}" is declared twice`);
    } else {
      names.add(gate.name);
    }
    if (typeof gate.min !== "number" || !Number.isFinite(gate.min)) errors.push(`${where} "min" must be a number`);
    if ("enabled" in gate && typeof gate.enabled !== "boolean") errors.push(`${where} "enabled" must be true or false`);
    if ("cmd" in gate && (typeof gate.cmd !== "string" || !gate.cmd.trim())) errors.push(`${where} "cmd" must be a non-empty string`);
    if (gate.cmd && !gate.metric) errors.push(`${where} declares a cmd, so it must also declare a "metric"`);
    if ("probe" in gate && (typeof gate.probe !== "string" || !gate.probe.trim())) errors.push(`${where} "probe" must be a non-empty string`);
    if ("metric" in gate) errors.push(...validateMetric(gate.metric).map((error) => `${where} ${error}`));
    if ("exitCodes" in gate && !(Array.isArray(gate.exitCodes) && gate.exitCodes.length > 0 && gate.exitCodes.every(Number.isInteger))) {
      errors.push(`${where} "exitCodes" must be a non-empty array of integers`);
    }
  });
  return errors;
}

function validateMetric(metric) {
  if (!metric || typeof metric !== "object" || Array.isArray(metric)) return ['"metric" must be an object'];
  const hasPattern = "pattern" in metric;
  const hasFile = "file" in metric || "path" in metric;
  if (hasPattern === hasFile) return ['"metric" needs either "pattern" or "file" + "path"'];
  if (hasPattern) {
    if (typeof metric.pattern !== "string" || !metric.pattern) return ['"metric.pattern" must be a non-empty string'];
    try {
      new RegExp(metric.pattern, "gi");
    } catch {
      return [`"metric.pattern" is not a valid regular expression: ${metric.pattern}`];
    }
    return [];
  }
  if (typeof metric.file !== "string" || !metric.file || typeof metric.path !== "string" || !metric.path) {
    return ['"metric.file" and "metric.path" must both be non-empty strings'];
  }
  return [];
}

// Read the gate's number. A pattern takes the last match in the output (case-insensitive):
// capture group 1 is the value, or named groups num/den give 100 * num / den for tools that
// print counts instead of a score. A file metric walks a dot path (numeric segments index
// arrays) into a JSON report; "87.5%" style strings are accepted. Returns null when absent.
export function extractMetric(metric, output, cwd = ".") {
  if (metric.pattern) {
    const matches = [...output.matchAll(new RegExp(metric.pattern, "gi"))];
    const last = matches.at(-1);
    if (!last) return null;
    if (last.groups?.num !== undefined && last.groups?.den !== undefined) {
      const num = Number.parseFloat(last.groups.num);
      const den = Number.parseFloat(last.groups.den);
      return den > 0 ? (100 * num) / den : null;
    }
    return toNumber(last[1]);
  }
  const file = path.join(cwd, metric.file);
  if (!existsSync(file)) return null;
  let value;
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  for (const segment of metric.path.split(".")) {
    if (value === null || typeof value !== "object") return null;
    value = value[segment];
  }
  return toNumber(value);
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Node product commands rely on node_modules/.bin, as the layers do in run-layer.
function commandEnv(runtime) {
  if (runtime !== "node") return process.env;
  return {
    ...process.env,
    PATH: `${path.join(process.cwd(), "node_modules", ".bin")}${path.delimiter}${process.env.PATH ?? ""}`,
  };
}

function prepareReportDir() {
  mkdirSync(QUALITY_REPORT_DIR, { recursive: true });
  const ignore = path.join(QUALITY_REPORT_DIR, ".gitignore");
  if (!existsSync(ignore)) writeFileSync(ignore, "*\n", "utf8");
}

function format(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

// Run every gate and print one [PASS]/[FAIL]/[SKIP] line each. Returns the exit code.
export function runQualityGates() {
  console.log("=== Quality Gates ===");
  if (!existsSync(QUALITY_CONFIG)) {
    console.log(`  [SKIP] No ${QUALITY_CONFIG} — quality gates are not configured`);
    return 0;
  }
  let config;
  try {
    config = JSON.parse(readFileSync(QUALITY_CONFIG, "utf8"));
  } catch (err) {
    console.log(`  [FAIL] ${QUALITY_CONFIG} is not valid JSON (${err.message})`);
    return 1;
  }
  const errors = validateQualityConfig(config);
  if (errors.length > 0) {
    for (const error of errors) console.log(`  [FAIL] ${error}`);
    return 1;
  }
  if (!config.enabled) {
    console.log(`  [SKIP] Quality gates are disabled — set "enabled": true in ${QUALITY_CONFIG}`);
    return 0;
  }

  const runtime = detectRuntime();
  prepareReportDir();
  let failed = false;
  for (const gate of config.gates) {
    if (gate.enabled === false) {
      console.log(`  [SKIP] ${gate.name}: disabled`);
      continue;
    }
    const resolved = gate.cmd ? { cmd: gate.cmd, metric: gate.metric, skip: "" } : resolveQualityPreset(runtime, gate.name);
    const metric = gate.metric ?? resolved.metric;
    if (!resolved.cmd) {
      console.log(`  [SKIP] ${gate.name}: ${resolved.skip}`);
      continue;
    }
    // A custom gate's counterpart to the presets' tool check: when the tool cannot run here
    // (wrong OS, too old a runtime, not installed), the gate is unverified, not failed.
    if (gate.probe) {
      const probe = spawnSync(gate.probe, { shell: true, stdio: "ignore", env: commandEnv(runtime) });
      if (probe.error || probe.status !== 0) {
        console.log(`  [SKIP] ${gate.name}: probe failed (${gate.probe})`);
        continue;
      }
    }
    // A report left by an earlier run must never stand in for this one.
    if (metric.file) rmSync(metric.file, { force: true });

    console.log(`--- ${gate.name}: ${resolved.cmd} ---`);
    const run = spawnSync(resolved.cmd, {
      encoding: "utf8",
      shell: true,
      stdio: ["inherit", "pipe", "pipe"],
      env: commandEnv(runtime),
      maxBuffer: 256 * 1024 * 1024,
    });
    const stdout = run.stdout ?? "";
    const stderr = run.stderr ?? "";
    process.stdout.write(stdout);
    process.stderr.write(stderr);
    const status = run.error ? 1 : (run.status ?? 1);
    if (!(gate.exitCodes ?? [0]).includes(status)) {
      console.log(`  [FAIL] ${gate.name}: command failed (exit ${status})`);
      failed = true;
      continue;
    }
    const value = extractMetric(metric, `${stdout}\n${stderr}`);
    if (value === null) {
      const source = metric.pattern ? `no output line matched /${metric.pattern}/i` : `no number at "${metric.path}" in ${metric.file}`;
      console.log(`  [FAIL] ${gate.name}: metric not found (${source})`);
      failed = true;
    } else if (value < gate.min) {
      console.log(`  [FAIL] ${gate.name}: ${format(value)} is below the minimum ${format(gate.min)}`);
      failed = true;
    } else {
      console.log(`  [PASS] ${gate.name}: ${format(value)} ≥ ${format(gate.min)}`);
    }
  }
  return failed ? 1 : 0;
}
