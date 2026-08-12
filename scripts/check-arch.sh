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

if command -v jq >/dev/null 2>&1; then
  RULE_COUNT=$(jq '[.rules[]] | length' "$ARCH_RULES")
  get_rule_field() {
    jq -r --arg idx "$1" --arg field "$2" '.rules[$idx | tonumber][$field]' "$ARCH_RULES"
  }
else
  RULE_COUNT=$(node -e "
const data = require('./$ARCH_RULES');
console.log(Array.isArray(data.rules) ? data.rules.length : 0);
")
  get_rule_field() {
    node -e "
const data = require('./$ARCH_RULES');
const rule = data.rules[Number(process.argv[1])] || {};
const value = rule[process.argv[2]];
if (value !== undefined && value !== null) console.log(value);
" "$1" "$2"
  }
fi

if [ "$RULE_COUNT" -eq 0 ]; then
  echo "[PASS] No architecture rules defined (acceptable for bootstrap)"
  exit 0
fi

echo "Evaluating $RULE_COUNT rules..."
echo ""

PASSING=true

for i in $(seq 0 $((RULE_COUNT - 1))); do
  RULE_ID=$(get_rule_field "$i" "id")
  RULE_DESC=$(get_rule_field "$i" "description")
  RULE_CHECK=$(get_rule_field "$i" "check")
  RULE_EXPECT=$(get_rule_field "$i" "expect")
  RULE_WHAT=$(get_rule_field "$i" "what")
  RULE_WHY=$(get_rule_field "$i" "why")
  RULE_FIX=$(get_rule_field "$i" "fix")

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