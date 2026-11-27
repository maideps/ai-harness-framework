import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { fileURLToPath } from "node:url";

import { aggregate, mergedPullRequest, outcomes, revertedPullRequests, skillsUsedIn, skillUsage } from "../../scripts/harness-report.mjs";

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

// ---- feat-059 (D-069): skill usage report ---------------------------------------

const REPORT_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "harness-report.mjs");

function isoDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// skills/alpha, beta and gamma; notes NNN-<date>.md with the given Skills used values.
function skillUsageFixture(notes) {
  const root = mkdtempSync(path.join(os.tmpdir(), "cw-skill-usage-"));
  for (const name of ["alpha", "beta", "gamma"]) {
    mkdirSync(path.join(root, "skills", name), { recursive: true });
    writeFileSync(path.join(root, "skills", name, "SKILL.md"), `---\nname: ${name}\n---\n`, "utf8");
  }
  mkdirSync(path.join(root, "skills", "not-a-skill"), { recursive: true }); // no SKILL.md
  mkdirSync(path.join(root, "progress"), { recursive: true });
  notes.forEach(([date, value], index) => {
    const line = value === null ? "" : `- Skills used: ${value}\n`;
    writeFileSync(path.join(root, "progress", `${String(index + 1).padStart(3, "0")}-${date}.md`), `### S\n\n- Goal: g\n${line}`, "utf8");
  });
  return root;
}

test("skillsUsedIn: names, backticks and none; null without the line (feat-059)", () => {
  assert.deepEqual(skillsUsedIn("- Skills used: alpha, `beta`.\n"), ["alpha", "beta"]);
  assert.deepEqual(skillsUsedIn("- Skills used: none\n"), []);
  assert.deepEqual(skillsUsedIn("- Skills used: \n"), []);
  assert.equal(skillsUsedIn("- Goal: g\n"), null);
});

test("skillUsage: sessions and last date per skill, unused ones in the window, older notes counted apart (feat-059)", () => {
  const root = skillUsageFixture([
    [isoDaysAgo(90), null],
    [isoDaysAgo(60), "alpha, gamma"],
    [isoDaysAgo(10), "alpha, alpha"],
    [isoDaysAgo(2), "none"],
  ]);
  try {
    const result = skillUsage(root, 30);
    assert.equal(result.notes_with_section, 3);
    assert.equal(result.notes_without_section, 1);
    assert.deepEqual(result.skills, [
      { name: "alpha", sessions: 2, last: isoDaysAgo(10) },
      { name: "beta", sessions: 0, last: null },
      { name: "gamma", sessions: 1, last: isoDaysAgo(60) },
    ]);
    assert.deepEqual(result.unused, ["beta", "gamma"]);
    assert.deepEqual(skillUsage(root, 60).unused, ["beta"], "a skill used exactly N days ago still counts");
    assert.deepEqual(skillUsage(root, 5).unused, ["alpha", "beta", "gamma"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("skill-usage and report print the table; --days must be a positive integer (feat-059)", () => {
  const root = skillUsageFixture([[isoDaysAgo(40), "alpha"], [isoDaysAgo(3), "beta"]]);
  const runReport = (...args) => {
    const result = spawnSync(process.execPath, [REPORT_SCRIPT, ...args], { cwd: root, encoding: "utf8" });
    return { exit: result.status ?? 1, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
  };
  try {
    let result = runReport("skill-usage");
    assert.equal(result.exit, 0, result.output);
    assert.match(result.output, /Skills used section: 2; older notes without it, skipped: 0/);
    assert.match(result.output, /alpha\s+sessions:\s+1\s+last: \d{4}-\d{2}-\d{2}/);
    assert.match(result.output, /Not used in the last 30 days .*: alpha, gamma/);

    result = runReport("skill-usage", "--days", "60");
    assert.match(result.output, /Not used in the last 60 days .*: gamma/);

    for (const bad of [["--days", "0"], ["--days", "x"], ["--days"], ["--weeks", "2"]]) {
      result = runReport("skill-usage", ...bad);
      assert.equal(result.exit, 1, bad.join(" "));
      assert.match(result.output, /usage: npm run skill-usage/);
    }

    result = runReport();
    assert.equal(result.exit, 0, result.output);
    assert.match(result.output, /=== Skill usage/);
    assert.match(result.output, /Not used in the last 30 days .*: alpha, gamma/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
