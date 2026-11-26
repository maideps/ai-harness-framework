import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (file) => readFileSync(path.join(ROOT, file), "utf8");

test("agent startup instructions include project standards", () => {
  assert.match(read("AGENTS.md"), /Read project docs.*`docs\/STANDARDS\.md`/);

  for (const file of ["CLAUDE.md", "GEMINI.md", "codex.md"]) {
    assert.match(read(file), /## Startup[\s\S]*?Read docs\/STANDARDS\.md/);
  }
});

test("adoption guide puts project-specific agent rules in docs/STANDARDS.md", () => {
  for (const file of ["docs/USAGE.md", "templates/docs/USAGE.md"]) {
    const usage = read(file);

    assert.match(usage, /project's own agent rules in `docs\/STANDARDS\.md`/);
    assert.match(
      usage,
      /existing files untouched, but a later `harness-upgrade` overwrites those CORE files/,
    );
    assert.match(usage, /templates\/docs\/STANDARDS\.md \| docs\/STANDARDS\.md/);
  }
});
