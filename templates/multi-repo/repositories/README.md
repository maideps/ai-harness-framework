# Repositories

Each subdirectory under `repositories/` is one execution domain with its own `scripts/verify`:

```
repositories/
  <name>/
    scripts/
      verify        # the repository's verification entrypoint (Node ≥ 18)
    src/            # the repository's own code (product-owned)
```

Rules:

- Every repository MUST have a `scripts/verify` that exits non-zero on failure — `verify-all` treats a missing verify script as SKIP, not PASS.
- A repository's verify script runs its own checks (harness check, tests, build) and prints its own PASS/SKIP/FAIL lines.
- The root `scripts/verify-all` (activated from `templates/multi-repo/verify-all`) runs every repository's verify and aggregates the results.

## Existing Repositories

[List your repositories here.]
