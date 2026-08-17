#!/bin/bash
set -e

echo "=== Harness Initialization ==="

# Check for required tools
echo "=== Checking prerequisites ==="
command -v git >/dev/null 2>&1 || { echo "[WARN] git not found — version control won't be available"; }
command -v make >/dev/null 2>&1 || command -v mingw32-make >/dev/null 2>&1 || { echo "[WARN] make not found — use mingw32-make on Windows or install make"; }

# Detect package manager and install dependencies if a manifest exists
if [ -f package.json ]; then
  if [ -f pnpm-lock.yaml ]; then
    PM="pnpm"
  elif [ -f yarn.lock ]; then
    PM="yarn"
  elif [ -f bun.lock ] || [ -f bun.lockb ]; then
    PM="bun"
  else
    PM="npm"
  fi

  echo "=== Installing dependencies with $PM ==="
  if [ "$PM" = "npm" ]; then
    npm install
  else
    "$PM" install
  fi

  # Run type check if available
  node -e "const s=require('./package.json').scripts||{}; process.exit(s.check||s.typecheck||s['type-check']?0:1)" && {
    if node -e "const s=require('./package.json').scripts||{}; process.exit(s.check?0:1)"; then
      [ "$PM" = "npm" ] && npm run check || "$PM" run check
    elif node -e "const s=require('./package.json').scripts||{}; process.exit(s.typecheck?0:1)"; then
      [ "$PM" = "npm" ] && npm run typecheck || "$PM" run typecheck
    else
      [ "$PM" = "npm" ] && npm run type-check || "$PM" run type-check
    fi
  }

  # Run lint if available
  node -e "const s=require('./package.json').scripts||{}; process.exit(s.lint?0:1)" && {
    [ "$PM" = "npm" ] && npm run lint || "$PM" run lint
  }

  # Run tests if available
  node -e "const s=require('./package.json').scripts||{}; process.exit(s.test?0:1)" && {
    [ "$PM" = "npm" ] && npm test || "$PM" test
  }

  # Run build if available
  node -e "const s=require('./package.json').scripts||{}; process.exit(s.build?0:1)" && {
    [ "$PM" = "npm" ] && npm run build || "$PM" run build
  }
elif [ -f pyproject.toml ] || [ -f requirements.txt ]; then
  echo "=== Running Python verification ==="
  PY="$(command -v python3 || command -v python)"
  "$PY" -m pytest || [ $? -eq 5 ]  # pytest exits 5 when no tests — not a failure
  "$PY" -m compileall -q -x '(^|/)(\.?venv|env|node_modules|build|dist|__pycache__)(/|$)' .
elif [ -f go.mod ]; then
  echo "=== Running Go verification ==="
  go test ./...
elif [ -f Cargo.toml ]; then
  echo "=== Running Rust verification ==="
  cargo test
elif [ -f pom.xml ]; then
  echo "=== Running Maven verification ==="
  mvn test
elif [ -f build.gradle ] || [ -f build.gradle.kts ]; then
  echo "=== Running Gradle verification ==="
  ./gradlew test
elif ls *.csproj *.sln >/dev/null 2>&1; then
  echo "=== Running .NET verification ==="
  dotnet test
else
  echo "=== No application runtime detected (harness-only bootstrap) ==="
  echo "This is expected during initial harness setup."
  echo "Application verification will be available after feat-002 (Primary Capability)."
fi

echo ""
echo "=== Harness Verification ==="
echo ""

# Verify harness state files exist
HARNESS_OK=true

check_file() {
  if [ -f "$1" ]; then
    echo "  [PASS] $1 exists"
  else
    echo "  [FAIL] $1 is missing"
    HARNESS_OK=false
  fi
}

check_dir() {
  if [ -d "$1" ]; then
    echo "  [PASS] $1/ exists"
  else
    echo "  [FAIL] $1/ is missing"
    HARNESS_OK=false
  fi
}

check_progress_file() {
  if [ -f "PROGRESS.md" ]; then
    echo "  [PASS] PROGRESS.md exists"
  elif [ -f "progress.md" ]; then
    echo "  [PASS] progress.md exists (legacy naming)"
  elif [ -f "claude-progress.md" ]; then
    echo "  [PASS] claude-progress.md exists"
  else
    echo "  [FAIL] PROGRESS.md (or legacy progress.md) or claude-progress.md is missing"
    HARNESS_OK=false
  fi
}

echo "Checking harness state files..."
check_file "AGENTS.md"
check_file "CLAUDE.md"
check_file "feature_list.json"
check_progress_file
check_file "DECISIONS.md"
check_file "session-handoff.md"
check_file "Makefile"
check_dir "docs"
check_dir "templates"
check_dir "scripts"
check_dir ".harness"

if [ "$HARNESS_OK" = true ]; then
  echo ""
  echo "=== All harness files present ==="
else
  echo ""
  echo "=== Some harness files are missing — see above ==="
  exit 1
fi

echo ""
echo "=== Verification Complete ==="
echo ""
echo "Next steps:"
echo "1. Read feature_list.json to see current feature state"
echo "2. Pick ONE unfinished feature to work on"
echo "3. Implement only that feature"
echo "4. Run 'make check' before claiming done"