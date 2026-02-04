#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT="tabmaster-chrome.zip"

cd "$ROOT_DIR"
rm -f "$OUTPUT"

echo "Packaging TabMaster for Chromium..."

zip -r "$OUTPUT" manifest.json popup icons README.md LICENSE >/dev/null

echo "✓ Created $OUTPUT"
echo "To load unpacked: chrome://extensions → enable Developer mode → Load unpacked → select this folder."
echo "To distribute: upload $OUTPUT to the Chrome Web Store or compatible Chromium store."
