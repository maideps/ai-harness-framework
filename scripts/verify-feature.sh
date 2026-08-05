#!/bin/bash
set -e

# Verify a feature by running all its defined verification layers
# Usage: ./scripts/verify-feature.sh <feature-id>

FEATURE_ID="${1:-}"

if [ -z "$FEATURE_ID" ]; then
  echo "Usage: $0 <feature-id>"
  echo "Example: $0 feat-001"
  exit 1
fi

# Check if jq is available, otherwise use a basic grep approach
HAS_JQ=false
command -v jq >/dev/null 2>&1 && HAS_JQ=true

echo "=== Verifying feature: $FEATURE_ID ==="
echo ""

# Extract feature name
if [ "$HAS_JQ" = true ]; then
  FEATURE_NAME=$(jq -r --arg id "$FEATURE_ID" '.features[] | select(.id == $id) | .name' feature_list.json)
else
  FEATURE_NAME=$(python3 -c "
import json, sys
with open('feature_list.json') as f:
    data = json.load(f)
for feat in data['features']:
    if feat['id'] == '$FEATURE_ID':
        print(feat['name'])
        break
" 2>/dev/null || node -e "
const data = require('./feature_list.json');
const feat = data.features.find(f => f.id === '$FEATURE_ID');
if (feat) console.log(feat.name);
" 2>/dev/null || echo "$FEATURE_ID")
fi

if [ -z "$FEATURE_NAME" ] || [ "$FEATURE_NAME" = "null" ]; then
  echo "[FAIL] Feature $FEATURE_ID not found in feature_list.json"
  exit 1
fi

echo "Feature: $FEATURE_NAME"
echo ""

# Run each verification layer
PASSING=true

if [ "$HAS_JQ" = true ]; then
  LAYER_COUNT=$(jq --arg id "$FEATURE_ID" '[.features[] | select(.id == $id) | .layers[]] | length' feature_list.json)
else
  LAYER_COUNT=$(node -e "
const data = require('./feature_list.json');
const feat = data.features.find(f => f.id === '$FEATURE_ID');
console.log(feat ? feat.layers.length : 0);
")
fi

for i in $(seq 0 $((LAYER_COUNT - 1))); do
  if [ "$HAS_JQ" = true ]; then
    LAYER_LABEL=$(jq -r --arg id "$FEATURE_ID" --arg idx "$i" '.features[] | select(.id == $id) | .layers[$idx | tonumber].label' feature_list.json)
    LAYER_CMD=$(jq -r --arg id "$FEATURE_ID" --arg idx "$i" '.features[] | select(.id == $id) | .layers[$idx | tonumber].cmd' feature_list.json)
  else
    LAYER_LABEL=$(node -e "
const data = require('./feature_list.json');
const feat = data.features.find(f => f.id === '$FEATURE_ID');
console.log(feat.layers[$i].label);
")
    LAYER_CMD=$(node -e "
const data = require('./feature_list.json');
const feat = data.features.find(f => f.id === '$FEATURE_ID');
console.log(feat.layers[$i].cmd);
")
  fi

  echo "--- $LAYER_LABEL ---"
  echo "Running: $LAYER_CMD"
  echo ""

  if eval "$LAYER_CMD"; then
    echo ""
    echo "  [PASS] $LAYER_LABEL"
    echo ""
  else
    echo ""
    echo "  [FAIL] $LAYER_LABEL"
    echo ""
    PASSING=false

    if [ "$HAS_JQ" = true ]; then
      REPAIR=$(jq -r --arg id "$FEATURE_ID" --arg idx "$i" '.features[] | select(.id == $id) | .layers[$idx | tonumber].repair' feature_list.json)
    else
      REPAIR=$(node -e "
const data = require('./feature_list.json');
const feat = data.features.find(f => f.id === '$FEATURE_ID');
console.log(feat.layers[$i].repair);
")
    fi
    if [ -n "$REPAIR" ] && [ "$REPAIR" != "null" ]; then
      echo "Repair hint: $REPAIR"
    fi
    break
  fi
done

echo ""
if [ "$PASSING" = true ]; then
  echo "=== Feature $FEATURE_ID: ALL LAYERS PASS ==="
  # Update evidence if jq available
  if [ "$HAS_JQ" = true ]; then
    EVIDENCE="All verification layers passed at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    jq --arg id "$FEATURE_ID" --arg evidence "$EVIDENCE" \
      '(.features[] | select(.id == $id)).evidence = $evidence' feature_list.json > feature_list.json.tmp && \
      mv feature_list.json.tmp feature_list.json
    echo "Evidence recorded in feature_list.json"
  fi
  exit 0
else
  echo "=== Feature $FEATURE_ID: VERIFICATION FAILED ==="
  exit 1
fi