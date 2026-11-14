#!/usr/bin/env pwsh
#
# Run the built pi CLI (packages/coding-agent/dist/bundle/cli.js).
# This runs the compiled bundle, unlike ./pi-test.sh which runs the TypeScript sources.
#
# Build first from the repository root:
#   npm install --ignore-scripts
#   npm run hydrate:model-data     # only needed once per clone / after wiping src/providers/data
#   npm run build:offline
#
# Usage:
#   .\pi-built.ps1                 # interactive TUI
#   .\pi-built.ps1 -p "explain src/index.ts"
#   .\pi-built.ps1 --tui-mode fullscreen
#
$ErrorActionPreference = 'Stop'

$ScriptDir = $PSScriptRoot
$Bundle = Join-Path $ScriptDir 'packages\coding-agent\dist\bundle\cli.js'

if (-not (Test-Path -LiteralPath $Bundle -PathType Leaf)) {
	[Console]::Error.WriteLine("pi is not built: $Bundle not found")
	[Console]::Error.WriteLine("run: npm install --ignore-scripts && npm run hydrate:model-data && npm run build:offline")
	exit 1
}

& node $Bundle @args
exit $LASTEXITCODE