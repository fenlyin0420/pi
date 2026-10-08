#!/usr/bin/env bash
#
# Run the built pi CLI (packages/coding-agent/dist/bundle/cli.js).
# This runs the compiled bundle, unlike ./pi-test.sh which runs the TypeScript sources.
#
# Build first from the repository root:
#   npm install --ignore-scripts
#   npm run hydrate:model-data     # only needed once per clone / after wiping src/providers/data
#   node fork/build.fork.mjs       # NOT `npm run build:offline` — see fork/AGENTS.md
#
# build.fork.mjs runs build:offline itself, then applies the fork carrier
# (OAuth trim). Plain build:offline leaves the OAuth flows in the bundle.
#
# Usage:
#   ./pi-built.sh                 # interactive TUI
#   ./pi-built.sh -p "explain src/index.ts"
#   ./pi-built.sh --tui-mode fullscreen
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLE="$SCRIPT_DIR/packages/coding-agent/dist/bundle/cli.js"

if [[ ! -f "$BUNDLE" ]]; then
	echo "pi is not built: $BUNDLE not found" >&2
	echo "run: npm install --ignore-scripts && npm run hydrate:model-data && node fork/build.fork.mjs" >&2
	exit 1
fi

exec node "$BUNDLE" "$@"
