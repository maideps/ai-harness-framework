#!/bin/bash
# Compatibility shim — the canonical implementation lives in the Node runner.
# Usage: ./scripts/clean-state-check.sh
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$DIR/framework-check.mjs" clean-state-check "$@"
