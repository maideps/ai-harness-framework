.PHONY: check lint typecheck test build e2e check-arch verify-feature vcr session-start session-end clean-check setup dev help

# Every target delegates to the Node runner (scripts/framework-check.mjs) and is
# mirrored 1:1 by an npm script, so `make check` ≡ `npm run check`.
# Stack detection is centralized in scripts/stack-detect.mjs.

## Full verification — all layers in order.
## Layers that are not configured report SKIP and do not count as verified.
check: lint typecheck test build e2e
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

## One-time dependency installation
setup:
	@node scripts/framework-check.mjs setup

## Start local development server
dev:
	@node scripts/framework-check.mjs run-layer dev

## Help
help:
	@node scripts/framework-check.mjs help
