#!/usr/bin/env bash
# A local macOS package, the way build-macos.yml makes one: src/app into
# frontend/dist, the Zig shell, a native Stockfish beside the executable
# (built once into build/stockfish), ad-hoc signed, zipped, and installed to
# ~/Applications/Chessboard.app.
#
#   scripts/package.sh            (needs zig 0.16, the Native SDK CLI, a C++ toolchain)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PATH="${HOME}/.native/toolchains/zig-0.16.0:${PATH}"

echo "==> the app's unit tests"
node scripts/test-app.mjs

echo "==> native Stockfish (build/stockfish, once)"
[ -x build/stockfish/stockfish ] || scripts/build-stockfish.sh build/stockfish

echo "==> frontend/dist from src/app, with the licences"
node scripts/sync-dist.mjs
cp build/stockfish/stockfish-SOURCE.txt build/stockfish/stockfish-AUTHORS.txt frontend/dist/licenses/

echo "==> derive the macOS manifest (close_policy = hide)"
node scripts/gen-manifest.mjs macos

echo "==> zig build -Doptimize=ReleaseFast"
zig build -Doptimize=ReleaseFast -Dmanifest=build/app.macos.zon

echo "==> native package, the .pgn document type, the engine (ad-hoc signed)"
mkdir -p dist
rm -rf dist/Chessboard.app
native package --target macos --signing adhoc --manifest build/app.macos.zon --output dist/Chessboard.app --binary zig-out/bin/chessboard
scripts/add-pgn-doctype.sh dist/Chessboard.app
scripts/add-engine.sh dist/Chessboard.app build/stockfish

echo "==> zip"
(
  cd dist
  rm -f Chessboard-macOS-arm64.zip
  ditto -c -k --sequesterRsrc --keepParent Chessboard.app Chessboard-macOS-arm64.zip
  ls -lh Chessboard-macOS-arm64.zip
)

echo "==> install ~/Applications/Chessboard.app"
rm -rf "${HOME}/Applications/Chessboard.app"
ditto dist/Chessboard.app "${HOME}/Applications/Chessboard.app"
rm -rf dist/Chessboard.app

echo "OK: ${HOME}/Applications/Chessboard.app"
echo "    dist/Chessboard-macOS-arm64.zip"
