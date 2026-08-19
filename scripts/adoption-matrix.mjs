#!/usr/bin/env node

// Adoption matrix + customization-survival upgrade test (feat-004).
//
// Generates throwaway adopter repositories from the seam manifest — CORE files
// as-is, templates placed per their {from, to} mapping, docs filled — then runs
// the harness in each: architecture check, product layer chain, and a full
// feature cycle through verify-feature. Cells whose toolchain is absent report
// SKIP (honest degradation) instead of failing. The upgrade test adopts,
// customizes, simulates a harness upgrade, and asserts the customizations
// survive while mustNotEdit surfaces are refreshed (D-010).

import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { HARNESS_ROOT, adopt, loadManifest } from "./create-harness.mjs";
import { upgrade as upgradeHarness } from "./harness-upgrade.mjs";

const RUNNER = path.join(HARNESS_ROOT, "scripts", "framework-check.mjs");

function buildAdopter(stage, stack) {
  const root = mkdtempSync(path.join(os.tmpdir(), `cw-adopt-${stage}-${stack}-`));
  adopt(root);
  fillDocs(root, stack);
  addProduct(root, stack);
  return root;
}

function fillDocs(root, stack) {
  const write = (rel, content) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content, "utf8");
  };
  write(
    "README.md",
    `# Adopted Project (${stack})\n\nThrowaway adoption-matrix fixture for the ${stack} cell.\n\n## Quick Start\n\n\`\`\`bash\n./init.sh\nmake check\n\`\`\`\n`,
  );
  write(
    "docs/PRODUCT.md",
    `# Product Overview\n\nPurpose: adoption-matrix fixture (${stack} cell).\n\n## Primary Users\n\n- The adoption matrix\n\n## Key User Flows\n\n- Boot and verify\n`,
  );
  write(
    "docs/quality-document.md",
    `# Quality Document\n\nRate each module on a scale of A/B/C/D.\n\n## Modules\n\n- Adopted surface: B\n\n## Summary\n\n- Overall Quality Grade: B\n- Blockers: none\n`,
  );
}

function addProduct(root, stack) {
  const write = (rel, content) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content, "utf8");
  };
  const manifestPath = path.join(root, ".harness", "manifest.json");
  const setProductRoots = (roots) => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.productRoots = roots;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  };
  switch (stack) {
    case "node": {
      write("src/app.js", "module.exports = { ok: true };\n");
      const pkgPath = path.join(root, "package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      pkg.scripts["app:test"] = "node -e \"require('./src/app.js'); console.log('product tests ok')\"";
      writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
      setProductRoots(["src/"]);
      break;
    }
    case "python": {
      write("pyproject.toml", "[project]\nname = \"adopt-fixture\"\nversion = \"0.1.0\"\nrequires-python = \">=3.8\"\n");
      write("tests/test_smoke.py", "def test_smoke():\n    assert 1 + 1 == 2\n");
      setProductRoots(["tests/"]);
      break;
    }
    case "go": {
      write("go.mod", "module adopt-fixture\n\ngo 1.21\n");
      write("main.go", "package main\n\nfunc main() {}\n");
      setProductRoots(["main.go"]);
      break;
    }
    case "rust": {
      write("Cargo.toml", "[package]\nname = \"adopt-fixture\"\nversion = \"0.1.0\"\nedition = \"2021\"\n");
      setProductRoots(["src/"]);
      break;
    }
    default:
      break;
  }
}

function fillFeatureList(root) {
  const feature = {
    id: "feat-001",
    name: "Adoption Smoke Feature",
    behavior: "Prove the harness runs a full feature cycle in this adopted repository.",
    verification: "verify-feature runs all layers and records evidence.",
    dependencies: [],
    state: "active",
    evidence: "",
    layers: [
      { label: "Layer 1: Static checks", cmd: "npm run lint", repair: "Fix static-analysis issues and rerun the layer command." },
      { label: "Layer 2: Runtime tests", cmd: "npm run test", repair: "Fix failing tests and rerun the layer command." },
      { label: "Layer 3: System confirmation", cmd: "npm run check", repair: "Resolve remaining issues and rerun full verification." },
    ],
  };
  writeFileSync(path.join(root, "feature_list.json"), `${JSON.stringify({ features: [feature] }, null, 2)}\n`, "utf8");
}

function spawnRunner(root, args, timeoutMs = 180000) {
  const result = spawnSync(process.execPath, [RUNNER, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env, CW_ADOPTION_CELL: "1" },
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const exit = result.error ? 1 : (result.status ?? 1);
  if (result.error) stderr += `\n${result.error.message}`;
  return { exit, output: `${stdout}${stderr}` };
}

function skipLines(output) {
  return output
    .split(/\r?\n/)
    .filter((line) => line.includes("[SKIP]"))
    .map((line) => line.trim());
}

function runCell(stack) {
  let root = "";
  try {
    root = buildAdopter("matrix", stack);
    fillFeatureList(root);
    const checkArch = spawnRunner(root, ["check-arch"]);
    const lint = spawnRunner(root, ["run-layer", "lint"]);
    const test = spawnRunner(root, ["run-layer", "test"]);
    const featureCycle = spawnRunner(root, ["verify-feature", "feat-001"]);
    const skips = [...skipLines(lint.output), ...skipLines(test.output)];
    return {
      stack,
      checkArch: checkArch.exit,
      lint: lint.exit,
      test: test.exit,
      featureCycle: featureCycle.exit,
      skips,
      featureCycleOutput: featureCycle.output,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ---- Customization-survival upgrade test ---------------------------------

function runUpgradeTest() {
  const root = buildAdopter("upgrade", "node");
  try {
    const write = (rel, content) => {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      writeFileSync(path.join(root, rel), content, "utf8");
    };
    // Adopter customizations across every customizable surface
    appendFileSync(path.join(root, "README.md"), "\n## Custom Section\nPROJECT-SPECIFIC LINE\n", "utf8");
    const featureListPath = path.join(root, "feature_list.json");
    const featureList = JSON.parse(readFileSync(featureListPath, "utf8"));
    featureList.features[0].name = "Customized Feature Name";
    writeFileSync(featureListPath, `${JSON.stringify(featureList, null, 2)}\n`, "utf8");
    const manifestPath = path.join(root, ".harness", "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.productRoots = ["src/", "custom/"];
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    appendFileSync(path.join(root, "Makefile"), "\n## Custom target\ncustom:\n\t@echo custom\n", "utf8");
    const pkgPath = path.join(root, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    pkg.scripts.custom = "echo custom";
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
    write(
      "skills/project-skill/SKILL.md",
      "---\nname: project-skill\ndescription: An adopter-owned project skill that must survive upgrades.\n---\n# Project Skill\n\n## When to Use\n\n- Project-specific work\n",
    );
    write("src/main.js", "// adopter product code\n");
    write("custom/note.txt", "adopter-owned\n");
    // Corrupt a mustNotEdit surface so the upgrade must visibly restore it
    appendFileSync(path.join(root, "scripts", "framework-check.mjs"), "\n// CORRUPTED BY ADOPTER EDIT\n", "utf8");

    // Assertions: customizations survived, corrupted surface was restored
    const assertions = [];
    const check = (ok, message) => assertions.push({ ok, message });

    // Simulated upgrade: the real distribution tool (dogfooding feat-006)
    const report = upgradeHarness(root);
    check(report.overwritten.length > 0, `upgrade overwrote ${report.overwritten.length} mustNotEdit surface(s)`);
    check(!readFileSync(path.join(root, "scripts", "framework-check.mjs"), "utf8").includes("CORRUPTED BY ADOPTER EDIT"), "upgrade restored the corrupted runner");
    check(readFileSync(path.join(root, "README.md"), "utf8").includes("PROJECT-SPECIFIC LINE"), "README customization survived");
    check(JSON.parse(readFileSync(featureListPath, "utf8")).features[0].name === "Customized Feature Name", "feature content survived");
    check(JSON.parse(readFileSync(manifestPath, "utf8")).productRoots.join(",") === "src/,custom/", "manifest productRoots survived");
    check(readFileSync(path.join(root, "Makefile"), "utf8").includes("## Custom target"), "extra Makefile target survived");
    check(JSON.parse(readFileSync(pkgPath, "utf8")).scripts.custom === "echo custom", "extra package.json script survived");
    check(existsSync(path.join(root, "skills", "project-skill", "SKILL.md")), "project skill survived");
    check(existsSync(path.join(root, "src", "main.js")), "product code survived");
    check(existsSync(path.join(root, "custom", "note.txt")), "productRoots content survived");

    const checkArch = spawnRunner(root, ["check-arch"]);
    const featureCycle = spawnRunner(root, ["verify-feature", "feat-001"]);
    check(checkArch.exit === 0, `check-arch passes after upgrade (exit ${checkArch.exit})`);
    check(featureCycle.exit === 0, `feature cycle passes after upgrade (exit ${featureCycle.exit})`);

    const failedAssertions = assertions.filter((assertion) => !assertion.ok);
    for (const assertion of failedAssertions) {
      console.log(`    [FAIL] ${assertion.message}`);
    }
    return { ok: failedAssertions.length === 0, assertions };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ---- Multi-repo component test (feat-005) ---------------------------------

function runMultiRepoTest() {
  const root = buildAdopter("multirepo", "none");
  try {
    // Activate the component: place every multi-repo skeleton at its declared
    // destination (the manifest's optional-marker entries).
    const manifest = loadManifest();
    const optionalPrefixes = ["contracts/", "tasks/", "repositories/", "scripts/verify-all"];
    for (const entry of manifest.templates) {
      if (typeof entry === "string" || entry.keep) continue;
      if (!optionalPrefixes.some((prefix) => entry.to.startsWith(prefix) || entry.to === prefix)) continue;
      const src = path.join(HARNESS_ROOT, entry.from);
      const dest = path.join(root, entry.to);
      mkdirSync(path.dirname(dest), { recursive: true });
      copyFileSync(src, dest);
    }
    // Two working subrepos with real checks
    const verifyScript = "#!/usr/bin/env node\nconst { spawnSync } = require(\"node:child_process\");\nconst path = require(\"node:path\");\nconst result = spawnSync(process.execPath, [path.join(__dirname, \"check.js\")], { stdio: \"inherit\" });\nprocess.exit(result.error ? 1 : (result.status ?? 1));\n";
    const goodCheck = "const ok = 1 + 1 === 2;\nif (!ok) { console.log(\"[FAIL] arithmetic\"); process.exit(1); }\nconsole.log(\"[PASS] check\");\n";
    for (const repo of ["app", "lib"]) {
      const dir = path.join(root, "repositories", repo);
      mkdirSync(path.join(dir, "scripts"), { recursive: true });
      writeFileSync(path.join(dir, "scripts", "verify"), verifyScript, "utf8");
      writeFileSync(path.join(dir, "scripts", "check.js"), goodCheck, "utf8");
    }
    // Git index so the classification coverage check actually runs
    const gitInit = spawnSync("git", ["init", "-q"], { cwd: root });
    const gitAdd = () => spawnSync("git", ["add", "-A"], { cwd: root });
    gitAdd();

    const assertions = [];
    const check = (ok, message) => assertions.push({ ok, message });

    const checkArch = spawnRunner(root, ["check-arch"]);
    check(checkArch.exit === 0, `check-arch passes with the component active (exit ${checkArch.exit})`);
    const verifyAll = spawnRunner(root, ["verify-all"]);
    check(verifyAll.exit === 0, `verify-all passes all subrepos (exit ${verifyAll.exit})`);

    // Negative: a failing subrepo fails verify-all
    writeFileSync(path.join(root, "repositories", "lib", "scripts", "check.js"), "process.exit(1);\n", "utf8");
    const verifyAllFail = spawnRunner(root, ["verify-all"]);
    check(verifyAllFail.exit === 1, `verify-all fails when a subrepo fails (exit ${verifyAllFail.exit})`);
    writeFileSync(path.join(root, "repositories", "lib", "scripts", "check.js"), goodCheck, "utf8");

    // Negative: an unclassified file fails arch-005 coverage
    writeFileSync(path.join(root, "stray.txt"), "unclassified\n", "utf8");
    gitAdd();
    const coverageFail = spawnRunner(root, ["check-arch"]);
    check(coverageFail.exit === 1, `arch-005 rejects unclassified files (exit ${coverageFail.exit})`);
    rmSync(path.join(root, "stray.txt"), { force: true });
    gitAdd();
    const coverageRestored = spawnRunner(root, ["check-arch"]);
    check(coverageRestored.exit === 0, `arch-005 passes again after the stray file is removed (exit ${coverageRestored.exit})`);

    const failedAssertions = assertions.filter((assertion) => !assertion.ok);
    for (const assertion of failedAssertions) {
      console.log(`    [FAIL] ${assertion.message}`);
    }
    if (verifyAll.exit !== 0) {
      console.log("    --- verify-all output (last 15 lines) ---");
      verifyAll.output.split(/\r?\n/).slice(-15).forEach((line) => console.log(`    | ${line}`));
    }
    return { ok: failedAssertions.length === 0, assertions, gitInit: gitInit.status ?? 0 };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ---- Entry point ----------------------------------------------------------

function main() {
  console.log("=== Adoption Matrix ===");
  const cells = ["none", "node", "python", "go", "rust"];
  let failures = 0;
  for (const stack of cells) {
    const result = runCell(stack);
    const ok =
      result.checkArch === 0 &&
      result.lint === 0 &&
      result.test === 0 &&
      result.featureCycle === 0;
    if (!ok) failures += 1;
    console.log(
      `  [${ok ? "PASS" : "FAIL"}] ${stack}: check-arch=${result.checkArch} lint=${result.lint} test=${result.test} feature-cycle=${result.featureCycle}`,
    );
    for (const skip of result.skips) {
      console.log(`         ${skip}`);
    }
    if (result.featureCycle !== 0) {
      console.log(result.featureCycleOutput
        .split(/\r?\n/)
        .slice(-8)
        .map((line) => `         | ${line}`)
        .join("\n"));
    }
  }

  console.log("=== Customization-Survival Upgrade Test ===");
  const upgrade = runUpgradeTest();
  if (upgrade.ok) {
    console.log("  [PASS] customizations survive a simulated harness upgrade");
  } else {
    failures += 1;
    console.log("  [FAIL] upgrade test failed — see assertions above");
  }

  console.log("=== Multi-repo Component Test ===");
  const multiRepo = runMultiRepoTest();
  if (multiRepo.ok) {
    console.log("  [PASS] multi-repo component: verify-all aggregates, degrades, and arch-005 stays honest");
  } else {
    failures += 1;
    console.log("  [FAIL] multi-repo test failed — see assertions above");
  }

  console.log("");
  if (failures > 0) {
    console.log(`=== E2E: ${failures} FAILURE(S) ===`);
    process.exit(1);
  }
  console.log("=== E2E: ALL CELLS PASS (per-cell SKIPs reported honestly above) ===");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
