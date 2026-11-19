import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { aggregate, mergedPullRequest, outcomes, revertedPullRequests } from "../../scripts/harness-report.mjs";

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

// ---- Outcomes (feat-050) -----------------------------------------------------

// A git repository whose commits carry the given subjects and dates (days ago), and optional
// state-shard contents, committed in order.
function historyRepo(commits) {
  const root = mkdtempSync(path.join(os.tmpdir(), "cw-outcomes-"));
  const gitIn = (args, env = {}) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: root, encoding: "utf8", env: { ...process.env, ...env } });
  gitIn(["init", "-q"]);
  commits.forEach(({ subject, daysAgo = 1, shards = {} }, index) => {
    for (const [id, state] of Object.entries(shards)) {
      mkdirSync(path.join(root, ".harness", "state"), { recursive: true });
      writeFileSync(path.join(root, ".harness", "state", `${id}.json`), `${JSON.stringify({ state, evidence: "" }, null, 2)}\n`, "utf8");
    }
    writeFileSync(path.join(root, "log.txt"), `${index}\n`, "utf8");
    gitIn(["add", "-A"]);
    const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000 + index * 1000).toISOString();
    gitIn(["commit", "-q", "-m", subject], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  });
  return root;
}

test("outcomes: merged PRs from both subject styles, reverted PRs and the revert rate (feat-050)", () => {
  const root = historyRepo([
    { subject: "Merge pull request #1 from owner/old-branch", daysAgo: 30 },
    { subject: "Merge pull request #2 from owner/feat-a" },
    { subject: "feat: squash-merged change (#3)" },
    { subject: "fix: a plain commit" },
    { subject: "Merge pull request #4 from owner/feat-b" },
    { subject: 'Revert "Merge pull request #4 from owner/feat-b"' },
  ]);
  try {
    const result = outcomes(root, 7);
    assert.equal(result.available, true);
    assert.equal(result.pull_requests_merged, 3, "#1 is outside the window");
    assert.deepEqual(result.pull_requests_reverted, [4]);
    assert.equal(result.revert_rate_percent, 33.3);
    assert.equal(result.commits, 5);
    assert.equal(result.revert_commits, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("outcomes: rework is a feature going from passing to another state; staying passing is not (feat-050)", () => {
  const root = historyRepo([
    { subject: "start", shards: { "feat-001": "active", "feat-002": "active" } },
    { subject: "pass both", shards: { "feat-001": "passing", "feat-002": "passing" } },
    { subject: "re-verify feat-002", shards: { "feat-002": "passing" } },
    { subject: "reopen feat-001", shards: { "feat-001": "active" } },
    { subject: "pass feat-001 again", shards: { "feat-001": "passing" } },
  ]);
  try {
    const { rework } = outcomes(root, 7);
    assert.deepEqual(rework.map((event) => [event.feature, event.to]), [["feat-001", "active"]]);
    assert.match(rework[0].date, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("outcomes: subject parsing and the no-git case (feat-050)", () => {
  assert.equal(mergedPullRequest("Merge pull request #57 from maideps/x"), 57);
  assert.equal(mergedPullRequest("docs: guide (#58)"), 58);
  assert.equal(mergedPullRequest("Merge branch 'master' into topic"), null);
  assert.deepEqual(revertedPullRequests('Revert "feat: thing (#9)"'), [9]);
  assert.deepEqual(revertedPullRequests("Reverting nothing #3"), []);
  const outside = mkdtempSync(path.join(os.tmpdir(), "cw-outcomes-nogit-"));
  try {
    const previous = process.env.GIT_CEILING_DIRECTORIES;
    process.env.GIT_CEILING_DIRECTORIES = path.dirname(outside);
    try {
      assert.deepEqual(outcomes(outside, 7), { available: false });
    } finally {
      if (previous === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
      else process.env.GIT_CEILING_DIRECTORIES = previous;
    }
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test("aggregate: empty traces directory reports zero sessions", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "cw-report-empty-"));
  const report = aggregate(root, 7);
  assert.equal(report.sessions.length, 0);
  assert.equal(report.totals.sessions, 0);
  rmSync(root, { recursive: true, force: true });
});
