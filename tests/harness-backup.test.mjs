import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createBackup,
  listBackups,
  pinBackup,
  resolveBackupId,
  restoreBackup,
} from "../scripts/harness-backup.mjs";

function write(root, rel, content) {
  const dest = path.join(root, rel);
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, content, "utf8");
}

// Two directories standing in for "the harness's source tree" and "the
// adopter repo being upgraded" — createBackup/restoreBackup only ever touch
// the adopter side; the harness side is read-only (it's what a real upgrade
// would copy from).
function harnessFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "cw-backup-harness-"));
  write(root, "AGENTS.md", "harness AGENTS.md v2\n");
  write(root, "scripts/framework-check.mjs", "// v2 runner\n");
  write(root, "scripts/nested/helper.mjs", "// v2 helper\n");
  return root;
}

function adopterFixture() {
  return mkdtempSync(path.join(os.tmpdir(), "cw-backup-adopter-"));
}

function cleanup(...roots) {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}

const SURFACES = ["AGENTS.md", "scripts/"];

test("createBackup: snapshots existing files and records existed=false for files that don't exist yet", () => {
  const harnessRoot = harnessFixture();
  const root = adopterFixture();
  write(root, "AGENTS.md", "adopter's current AGENTS.md v1\n");
  // No scripts/ directory at all on the adopter side yet.
  try {
    const result = createBackup(root, SURFACES, harnessRoot);
    assert.equal(result.skipped, false);
    assert.equal(result.fileCount, 1, "only AGENTS.md existed on the adopter side");

    const backups = listBackups(root);
    assert.equal(backups.length, 1);
    const manifest = backups[0];
    const agents = manifest.files.find((f) => f.path === "AGENTS.md");
    assert.equal(agents.existed, true);
    const helper = manifest.files.find((f) => f.path === "scripts/nested/helper.mjs");
    assert.equal(helper.existed, false, "files absent on the adopter side are recorded, not skipped");
  } finally {
    cleanup(harnessRoot, root);
  }
});

test("createBackup: dedups against the most recent backup when nothing changed", () => {
  const harnessRoot = harnessFixture();
  const root = adopterFixture();
  write(root, "AGENTS.md", "unchanged content\n");
  try {
    const first = createBackup(root, SURFACES, harnessRoot);
    assert.equal(first.skipped, false);
    const second = createBackup(root, SURFACES, harnessRoot);
    assert.equal(second.skipped, true);
    assert.equal(second.id, first.id);
    assert.equal(listBackups(root).length, 1, "no redundant backup was created");
  } finally {
    cleanup(harnessRoot, root);
  }
});

test("createBackup: does not dedup once the adopter-side content actually changes", () => {
  const harnessRoot = harnessFixture();
  const root = adopterFixture();
  write(root, "AGENTS.md", "version 1\n");
  try {
    createBackup(root, SURFACES, harnessRoot);
    write(root, "AGENTS.md", "version 2\n");
    const second = createBackup(root, SURFACES, harnessRoot);
    assert.equal(second.skipped, false);
    assert.equal(listBackups(root).length, 2);
  } finally {
    cleanup(harnessRoot, root);
  }
});

test("createBackup: backups created back-to-back always get distinct, correctly ordered ids", () => {
  const harnessRoot = harnessFixture();
  const root = adopterFixture();
  try {
    const ids = [];
    for (let i = 0; i < 20; i++) {
      write(root, "AGENTS.md", `version ${i}\n`);
      const result = createBackup(root, SURFACES, harnessRoot);
      assert.equal(result.skipped, false);
      ids.push(result.id);
    }
    assert.equal(new Set(ids).size, ids.length, "every backup id is unique, even within one millisecond");
    assert.equal(listBackups(root)[0].id, ids[ids.length - 1], "the newest backup sorts first");
    assert.equal(resolveBackupId(root, "latest"), ids[ids.length - 1], "'latest' resolves to the newest backup");
  } finally {
    cleanup(harnessRoot, root);
  }
});

test("restoreBackup: writes back content for files that existed, removes files that didn't", () => {
  const harnessRoot = harnessFixture();
  const root = adopterFixture();
  write(root, "AGENTS.md", "pre-upgrade corrupted content\n");
  try {
    const backup = createBackup(root, SURFACES, harnessRoot);
    // Simulate the upgrade itself: overwrite AGENTS.md, create the scripts/
    // tree that didn't exist on the adopter side before.
    write(root, "AGENTS.md", "harness AGENTS.md v2\n");
    write(root, "scripts/framework-check.mjs", "// v2 runner\n");
    write(root, "scripts/nested/helper.mjs", "// v2 helper\n");

    const result = restoreBackup(root, backup.id);
    assert.equal(result.restored, 1, "AGENTS.md existed before — restored");
    assert.equal(result.removed, 2, "scripts/ files did not exist before — removed");
    assert.equal(readFileSync(path.join(root, "AGENTS.md"), "utf8"), "pre-upgrade corrupted content\n");
    assert.ok(!existsSync(path.join(root, "scripts", "framework-check.mjs")));
    assert.ok(!existsSync(path.join(root, "scripts", "nested", "helper.mjs")));
  } finally {
    cleanup(harnessRoot, root);
  }
});

test("restoreBackup: 'latest' resolves to the most recent backup", () => {
  const harnessRoot = harnessFixture();
  const root = adopterFixture();
  write(root, "AGENTS.md", "version 1\n");
  try {
    createBackup(root, SURFACES, harnessRoot);
    write(root, "AGENTS.md", "version 2\n");
    const second = createBackup(root, SURFACES, harnessRoot);
    write(root, "AGENTS.md", "version 3 (current)\n");

    const result = restoreBackup(root, "latest");
    assert.equal(result.id, second.id);
    assert.equal(readFileSync(path.join(root, "AGENTS.md"), "utf8"), "version 2\n");
  } finally {
    cleanup(harnessRoot, root);
  }
});

test("restoreBackup: throws a clear error for an unknown backup id", () => {
  const root = adopterFixture();
  try {
    assert.throws(() => restoreBackup(root, "does-not-exist"), /backup does-not-exist not found/);
  } finally {
    cleanup(root);
  }
});

test("pinBackup / pruneBackups: keeps the 5 most recent unpinned backups, a pinned one survives regardless of age", () => {
  const harnessRoot = harnessFixture();
  const root = adopterFixture();
  try {
    // createBackup prunes on every call, so a backup can only be rescued by
    // pinning it before it ages out of the retention window — not
    // retroactively once later backups have already pushed it out.
    write(root, "AGENTS.md", "version 0\n");
    const first = createBackup(root, SURFACES, harnessRoot);
    pinBackup(root, first.id, true);

    const laterIds = [];
    for (let i = 1; i < 7; i++) {
      write(root, "AGENTS.md", `version ${i}\n`);
      const result = createBackup(root, SURFACES, harnessRoot);
      laterIds.push(result.id);
    }

    const remaining = listBackups(root).map((backup) => backup.id);
    assert.equal(remaining.length, 6, "5 unpinned kept + 1 pinned surviving outside that window");
    assert.ok(remaining.includes(first.id), "pinned backup survives pruning even though it's the oldest");
    assert.ok(!remaining.includes(laterIds[0]), "oldest unpinned backup beyond the keep-5 window is pruned");
    for (const id of laterIds.slice(1)) {
      assert.ok(remaining.includes(id), `recent unpinned backup ${id} should survive`);
    }
  } finally {
    cleanup(harnessRoot, root);
  }
});

test("pinBackup: throws a clear error for an unknown backup id", () => {
  const root = adopterFixture();
  try {
    assert.throws(() => pinBackup(root, "does-not-exist", true), /backup does-not-exist not found/);
  } finally {
    cleanup(root);
  }
});

test("listBackups: returns an empty array when no backups exist yet", () => {
  const root = adopterFixture();
  try {
    assert.deepEqual(listBackups(root), []);
  } finally {
    cleanup(root);
  }
});
