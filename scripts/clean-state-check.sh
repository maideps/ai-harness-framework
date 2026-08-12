#!/bin/bash
set -e

# Run at end of session — confirm the repo is clean and restartable
# Usage: ./scripts/clean-state-check.sh

echo "=== Clean State Check ==="
echo ""

PASSING=true

# 1. Check required harness files exist
echo "--- Harness Files ---"
for f in AGENTS.md CLAUDE.md feature_list.json DECISIONS.md session-handoff.md Makefile; do
  if [ -f "$f" ]; then
    echo "  [PASS] $f"
  else
    echo "  [FAIL] $f is missing"
    PASSING=false
  fi
done

if [ -f "progress.md" ]; then
  echo "  [PASS] progress.md"
elif [ -f "claude-progress.md" ]; then
  echo "  [PASS] claude-progress.md"
else
  echo "  [FAIL] progress.md or claude-progress.md is missing"
  PASSING=false
fi

for d in docs templates scripts .harness; do
  if [ -d "$d" ]; then
    echo "  [PASS] $d/"
  else
    echo "  [FAIL] $d/ is missing"
    PASSING=false
  fi
done

# 2. Check git status is clean (no uncommitted changes)
echo ""
echo "--- Git Status ---"
if git rev-parse --git-dir >/dev/null 2>&1; then
  if [ -z "$(git status --porcelain)" ]; then
    echo "  [PASS] Working tree clean"
  else
    echo "  [FAIL] Uncommitted changes:"
    git status --short
    PASSING=false
  fi
else
  echo "  [WARN] Not a git repository"
fi

# 3. Check for debug artifacts
echo ""
echo "--- Debug Artifacts ---"
FOUND=false
# Check for common debug artifacts in configured paths.
# Set DEBUG_SCAN_PATHS (space-separated) to customize paths, e.g.:
# DEBUG_SCAN_PATHS="src packages apps"
# Set DEBUG_SCAN_EXCLUDE_DIRS (space-separated) to override excludes.
if [ -n "${DEBUG_SCAN_PATHS:-}" ]; then
  SCAN_PATHS="$DEBUG_SCAN_PATHS"
else
  CANDIDATES="src app apps lib packages services backend frontend"
  SCAN_PATHS=""
  for p in $CANDIDATES; do
    if [ -d "$p" ]; then
      SCAN_PATHS="$SCAN_PATHS $p"
    fi
  done
  if [ -z "$SCAN_PATHS" ]; then
    SCAN_PATHS="."
  fi
fi

EXCLUDE_DIRS=${DEBUG_SCAN_EXCLUDE_DIRS:-".git node_modules dist build .harness base"}
EXCLUDE_ARGS=""
for d in $EXCLUDE_DIRS; do
  EXCLUDE_ARGS="$EXCLUDE_ARGS --exclude-dir=$d"
done

grep -rn $EXCLUDE_ARGS \
  --include='*.ts' --include='*.js' --include='*.tsx' --include='*.jsx' \
  -E 'console\.(log|debug|dir)\(|debugger' $SCAN_PATHS 2>/dev/null && FOUND=true || true
grep -rn $EXCLUDE_ARGS \
  --include='*.py' -E 'print\(|pdb\.set_trace' $SCAN_PATHS 2>/dev/null && FOUND=true || true
grep -rn $EXCLUDE_ARGS \
  --include='*.go' -E 'fmt\.Println\(|log\.Print' $SCAN_PATHS 2>/dev/null && FOUND=true || true

if [ "$FOUND" = true ]; then
  echo "  [WARN] Potential debug statements found (review before committing)"
else
  echo "  [PASS] No obvious debug artifacts"
fi

# 4. Check feature list has at most one active feature
echo ""
echo "--- Feature State ---"
if command -v jq >/dev/null 2>&1 && [ -f feature_list.json ]; then
  ACTIVE_COUNT=$(jq '[.features[] | select((.state == "active") or (.status == "in_progress"))] | length' feature_list.json)
  if [ "$ACTIVE_COUNT" -le 1 ]; then
    echo "  [PASS] WIP=$ACTIVE_COUNT (at most 1 active feature)"
  else
    echo "  [FAIL] WIP=$ACTIVE_COUNT (multiple active features)"
    PASSING=false
  fi
elif command -v node >/dev/null 2>&1 && [ -f feature_list.json ]; then
  ACTIVE_COUNT=$(node -e "
const data = require('./feature_list.json');
console.log(data.features.filter(f => f.state === 'active' || f.status === 'in_progress').length);
")
  if [ "$ACTIVE_COUNT" -le 1 ]; then
    echo "  [PASS] WIP=$ACTIVE_COUNT (at most 1 active feature)"
  else
    echo "  [FAIL] WIP=$ACTIVE_COUNT (multiple active features)"
    PASSING=false
  fi
else
  echo "  [WARN] Cannot verify feature state (jq/node not available)"
fi

# 5. Check no .DS_Store or Thumbs.db staged
echo ""
echo "--- OS Artifacts ---"
STAGED_OS=$(git diff --cached --name-only 2>/dev/null | grep -E '\.DS_Store$|Thumbs\.db$' || true)
if [ -z "$STAGED_OS" ]; then
  echo "  [PASS] No OS artifacts staged"
else
  echo "  [FAIL] OS artifacts staged: $STAGED_OS"
  PASSING=false
fi

echo ""
if [ "$PASSING" = true ]; then
  echo "=== Clean state check: ALL PASS ==="
  echo "Ready to commit."
  exit 0
else
  echo "=== Clean state check: FAILURES DETECTED ==="
  echo "Fix issues above before committing."
  exit 1
fi