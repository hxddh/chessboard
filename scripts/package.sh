#!/usr/bin/env bash
# Build frontend dist, compile ReleaseFast, package Chessboard.app + zip.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PATH="${HOME}/.native/toolchains/zig-0.16.0:${PATH}"

echo "==> sync frontend/dist from src/web (engine sources, bundle, chunks, licences)"
# One script, not a hand-copied list. This file used to repeat the copies and
# the size guards; 6.1 added an on-demand chunk (chunk-eco.js) to the bundler
# and to sync-dist.mjs, and the copies here still named two files — the .app
# would have shipped without it and lost every opening name. sync-dist.mjs
# reads scripts/bundle.mjs CHUNKS, so a new chunk is packaged by existing.
node scripts/sync-dist.mjs

echo "==> unit tests"
node scripts/test-chess.mjs

# The browser checks run here too when a Chromium is around. They are not
# required locally — packaging must not need a browser download — so each one
# prints a notice and passes when it cannot run. The release workflow sets
# E2E_REQUIRED=1, where that notice is a failure instead.
echo "==> browser checks (skipped when playwright/Chromium are missing)"
node scripts/test-board-e2e.mjs
node scripts/test-clock-e2e.mjs
node scripts/test-content-e2e.mjs
node scripts/test-persist-e2e.mjs
node scripts/test-review-e2e.mjs

echo "==> derive the macOS manifest (close_policy = hide)"
node scripts/gen-manifest.mjs macos

echo "==> zig build -Doptimize=ReleaseFast"
zig build -Doptimize=ReleaseFast -Dmanifest=build/app.macos.zon

echo "==> native package"
mkdir -p dist
rm -rf dist/Chessboard.app
native package --target macos --signing adhoc --manifest build/app.macos.zon --output dist/Chessboard.app --binary zig-out/bin/chessboard

echo "==> declare the .pgn document type (Info.plist) and re-sign"
scripts/add-pgn-doctype.sh dist/Chessboard.app

echo "==> zip + remove package .app (avoid duplicate Launchpad entry)"
(
  cd dist
  rm -f Chessboard-macOS-arm64.zip
  ditto -c -k --sequesterRsrc --keepParent Chessboard.app Chessboard-macOS-arm64.zip
  rm -rf Chessboard.app
  ls -lh Chessboard-macOS-arm64.zip
)

echo "==> install ~/Applications/Chessboard.app"
rm -rf "${HOME}/Applications/Chessboard.app"
rm -rf dist/Chessboard.app dist/__MACOSX
unzip -q -o dist/Chessboard-macOS-arm64.zip -d dist -x '__MACOSX/*' '*/__MACOSX/*' || {
  unzip -q -o dist/Chessboard-macOS-arm64.zip -d dist
  rm -rf dist/__MACOSX
}
ditto dist/Chessboard.app "${HOME}/Applications/Chessboard.app"
rm -rf dist/Chessboard.app dist/__MACOSX

echo "OK: ${HOME}/Applications/Chessboard.app"
echo "    dist/Chessboard-macOS-arm64.zip"
