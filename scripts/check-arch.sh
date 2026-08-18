#!/bin/bash
# Compatibility shim — the canonical implementation lives in the Node runner.
# Usage: ./scripts/check-arch.sh
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$DIR/framework-check.mjs" check-arch "$@"
