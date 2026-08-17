.PHONY: check lint typecheck test build e2e check-arch vcr verify-feature session-start session-end clean-check setup dev help

## Full verification — all layers in order.
## Layers that are not configured report SKIP and do not count as verified.
check: lint typecheck test build e2e
	@echo "=== make check: complete ==="
	@echo "  Any layer that reported SKIP was not configured and does not count as verified."

## Layer 1: Static analysis
lint:
	@echo "=== Layer 1: Static Analysis ==="
	@if [ -f package.json ]; then \
		if node -e "const s=require('./package.json').scripts||{}; process.exit(s.lint?0:1)"; then \
			npm run lint && echo "  [PASS] Layer 1 complete (npm run lint)"; \
		else \
			echo "  [SKIP] package.json has no lint script"; \
		fi; \
	elif [ -f pyproject.toml ]; then \
		if command -v ruff >/dev/null 2>&1; then \
			ruff check . && echo "  [PASS] Layer 1 complete (ruff)"; \
		else \
			echo "  [SKIP] ruff is not installed"; \
		fi; \
	elif [ -f go.mod ]; then \
		go vet ./... && echo "  [PASS] Layer 1 complete (go vet)"; \
	else \
		echo "  [SKIP] No lint configuration found"; \
	fi

## Layer 1b: Type checking
typecheck:
	@echo "=== Layer 1b: Type Checking ==="
	@if [ -f package.json ]; then \
		if node -e "const s=require('./package.json').scripts||{}; process.exit(s.typecheck||s['type-check']?0:1)"; then \
			if node -e "const s=require('./package.json').scripts||{}; process.exit(s.typecheck?0:1)"; then \
				npm run typecheck && echo "  [PASS] Layer 1b complete (npm run typecheck)"; \
			else \
				npm run type-check && echo "  [PASS] Layer 1b complete (npm run type-check)"; \
			fi; \
		else \
			echo "  [SKIP] package.json has no typecheck script"; \
		fi; \
	elif [ -f pyproject.toml ]; then \
		if command -v mypy >/dev/null 2>&1; then \
			mypy src/ && echo "  [PASS] Layer 1b complete (mypy)"; \
		else \
			echo "  [SKIP] mypy is not installed"; \
		fi; \
	else \
		echo "  [SKIP] No type checking configured"; \
	fi

## Layer 2: Runtime tests
test:
	@echo "=== Layer 2: Runtime Tests ==="
	@if [ -f package.json ]; then \
		if node -e "const s=require('./package.json').scripts||{}; process.exit(s.test?0:1)"; then \
			npm test && echo "  [PASS] Layer 2 complete (npm test)"; \
		else \
			echo "  [SKIP] package.json has no test script"; \
		fi; \
	elif [ -f pyproject.toml ] || [ -f requirements.txt ]; then \
		$$(command -v python3 || command -v python) -m pytest -q || [ $$? -eq 5 ] && echo "  [PASS] Layer 2 complete (pytest)"; \
	elif [ -f go.mod ]; then \
		go test ./... && echo "  [PASS] Layer 2 complete (go test)"; \
	elif [ -f Cargo.toml ]; then \
		cargo test && echo "  [PASS] Layer 2 complete (cargo test)"; \
	else \
		echo "  [SKIP] No tests configured"; \
	fi

## Layer 3a: Build verification
build:
	@echo "=== Layer 3: Build ==="
	@if [ -f package.json ]; then \
		if node -e "const s=require('./package.json').scripts||{}; process.exit(s.build?0:1)"; then \
			npm run build && echo "  [PASS] Layer 3 complete (npm run build)"; \
		else \
			echo "  [SKIP] package.json has no build script"; \
		fi; \
	elif [ -f go.mod ]; then \
		go build ./... && echo "  [PASS] Layer 3 complete (go build)"; \
	elif [ -f Cargo.toml ]; then \
		cargo build && echo "  [PASS] Layer 3 complete (cargo build)"; \
	else \
		echo "  [SKIP] No build step configured"; \
	fi

## Layer 3b: End-to-end tests
e2e:
	@echo "=== Layer 3b: E2E Tests ==="
	@if [ -f package.json ]; then \
		if node -e "const s=require('./package.json').scripts||{}; process.exit(s.e2e?0:1)"; then \
			npm run e2e; \
		else \
			echo "  [SKIP] package.json has no e2e script"; \
		fi; \
	else \
		echo "  [SKIP] No E2E tests configured"; \
	fi

## Architecture constraint check
check-arch:
	@bash scripts/check-arch.sh

## Verify a specific feature by its layer definitions
## Usage: make verify-feature F=feat-001
verify-feature:
	@bash scripts/verify-feature.sh $(F)

## Verify + check-arch + record (writes a verification trail to .harness/trails/)
vcr: check check-arch
	@node scripts/framework-check.mjs record-trail vcr
	@echo "=== VCR: Verify, Check-arch, Record — COMPLETE ==="

## Session lifecycle
session-start:
	@bash scripts/session-trace.sh start

session-end:
	@bash scripts/session-trace.sh end

## Clean state check (run before commit)
clean-check:
	@bash scripts/clean-state-check.sh

## One-time dependency installation
setup:
	@echo "=== Installing dependencies ==="
	@if [ -f package.json ]; then \
		npm install; \
	elif [ -f pyproject.toml ]; then \
		pip install -e ".[dev]"; \
	elif [ -f go.mod ]; then \
		go mod download; \
	elif [ -f Cargo.toml ]; then \
		cargo fetch; \
	else \
		echo "  [INFO] No dependency manifest found — skipping"; \
	fi
	@echo "  [PASS] Setup complete"

## Start local development server
dev:
	@echo "=== Starting dev server ==="
	@if [ -f package.json ]; then \
		if node -e "const s=require('./package.json').scripts||{}; process.exit(s.dev?0:1)"; then \
			npm run dev; \
		else \
			echo "  [WARN] No 'dev' script in package.json"; \
		fi; \
	elif [ -f docker-compose.yml ] || [ -f docker-compose.yaml ]; then \
		docker-compose up; \
	else \
		echo "  [WARN] No dev server configuration found"; \
	fi

## Help
help:
	@echo "Available targets:"
	@echo ""
	@echo "  setup         Install all dependencies from scratch"
	@echo "  dev           Start local development server"
	@echo "  check         Full verification: lint → typecheck → test → build → e2e"
	@echo "  lint          Layer 1: static analysis"
	@echo "  typecheck     Layer 1b: type checking"
	@echo "  test          Layer 2: runtime tests"
	@echo "  build         Layer 3: build verification"
	@echo "  e2e           Layer 3b: end-to-end tests"
	@echo "  check-arch    Architecture constraint enforcement"
	@echo "  verify-feature F=<id>  Run all verification layers for a feature"
	@echo "  vcr           verify + check-arch + record trail"
	@echo "  session-start Record session start"
	@echo "  session-end   Record session end"
	@echo "  clean-check   Pre-commit clean state verification"
	@echo "  help          Show this help"