.PHONY: check lint typecheck test build e2e check-arch verify-feature vcr session-start session-end clean-check setup dev help lane-new lane-list lane-land lane-drop migrate-feature-state add-feature activate backup-list backup-pin backup-unpin backup-restore

# Every target delegates to the Node runner (scripts/framework-check.mjs) and is
# mirrored 1:1 by an npm script, so `make check` ≡ `npm run check`.
# Stack detection is centralized in scripts/stack-detect.mjs.

## Full verification — all layers in order.
## Layers that are not configured report SKIP and do not count as verified.
check: lint typecheck test build e2e verify-all
	@echo "=== make check: complete ==="
	@echo "  Any layer that reported SKIP was not configured and does not count as verified."

## Layer 1: Static analysis
lint:
	@node scripts/framework-check.mjs run-layer lint

## Layer 1b: Type checking
typecheck:
	@node scripts/framework-check.mjs run-layer typecheck

## Layer 2: Runtime tests
test:
	@node scripts/framework-check.mjs run-layer test

## Layer 3: Build verification
build:
	@node scripts/framework-check.mjs run-layer build

## Layer 3b: End-to-end tests
e2e:
	@node scripts/framework-check.mjs run-layer e2e

## Architecture constraint check
check-arch:
	@node scripts/framework-check.mjs check-arch

## Verify a specific feature by its layer definitions
## Usage: make verify-feature F=<id>
verify-feature:
	@node scripts/framework-check.mjs verify-feature $(F)

## Multi-repo verification — runs repositories/*/scripts/verify (SKIP when inactive)
verify-all:
	@node scripts/framework-check.mjs verify-all

## Worktree lanes (feat-010) — parallel isolated development lanes, git branch-checkout
## exclusivity is the coordination primitive (see DECISIONS.md D-017)
## Usage: make lane-new F=<feature-id>
lane-new:
	@node scripts/framework-check.mjs lane-new $(F)

## List local lane/* branches, their feature, state, and worktree path
lane-list:
	@node scripts/framework-check.mjs lane-list

## Merge a passing lane back into the current branch and clean up its worktree/branch
## Usage: make lane-land F=<feature-id>  (run from the branch you want to merge into)
lane-land:
	@node scripts/framework-check.mjs lane-land $(F)

## Abandon a lane's worktree without merging (branch is left intact)
## Usage: make lane-drop F=<feature-id>
lane-drop:
	@node scripts/framework-check.mjs lane-drop $(F)

## Sharded feature state (feat-011) — one-time migration: moves inline
## state/evidence out of feature_list.json into .harness/state/<id>.json.
## Idempotent; safe to run on a repo that has already migrated.
migrate-feature-state:
	@node scripts/framework-check.mjs migrate-feature-state

## Add a configured feature declaration to feature_list.json.
## Usage: make add-feature ID=<feature-id> NAME=<name>
add-feature:
	@node scripts/framework-check.mjs add-feature $(ID) $(NAME)

## Activate a feature after its dependencies pass; enforces WIP=1 immediately.
## Usage: make activate F=<feature-id>
activate:
	@node scripts/framework-check.mjs activate $(F)

## Verify + check-arch + record (writes a verification trail to .harness/trails/)
vcr: check check-arch
	@node scripts/framework-check.mjs record-trail vcr
	@echo "=== VCR: Verify, Check-arch, Record — COMPLETE ==="

## Session lifecycle
session-start:
	@node scripts/framework-check.mjs session-trace start

session-end:
	@node scripts/framework-check.mjs session-trace end

## Clean state check (run before commit)
clean-check:
	@node scripts/framework-check.mjs clean-state-check

## Distribution tools (feat-006) — read the manifest
create-harness:
	@node scripts/create-harness.mjs $(D)

harness-upgrade:
	@node scripts/harness-upgrade.mjs $(D)

harness-audit:
	@node scripts/harness-audit.mjs $(D)

## Upgrade backups (feat-012) — checksum-deduped, compressed, pinnable
## snapshots taken automatically before harness-upgrade overwrites CORE
## surfaces. Operate on the current directory.
backup-list:
	@node scripts/harness-backup.mjs list

backup-pin:
	@node scripts/harness-backup.mjs pin $(F)

backup-unpin:
	@node scripts/harness-backup.mjs unpin $(F)

## Usage: make backup-restore F=<backup-id|latest>
backup-restore:
	@node scripts/harness-backup.mjs restore $(F)

## Observability tools (feat-007) — session reports and periodic sweep
report:
	@node scripts/harness-report.mjs

sweep:
	@node scripts/harness-sweep.mjs

## One-time dependency installation
setup:
	@node scripts/framework-check.mjs setup

## Start local development server
dev:
	@node scripts/framework-check.mjs run-layer dev

## Help
help:
	@node scripts/framework-check.mjs help
