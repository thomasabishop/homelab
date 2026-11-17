#!/usr/bin/env bash
# Regenerates homelab.svg, homelab_<stamp>.png and services/*/readme.md
# from homelab.json.
# Run from anywhere:  ./claude/generate.sh
#
# New services get a readme with a TODO description/crib to fill in by hand.
# If the diagram changed, the old PNG goes to history/ and meta.updated in
# homelab.json is stamped with the current time.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null; then
  echo "✗ node is not installed (need Node.js 22.6+)" >&2
  exit 1
fi
[ -d node_modules ] || npm ci --silent

node generate.ts "$@"
