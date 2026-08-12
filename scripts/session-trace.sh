#!/bin/bash
# Session trace: record start or end of a working session
# Usage: ./scripts/session-trace.sh start|end

MODE="${1:-start}"
TRACES_DIR=".harness/traces"
mkdir -p "$TRACES_DIR"

TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
TIMESTAMP_FILE=$(date -u +%Y%m%d-%H%M%S)

# Read active feature if jq is available
ACTIVE_FEATURE=""
if command -v jq >/dev/null 2>&1 && [ -f feature_list.json ]; then
  ACTIVE_FEATURE=$(jq -r '[.features[] | select(.state == "active")] | .[0].id // ""' feature_list.json 2>/dev/null || echo "")
elif command -v node >/dev/null 2>&1 && [ -f feature_list.json ]; then
  ACTIVE_FEATURE=$(node -e "
const data = require('./feature_list.json');
const feature = data.features.find((item) => item.state === 'active');
if (feature) console.log(feature.id);
" 2>/dev/null || echo "")
fi

GIT_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

if [ "$MODE" = "start" ]; then
  cat > "$TRACES_DIR/session-start-$TIMESTAMP_FILE.json" <<EOF
{
  "session_start": "$TS",
  "git_branch": "$GIT_BRANCH",
  "git_commit": "$GIT_COMMIT",
  "active_feature": "$ACTIVE_FEATURE"
}
EOF
  echo "Session start recorded: $TRACES_DIR/session-start-$TIMESTAMP_FILE.json"
  echo "Active feature: ${ACTIVE_FEATURE:-none}"

elif [ "$MODE" = "end" ]; then
  # Find the most recent session start file
  LATEST_START=$(ls -1t "$TRACES_DIR"/session-start-*.json 2>/dev/null | head -1)
  if [ -z "$LATEST_START" ]; then
    # No start file found; create end-only record
    cat > "$TRACES_DIR/session-$TIMESTAMP_FILE-end.json" <<EOF
{
  "session_end": "$TS",
  "git_branch": "$GIT_BRANCH",
  "git_commit": "$GIT_COMMIT",
  "active_feature": "$ACTIVE_FEATURE",
  "note": "No matching session-start trace found"
}
EOF
    echo "Session end recorded (no start trace): $TRACES_DIR/session-$TIMESTAMP_FILE-end.json"
  else
    # Update the start file with end info
    if command -v jq >/dev/null 2>&1; then
      jq --arg end "$TS" --arg branch "$GIT_BRANCH" --arg commit "$GIT_COMMIT" --arg feat "$ACTIVE_FEATURE" \
        '. + {session_end: $end, end_git_branch: $branch, end_git_commit: $commit, end_active_feature: $feat}' \
        "$LATEST_START" > "${LATEST_START}.tmp" && mv "${LATEST_START}.tmp" "$LATEST_START"
      echo "Session end recorded in: $LATEST_START"
    else
      echo "Session end at $TS (active feature: ${ACTIVE_FEATURE:-none})"
      echo "(install jq for structured trace records)"
    fi
  fi

else
  echo "Usage: $0 start|end"
  exit 1
fi