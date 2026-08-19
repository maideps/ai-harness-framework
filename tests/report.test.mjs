import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { aggregate } from "../scripts/harness-report.mjs";

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "cw-report-"));
  const now = new Date().toISOString();
  const recent = (record) =>
    writeFileSync(path.join(root, `session-start-${record.file}.json`), JSON.stringify(record), "utf8");
  recent({
    file: "a",
    session_start: now,
    session_end: new Date(Date.now() + 5 * 60000).toISOString(),
    active_feature: "feat-001",
    decisions_recorded: { count: 2, latest: "D-001: X" },
    files_modified: ["README.md"],
    verification_results: { feature_evidence: "passed" },
  });
  recent({
    file: "b",
    session_start: now,
    active_feature: "feat-002",
    decisions_recorded: { count: 0, latest: "" },
    files_modified: [],
  });
  const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  writeFileSync(
    path.join(root, "session-start-old.json"),
    JSON.stringify({ session_start: old, session_end: old, active_feature: "feat-000" }),
    "utf8",
  );
  return root;
}

test("aggregate: windows by days, counts open sessions, aggregates decisions", () => {
  const root = fixture();
  const report = aggregate(root, 7);
  assert.equal(report.sessions.length, 2, "old session excluded by the window");
  assert.equal(report.totals.open_sessions, 1, "one record has no session_end");
  assert.equal(report.totals.decisions_recorded, 2);
  assert.deepEqual(report.totals.active_features.sort(), ["feat-001", "feat-002"]);
  assert.equal(report.sessions[0].files_modified, 1);
  rmSync(root, { recursive: true, force: true });
});

test("aggregate: empty traces directory reports zero sessions", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "cw-report-empty-"));
  const report = aggregate(root, 7);
  assert.equal(report.sessions.length, 0);
  assert.equal(report.totals.sessions, 0);
  rmSync(root, { recursive: true, force: true });
});
