#!/usr/bin/env bash
# Build frontend dist, compile ReleaseFast, package Chessboard.app + zip.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PATH="${HOME}/.native/toolchains/zig-0.16.0:${PATH}"

echo "==> generate engine sources (Stockfish loader + wasm base64)"
node scripts/gen-engine-src.mjs

echo "==> bundle the ES modules into one classic script"
node scripts/bundle.mjs

echo "==> sync frontend/dist from src/web"
rm -rf frontend/dist
mkdir -p frontend/dist/js
cp src/web/index.html frontend/dist/
cp src/web/styles.css frontend/dist/
# Only the two generated scripts ship. index.html loads exactly these; the 28
# module sources are inputs to the bundle, not part of the product, and copying
# them would put a second (unloaded, drifting) copy of the app in the .app.
cp src/web/js/bundle.js frontend/dist/js/
cp src/web/js/engine-src.js frontend/dist/js/
# sanity: what index.html asks for is what is there
test -f frontend/dist/index.html
test -f frontend/dist/styles.css
test -f frontend/dist/js/bundle.js
# the bundle must be the whole app, not an early-exit stub
test "$(wc -c < frontend/dist/js/bundle.js)" -gt 400000
# engine-src must carry the full wasm payload (~9MB), not a stub
test "$(wc -c < frontend/dist/js/engine-src.js)" -gt 5000000

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
