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

export function detectRuntime() {
  if (existsSync("package.json")) return "node";
  if (existsSync("pyproject.toml") || existsSync("requirements.txt")) return "python";
  if (existsSync("go.mod")) return "go";
  if (existsSync("Cargo.toml")) return "rust";
  if (existsSync("pom.xml") || existsSync("build.gradle") || existsSync("build.gradle.kts")) return "jvm";
  try {
    const dotnet = readdirSync(".").filter((name) => name.endsWith(".csproj") || name.endsWith(".sln"));
    if (dotnet.length > 0) return "dotnet";
  } catch {
    // unreadable directory — treat as unknown
  }
  return "none";
}

export function detectPackageManager() {
  if (!existsSync("package.json")) return "";
  if (existsSync("pnpm-lock.yaml")) return "pnpm";
  if (existsSync("yarn.lock")) return "yarn";
  if (existsSync("bun.lock") || existsSync("bun.lockb")) return "bun";
  return "npm";
}

function toolAvailable(command) {
  try {
    execSync(`${command} --version`, { stdio: "pipe", shell: true });
    return true;
  } catch {
    return false;
  }
}

function pythonInterpreter() {
  for (const candidate of ["python3", "python", "py -3"]) {
    if (toolAvailable(candidate)) return candidate;
  }
  return "";
}

function readNodeScripts() {
  try {
    return JSON.parse(readFileSync("package.json", "utf8")).scripts ?? {};
  } catch {
    return {};
  }
}

// Resolve the direct command for one verification layer in the detected stack.
// Returns { cmd, skip }: cmd is the exact command to execute (for node stacks
// this is the package.json script value, executed directly by run-layer with
// node_modules/.bin on PATH); skip is the human-readable SKIP reason when the
// layer is not configured.
export function resolveLayer(runtime, layer) {
  if (layer === "dev") return resolveDev(runtime);
  switch (runtime) {
    case "node": {
      const scripts = readNodeScripts();
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
          return toolAvailable("ruff") ? { cmd: "ruff check .", skip: "" } : { cmd: "", skip: "ruff is not installed" };
        case "typecheck":
          return toolAvailable("mypy") ? { cmd: "mypy src/", skip: "" } : { cmd: "", skip: "mypy is not installed" };
        case "test":
          return py ? { cmd: `${py} -m pytest -q`, skip: "" } : { cmd: "", skip: "python interpreter not found" };
        case "build":
          return { cmd: "", skip: "no python build step configured" };
        case "e2e":
          return { cmd: "", skip: "no e2e tests configured" };
        default:
          return { cmd: "", skip: `no ${layer} step configured` };
      }
    }
    case "go":
      switch (layer) {
        case "lint": return { cmd: "go vet ./...", skip: "" };
        case "typecheck": return { cmd: "", skip: "go has no separate type checking step" };
        case "test": return { cmd: "go test ./...", skip: "" };
        case "build": return { cmd: "go build ./...", skip: "" };
        case "e2e": return { cmd: "", skip: "no e2e tests configured" };
        default: return { cmd: "", skip: `no ${layer} step configured` };
      }
    case "rust":
      switch (layer) {
        case "lint": return { cmd: "", skip: "no rust lint step configured" };
        case "typecheck": return { cmd: "", skip: "no rust typecheck step configured" };
        case "test": return { cmd: "cargo test", skip: "" };
        case "build": return { cmd: "cargo build", skip: "" };
        case "e2e": return { cmd: "", skip: "no e2e tests configured" };
        default: return { cmd: "", skip: `no ${layer} step configured` };
      }
    case "jvm": {
      const maven = existsSync("pom.xml");
      if (layer === "test") return { cmd: maven ? "mvn test" : "./gradlew test", skip: "" };
      return { cmd: "", skip: `no ${layer} step configured` };
    }
    case "dotnet":
      if (layer === "test") return { cmd: "dotnet test", skip: "" };
      return { cmd: "", skip: `no ${layer} step configured` };
    default:
      return { cmd: "", skip: "no runtime detected" };
  }
}

function resolveDev(runtime) {
  if (runtime === "node") {
    const scripts = readNodeScripts();
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

// The stack's verification chain for init.sh: an ordered list of steps, each
// with its own allowed exit codes (python's pytest exits 5 when no tests exist,
// which is not a failure).
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
      const py = pythonInterpreter();
      if (!py) return [];
      const compileRegex = "(^|/)(\\.?venv|env|node_modules|build|dist|__pycache__)(/|$)";
      return [
        { cmd: `${py} -m pytest -q`, allowedExitCodes: [0, 5] },
        { cmd: `${py} -m compileall -q -x '${compileRegex}' .`, allowedExitCodes: [0] },
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
