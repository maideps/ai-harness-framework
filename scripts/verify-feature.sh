#!/bin/bash
# Compatibility shim — the canonical implementation lives in the Node runner.
# Usage: ./scripts/verify-feature.sh <feature-id>
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$DIR/framework-check.mjs" verify-feature "$@"
