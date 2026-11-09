---
name: testing
description: Testing the product inside the harness — which tests go in which layer, acceptance tests from each feature's declared behavior, keeping the gate fast, and judging test quality.
---
# Testing

The harness runs your tests and makes their results count — SKIP is never PASS, and evidence names the commit that passed — but it ships no tests for your product. This skill is how to write and place them so a feature's gate proves its declared behavior.

## When to Use

- Setting up testing in a project that just adopted the harness
- Starting a feature: before writing its code, write the test that proves its behavior
- Fixing a bug
- `npm run check` is getting slow, or a test fails only sometimes
- Deciding whether the tests are good enough, not just green

## Workflow

1. **Put each kind of test in its layer.** Chain your tools after the harness's own command in `package.json` — never replace it, or that layer silently loses the harness's checks:

   | Layer | What goes there | Example |
   |---|---|---|
   | `lint`, `typecheck` | Linter and type checker | `"lint": "node scripts/framework-check.mjs lint && eslint ."` |
   | `test` | Fast unit and integration tests: the whole suite, deterministic, no real network | `"test": "node scripts/framework-check.mjs test && vitest run"` |
   | `build`, `e2e` | The build; real end-to-end tests (browser, API contract, CLI output) | `"e2e": "playwright test"` |

   Other stacks: `ruff check` + `mypy` and `pytest` (Python), `go vet` and `go test ./...` (Go), `cargo clippy` and `cargo test` (Rust). Until `e2e` runs real tests it reports SKIP, and SKIP is not verified: wire it before any feature that crosses components.

2. **Write the feature's behavior so it can be checked.** "`cartTotal()` applies a 10% discount above $100", not "improve the cart". The declared `behavior` in `feature_list.json` is the spec.

3. **Write the acceptance test first and see it fail**, then declare it as the feature's own layer so the gate checks exactly that behavior:
   ```bash
   npm run add-feature -- feat-012 "Cart discount" --behavior "..." --layer "Cart tests=vitest run src/cart"
   ```
   Then implement until it passes, with unit tests for the pieces.

4. **Fix bugs the same way:** reproduce with a failing test, fix, keep the test as a regression guard.

5. **Never weaken a test to get green.** If an existing test contradicts the declared behavior, the test is wrong: fix it in the same commit and say so. If the behavior itself looks wrong, stop and ask.

6. **Keep the gate fast.** Keep `npm run check` under about two minutes — longer than an agent's default command timeout and the agent gets a timeout instead of a verdict. Move slow suites to `e2e` or a scheduled CI job. Treat a flaky test as a bug: pin times and seeds, fake the network.

7. **Judge the tests, not just the result.** A weak test passes the gate as well as a strong one:
   - Coverage: enable your stack's coverage preset in `.harness/quality.json` as a floor, not a goal.
   - Mutation score (Stryker, mutmut, cargo-mutants) for critical modules, as another quality gate: it measures whether the tests catch bugs.
   - In review, check that each test checks the declared behavior, not just what the code currently does.
   - For the features that matter most, a person writes or approves the acceptance test; the agent writes the unit tests.

8. **In CI**, the generated workflow runs `npm run check` and `npm run check-arch`. Add the services `e2e` needs (a database, a browser); keep slow suites in a scheduled job.

## Quick Reference

- [ ] Product tools chained after the harness command in `lint`, `typecheck`, `test`, `e2e` — not replacing it
- [ ] `e2e` runs real end-to-end tests (or the gap is known: SKIP is not verified)
- [ ] Feature behavior written as a checkable statement
- [ ] Acceptance test written first, declared as the feature's own layer
- [ ] Bugs reproduced by a failing test before the fix
- [ ] No test weakened to pass; a test contradicting the behavior is fixed and called out
- [ ] `npm run check` under about two minutes; no flaky tests
- [ ] Coverage floor on; mutation score for critical modules
