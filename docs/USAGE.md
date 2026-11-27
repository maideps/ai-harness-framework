# Using the Framework

This guide covers running the harness day-to-day and adopting it in a new project.

## Quick Start

```bash
./init.sh        # check prerequisites, detect the project stack, install deps, run verification and the harness self-tests
make check       # full verification: lint → check-arch → typecheck → test → build → e2e → optional verify-all → optional quality
make help        # list all available commands
```

- **Harness runtime**: Node.js ≥ 18. The harness tooling runs on Node regardless of the project's product stack.
- **No make?** Every make target is mirrored 1:1 by an npm script (`npm run check`, `npm run check-arch`, …). Both surfaces delegate to the same Node runner (`scripts/framework-check.mjs`), so they cannot drift apart.

## Stack Detection

`scripts/stack-detect.mjs` is the single source of truth for "what kind of project is this". It detects the runtime from manifest markers — node (`package.json`), python (`pyproject.toml`/`requirements.txt`), go (`go.mod`), rust (`Cargo.toml`), jvm (`pom.xml`/gradle), dotnet (`.csproj`/`.sln`) — and resolves the right command per verification layer (`ruff`, `mypy`, `pytest`, `go vet`/`test`/`build`, `cargo test`/`build`, `mvn test`, `dotnet test`, …).

Python layers use `uv run` when `uv.lock` is present, `poetry run` when `poetry.lock` is present, or the project `.venv` interpreter when available. Mypy uses configured `files` from `pyproject.toml`, `mypy.ini`, `.mypy.ini` or `setup.cfg`; otherwise it checks `src/`.

For node projects, the package.json script keys are the layer commands (`scripts.lint`, `scripts.test`, …). A layer that is not configured reports **SKIP** — which does not count as verified. Only **PASS** counts; **FAIL** stops the chain.

## Command Surface

The generated [Harness Command Reference](HARNESS.md) lists Makefile targets and npm scripts. Run `npm run harness-docs` to regenerate it after changing either command surface.

## The Feature Workflow

1. Read `feature_list.json` — the machine-readable source of truth for what each feature is (id, behavior, dependencies, layers). Pick ONE unfinished feature, or add a new one: `npm run add-feature -- <id> <name> [--behavior ..] [--verification ..] [--depends a,b] [--layer label=cmd]` configures the declaration; repeated `--layer` options append custom verification layers to the standard chain. The standard chain is Layer 1 `npm run lint`, Layer 2 `npm run test`, and Layer 3 the rest of your `check` script — for the default scripts, `npm run typecheck && npm run build && npm run e2e && npm run verify-all && npm run quality` — so a gate runs each check once. If `check` is not a plain `&&` chain of `npm run` steps containing both `lint` and `test`, Layer 3 stays `npm run check` (feat-038). An optional `featureIdPattern` regular expression in `.harness/manifest.json` restricts accepted IDs.
2. Clarify it, then activate it. `npm run clarify -- <feature-id>` prints the feature's behavior and verification, five questions (undefined terms, uncovered inputs and edge cases, error cases, files it will touch, whether the verification checks every sentence of the behavior) and the ambiguities it finds mechanically (vague wording such as etc or properly, a verification that names no test or command, a behavior sentence the verification never mentions). Answer each question from the repository, citing the file, or ask the human; write the answers as a JSON list of `{"question", "answer", "source"}` (source: a repository path or `human`; `[]` when nothing was open) and record them with `npm run clarify -- <feature-id> --record <file>`. They are kept in the feature's state shard. An answer that would change what done means is not recorded: edit the feature's `behavior` first (the `clarify` skill, feat-054, D-064). Then `npm run activate -- <feature-id>`: activation refuses a feature with no clarifications recorded, and immediately enforces **WIP=1** (at most one active feature) and **dependency order** (every dependency must already be `passing`), then writes the feature's state shard. A human can activate without clarifying with `--skip-clarify`; the shard records `clarifications: skipped` and the session brief shows it.
3. Implement the feature. Run `npm run check` before every commit.
4. Verify through the gate — never mark a feature `passing` by hand:
   ```bash
   npm run verify-feature -- <feature-id>
   ```
   The gate runs the feature's own verification layers, refuses to pass a feature whose dependencies are not `passing`, and records evidence in `.harness/state/<feature-id>.json` — `feature_list.json` itself is never rewritten (feat-011, D-017).
5. The gate writes the trail to `.harness/trails/` itself on a bound pass (feat-034); `npm run vcr` records a full-run trail for work no feature gate covers.
6. End the session: start the note with `node scripts/framework-check.mjs progress-new "<title>"` and fill it in, including "Mistakes caught" (`none`, or each mistake caught this session and the rule, test or lint check it became) (or write `progress/NNN-YYYY-MM-DD.md` yourself and run `node scripts/framework-check.mjs progress-update`), update `session-handoff.md` and `docs/quality-document.md`, update `README.md` so it describes the app as it is now (what it does, how to run it, what a user can do; `clean-check` fails until README.md changes after the latest verified feature, and a feature with no user-visible change declares `"readme": "<reason>"` in `feature_list.json` instead, feat-051), then run `npm run clean-check` and commit.
7. Open a pull request. The shipped CI workflow runs `npm run evidence-check -- --base origin/<base branch>` on it (with full history, `fetch-depth: 0`): every feature that became `passing` on the branch must have evidence bound to a commit that is an ancestor of the merged code, and after that commit the branch may change only harness bookkeeping (`.harness/state/`, `.harness/trails/`, `progress/`, `PROGRESS.md`, `session-handoff.md`, `README.md`, `docs/quality-document.md`, and the other files verify-feature already treats as bookkeeping). Otherwise it fails, naming the feature, its evidence commit and each file changed after it: rerun `npm run verify-feature -- <feature-id>`. Commits that reach the branch by merging the base in are not counted. Run it locally the same way; without `--base` it compares with `origin/HEAD`, `origin/master`, `origin/main`, `master` or `main`, the first that exists (feat-055, D-065).

## Testing Your Product

The harness runs your tests and makes their results count (SKIP is never PASS; evidence names the commit that passed), but ships no tests for your product. The `testing` skill has the full workflow; in short:

- **Each kind of test in its layer**, your tools chained after the harness command: linter and type checker in `lint`/`typecheck`; fast, deterministic unit and integration tests in `test`; real end-to-end tests in `e2e` (it reports SKIP, and is not verified, until you wire it). For example `"test": "node scripts/framework-check.mjs test && vitest run"`, or `pytest`, `go test ./...`, `cargo test`.
- **Each feature proves its declared behavior**: write the behavior as a checkable statement, write its acceptance test first, and declare it as the feature's own layer (`npm run add-feature -- <id> <name> --behavior "..." --layer "Cart tests=vitest run src/cart"`). Bugs start with a failing test. A test that contradicts the declared behavior is fixed in the same commit, never the other way round (feat-035).
- **A fast gate**: keep `npm run check` under about two minutes, an agent's default command timeout; move slow suites to `e2e` or a scheduled CI job; treat flaky tests as bugs.
- **Judge the tests, not only the result**: a coverage floor from `.harness/quality.json`, a mutation score for critical modules, review that each test checks the declared behavior, and human-owned acceptance tests for the features that matter most.

## Visual Evidence

A layer can pass while a page is visibly wrong: overlapping buttons, unreadable text, an empty list where data should be. When a feature has output a test cannot fully assert, have its end-to-end tests take screenshots and declare them as the layer's `captures` (feat-044). `verify-feature` then keeps the ones written during that run, copies them into `.harness/logs/<feature>/captures/` and records their hashes in the evidence; a layer that declares captures and writes none fails.

**Playwright example.** Take a screenshot at each step that matters, into a folder git ignores:

```ts
// tests/e2e/cart.spec.ts
test("cart shows the discounted total", async ({ page }) => {
  await page.goto("/cart");
  await page.screenshot({ path: "test-results/shots/cart-empty.png" });
  await page.getByRole("button", { name: "Add item" }).click();
  await page.screenshot({ path: "test-results/shots/cart-discount.png", fullPage: true });
});
```

```js
// playwright.config.js: video is optional and only for people; agents cannot watch it
export default { outputDir: "test-results", use: { video: "retain-on-failure" } };
```

Add `test-results/` to `.gitignore`, then declare the captures on the feature's layer in `feature_list.json`:

```json
{ "label": "Layer 3: E2E", "cmd": "npm run e2e", "repair": "Fix the failing flow and rerun npm run e2e.", "captures": ["test-results/shots/**/*.png"] }
```

**When to look.** Twice, and the skills (`verification`, `review`, `testing`) say so:

- While developing, after `npm run e2e` and before committing: open each new screenshot and compare it with the declared behavior. Fixing it now is cheap; `verify-feature` refuses uncommitted code, so a defect first seen at the gate costs another commit.
- At the gate: open the copies `verify-feature` prints before reporting the feature done, and name them in the session note's "Verification run". A capture that contradicts the behavior means the feature is not done, whatever the layers say.

**Screenshots for agents, video for people.** Agents read images but cannot watch video, so a flow an agent must check needs a screenshot at each step; a recording only helps a human reviewer.

**CLI and API projects.** The layer log `verify-feature` already keeps (`.harness/logs/<feature>/<NN>-<label>.log`) is the evidence of what the command printed. For a terminal interface, a layer can record a [VHS](https://github.com/charmbracelet/vhs) tape that writes a screenshot (`Screenshot out/menu.png`) and declare `"captures": ["out/*.png"]`; this repository's own README demo is recorded with VHS (`docs/demo/demo.tape`).

## Property-based and Formal Checks

Example tests check the cases someone thought of. Two stronger kinds of check fit into the same layers; the harness ships neither, and most features need neither (feat-047, D-058).

**Property-based tests** state a rule that must hold for every input, and the tool generates hundreds of inputs, shrinking any failure to the smallest one. They are ordinary tests: they run in the `test` layer, or in the feature's own layer, like any other.

| Stack | Tool |
|---|---|
| JavaScript, TypeScript | fast-check |
| Python | Hypothesis |
| Rust | proptest, quickcheck |
| JVM | jqwik |

For a feature whose declared behavior is "`cartTotal()` applies a 10% discount above $100 and never returns less than $0":

```js
// cart.property.test.mjs (node --test, fast-check)
import test from "node:test";
import fc from "fast-check";
import { cartTotal } from "./cart.mjs";

test("the discount applies above $100 and the total is never negative", () => {
  fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 50_000 })), (cents) => {
    const subtotal = cents.reduce((sum, c) => sum + c, 0);
    const total = cartTotal(cents);
    return total >= 0 && total === (subtotal > 10_000 ? Math.round(subtotal * 0.9) : subtotal);
  }));
});
```

Reach for them when the input space is large and the rule is easy to state: parsers and serializers (decode of encode is the identity), money and date arithmetic, sorting and merging, anything with an invariant.

**Model checking and proofs** check a design, not samples: every reachable state of a model (TLA+ with the TLC checker or Apalache), or a machine-checked proof (Lean). They fit state machines, concurrency, retries and distributed protocols, where a bug needs a rare interleaving that tests almost never produce.

- Run them as a feature's own layer, because the result is pass or fail. A quality gate in `.harness/quality.json` is for a number (coverage, a score), not a verdict.
- The check must exit non-zero when it finds a violation, or the layer passes whatever it finds; check your tool version's exit codes before trusting a PASS.

```json
{ "label": "Model check: order workflow", "cmd": "java -cp tools/tla2tools.jar tlc2.TLC -workers auto -config specs/Orders.cfg specs/Orders.tla", "repair": "Read the counterexample trace TLC printed; fix the design or the spec, then rerun." }
```

```json
{ "label": "Proofs: rounding lemmas", "cmd": "lake build", "repair": "Fix the proof or the definition Lean rejected, then rerun lake build." }
```

Weigh the cost first. TLA+ needs Java and a model written by hand; the model describes the design, not the code, so it can drift from the code unless someone owns keeping them in step. Lean proofs take expertise and time, and pay off for small, critical algorithms. Model checks can also be slow: keep the model the gate checks small enough that `verify-feature` stays quick, and run the full state space in a scheduled CI job.

## The README Contract

README.md describes the app being built, and says nothing more and nothing less than the repository does (feat-051, feat-052). Three things keep it that way:

- **`npm run lint` checks it mechanically**, in every project that uses the harness:
  - a conventional structure, based on the Standard Readme convention: one `#` title, a short description right after it, an install section (Install, Installation, Getting Started, Quick Start or Setup), a usage section (Usage, Examples, How to Use, How It Works or What It Does), a License section, and a Table of Contents section once the README passes 100 lines;
  - nothing the repository doesn't have: every `npm run` / `pnpm run` / `yarn run` script and `make` target in its inline code and in its shell code blocks, every relative link and every relative path in its inline code must exist. Absolute routes such as `/health/live` are ignored, as are slash-delimited terms such as `application/json` or provider model IDs — unless their first segment exists in the repository, or they read as a path anyway: a file extension, a trailing slash, or a leading `./` or `../`. A typo in a root directory (`scirpts/x.mjs`) or a renamed one is therefore still reported. A fenced block counts as shell when its info string is `bash`, `sh`, `shell`, `zsh`, `console`, `shell-session`, `powershell`, `ps1`, `pwsh`, `cmd` or `bat`, or when it has none; a block tagged `text`, `json`, `yaml` or any other language is sample output or source and is not read as commands (feat-053). Shell comments, HTML comments, external links and placeholders (`<id>`, `*`, `{…}`, `NNN`, `YYYY`) are skipped.

  Each problem is reported with its line, for example `README.md:42: "npm run deploy" names a script package.json does not define`.
- **`npm run clean-check` requires an update after each feature passes the gate**, unless the feature declares `"readme": "<reason>"` because its users see no change.
- **The `readme-review` skill covers what a check can't:** every claim needs evidence in the code, a test or a passing feature (no "works with" for a platform that is only partly supported, no "enforces" where the code only lets you); every capability users can see appears in the README or a document it links; it is written about the app, in the present tense.

## Session Lifecycle

Every session starts with `./init.sh`, which ends with a short brief (`node scripts/framework-check.mjs brief` prints the same on demand): branch and uncommitted changes, feature counts, the active feature with its behavior and layer commands, the planned features that can start now and those waiting on dependencies, blocked features, stale evidence, the latest session note's known risk and next step, and how old `session-handoff.md` is. It is a few hundred bytes, so a session doesn't need to read all of `feature_list.json`; open it for the features the brief names (feat-037).

```bash
npm run session-start   # record start time, git state, active feature
# … work …
npm run session-end     # merge end state, files modified, decisions, verification into the trace
```

Traces are JSON files in `.harness/traces/`. They are runtime records, not evidence — keep durable session notes in `progress/`, decisions in `DECISIONS.md`, and feature state in `.harness/state/`. `PROGRESS.md` is a generated dashboard/index.

## Skills

Reusable capability packs live in `skills/` — one folder per skill with a `SKILL.md` (frontmatter `name`/`description`, `When to Use`, workflow, quick-reference checklist). The lint layer validates every skill's structure.

Shipped skills: `feature-cycle` (one feature at a time), `verification` (honest gate runs), `session-handoff` (durable session ends), `adopt` (bootstrapping the harness), `parallel-lanes` (agent-proposed, human-approved parallel lanes), `release` (final pre-release pass), `commit` (focused commits), `review` (pre-gate independent pass), `testing` (tests per layer, acceptance tests first, visual and property-based checks), `update-docs` (docs-drift cleanup), `readme-review` (README contrasted with the repository), `write-skill` (the meta-skill for authoring new ones).

Project skills may be added under `skills/` — see the `write-skill` skill for the format.

## Worktree Lanes

Multiple agents can work on independent features at the same time, each in its own sibling git worktree:

```bash
npm run lane-new -- feat-020    # sibling worktree ../<repo>-lane-feat-020 on branch lane/feat-020,
                                 # feature marked active in .harness/state/feat-020.json (uncommitted)
npm run lane-list               # every local lane/* branch: feature, state, worktree path
npm run lane-land -- feat-020   # from the branch to merge into: refuses unless the lane's
                                 # feature is passing, then merges, removes the worktree, deletes the branch
npm run lane-drop -- feat-020   # abandon the lane's worktree without merging (branch kept)
npm run lane-suggest            # advisory: which planned features are startable in parallel right now
                                 # (creates nothing — see the `parallel-lanes` skill for the propose/approve flow)
```

A git branch can only be checked out in one worktree at a time, so branch-checkout exclusivity is the coordination primitive — no lock file or lease. WIP=1 applies per lane: a `lane/<feature-id>` branch may only activate the feature it is named for (`arch-002` enforces this). Feature state is sharded — one file per feature under `.harness/state/<id>.json` (feat-011, D-017) — so two lanes landing two different features touch two different files and merge conflict-free by construction; `feature_list.json` itself only changes when features are declared, so lane landings rarely touch it at all.

## Sharded Feature State

`feature_list.json` declares what each feature is (id, name, behavior, verification, dependencies, layers) and rarely changes. Each feature's mutable state — `state` and `evidence` — lives in its own file, `.harness/state/<feature-id>.json`:

```json
{
  "state": "passing",
  "evidence": "All verification layers passed via node scripts/framework-check.mjs verify-feature at 2026-09-09T00:00:00.000Z"
}
```

A missing shard means "planned, no evidence yet" — you don't need to create one until you activate a feature. `npm run verify-feature -- <id>` writes only that feature's shard; it never rewrites `feature_list.json`. `npm run typecheck` (Layer 1b) rejects any `state`/`status`/`evidence` key found inline in `feature_list.json` — that data belongs in the shard now.

**Evidence is tied to a commit (feat-030).** `verify-feature` refuses to run while code is uncommitted, so the commit its evidence names is the code that passed. Commit the feature (after `npm run check`), then run the gate, then commit the shard it wrote with your session notes. Harness bookkeeping never blocks it: `.harness/state/`, `.harness/logs/`, `.harness/traces/`, `.harness/trails/`, `progress/`, `PROGRESS.md`, `claude-progress.md` and `session-handoff.md`. A layer that leaves new files behind (an unignored coverage report, a formatter rewrite) fails the gate too: add the output to `.gitignore` or commit it. `npm run verify-feature -- <id> --allow-dirty` (or `make verify-feature F="<id> --allow-dirty"`) records evidence anyway, marked `"bound": false`; outside a git repository evidence is always unbound. The evidence also stores `checksHash`, a fingerprint of the feature's layers (label, command, `required`; not the repair hint). If you change a passing feature's layers, `npm run typecheck` warns and features that depend on it can't pass until you re-run its gate. Evidence recorded before feat-030 has no `checksHash` and is never reported stale.

**Captures (feat-044).** A layer can name the screenshots, videos or other files its command writes, as globs relative to the project root: `{ "label": "Layer 3: E2E", "cmd": "npx playwright test", "repair": "...", "captures": ["test-results/**/*.png"] }`. After that layer passes, `verify-feature` takes only the matching files written during this run (an older file is never evidence), copies them to `.harness/logs/<feature>/captures/<NN>-<label>/`, records each in the layer's evidence with its path, `sha256` and size, and prints the copies with the instruction to open each one and compare it to the declared behavior. A layer that declares captures but writes none fails the gate. The folder the captures are written to must be gitignored; if it is not, the gate's uncommitted-changes failure names it. Declaring captures changes the layer's `checksHash`; layers without captures keep theirs.

Upgrading a repository from the older inline-state schema (or hand-migrating one): `npm run migrate-feature-state` moves every feature's inline `state`/`status`/`evidence` into its shard and strips those keys from `feature_list.json`. It's idempotent — a feature that already has a shard is left alone, and running it again on an already-migrated repo reports nothing to do.

## Multi-repo Extension (optional)

It is **opt-in**: `create-harness` never places it unasked, so a plain single-repo adopter never acquires `contracts/`, `tasks/`, `repositories/`, or `scripts/verify-all` just from adopting the harness.

Projects that span multiple repositories can activate the multi-repo component:

1. Activate it: `node scripts/create-harness.mjs <dir> --with multi-repo` places the `templates/multi-repo/*` skeletons (`scripts/verify-all`, `scripts/verify-all.mjs`, `contracts/`, `tasks/`, `repositories/`) at their declared destinations. Safe to rerun later against an already-adopted repository — existing files are never overwritten, so only what's still missing gets added.
2. Give every subrepository a `scripts/verify`, `scripts/verify.mjs`, or `scripts/verify.cjs` that exits non-zero on failure.
3. Run the root gate: `npm run verify-all` (or `make verify-all`) — it runs every repository's verify script and aggregates the results. `make check` includes this optional layer.

Single-repo projects never need the component: `check` passes without it, and `verify-all` reports `[SKIP] Multi-repo component not activated` when its files are absent. Once activated but still only holding the untouched `example` scaffold (no real repositories added yet), `verify-all` honestly reports `[SKIP] verify-all ran but nothing was verified yet` rather than a silent pass — it only reports success once at least one real repository's verify script actually runs and passes. Repositories without any supported verify script are SKIPped, not passed.

## Pre-commit Hook (opt-in)

`npm run hooks-install` (or `make hooks-install`) makes git run the fast static checks, `npm run lint` and then `npm run check-arch`, before every commit, and block the commit when either fails, naming the failed step and how to rerun it. Because it is a git hook, it applies to every agent (Claude Code, Codex, Gemini) and every human committing in that clone.

- **Fast on purpose.** It never runs the full `npm run check`; tests, build and e2e stay the step you run before committing.
- **Local and opt-in.** It sets `core.hooksPath` to `scripts/hooks` in this clone's git config only. Nothing installs it automatically, and each clone opts in on its own. `npm run hooks-uninstall` restores git's default hooks folder.
- **Never replaces your hooks.** If `core.hooksPath` already points elsewhere, or the default hooks folder holds hooks of your own, `hooks-install` stops and prints the line to add to your own pre-commit hook instead: `"scripts/hooks/pre-commit" || exit 1`.
- **Upgrades include it.** The hook lives in `scripts/hooks/`, so `harness-upgrade` refreshes it with the other CORE scripts.
- It checks the working tree, not only the staged changes, so an unstaged violation also blocks the commit.

## Quality Gates (opt-in)

`make quality` / `npm run quality` runs the metric gates declared in `.harness/quality.json`, and `make check` runs it last. Every adopter gets that file with the gates **disabled**, so the layer reports `[SKIP] Quality gates are disabled` until the project has tests worth measuring. To turn them on:

```json
{
  "enabled": true,
  "gates": [
    { "name": "coverage", "min": 80 },
    { "name": "mutation", "enabled": false, "min": 80 }
  ]
}
```

Each gate runs one command, reads one number from it, and fails when the number is below `min`. A disabled gate, or one whose tool is not installed, reports SKIP. A SKIP is never a PASS: a feature layer that runs `npm run quality` and only gets SKIPs fails `verify-feature` (D-029).

**Coverage presets.** A gate named `coverage` with no `cmd` uses the detected stack's preset:

| Stack | Command | Number read |
|---|---|---|
| node | your `coverage` script in `package.json` (c8, vitest, jest, `node --experimental-test-coverage`) | the `All files \| <n>` row |
| python | `pytest --cov=src` (or `--cov=.`), needs `pytest-cov` | `totals.percent_covered` in the JSON report |
| go | `go test -coverprofile` + `go tool cover -func` | the `total: (statements)` line |
| rust | `cargo llvm-cov --json --summary-only`, needs `cargo-llvm-cov` | `data.0.totals.lines.percent` |

JVM and .NET have no preset: declare the command yourself.

**Your own command.** Any gate can declare `cmd`, and then must declare where its number comes from:

- `"metric": { "pattern": "<regex>" }` reads the last match in the output (case-insensitive). Capture group 1 is the value; named groups `num` and `den` give `100 × num / den` for tools that print counts instead of a score.
- `"metric": { "file": "<json report>", "path": "a.b.0.c" }` reads a field of a JSON report (numeric segments index arrays; `"87.5%"` strings are accepted).
- `"exitCodes": [0, 2]` accepts exit codes other than 0, for tools that exit non-zero on their own verdict.
- `"probe": "<command>"` runs first; when it exits non-zero the gate reports SKIP instead of running. Use it for tools that only work on some platforms or versions (mutmut needs Linux, macOS or WSL; this repository probes for Node 22+ before measuring its own coverage).

Mutation testing has no preset because each stack's tool reports differently. Starting points (check them against your tool's version):

| Tool | `cmd` | `metric` |
|---|---|---|
| Stryker (JS/TS), Stryker.NET | `npx stryker run` / `dotnet stryker` | `{ "pattern": "all files\s*\|\s*([\d.]+)" }` |
| PIT (JVM) | `mvn -q org.pitest:pitest-maven:mutationCoverage` | `{ "pattern": "Killed \d+ \((\d+)%\)" }` |
| mutmut 3 (Linux, macOS, WSL) | `mutmut run && mutmut export-cicd-stats && mutmut badge --output .harness/quality/mutation.json` | `{ "file": ".harness/quality/mutation.json", "path": "message" }` |
| cargo-mutants | `cargo mutants` with `"exitCodes": [0, 2]` | `{ "pattern": "(?<den>\d+) mutants tested.*?(?<num>\d+) caught" }` |

A gate is any number with a floor, so the same mechanism fits an LLM eval score (`{ "name": "eval-accuracy", "cmd": "python -m evals.run", "metric": { "file": "evals/results/latest.json", "path": "accuracy" }, "min": 0.8 }`).

Reports go to `.harness/quality/`, a folder that ignores itself. `npm run lint` fails on a malformed `.harness/quality.json` even while it is disabled. To make a metric part of a feature's evidence, add `{ "label": "Layer 4: Quality gates", "cmd": "npm run quality" }` to its layers. After `harness-upgrade`, an existing adopter gets the disabled file, and the upgrade prints the `quality` npm script and make target to add: `Makefile` and `package.json` are adopter-owned, so add both, then append `quality` to the `check` target and `&& npm run quality` to the `check` script, and run `npm run harness-docs`. Until the make target exists, `npm run build` fails with `Makefile is missing target quality`.

## Dev Container (optional)

The `devcontainer` component gives every agent session the same environment: Docker and an editor that supports dev containers (VS Code, Cursor, the `devcontainer` CLI, GitHub Codespaces) are all you need on the host. It is opt-in:

```bash
node scripts/create-harness.mjs <dir> --with devcontainer   # new project, or rerun on an existing one
```

It places two files:

- `.devcontainer/devcontainer.json`: Ubuntu 24.04 with Node pinned to the project's `.nvmrc`, the GitHub CLI, Claude Code (its official dev container feature), and the toolchain feature for the product already in the directory (python, go, rust, java with Maven or Gradle, .NET). Agent logins live in named volumes (`~/.claude`, `~/.codex`, `~/.gemini`), so they survive container rebuilds.
- `.devcontainer/post-create.sh`: installs Codex and Gemini CLI from npm, registers the project's MCP servers with Codex (`register-mcp.sh`, a no-op without the `mcp` component), then runs `./init.sh`, so the first session starts from a verified state. A failing `init.sh` is reported without aborting the container.

Pinning and the toolchain are filled in only when `create-harness` places the file. If you add a stack later, or change `.nvmrc`, edit `devcontainer.json` yourself: an existing file is never rewritten. API keys are not wired in; log in inside the container once (the volumes keep it), or add `remoteEnv` entries such as `"ANTHROPIC_API_KEY": "${localEnv:ANTHROPIC_API_KEY}"`.

## MCP Servers (optional)

The `mcp` component gives the agents the same Model Context Protocol servers. It ships one, [context7](https://github.com/upstash/context7), which looks up current documentation for libraries instead of relying on what the model remembers. It needs no secret. It is opt-in:

```bash
node scripts/create-harness.mjs <dir> --with mcp            # often together with --with devcontainer
```

| Agent | Where it reads the servers | What the component does |
|---|---|---|
| Claude Code | `.mcp.json` (project scope) | places it; Claude Code asks once before starting a project server |
| Gemini CLI | `.gemini/settings.json` | places it with the same servers; Gemini keeps project servers disabled until you trust the folder |
| Codex | `~/.codex/config.toml` (user scope) | `.devcontainer/register-mcp.sh` registers every command server from `.mcp.json` with `codex mcp add`; post-create runs it. Outside the container run `codex mcp add context7 -- npx -y @upstash/context7-mcp` once |

The first start of a server runs `npx`, which downloads the package; an agent can report it as disconnected until that download finishes, so retry once before debugging.

Add a server by editing both `.mcp.json` and `.gemini/settings.json`, then rerun `bash .devcontainer/register-mcp.sh` for Codex. `register-mcp.sh` skips servers without a `command` (remote HTTP servers) and does not pass `env` entries.

## Distribution

Three tools read the manifest as the single source of truth (make and npm mirrors exist):

| Tool | Purpose |
|---|---|
| `create-harness <dir>` | Generates an adopter repo: CORE as-is, templates placed per their `{from, to}` mapping, runtime surfaces created. Never overwrites existing files. |
| `harness-upgrade <dir> [--dry-run]` | Applies an upgrade per the D-010 contract: overwrites mustNotEdit CORE only (`scripts/`, `.harness/selftest/`, the agent shims, the shipped skills named in the manifest's `shippedSkills`, `templates/` except `keep` ones, the manifest classification; project skills added to `skills/` are kept); migrates shipped legacy self-tests out of `tests/` while preserving other product tests there. Creates instance files a newer harness declares when they are missing, and replaces a `.claude/settings.json` that is still the `{}` an older harness wrote (feat-031). Reports each framework-owned file it changes or adds, and how many were already current; `--dry-run` prints that plan without writing anything, backups included (feat-032). Lists new harness npm scripts and make targets to add to `package.json` and the `Makefile`, and points to `progress-migrate` for an old single-file progress log. |
| `harness-audit [dir]` | Local health report: manifest validity, classification coverage, template placement status, skills structure. Exits non-zero on any failure. |

```bash
node scripts/create-harness.mjs my-project    # or: npm run create-harness -- my-project
node scripts/harness-audit.mjs my-project
node scripts/harness-upgrade.mjs my-project --dry-run   # preview: lists each file it would change or add, writes nothing
node scripts/harness-upgrade.mjs my-project
```

### Upgrade Backups

`harness-upgrade` snapshots every file it's about to overwrite before touching anything — a safety net independent of git, for a dirty tree or a mustNotEdit file an adopter edited against policy (feat-012). Backups live in `.harness/backups/` (gitignored — a local safety net, not durable evidence):

```bash
npm run backup-list                        # every backup: id, pinned?, file count, timestamp
npm run backup-pin -- <id>                 # protect a backup from pruning
npm run backup-unpin -- <id>
npm run backup-restore -- <id>             # or: npm run backup-restore -- latest
```

Dedup: an upgrade that changes nothing skips creating a redundant backup (checksummed against the most recent one) — the overwrite still runs. Retention: the 5 most recent *unpinned* backups are kept; pinned backups are never pruned. Restore is per-file: a file that existed before the operation gets its content back; a file the operation created that didn't exist before is removed.

## Reports and Sweeps

```bash
npm run report       # session digest from .harness/traces/ (last 7 days)
npm run sweep        # archive old traces, prune orphans, report manifest drift
```

The sweep never touches instance state — it only organizes runtime trace artifacts.

## Adopting the Framework in Your Project

The seam contract in `.harness/manifest.json` states exactly what ships and what does not:

- **CORE** — ships as-is: `AGENTS.md`, `CLAUDE.md`, `Makefile`, `package.json`, `init.sh`, `scripts/`, `templates/`, `.harness/manifest.json`, `.harness/arch-rules.json`.
- **TEMPLATES** — skeletons you fill in for your project: `LICENSE` (copied once at adoption), `.nvmrc`, project `README.md`, `.gitignore`, `feature-list.json`, `progress.md`, `DECISIONS.md`, `session-handoff.md`, `quality-document.md`, sprint contract, evaluator rubric, and project docs (`docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/OBSERVABILITY.md`, `docs/TOOLS.md`, `docs/USAGE.md`, `docs/STANDARDS.md`).
- **INSTANCE** — your project's own state, never overwritten by harness upgrades: the root `LICENSE`, `.nvmrc`, and the files you filled from the templates plus your roadmap, progress, and decisions.
- **PRODUCT-OWNED** — your product code. List its directories in the manifest's `productRoots` so the classification rule (arch-005) exempts them.

Adoption steps:

1. Copy CORE files and `templates/` into your repository.
2. Copy each template to its declared destination and fill it in. The manifest's `templates` entries carry the mapping machine-readably: `{ "from": "templates/progress.md", "to": "PROGRESS.md" }` means copy that dashboard skeleton to `PROGRESS.md`; regenerate its generated block after changing feature declarations or adding session notes. Entries with `"keep": true` stay under `templates/` as reference material.

   Put your project's own agent rules in `docs/STANDARDS.md`. If you already have project-specific rules in a root `AGENTS.md` or `CLAUDE.md`, merge them into `docs/STANDARDS.md`: `create-harness` leaves existing files untouched, but a later `harness-upgrade` overwrites those CORE files.

   | Template (from) | Destination (to) |
   |---|---|
   | templates/nvmrc | .nvmrc |
   | templates/LICENSE | LICENSE (kept by upgrades) |
   | templates/README.md | README.md |
   | templates/gitignore | .gitignore |
   | templates/progress.md | PROGRESS.md |
   | templates/DECISIONS.md | DECISIONS.md |
   | templates/feature-list.json | feature_list.json |
   | templates/session-handoff.md | session-handoff.md |
   | templates/quality-document.md | docs/quality-document.md |
   | templates/docs/PRODUCT.md | docs/PRODUCT.md |
   | templates/docs/ARCHITECTURE.md | docs/ARCHITECTURE.md |
   | templates/docs/OBSERVABILITY.md | docs/OBSERVABILITY.md |
   | templates/docs/TOOLS.md | docs/TOOLS.md |
   | templates/docs/USAGE.md | docs/USAGE.md |
   | templates/docs/STANDARDS.md | docs/STANDARDS.md |
   | templates/docs/decisions/index.md | docs/decisions/index.md |
   | templates/ci.yml | .github/workflows/ci.yml |
   | templates/sprint-contract.md | (keep — reference) |
   | templates/evaluator-rubric.md | (keep — reference) |
   | templates/clean-state-checklist.md | (keep — reference) |
3. The generated CI workflow uses your `.nvmrc`, runs `npm run setup --if-present`, then `npm run check` and `npm run check-arch`. If the target already held a Python product (`pyproject.toml` or `requirements.txt`), it also sets up Python with `actions/setup-python` (from `.python-version`, else 3.12) so `npm run setup` can install your dependencies; add that step yourself if you add Python later. Edit `.nvmrc` to choose the Node version for your project. The workflow skips the framework's adoption matrix, which runs in this repository's CI; configure your own e2e script to run project-specific end-to-end tests.
4. Add your product directories to `productRoots` in `.harness/manifest.json` (a new adopter starts with an empty list).
5. Add project-specific architecture rules to `.harness/arch-rules.json` as your codebase grows.
6. Run `./init.sh`, then `npm run check` — you are now on the harness.

Customization points (from the manifest):

- MUST edit: feature content (`feature_list.json`), project docs (`docs/`), project arch rules (`.harness/arch-rules.json`).
- MAY edit: extra Makefile targets, project scripts in `package.json`, stack-specific verification in `init.sh`, manifest `productRoots`.
- MUST NOT edit: `scripts/framework-check.mjs`, the manifest classification itself, the PASS/SKIP/FAIL semantics, the feature state machine and WIP=1 contract.

### Replacing `lint`, `typecheck`, `test`, or `build` without losing the harness's own checks (#25)

For a Node project, `lint`, `typecheck`, `test`, and `build` ship pointing at `node scripts/framework-check.mjs <layer>` — which is also how the harness checks itself: `lint` validates skills structure, the generated progress dashboard, and framework docs for unfilled template placeholders; `typecheck` validates `feature_list.json`'s shape; `test` validates the feature dependency graph and the WIP=1/lane contract (the runner's own unit tests run from `./init.sh` instead, see below); `build` validates Make targets and shell shims. `npm run check-arch` (arch-001..008) does **not** duplicate any of this — replacing one of these four script values with your product tool entirely, instead of chaining it, silently drops that layer's harness checks from both `npm run check` and every `npm run verify-feature` run, with nothing to catch the gap.

**Chain the two instead of replacing:**

```json
"scripts": {
  "lint": "node scripts/framework-check.mjs lint && eslint .",
  "typecheck": "node scripts/framework-check.mjs typecheck && tsc --noEmit",
  "test": "node scripts/framework-check.mjs test && jest",
  "build": "node scripts/framework-check.mjs build && tsc -p . --outDir dist"
}
```

Each side must still exit non-zero on its own failure for `&&` to stop the chain correctly — that's true of ordinary CLI tools (eslint, tsc, jest, …) by default. `node scripts/create-harness.mjs <dir> --with <component>` and plain adoption both ship this chained form already where applicable; only an adopter who later overwrites one of these four keys outright (not by appending `&&`) loses the harness side.

Forgot to chain one? `node scripts/harness-audit.mjs` warns, by layer name, the first time it notices a layer script no longer invokes `framework-check.mjs <layer>` at all.

## Verification Semantics

- **PASS** — the layer ran and succeeded; it counts as verified.
- **SKIP** — the layer is not configured; it does not count as verified.
- **FAIL** — non-zero exit; the chain stops.
- **The default `e2e` layer reports SKIP until you wire your own end-to-end tests.** Point the `e2e` script at them; until then a SKIP is the honest answer, and it does not count as verified. The framework's adoption matrix (throwaway adopter repos across five stacks, a simulated upgrade, the multi-repo component) tests the harness, not your product, so it runs only in the framework's own repository (feat-029, D-040).
- **The harness self-tests run once per session, not on every check.** They are the runner's unit tests in `.harness/selftest/`, which test CORE files you don't edit and that only change on `harness-upgrade`. `./init.sh` runs them at the start of each session, which catches a Node version or platform that breaks the harness; `node scripts/framework-check.mjs selftest` runs them on demand, for example right after an upgrade. Their `.selftest.mjs` suffix keeps default `node --test` discovery from picking them up alongside product tests and keeps the harness's own share of a `verify-feature` run to a second or two.

`npm run check-arch` enforces eight rules: required harness surfaces exist, the feature tracker preserves WIP=1, dependency order, and lane ownership, framework docs contain no template placeholders, the manifest is valid, every tracked file is classified by the manifest, feature declarations carry no leftover inline state (sharded state stays consistent), and two banned patterns in the harness's own code (`os.EOL` in scripts, the `[\/]` separator class in regexes — both behind a Windows bug, D-025).

### Banning a pattern

Most product rules are "never write X here": no `useEffect` in components, no direct database import from the UI layer, no `console.log` in library code. Declare them as `forbid` rules instead of writing a grep, which behaves differently on Windows and doesn't report locations (feat-041, D-052):

```json
{
  "id": "arch-101",
  "kind": "forbid",
  "description": "Components never call useEffect",
  "pattern": "\\buseEffect\\(",
  "paths": ["src/components/**/*.{ts,tsx}"],
  "allow": ["src/components/legacy/**"],
  "what": "A component calls useEffect.",
  "why": "Effects in components caused the double-fetch bugs; data loading lives in loaders.",
  "fix": "Move the side effect into the route loader or an event handler."
}
```

- `pattern` is a JavaScript regular expression tested against each line (escape backslashes for JSON).
- `paths` lists the globs to search (`**` spans folders, `*` stays inside one, `{a,b}` picks one); `allow` lists exceptions. Only files git tracks are searched; outside a git repository the rule reports SKIP.
- A violation fails `check-arch` (and therefore `npm run check`) with each match as `file:line: text`, then the rule's what/why/fix — the lines an agent needs to fix it without asking.
- An invalid `pattern`, an empty `paths` list or a malformed `allow` fails the rule with a message naming it.
- When review catches a mistake that a pattern can describe, add a `forbid` rule in the same commit as the fix, so the mistake can't come back.

Two more checks worth knowing about, neither a numbered arch rule:

- **`check-arch` warns (does not fail) on untracked files.** Coverage rules like arch-005 only see what `git ls-files` already tracks — a brand-new file silently passes coverage until it's `git add`ed, then fails once it is. `check-arch` prints a heads-up (`[WARN] N untracked file(s) exist…`) before evaluating rules, so a rule result you're about to read isn't misread as covering a file it can't see yet.
- **`npm run lint` checks the generated `PROGRESS.md` dashboard and `progress/` archive.** The dashboard must match feature declarations/state shards and the dated session files; filenames/headings must agree, and session numbers must be unique and contiguous (file creation order does not matter). Run `node scripts/framework-check.mjs progress-update` to regenerate it; `progress-new "<title>"` starts a note with a heading lint accepts (`### Session NNN — YYYY-MM-DD — <title>`, three `#` and em dashes). From the first note that has a "- Mistakes caught:" line, every note needs one, and each entry must end in what the mistake became: `→ rule: <arch rule id>` (a rule that exists), `→ test: <name>`, `→ lint: <check>`, or `→ no check possible: <reason>`; `none` is fine. A blank section passes lint, so the skeleton does, but `clean-check` fails while the latest note leaves it blank (feat-042).
- **`npm run lint` checks that every MUST rule in `AGENTS.md` says what enforces it** (feat-048): an `<!-- enforced-by: ... -->` comment on the rule's line or the comment lines right below it, naming the gate (an arch rule id must exist in `.harness/arch-rules.json`) or `none — <reason>`. The PASS line counts both; the `none` rules are the ones still enforced only by prose, the list to turn into gates next.
- **`npm run typecheck` fails a `passing` feature whose evidence did not come from `verify-feature`** (feat-049): gate evidence (a commit, `checksHash` and layers) backed by its trail in `.harness/trails/` when bound, unbound evidence from `--allow-dirty`, or the gate's older formats (beginning "All verification layers passed via"). Empty, free-text or hand-built evidence fails with the `verify-feature` command to run instead. It stops shortcuts, not forgery: a copied old summary or a forged trail still passes.
