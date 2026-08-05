#!/bin/bash
set -e

# Enforce architectural constraints defined in .harness/arch-rules.json
# Usage: ./scripts/check-arch.sh

ARCH_RULES=".harness/arch-rules.json"

if [ ! -f "$ARCH_RULES" ]; then
  echo "=== Architecture check skipped: no arch-rules.json found ==="
  exit 0
fi

echo "=== Architecture Constraint Check ==="
echo ""

# Check if jq is available
HAS_JQ=false
command -v jq >/dev/null 2>&1 && HAS_JQ=true

if [ "$HAS_JQ" = false ]; then
  echo "[WARN] jq not available — architecture rules will not be evaluated"
  echo "Install jq to enable automated architecture enforcement"
  exit 1
fi

# Count rules
RULE_COUNT=$(jq '[.rules[]] | length' "$ARCH_RULES")

if [ "$RULE_COUNT" -eq 0 ]; then
  echo "[PASS] No architecture rules defined (acceptable for bootstrap)"
  exit 0
fi

echo "Evaluating $RULE_COUNT rules..."
echo ""

PASSING=true

for i in $(seq 0 $((RULE_COUNT - 1))); do
  RULE_ID=$(jq -r --arg idx "$i" '.rules[$idx | tonumber].id' "$ARCH_RULES")
  RULE_DESC=$(jq -r --arg idx "$i" '.rules[$idx | tonumber].description' "$ARCH_RULES")
  RULE_CHECK=$(jq -r --arg idx "$i" '.rules[$idx | tonumber].check' "$ARCH_RULES")
  RULE_EXPECT=$(jq -r --arg idx "$i" '.rules[$idx | tonumber].expect' "$ARCH_RULES")
  RULE_WHAT=$(jq -r --arg idx "$i" '.rules[$idx | tonumber].what' "$ARCH_RULES")
  RULE_WHY=$(jq -r --arg idx "$i" '.rules[$idx | tonumber].why' "$ARCH_RULES")
  RULE_FIX=$(jq -r --arg idx "$i" '.rules[$idx | tonumber].fix' "$ARCH_RULES")

  echo "Rule: $RULE_ID — $RULE_DESC"

  RESULT=$(eval "$RULE_CHECK" 2>&1) || true

  if echo "$RESULT" | grep -qE "$RULE_EXPECT"; then
    echo "  [PASS]"
  else
    echo "  [FAIL] $RULE_WHAT"
    echo "  Why: $RULE_WHY"
    echo "  Fix: $RULE_FIX"
    echo ""
    PASSING=false
  fi
done

echo ""
if [ "$PASSING" = true ]; then
  echo "=== All architecture rules pass ==="
  exit 0
else
  echo "=== Architecture constraint violations found ==="
  exit 1
fi