#!/usr/bin/env node

// harness-backup — checksum-deduped, gzip-compressed, pinnable snapshots of
// the files a harness upgrade is about to overwrite (feat-012).
//
// Backups live in .harness/backups/ (gitignored — a local safety net, not
// durable evidence; the durable record of *what changed* is git itself, per
// the harness's own "repository is the system of record" principle). This
// covers the gap git alone doesn't: an upgrade run against a dirty,
// uncommitted tree, or against a mustNotEdit CORE file an adopter edited
// against policy.
//
// Dedup: skip creating a backup identical (by content checksum) to the most
// recent one. Retention: keep the 5 most recent *unpinned* backups; pinned
// backups are never pruned.
//
//   node scripts/harness-backup.mjs list
//   node scripts/harness-backup.mjs pin <backup-id>
//   node scripts/harness-backup.mjs unpin <backup-id>
//   node scripts/harness-backup.mjs restore <backup-id|latest>

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BACKUPS_DIR = ".harness/backups";
const KEEP_UNPINNED = 5;

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

// Every file an upgrade would touch for these surfaces, relative to
// harnessRoot, walked with forward slashes regardless of host OS (this is
// used both as a filesystem-relative path under root and as the manifest's
// stored key, so it must stay host-independent).
function collectSourceRelPaths(harnessRoot, surfaces) {
  const relPaths = [];
  const walk = (dir, relDir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), rel);
      } else {
        relPaths.push(rel);
      }
    }
  };
  for (const surface of surfaces) {
    const src = path.join(harnessRoot, surface);
    if (!existsSync(src)) continue;
    if (surface.endsWith("/")) {
      walk(src, surface.replace(/\/$/, ""));
    } else {
      relPaths.push(surface);
    }
  }
  return relPaths;
}

function snapshotState(root, relPaths) {
  return relPaths.map((relPath) => {
    const destPath = path.join(root, relPath);
    if (!existsSync(destPath)) {
      return { path: relPath, existed: false, checksum: null, content: null };
    }
    const content = readFileSync(destPath);
    return { path: relPath, existed: true, checksum: sha256(content), content };
  });
}

function overallChecksum(files) {
  return sha256(Buffer.from(files.map((f) => `${f.path}:${f.checksum ?? "absent"}`).join("\n"), "utf8"));
}

function backupsRoot(root) {
  return path.join(root, BACKUPS_DIR);
}

function readManifest(root, id) {
  const manifestPath = path.join(backupsRoot(root), id, "manifest.json");
  if (!existsSync(manifestPath)) return null;
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

function writeManifest(root, id, manifest) {
  writeFileSync(path.join(backupsRoot(root), id, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export function listBackups(root) {
  const dir = backupsRoot(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readManifest(root, entry.name))
    .filter(Boolean)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// Snapshots the current on-disk state of every file the given surfaces are
// about to overwrite. Returns { skipped: true, reason, id } when identical
// to the most recent backup, otherwise { skipped: false, id, path, fileCount }.
export function createBackup(root, surfaces, harnessRoot) {
  const relPaths = collectSourceRelPaths(harnessRoot, surfaces);
  const files = snapshotState(root, relPaths);
  const checksum = overallChecksum(files);

  const existing = listBackups(root);
  if (existing.length > 0 && existing[0].overallChecksum === checksum) {
    return { skipped: true, reason: "identical to the most recent backup", id: existing[0].id };
  }

  // Backup ids are derived from the creation timestamp. Two backups created in
  // the same millisecond (or with a clock that steps backwards) would share a
  // directory and sort ambiguously, so the timestamp is forced to be strictly
  // later than the most recent existing backup.
  let nowMs = Date.now();
  if (existing.length > 0) {
    const latestMs = Date.parse(existing[0].createdAt);
    if (!Number.isNaN(latestMs) && nowMs <= latestMs) nowMs = latestMs + 1;
  }
  const createdAt = new Date(nowMs).toISOString();
  const id = createdAt.replace(/[:.]/g, "-");
  const dir = path.join(backupsRoot(root), id);
  const filesDir = path.join(dir, "files");
  mkdirSync(filesDir, { recursive: true });

  const manifestFiles = [];
  for (const file of files) {
    if (file.existed) {
      const gzPath = path.join(filesDir, `${file.path}.gz`);
      mkdirSync(path.dirname(gzPath), { recursive: true });
      writeFileSync(gzPath, gzipSync(file.content));
    }
    manifestFiles.push({ path: file.path, existed: file.existed, checksum: file.checksum });
  }

  writeManifest(root, id, {
    id,
    createdAt,
    overallChecksum: checksum,
    pinned: false,
    files: manifestFiles,
  });

  pruneBackups(root);
  return { skipped: false, id, path: dir, fileCount: manifestFiles.filter((f) => f.existed).length };
}

export function pinBackup(root, id, pinned) {
  const manifest = readManifest(root, id);
  if (!manifest) {
    throw new Error(`backup ${id} not found`);
  }
  manifest.pinned = pinned;
  writeManifest(root, id, manifest);
  return manifest;
}

// Keeps the KEEP_UNPINNED most recent unpinned backups; pinned backups are
// never counted against the limit or deleted.
export function pruneBackups(root, keep = KEEP_UNPINNED) {
  const unpinned = listBackups(root).filter((backup) => !backup.pinned);
  const toDelete = unpinned.slice(keep);
  for (const backup of toDelete) {
    rmSync(path.join(backupsRoot(root), backup.id), { recursive: true, force: true });
  }
  return toDelete.map((backup) => backup.id);
}

export function resolveBackupId(root, id) {
  if (id !== "latest") return id;
  const backups = listBackups(root);
  if (backups.length === 0) {
    throw new Error("no backups exist");
  }
  return backups[0].id;
}

// Restores every file recorded in the backup: existed=true writes the
// snapshotted content back; existed=false removes the file (reverting
// whatever the operation created that did not exist before it ran).
export function restoreBackup(root, id) {
  const resolvedId = resolveBackupId(root, id);
  const manifest = readManifest(root, resolvedId);
  if (!manifest) {
    throw new Error(`backup ${resolvedId} not found`);
  }
  let restored = 0;
  let removed = 0;
  for (const file of manifest.files) {
    const destPath = path.join(root, file.path);
    if (file.existed) {
      const gzPath = path.join(backupsRoot(root), resolvedId, "files", `${file.path}.gz`);
      mkdirSync(path.dirname(destPath), { recursive: true });
      writeFileSync(destPath, gunzipSync(readFileSync(gzPath)));
      restored += 1;
    } else if (existsSync(destPath)) {
      rmSync(destPath, { force: true });
      removed += 1;
    }
  }
  return { id: resolvedId, restored, removed };
}

function main() {
  const [subcommand, arg] = process.argv.slice(2);
  const root = process.cwd();

  if (subcommand === "list") {
    const backups = listBackups(root);
    console.log(`=== Backups (${backups.length}) ===`);
    if (backups.length === 0) {
      console.log("  none");
    }
    for (const backup of backups) {
      const fileCount = backup.files.filter((file) => file.existed).length;
      console.log(`  ${backup.id}${backup.pinned ? " [pinned]" : ""} — ${fileCount} file(s), ${backup.createdAt}`);
    }
    return;
  }

  if (subcommand === "pin" || subcommand === "unpin") {
    if (!arg) {
      console.error(`usage: node scripts/harness-backup.mjs ${subcommand} <backup-id>`);
      process.exit(1);
    }
    try {
      pinBackup(root, arg, subcommand === "pin");
      console.log(`${subcommand === "pin" ? "Pinned" : "Unpinned"}: ${arg}`);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
    return;
  }

  if (subcommand === "restore") {
    if (!arg) {
      console.error("usage: node scripts/harness-backup.mjs restore <backup-id|latest>");
      process.exit(1);
    }
    try {
      const result = restoreBackup(root, arg);
      console.log(`Restored backup ${result.id}: ${result.restored} file(s) restored, ${result.removed} file(s) removed`);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
    return;
  }

  console.error("usage: node scripts/harness-backup.mjs list|pin <id>|unpin <id>|restore <id|latest>");
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
