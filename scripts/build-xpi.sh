#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
XPI="$DIST_DIR/ai4zotero.xpi"

mkdir -p "$DIST_DIR"
rm -f "$DIST_DIR"/*.xpi

cd "$ROOT_DIR"
zip -X -r "$XPI" \
  manifest.json \
  bootstrap.js \
  chrome \
  locale \
  README.md \
  -x '*.DS_Store'

echo "Built $XPI"
