#!/usr/bin/env bash
# Build frontend dist, compile ReleaseFast, package Chessboard.app + zip.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PATH="${HOME}/.native/toolchains/zig-0.16.0:${PATH}"

echo "==> generate engine sources (Stockfish loader + wasm base64)"
node scripts/gen-engine-src.mjs

echo "==> sync frontend/dist from src/web"
rm -rf frontend/dist
mkdir -p frontend/dist/js
cp src/web/index.html frontend/dist/
cp src/web/styles.css frontend/dist/
cp src/web/js/*.js frontend/dist/js/
# sanity: required files
test -f frontend/dist/index.html
test -f frontend/dist/js/chess.js
test -f frontend/dist/js/host.js
test -f frontend/dist/js/audio.js
test -f frontend/dist/js/board.js
test -f frontend/dist/js/app.js
test -f frontend/dist/js/engine.js
# engine-src must carry the full wasm payload (~9MB), not a stub
test "$(wc -c < frontend/dist/js/engine-src.js)" -gt 5000000

echo "==> unit tests"
node scripts/test-chess.mjs

echo "==> zig build -Doptimize=ReleaseFast"
zig build -Doptimize=ReleaseFast

echo "==> native package"
mkdir -p dist
rm -rf dist/Chessboard.app
native package --target macos --signing adhoc --output dist/Chessboard.app --binary zig-out/bin/chessboard

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
