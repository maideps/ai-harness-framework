#!/bin/bash
# Compatibility shim — the canonical implementation lives in the Node runner.
# Usage: ./scripts/session-trace.sh start|end
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$DIR/framework-check.mjs" session-trace "$@"
