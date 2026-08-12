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
  ACTIVE_FEATURE=$(jq -r '[.features[] | select((.state == "active") or (.status == "in_progress"))] | .[0].id // ""' feature_list.json 2>/dev/null || echo "")
elif command -v node >/dev/null 2>&1 && [ -f feature_list.json ]; then
  ACTIVE_FEATURE=$(node -e "
const data = require('./feature_list.json');
const feature = data.features.find((item) => item.state === 'active' || item.status === 'in_progress');
if (feature) console.log(feature.id);
" 2>/dev/null || echo "")
fi

collect_modified_files_json() {
  if command -v jq >/dev/null 2>&1; then
    {
      git diff --name-only --relative
      git ls-files --others --exclude-standard
    } | jq -Rsc 'split("\n") | map(select(length > 0)) | unique'
  elif command -v node >/dev/null 2>&1; then
    {
      git diff --name-only --relative
      git ls-files --others --exclude-standard
    } | node -e "
const fs = require('fs');
const lines = fs.readFileSync(0, 'utf8').split(/\r?\n/).filter(Boolean);
const unique = Array.from(new Set(lines));
process.stdout.write(JSON.stringify(unique));
"
  else
    echo "[]"
  fi
}

collect_decision_summary_json() {
  COUNT=$(grep -E '^### ' DECISIONS.md 2>/dev/null | wc -l | tr -d ' ')
  LATEST=$(grep -E '^### ' DECISIONS.md 2>/dev/null | tail -1 | sed 's/^### //')
  if command -v jq >/dev/null 2>&1; then
    jq -cn --argjson c "${COUNT:-0}" --arg latest "$LATEST" '{count: $c, latest: $latest}'
  elif command -v node >/dev/null 2>&1; then
    node -e "
const count = Number(process.argv[1] || '0');
const latest = process.argv[2] || '';
process.stdout.write(JSON.stringify({ count, latest }));
" "${COUNT:-0}" "$LATEST"
  else
    echo "{\"count\":0,\"latest\":\"\"}"
  fi
}

collect_verification_summary_json() {
  if [ -f feature_list.json ] && command -v jq >/dev/null 2>&1; then
    jq -cn --arg id "$ACTIVE_FEATURE" --arg ts "$TS" --slurpfile f feature_list.json '
      ($f[0].features // []) as $features |
      ($features | map(select(.id == $id)) | .[0]) as $active |
      {
        timestamp: $ts,
        active_feature: ($id // ""),
        feature_evidence: ($active.evidence // ""),
        layers: (($active.layers // []) | map({label, cmd}))
      }
    '
  elif [ -f feature_list.json ] && command -v node >/dev/null 2>&1; then
    node -e "
const fs = require('fs');
const ts = process.argv[1];
const id = process.argv[2] || '';
const data = JSON.parse(fs.readFileSync('feature_list.json', 'utf8'));
const features = Array.isArray(data.features) ? data.features : [];
const active = features.find((f) => f.id === id) || {};
const layers = Array.isArray(active.layers) ? active.layers.map((l) => ({ label: l.label, cmd: l.cmd })) : [];
process.stdout.write(JSON.stringify({
  timestamp: ts,
  active_feature: id,
  feature_evidence: active.evidence || '',
  layers
}));
" "$TS" "$ACTIVE_FEATURE"
  else
    echo "{\"timestamp\":\"$TS\",\"active_feature\":\"$ACTIVE_FEATURE\",\"feature_evidence\":\"\",\"layers\":[]}"
  fi
}

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
  FILES_MODIFIED_JSON=$(collect_modified_files_json)
  DECISIONS_JSON=$(collect_decision_summary_json)
  VERIFICATION_JSON=$(collect_verification_summary_json)

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
  "verification_results": $VERIFICATION_JSON,
  "files_modified": $FILES_MODIFIED_JSON,
  "decisions_recorded": $DECISIONS_JSON,
  "note": "No matching session-start trace found"
}
EOF
    echo "Session end recorded (no start trace): $TRACES_DIR/session-$TIMESTAMP_FILE-end.json"
  else
    # Update the start file with end info
    if command -v jq >/dev/null 2>&1; then
      jq --arg end "$TS" --arg branch "$GIT_BRANCH" --arg commit "$GIT_COMMIT" --arg feat "$ACTIVE_FEATURE" \
         --argjson verification "$VERIFICATION_JSON" --argjson files "$FILES_MODIFIED_JSON" --argjson decisions "$DECISIONS_JSON" \
        '. + {
          session_end: $end,
          end_git_branch: $branch,
          end_git_commit: $commit,
          end_active_feature: $feat,
          verification_results: $verification,
          files_modified: $files,
          decisions_recorded: $decisions
        }' \
        "$LATEST_START" > "${LATEST_START}.tmp" && mv "${LATEST_START}.tmp" "$LATEST_START"
      echo "Session end recorded in: $LATEST_START"
    else
      cat > "$TRACES_DIR/session-$TIMESTAMP_FILE-end.json" <<EOF
{
  "session_end": "$TS",
  "git_branch": "$GIT_BRANCH",
  "git_commit": "$GIT_COMMIT",
  "active_feature": "$ACTIVE_FEATURE",
  "verification_results": $VERIFICATION_JSON,
  "files_modified": $FILES_MODIFIED_JSON,
  "decisions_recorded": $DECISIONS_JSON,
  "note": "jq not available; wrote end-only trace"
}
EOF
      echo "Session end recorded (no jq merge): $TRACES_DIR/session-$TIMESTAMP_FILE-end.json"
    fi
  fi

else
  echo "Usage: $0 start|end"
  exit 1
fi