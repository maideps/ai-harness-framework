import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

// feat-027: the framework's own productRoots (publish.yml, repo-completion-plan.md) used to
// land in every new adopter's manifest, exempting files the adopter does not have.
test("adopt: a brand-new target starts with empty productRoots and the framework's classification", () => {
  const root = fixture("manifest");
  try {
    adopt(root, { skipExisting: true });
    const manifest = JSON.parse(readFileSync(path.join(root, ".harness", "manifest.json"), "utf8"));
    const frameworkManifest = JSON.parse(readFileSync(path.join(HARNESS_ROOT, ".harness", "manifest.json"), "utf8"));

    assert.deepEqual(manifest.productRoots, []);
    assert.deepEqual({ ...manifest, productRoots: frameworkManifest.productRoots }, frameworkManifest);
  } finally {
    cleanup(root);
  }
});

test("adopt: an existing adopter manifest keeps its productRoots", () => {
  const root = fixture("existing-manifest");
  try {
    adopt(root, { skipExisting: true });
    const manifestPath = path.join(root, ".harness", "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.productRoots = ["src/"];
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    adopt(root, { skipExisting: true });

    assert.deepEqual(JSON.parse(readFileSync(manifestPath, "utf8")).productRoots, ["src/"]);
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

const NODE_FEATURE = "ghcr.io/devcontainers/features/node:1";

function devcontainerOf(root) {
  return JSON.parse(readFileSync(path.join(root, ".devcontainer", "devcontainer.json"), "utf8"));
}

test("adopt: the devcontainer component is opt-in and pins Node to the project's .nvmrc", () => {
  const plain = fixture("no-devcontainer");
  const root = fixture("devcontainer");
  try {
    adopt(plain);
    assert.ok(!existsSync(path.join(plain, ".devcontainer")));

    adopt(root, { components: ["devcontainer"] });
    const config = devcontainerOf(root);
    const nvmrc = readFileSync(path.join(HARNESS_ROOT, "templates", "nvmrc"), "utf8").trim();
    assert.deepEqual(config.features[NODE_FEATURE], { version: nvmrc });
    assert.ok("ghcr.io/anthropics/devcontainer-features/claude-code:1" in config.features);
    assert.equal(config.postCreateCommand, "bash .devcontainer/post-create.sh");
    // A fresh adopter is detected as node (the harness package.json), which needs no extra toolchain.
    assert.equal(Object.keys(config.features).filter((id) => id.includes("/python:") || id.includes("/go:")).length, 0);

    const postCreate = readFileSync(path.join(root, ".devcontainer", "post-create.sh"), "utf8");
    assert.ok(postCreate.startsWith("#!/bin/bash\n"));
    assert.match(postCreate, /npm install -g @openai\/codex @google\/gemini-cli/);
    assert.match(postCreate, /\.\/init\.sh/);
    assert.match(postCreate, /bash \.devcontainer\/register-mcp\.sh/);
    assert.ok(existsSync(path.join(root, ".devcontainer", "register-mcp.sh")));
  } finally {
    cleanup(plain);
    cleanup(root);
  }
});

test("adopt: the devcontainer gets the toolchain feature of the product already in the target", () => {
  const cases = [
    ["pyproject.toml", "ghcr.io/devcontainers/features/python:1", {}],
    ["go.mod", "ghcr.io/devcontainers/features/go:1", {}],
    ["Cargo.toml", "ghcr.io/devcontainers/features/rust:1", {}],
    ["pom.xml", "ghcr.io/devcontainers/features/java:1", { installMaven: "true" }],
    ["build.gradle.kts", "ghcr.io/devcontainers/features/java:1", { installGradle: "true" }],
    ["app.csproj", "ghcr.io/devcontainers/features/dotnet:2", {}],
  ];
  for (const [marker, feature, options] of cases) {
    const root = fixture(`devcontainer-${marker.replace(/\W/g, "")}`);
    try {
      writeFileSync(path.join(root, marker), "", "utf8");
      adopt(root, { skipExisting: true, components: ["devcontainer"] });
      assert.deepEqual(devcontainerOf(root).features[feature], options, marker);
    } finally {
      cleanup(root);
    }
  }
});

test("adopt: activating the devcontainer later never rewrites one the adopter already edited", () => {
  const root = fixture("devcontainer-edited");
  try {
    adopt(root, { skipExisting: true, components: ["devcontainer"] });
    const file = path.join(root, ".devcontainer", "devcontainer.json");
    const edited = `${JSON.stringify({ name: "mine", image: "custom", features: {} }, null, 2)}\n`;
    writeFileSync(file, edited, "utf8");
    writeFileSync(path.join(root, "pyproject.toml"), "", "utf8");
    adopt(root, { skipExisting: true, components: ["devcontainer"] });
    assert.equal(readFileSync(file, "utf8"), edited);
  } finally {
    cleanup(root);
  }
});

test("adopt: the mcp component is opt-in and gives Claude Code and Gemini the same servers", () => {
  const plain = fixture("no-mcp");
  const root = fixture("mcp");
  try {
    adopt(plain);
    assert.ok(!existsSync(path.join(plain, ".mcp.json")));
    assert.ok(!existsSync(path.join(plain, ".gemini")));

    adopt(root, { components: ["mcp"] });
    const claude = JSON.parse(readFileSync(path.join(root, ".mcp.json"), "utf8"));
    const gemini = JSON.parse(readFileSync(path.join(root, ".gemini", "settings.json"), "utf8"));
    assert.deepEqual(claude.mcpServers.context7, { command: "npx", args: ["-y", "@upstash/context7-mcp"] });
    assert.deepEqual(gemini.mcpServers, claude.mcpServers);
    // The mcp component alone brings no dev container.
    assert.ok(!existsSync(path.join(root, ".devcontainer")));
  } finally {
    cleanup(plain);
    cleanup(root);
  }
});

// register-mcp.sh is bash; on Windows `bash` may resolve to WSL, which cannot see this
// fixture's paths, so the run is left to the Linux CI job.
test("register-mcp.sh registers every command server in .mcp.json with codex", { skip: process.platform === "win32" }, () => {
  const root = fixture("register-mcp");
  try {
    adopt(root, { components: ["devcontainer", "mcp"] });
    const bin = path.join(root, "fake-bin");
    mkdirSync(bin);
    const log = path.join(root, "codex-calls.txt");
    writeFileSync(path.join(bin, "codex"), `#!/bin/bash\necho "$*" >> "${log}"\n`, { mode: 0o755 });
    const config = JSON.parse(readFileSync(path.join(root, ".mcp.json"), "utf8"));
    config.mcpServers.remote = { type: "http", url: "https://example.invalid/mcp" };
    writeFileSync(path.join(root, ".mcp.json"), JSON.stringify(config), "utf8");

    const result = spawnSync("bash", [".devcontainer/register-mcp.sh"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
    });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal(readFileSync(log, "utf8"), "mcp add context7 -- npx -y @upstash/context7-mcp\n");
  } finally {
    cleanup(root);
  }
});

// feat-028: a python adopter's CI failed in `npm run setup` because the workflow only set up
// Node and the runner's system Python refuses `pip install` (PEP 668).
function ciWorkflowOf(root) {
  return readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
}

test("adopt: a python product's CI workflow sets up Python before the setup step", () => {
  const root = fixture("ci-python");
  try {
    writeFileSync(path.join(root, "pyproject.toml"), "", "utf8");
    adopt(root, { skipExisting: true });
    const workflow = ciWorkflowOf(root);
    assert.match(workflow, /- uses: actions\/setup-python@v5\n\s+with:\n\s+python-version: "3\.12"\n/);
    assert.ok(workflow.indexOf("setup-node") < workflow.indexOf("setup-python"));
    assert.ok(workflow.indexOf("setup-python") < workflow.indexOf("npm run setup --if-present"));
  } finally {
    cleanup(root);
  }
});

test("adopt: the CI workflow takes the Python version from .python-version when present", () => {
  const root = fixture("ci-python-version");
  try {
    writeFileSync(path.join(root, "requirements.txt"), "", "utf8");
    writeFileSync(path.join(root, ".python-version"), "3.11\n", "utf8");
    adopt(root, { skipExisting: true });
    assert.match(ciWorkflowOf(root), /python-version-file: \.python-version\n/);
  } finally {
    cleanup(root);
  }
});

test("adopt: other stacks and an existing CI workflow get no setup-python step", () => {
  const goRoot = fixture("ci-go");
  const existingRoot = fixture("ci-existing");
  try {
    writeFileSync(path.join(goRoot, "go.mod"), "", "utf8");
    adopt(goRoot, { skipExisting: true });
    assert.equal(ciWorkflowOf(goRoot), readFileSync(path.join(HARNESS_ROOT, "templates", "ci.yml"), "utf8"));

    const own = "name: mine\n";
    mkdirSync(path.join(existingRoot, ".github", "workflows"), { recursive: true });
    writeFileSync(path.join(existingRoot, ".github", "workflows", "ci.yml"), own, "utf8");
    writeFileSync(path.join(existingRoot, "pyproject.toml"), "", "utf8");
    adopt(existingRoot, { skipExisting: true });
    assert.equal(ciWorkflowOf(existingRoot), own);
  } finally {
    cleanup(goRoot);
    cleanup(existingRoot);
  }
});
