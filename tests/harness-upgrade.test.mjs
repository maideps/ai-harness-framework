import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { missingHarnessScripts, missingMakeTargets, upgrade } from "../scripts/harness-upgrade.mjs";

// These tests also run inside adopters (tests/ is CORE), where the harness root is the adopter
// itself: they compare against whatever harness root they run in, never against fixed content.
const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const harnessFile = (rel) => readFileSync(path.join(HARNESS_ROOT, rel), "utf8");

function tempDir() {
  return mkdtempSync(path.join(os.tmpdir(), "cw-harness-upgrade-"));
}

function write(root, rel, content) {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), content);
}

function adopter() {
  const root = tempDir();
  write(root, "package.json", `${JSON.stringify({ name: "adopter", scripts: {} }, null, 2)}\n`);
  // As an older harness shipped them.
  write(root, "tests/framework-check.test.mjs", "// tests from an older harness\n");
  write(root, "templates/ci.yml", "# an older CI skeleton\n");
  write(root, "templates/sprint-contract.md", "# Our own sprint contract\n");
  write(root, ".harness/manifest.json", `${JSON.stringify({
    harness: "old",
    version: "0.0.1",
    core: ["scripts/"],
    instance: ["README.md"],
    templates: [],
    productRoots: ["app/", "web/"],
    featureIdPattern: "^ours-\\d+$",
  }, null, 2)}\n`);
  return root;
}

test("harness-upgrade: refreshes the runner's own tests along with the runner (feat-019)", () => {
  const root = adopter();
  try {
    const report = upgrade(root);
    assert.ok(report.overwritten.includes("tests/"), JSON.stringify(report.overwritten));
    assert.equal(readFileSync(path.join(root, "tests/framework-check.test.mjs"), "utf8"), harnessFile("tests/framework-check.test.mjs"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// feat-029: frameworkRepository makes the test and e2e layers run the harness's own unit tests
// and adoption matrix; it must never reach an adopter through an upgrade.
test("harness-upgrade: never marks an adopter as the framework repository", () => {
  const root = adopter();
  try {
    upgrade(root);
    const theirs = JSON.parse(readFileSync(path.join(root, ".harness/manifest.json"), "utf8"));
    assert.ok(!("frameworkRepository" in theirs), JSON.stringify(theirs.frameworkRepository));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("harness-upgrade: refreshes template skeletons but keeps the customisable templates", () => {
  const root = adopter();
  try {
    upgrade(root);
    assert.equal(readFileSync(path.join(root, "templates/ci.yml"), "utf8"), harnessFile("templates/ci.yml"));
    assert.equal(readFileSync(path.join(root, "templates/sprint-contract.md"), "utf8"), "# Our own sprint contract\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("harness-upgrade: updates the manifest classification and keeps the adopter's own keys", () => {
  const root = adopter();
  try {
    const report = upgrade(root);
    const ours = JSON.parse(harnessFile(".harness/manifest.json"));
    const theirs = JSON.parse(readFileSync(path.join(root, ".harness/manifest.json"), "utf8"));
    for (const key of ["harness", "version", "core", "instance", "templates", "optionalComponents", "customizationPoints"]) {
      assert.deepEqual(theirs[key], ours[key], key);
    }
    assert.deepEqual(theirs.productRoots, ["app/", "web/"]);
    assert.equal(theirs.featureIdPattern, "^ours-\\d+$");
    assert.ok(report.overwritten.some((surface) => surface.startsWith(".harness/manifest.json")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("harness-upgrade: creates missing instance files from templates, never overwrites, never optional ones", () => {
  const root = adopter();
  write(root, "LICENSE", "Copyright (c) Adopter\n");
  try {
    const report = upgrade(root);
    const manifest = JSON.parse(harnessFile(".harness/manifest.json"));
    const gitattributes = manifest.templates.find((entry) => entry.to === ".gitattributes");
    if (gitattributes && manifest.instance.includes(".gitattributes")) {
      assert.ok(report.created.includes(".gitattributes"), JSON.stringify(report.created));
      assert.equal(readFileSync(path.join(root, ".gitattributes"), "utf8"), harnessFile(gitattributes.from));
    }
    assert.equal(readFileSync(path.join(root, "LICENSE"), "utf8"), "Copyright (c) Adopter\n");
    assert.ok(!report.created.includes("LICENSE"));
    assert.ok(!report.created.some((file) => file.startsWith("repositories/")), JSON.stringify(report.created));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---- feat-032 (D-043): --dry-run plans the upgrade and writes nothing -----

// Every file under root with its content, so a test can prove nothing changed.
function snapshotTree(root, rel = "") {
  const files = {};
  for (const entry of readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(files, snapshotTree(root, relPath));
    else files[relPath] = readFileSync(path.join(root, relPath), "utf8");
  }
  return files;
}

test("harness-upgrade --dry-run: writes nothing, takes no backup, and reports the plan a real run applies", () => {
  const root = adopter();
  write(root, ".claude/settings.json", "{}\n");
  try {
    const before = snapshotTree(root);
    const dry = upgrade(root, { dryRun: true });
    assert.deepEqual(snapshotTree(root), before, "a dry run must leave every file byte-identical");
    assert.ok(!existsSync(path.join(root, ".harness", "backups")), "a dry run takes no backup");
    assert.equal(dry.dryRun, true);
    assert.equal(dry.backup.reason, "dry run");
    assert.ok(dry.files.added.length > 0, "a bare adopter is missing framework files");
    assert.ok(dry.files.updated.includes("tests/framework-check.test.mjs"), JSON.stringify(dry.files.updated));

    const real = upgrade(root);
    assert.equal(real.dryRun, false);
    assert.deepEqual(real.files, dry.files);
    assert.deepEqual(real.created, dry.created);
    assert.deepEqual(real.overwritten, dry.overwritten);
    for (const file of [...dry.files.added, ...dry.files.updated]) {
      assert.ok(existsSync(path.join(root, file)), `the real run did not write ${file}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("harness-upgrade: a second upgrade reports nothing to change, and an edited CORE file as an update", () => {
  const root = adopter();
  try {
    upgrade(root);
    const again = upgrade(root, { dryRun: true });
    assert.deepEqual(again.files.updated, []);
    assert.deepEqual(again.files.added, []);
    assert.ok(again.files.unchanged > 0);

    write(root, "scripts/framework-check.mjs", "// edited against policy\n");
    const edited = upgrade(root, { dryRun: true });
    assert.deepEqual(edited.files.updated, ["scripts/framework-check.mjs"]);
    // Line endings alone are not a change.
    write(root, "scripts/framework-check.mjs", harnessFile("scripts/framework-check.mjs").replace(/\r?\n/g, "\r\n"));
    assert.deepEqual(upgrade(root, { dryRun: true }).files.updated, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("harness-upgrade CLI: --dry-run prints the plan and writes nothing; an unknown option fails", () => {
  const root = adopter();
  const cli = (args) => spawnSync(process.execPath, [path.join(HARNESS_ROOT, "scripts", "harness-upgrade.mjs"), ...args], { encoding: "utf8" });
  try {
    const before = snapshotTree(root);
    const dry = cli([root, "--dry-run"]);
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /dry run: nothing was written/);
    assert.match(dry.stdout, /Framework-owned files: \d+ would change, \d+ would be added, \d+ unchanged/);
    assert.match(dry.stdout, /update {2}tests\/framework-check\.test\.mjs/);
    assert.match(dry.stdout, /Nothing was written\. Apply with:/);
    assert.deepEqual(snapshotTree(root), before);

    const bad = cli([root, "--dryrun"]);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /unknown option --dryrun/);
    assert.deepEqual(snapshotTree(root), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// feat-031 (D-042): older harnesses wrote .claude/settings.json as {}. That placeholder was
// never customised, so an upgrade replaces it; anything else is the adopter's.
test("harness-upgrade: replaces an untouched {} .claude/settings.json and reports it", () => {
  const manifest = JSON.parse(harnessFile(".harness/manifest.json"));
  const entry = manifest.templates.find((item) => item.to === ".claude/settings.json");
  if (!entry || !manifest.instance.includes(".claude/settings.json")) return; // a harness without the template
  for (const placeholder of ["{}\n", "{}", "  {}\r\n"]) {
    const root = adopter();
    write(root, ".claude/settings.json", placeholder);
    try {
      const report = upgrade(root);
      assert.ok(report.created.includes(".claude/settings.json"), JSON.stringify(report.created));
      assert.equal(readFileSync(path.join(root, ".claude/settings.json"), "utf8"), harnessFile(entry.from));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("harness-upgrade: never touches a customised .claude/settings.json", () => {
  const root = adopter();
  const own = `${JSON.stringify({ permissions: { deny: ["Read(./secrets/**)"] } }, null, 2)}\n`;
  write(root, ".claude/settings.json", own);
  try {
    const report = upgrade(root);
    assert.ok(!report.created.includes(".claude/settings.json"), JSON.stringify(report.created));
    assert.equal(readFileSync(path.join(root, ".claude/settings.json"), "utf8"), own);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("harness-upgrade: backfills .harness/trails/.gitkeep so a fresh clone keeps the directory (#26)", () => {
  const root = adopter();
  try {
    const report = upgrade(root);
    assert.ok(report.created.includes(".harness/trails/.gitkeep"), JSON.stringify(report.created));
    assert.equal(readFileSync(path.join(root, ".harness/trails/.gitkeep"), "utf8"), "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("harness-upgrade: leaves .harness/trails/ alone once it already holds real trail files", () => {
  const root = adopter();
  write(root, ".harness/trails/vcr-20260101T000000.json", "{}\n");
  try {
    const report = upgrade(root);
    assert.ok(!report.created.includes(".harness/trails/.gitkeep"), JSON.stringify(report.created));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("missingHarnessScripts: lists harness commands the adopter lacks, never its own variants", () => {
  const harness = tempDir();
  const root = tempDir();
  write(harness, "package.json", JSON.stringify({
    scripts: {
      lint: "node scripts/framework-check.mjs lint",
      "harness-docs": "node scripts/harness-docs.mjs",
      activate: "node scripts/framework-check.mjs activate",
      prepublishOnly: "npm run check",
    },
  }));
  const adopterPackage = `${JSON.stringify({ scripts: { lint: "node scripts/framework-check.mjs lint && eslint ." } }, null, 2)}\n`;
  write(root, "package.json", adopterPackage);
  try {
    assert.deepEqual(missingHarnessScripts(root, harness), [
      { name: "harness-docs", command: "node scripts/harness-docs.mjs" },
      { name: "activate", command: "node scripts/framework-check.mjs activate" },
    ]);
    assert.equal(readFileSync(path.join(root, "package.json"), "utf8"), adopterPackage);
  } finally {
    rmSync(harness, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("missingMakeTargets: gives each missing target with its help lines and recipe, never edits", () => {
  const harness = tempDir();
  const root = tempDir();
  write(harness, "Makefile", [
    ".PHONY: check activate",
    "",
    "## Full verification",
    "check:",
    "\t@node scripts/framework-check.mjs check",
    "",
    "## Activate a feature after its dependencies pass.",
    "## Usage: make activate F=<feature-id>",
    "activate:",
    "\t@node scripts/framework-check.mjs activate $(F)",
    "",
  ].join("\n"));
  const ours = "check:\n\t@npm run check\n";
  write(root, "Makefile", ours);
  try {
    assert.deepEqual(missingMakeTargets(root, harness), [
      {
        target: "activate",
        block: [
          "## Activate a feature after its dependencies pass.",
          "## Usage: make activate F=<feature-id>",
          "activate:",
          "\t@node scripts/framework-check.mjs activate $(F)",
        ].join("\n"),
      },
    ]);
    assert.equal(readFileSync(path.join(root, "Makefile"), "utf8"), ours);
  } finally {
    rmSync(harness, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("missingHarnessScripts: nothing to report without a package.json", () => {
  const root = tempDir();
  try {
    assert.deepEqual(missingHarnessScripts(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("harness-upgrade: refreshes the shipped skills and never touches a project skill (feat-026)", () => {
  const root = adopter();
  try {
    write(root, "skills/verification/SKILL.md", "# verification skill from an older harness\n");
    write(root, "skills/our-deploy/SKILL.md", "# our own project skill\n");
    const report = upgrade(root);
    const shipped = JSON.parse(harnessFile(".harness/manifest.json")).shippedSkills;
    assert.ok(shipped.includes("verification"));
    assert.ok(report.overwritten.includes("skills/verification/"), JSON.stringify(report.overwritten));
    for (const name of shipped) {
      assert.equal(readFileSync(path.join(root, "skills", name, "SKILL.md"), "utf8"), harnessFile(`skills/${name}/SKILL.md`));
    }
    assert.equal(readFileSync(path.join(root, "skills/our-deploy/SKILL.md"), "utf8"), "# our own project skill\n");
    assert.deepEqual(JSON.parse(readFileSync(path.join(root, ".harness/manifest.json"), "utf8")).shippedSkills, shipped);
    // The older copy is in the backup, as for every other surface the upgrade overwrites.
    const backup = readFileSync(path.join(root, ".harness", "backups", report.backup.id, "manifest.json"), "utf8");
    assert.match(backup, /skills\/verification\/SKILL\.md/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
