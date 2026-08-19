#!/usr/bin/env node

// Stack detection — the single source of truth for "what kind of project is this
// and how do we verify it". Consumed by:
//   - scripts/framework-check.mjs (run-layer, verify-chain, setup modes)
//   - init.sh                    (install + verification bootstrap)
//   - the Makefile               (via framework-check.mjs run-layer)
// Detection rules are documented in docs/ARCHITECTURE.md (Runner Consolidation).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const LAYERS = ["lint", "typecheck", "test", "build", "e2e", "dev"];

// Product stacks take precedence over the harness runtime: an adopter repo
// always contains the harness's own package.json (CORE), so node must be the
// LAST fallback — otherwise a python/go/rust product would be shadowed and
// its layers would never resolve (D-010).
export function detectRuntime(cwd = ".") {
  const at = (rel) => existsSync(path.join(cwd, rel));
  if (at("pyproject.toml") || at("requirements.txt")) return "python";
  if (at("go.mod")) return "go";
  if (at("Cargo.toml")) return "rust";
  if (at("pom.xml") || at("build.gradle") || at("build.gradle.kts")) return "jvm";
  try {
    const dotnet = readdirSync(cwd).filter((name) => name.endsWith(".csproj") || name.endsWith(".sln"));
    if (dotnet.length > 0) return "dotnet";
  } catch {
    // unreadable directory — treat as unknown
  }
  if (at("package.json")) return "node";
  return "none";
}

export function detectPackageManager(cwd = ".") {
  const at = (rel) => existsSync(path.join(cwd, rel));
  if (!at("package.json")) return "";
  if (at("pnpm-lock.yaml")) return "pnpm";
  if (at("yarn.lock")) return "yarn";
  if (at("bun.lock") || at("bun.lockb")) return "bun";
  return "npm";
}

function toolAvailable(probe) {
  try {
    // The probe is the complete command — callers pass the full version probe
    // (e.g. "go version", "cargo --version"). Appending --version here broke
    // tools whose probe already carried the flag ("go version --version").
    execSync(probe, { stdio: "pipe", shell: true });
    return true;
  } catch {
    return false;
  }
}

function pythonInterpreter() {
  for (const candidate of ["python3", "python", "py -3"]) {
    if (toolAvailable(`${candidate} --version`)) return candidate;
  }
  return "";
}

function readNodeScripts(cwd = ".") {
  try {
    return JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8")).scripts ?? {};
  } catch {
    return {};
  }
}

// Resolve the direct command for one verification layer in the detected stack.
// Returns { cmd, skip }: cmd is the exact command to execute (for node stacks
// this is the package.json script value, executed directly by run-layer with
// node_modules/.bin on PATH); skip is the human-readable SKIP reason when the
// layer is not configured.
export function resolveLayer(runtime, layer, cwd = ".") {
  if (layer === "dev") return resolveDev(runtime, cwd);
  switch (runtime) {
    case "node": {
      const scripts = readNodeScripts(cwd);
      let value = scripts[layer];
      if (layer === "typecheck" && typeof value !== "string" && typeof scripts["type-check"] === "string") {
        value = scripts["type-check"];
      }
      if (typeof value !== "string" || !value.trim()) {
        return { cmd: "", skip: `package.json has no ${layer === "typecheck" ? "typecheck" : layer} script` };
      }
      return { cmd: value.trim(), skip: "" };
    }
    case "python": {
      const py = pythonInterpreter();
      switch (layer) {
        case "lint":
          return toolAvailable("ruff --version") ? { cmd: "ruff check .", skip: "" } : { cmd: "", skip: "ruff is not installed" };
        case "typecheck":
          return toolAvailable("mypy --version") ? { cmd: "mypy src/", skip: "" } : { cmd: "", skip: "mypy is not installed" };
        case "test":
          return py && toolAvailable(`${py} -m pytest --version`)
            ? { cmd: `${py} -m pytest -q`, skip: "" }
            : { cmd: "", skip: py ? "pytest is not installed" : "python interpreter not found" };
        case "build":
          return { cmd: "", skip: "no python build step configured" };
        case "e2e":
          return { cmd: "", skip: "no e2e tests configured" };
        default:
          return { cmd: "", skip: `no ${layer} step configured` };
      }
    }
    case "go": {
      const available = toolAvailable("go version");
      const missing = { cmd: "", skip: "go toolchain is not installed" };
      switch (layer) {
        case "lint": return available ? { cmd: "go vet ./...", skip: "" } : missing;
        case "typecheck": return { cmd: "", skip: "go has no separate type checking step" };
        case "test": return available ? { cmd: "go test ./...", skip: "" } : missing;
        case "build": return available ? { cmd: "go build ./...", skip: "" } : missing;
        case "e2e": return { cmd: "", skip: "no e2e tests configured" };
        default: return { cmd: "", skip: `no ${layer} step configured` };
      }
    }
    case "rust": {
      const available = toolAvailable("cargo --version");
      const missing = { cmd: "", skip: "rust toolchain is not installed" };
      switch (layer) {
        case "lint": return { cmd: "", skip: "no rust lint step configured" };
        case "typecheck": return { cmd: "", skip: "no rust typecheck step configured" };
        case "test": return available ? { cmd: "cargo test", skip: "" } : missing;
        case "build": return available ? { cmd: "cargo build", skip: "" } : missing;
        case "e2e": return { cmd: "", skip: "no e2e tests configured" };
        default: return { cmd: "", skip: `no ${layer} step configured` };
      }
    }
    case "jvm": {
      const maven = existsSync(path.join(cwd, "pom.xml"));
      const gradle = existsSync(path.join(cwd, "build.gradle")) || existsSync(path.join(cwd, "build.gradle.kts"));
      if (layer === "test") {
        if (maven) return toolAvailable("mvn --version") ? { cmd: "mvn test", skip: "" } : { cmd: "", skip: "maven is not installed" };
        if (gradle) return existsSync(path.join(cwd, "gradlew")) ? { cmd: "./gradlew test", skip: "" } : { cmd: "", skip: "gradle wrapper (gradlew) is not present" };
        return { cmd: "", skip: "no jvm build tool detected" };
      }
      return { cmd: "", skip: `no ${layer} step configured` };
    }
    case "dotnet":
      if (layer === "test") return toolAvailable("dotnet --version") ? { cmd: "dotnet test", skip: "" } : { cmd: "", skip: "dotnet is not installed" };
      return { cmd: "", skip: `no ${layer} step configured` };
    default:
      return { cmd: "", skip: "no runtime detected" };
  }
}

function resolveDev(runtime, cwd = ".") {
  if (runtime === "node") {
    const scripts = readNodeScripts(cwd);
    if (typeof scripts.dev === "string" && scripts.dev.trim()) {
      return { cmd: scripts.dev.trim(), skip: "" };
    }
    return { cmd: "", skip: "no dev script in package.json" };
  }
  if (existsSync("docker-compose.yml") || existsSync("docker-compose.yaml")) {
    return { cmd: "docker-compose up", skip: "" };
  }
  return { cmd: "", skip: "no dev server configuration found" };
}

// One-time dependency installation command for the detected stack, or "" when
// the stack has no declarative install step.
export function getInstallCommand() {
  switch (detectRuntime()) {
    case "node": return `${detectPackageManager()} install`;
    case "python": return `pip install -e ".[dev]"`;
    case "go": return "go mod download";
    case "rust": return "cargo fetch";
    default: return "";
  }
}

// Regex that excludes dependency/venv/build dirs from compileall. Must match
// both separators: / on POSIX and \ on Windows paths.
export const PY_COMPILE_EXCLUDE = "(^|[/\\\\])(\\.?venv|env|node_modules|build|dist|__pycache__)([/\\\\]|$)";

// The stack's verification chain for init.sh: an ordered list of steps, each
// with its own allowed exit codes (python's pytest exits 5 when no tests exist,
// which is not a failure). Steps with an args array run without a shell.
export function getVerifyChain() {
  const runtime = detectRuntime();
  switch (runtime) {
    case "node": {
      const scripts = readNodeScripts();
      const pm = detectPackageManager();
      const chain = [];
      const add = (name) => {
        if (typeof scripts[name] === "string" && scripts[name].trim()) {
          chain.push({ cmd: `${pm} run ${name}`, allowedExitCodes: [0] });
        }
      };
      if (scripts.check) add("check");
      else if (scripts.typecheck) add("typecheck");
      else if (scripts["type-check"]) add("type-check");
      add("lint");
      add("test");
      add("build");
      return chain;
    }
    case "python": {
      const py = pythonInterpreter(); // e.g. "python3", "python", or "py -3"
      if (!py) return [];
      const [interpreter, ...flags] = py.split(/\s+/).filter(Boolean);
      // argv steps run without a shell so the regex pipes survive Windows cmd.
      return [
        { cmd: interpreter, args: [...flags, "-m", "pytest", "-q"], allowedExitCodes: [0, 5] },
        { cmd: interpreter, args: [...flags, "-m", "compileall", "-q", "-x", PY_COMPILE_EXCLUDE, "."], allowedExitCodes: [0] },
      ];
    }
    case "go": return [{ cmd: "go test ./...", allowedExitCodes: [0] }];
    case "rust": return [{ cmd: "cargo test", allowedExitCodes: [0] }];
    case "jvm": return [{ cmd: existsSync("pom.xml") ? "mvn test" : "./gradlew test", allowedExitCodes: [0] }];
    case "dotnet": return [{ cmd: "dotnet test", allowedExitCodes: [0] }];
    default: return [];
  }
}

export function buildPayload() {
  const runtime = detectRuntime();
  const layers = {};
  for (const layer of LAYERS) {
    layers[layer] = resolveLayer(runtime, layer);
  }
  return {
    runtime,
    packageManager: detectPackageManager(),
    layers,
    install: getInstallCommand(),
    verify: getVerifyChain(),
  };
}

// ---- CLI ---------------------------------------------------------------

const usage = [
  "usage: node scripts/stack-detect.mjs <mode> [args]",
  "",
  "  runtime           detected stack: node|python|go|rust|jvm|dotnet|none",
  "  package-manager   npm|pnpm|yarn|bun (node stacks only, empty otherwise)",
  "  layer <name>      direct command for lint|typecheck|test|build|e2e|dev, empty if unconfigured",
  "  layer-skip <name> skip reason for the layer, empty if configured",
  "  install           one-time dependency install command, empty if none",
  "  verify            verification chain commands, one per line",
  "  json              full detection payload as JSON",
].join("\n");

function main() {
  const [, , mode, ...rest] = process.argv;
  switch (mode) {
    case "runtime":
      console.log(detectRuntime());
      break;
    case "package-manager":
      console.log(detectPackageManager());
      break;
    case "layer": {
      const layer = rest[0];
      if (!LAYERS.includes(layer)) {
        console.error(`unknown layer ${layer ?? "<none>"} (expected one of ${LAYERS.join(", ")})`);
        process.exit(1);
      }
      console.log(resolveLayer(detectRuntime(), layer).cmd);
      break;
    }
    case "layer-skip": {
      const layer = rest[0];
      if (!LAYERS.includes(layer)) {
        console.error(`unknown layer ${layer ?? "<none>"} (expected one of ${LAYERS.join(", ")})`);
        process.exit(1);
      }
      console.log(resolveLayer(detectRuntime(), layer).skip);
      break;
    }
    case "install":
      console.log(getInstallCommand());
      break;
    case "verify":
      for (const step of getVerifyChain()) console.log(step.cmd);
      break;
    case "json":
      console.log(JSON.stringify(buildPayload(), null, 2));
      break;
    default:
      console.error(usage);
      process.exit(mode === "--help" || mode === "help" ? 0 : 1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
