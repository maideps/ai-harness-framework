#!/bin/bash
set -e

# Run at end of session — confirm the repo is clean and restartable
# Usage: ./scripts/clean-state-check.sh

echo "=== Clean State Check ==="
echo ""

PASSING=true

# 1. Check required harness files exist
echo "--- Harness Files ---"
for f in AGENTS.md feature_list.json progress.md DECISIONS.md session-handoff.md Makefile; do
  if [ -f "$f" ]; then
    echo "  [PASS] $f"
  else
    echo "  [FAIL] $f is missing"
    PASSING=false
  fi
done

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
# Check for common debug artifacts
grep -rn --include='*.ts' --include='*.js' --include='*.tsx' --include='*.jsx' \
  -E 'console\.(log|debug|dir)\(|debugger' src/ 2>/dev/null && FOUND=true || true
grep -rn --include='*.py' -E 'print\(|pdb\.set_trace' src/ 2>/dev/null && FOUND=true || true
grep -rn --include='*.go' -E 'fmt\.Println\(|log\.Print' src/ 2>/dev/null && FOUND=true || true

if [ "$FOUND" = true ]; then
  echo "  [WARN] Potential debug statements found (review before committing)"
else
  echo "  [PASS] No obvious debug artifacts"
fi

# 4. Check feature list has at most one active feature
echo ""
echo "--- Feature State ---"
if command -v jq >/dev/null 2>&1 && [ -f feature_list.json ]; then
  ACTIVE_COUNT=$(jq '[.features[] | select(.status == "active")] | length' feature_list.json)
  if [ "$ACTIVE_COUNT" -le 1 ]; then
    echo "  [PASS] WIP=$ACTIVE_COUNT (at most 1 active feature)"
  else
    echo "  [FAIL] WIP=$ACTIVE_COUNT (multiple active features)"
    PASSING=false
  fi
elif command -v node >/dev/null 2>&1 && [ -f feature_list.json ]; then
  ACTIVE_COUNT=$(node -e "
const data = require('./feature_list.json');
console.log(data.features.filter(f => f.status === 'active').length);
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