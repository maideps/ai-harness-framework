# Repositories

Each subdirectory under `repositories/` is one execution domain with its own `scripts/verify`, `scripts/verify.mjs`, or `scripts/verify.cjs`:

```
repositories/
  <name>/
    scripts/
      verify        # optional extensionless verification launcher
      verify.mjs    # ESM verification entrypoint
      verify.cjs    # CommonJS verification entrypoint
    src/            # the repository's own code (product-owned)
```

Rules:

- Every repository SHOULD have one supported verify script that exits non-zero on failure — `verify-all` treats a missing verify script as SKIP, not PASS.
- A repository's verify script runs its own checks (harness check, tests, build) and prints its own PASS/SKIP/FAIL lines.
- The root `scripts/verify-all` (activated from `templates/multi-repo/verify-all`) runs every supported repository verify script and aggregates the results.

## Existing Repositories

[List your repositories here.]
