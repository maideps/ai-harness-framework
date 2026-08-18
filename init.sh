#!/bin/bash
set -e

echo "=== Harness Initialization ==="

# Check for required tools
echo "=== Checking prerequisites ==="
command -v git >/dev/null 2>&1 || { echo "[WARN] git not found — version control won't be available"; }
command -v make >/dev/null 2>&1 || command -v mingw32-make >/dev/null 2>&1 || { echo "[WARN] make not found — use the npm entrypoints (npm run <target>) instead"; }
if ! command -v node >/dev/null 2>&1; then
  echo "[FAIL] Node.js >= 18 not found — harness tooling (stack detection, verification layers, session traces) runs on Node"
  exit 1
fi

# Detect the project stack — single source of truth shared with the Makefile
# and the verification layers (scripts/stack-detect.mjs).
RUNTIME=$(node scripts/stack-detect.mjs runtime)
PM=$(node scripts/stack-detect.mjs package-manager)
echo ""
echo "=== Detected stack: ${RUNTIME}${PM:+ (package manager: $PM)} ==="

# Install dependencies if the stack declares an install step
INSTALL_CMD=$(node scripts/stack-detect.mjs install)
if [ -n "$INSTALL_CMD" ]; then
  echo "=== Installing dependencies: $INSTALL_CMD ==="
  eval "$INSTALL_CMD"
else
  echo "=== No dependency manifest found — skipping install ==="
fi

# Run the stack's verification chain
echo ""
echo "=== Running verification ==="
node scripts/framework-check.mjs verify-chain
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

echo "=== Harness Verification ==="
echo ""
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
echo "4. Run 'npm run check' (or 'make check') before claiming done"
