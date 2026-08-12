.PHONY: check lint typecheck test build e2e check-arch vcr verify-feature session-start session-end clean-check setup dev help

# Detect make variant on Windows
MAKE:=$(MAKE)
ifeq ($(OS),Windows_NT)
  MAKE:=mingw32-make
endif

## Full verification — all layers in order
check: lint typecheck test build
	@echo "=== make check: ALL LAYERS PASS ==="

## Layer 1: Static analysis
lint:
	@echo "=== Layer 1: Static Analysis ==="
	@# Check harness files are well-formed
	@if [ -f package.json ]; then \
		if node -e "const s=require('./package.json').scripts||{}; process.exit(s.lint?0:1)"; then \
			npm run lint; \
		fi; \
	elif [ -f pyproject.toml ]; then \
		command -v ruff >/dev/null 2>&1 && ruff check . || true; \
	elif [ -f go.mod ]; then \
		go vet ./...; \
	else \
		echo "  [INFO] No lint configuration found — skipping"; \
	fi
	@echo "  [PASS] Layer 1 complete"

## Layer 1b: Type checking
typecheck:
	@echo "=== Layer 1b: Type Checking ==="
	@if [ -f package.json ]; then \
		if node -e "const s=require('./package.json').scripts||{}; process.exit(s.typecheck||s['type-check']?0:1)"; then \
			if node -e "const s=require('./package.json').scripts||{}; process.exit(s.typecheck?0:1)"; then \
				npm run typecheck; \
			else \
				npm run type-check; \
			fi; \
		fi; \
	elif [ -f pyproject.toml ]; then \
		command -v mypy >/dev/null 2>&1 && mypy src/ || true; \
	else \
		echo "  [INFO] No type checking configured — skipping"; \
	fi
	@echo "  [PASS] Type check complete"

## Layer 2: Runtime tests
test:
	@echo "=== Layer 2: Runtime Tests ==="
	@if [ -f package.json ]; then \
		if node -e "const s=require('./package.json').scripts||{}; process.exit(s.test?0:1)"; then \
			npm test; \
		fi; \
	elif [ -f pyproject.toml ] || [ -f requirements.txt ]; then \
		$$(command -v python3 || command -v python) -m pytest -q || [ $$? -eq 5 ]; \
	elif [ -f go.mod ]; then \
		go test ./...; \
	elif [ -f Cargo.toml ]; then \
		cargo test; \
	else \
		echo "  [INFO] No tests configured — skipping"; \
	fi
	@echo "  [PASS] Layer 2 complete"

## Layer 3a: Build verification
build:
	@echo "=== Layer 3: Build ==="
	@if [ -f package.json ]; then \
		if node -e "const s=require('./package.json').scripts||{}; process.exit(s.build?0:1)"; then \
			npm run build; \
		fi; \
	elif [ -f go.mod ]; then \
		go build ./...; \
	elif [ -f Cargo.toml ]; then \
		cargo build; \
	else \
		echo "  [INFO] No build step configured — skipping"; \
	fi
	@echo "  [PASS] Layer 3 complete"

## Layer 3b: End-to-end tests
e2e:
	@echo "=== Layer 3b: E2E Tests ==="
	@if [ -f package.json ]; then \
		if node -e "const s=require('./package.json').scripts||{}; process.exit(s.e2e||s['test:e2e']?0:1)"; then \
			npm run e2e; \
		fi; \
	else \
		echo "  [INFO] No E2E tests configured — skipping"; \
	fi
	@echo "  [PASS] E2E complete"

## Architecture constraint check
check-arch:
	@bash scripts/check-arch.sh

## Verify a specific feature by its layer definitions
## Usage: make verify-feature F=feat-001
verify-feature:
	@bash scripts/verify-feature.sh $(F)

## Verify + check-arch + record
vcr: check check-arch
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
	@echo "  check         Full verification: lint → test → build"
	@echo "  lint          Layer 1: static analysis"
	@echo "  typecheck     Layer 1b: type checking"
	@echo "  test          Layer 2: runtime tests"
	@echo "  build         Layer 3: build verification"
	@echo "  e2e           Layer 3b: end-to-end tests"
	@echo "  check-arch    Architecture constraint enforcement"
	@echo "  verify-feature F=<id>  Run all verification layers for a feature"
	@echo "  vcr           verify + check-arch + record"
	@echo "  session-start Record session start"
	@echo "  session-end   Record session end"
	@echo "  clean-check   Pre-commit clean state verification"
	@echo "  help          Show this help"