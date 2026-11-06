#!/usr/bin/env bash
# Put the native Stockfish (scripts/build-stockfish.sh) into a packaged 20.0
# app, beside the executable — where src/engine.zig looks for it:
#
#   macOS    Chessboard.app/Contents/MacOS/stockfish, signed on its own first
#            (nested code must be signed before the bundle that seals it),
#            then the bundle re-signed and verified (--deep --strict)
#   Windows  Chessboard\bin\stockfish.exe
#
# Ad-hoc signed ("-") until the Developer ID of v20-0-plan E2 exists; pass
# the identity as $3 then. The licence and source notes travel in the page's
# licenses/ folder (the workflow copies stockfish-SOURCE.txt / -AUTHORS.txt
# into frontend/dist/licenses before `native package`).
#
#   scripts/add-engine.sh dist/Chessboard.app build/stockfish [identity]
#   scripts/add-engine.sh dist/Chessboard     build/stockfish
set -euo pipefail

pkg="${1:?usage: scripts/add-engine.sh <package> <engine-dir> [identity]}"
engines="${2:?usage: scripts/add-engine.sh <package> <engine-dir> [identity]}"
identity="${3:--}"

if [ -d "$pkg/Contents/MacOS" ]; then
  test -x "$engines/stockfish"
  cp "$engines/stockfish" "$pkg/Contents/MacOS/stockfish"
  chmod 755 "$pkg/Contents/MacOS/stockfish"
  codesign --force --sign "$identity" "$pkg/Contents/MacOS/stockfish"
  codesign --force --deep --sign "$identity" "$pkg"
  codesign --verify --deep --strict --verbose=2 "$pkg"
  codesign --verify --strict "$pkg/Contents/MacOS/stockfish"
  echo "add-engine: $pkg/Contents/MacOS/stockfish ($(du -h "$pkg/Contents/MacOS/stockfish" | cut -f1)), signed ($identity)"
else
  bin="$(dirname "$(find "$pkg" -name chessboard.exe | head -n1)")"
  test -n "$bin" && test -f "$engines/stockfish.exe"
  cp "$engines/stockfish.exe" "$bin/stockfish.exe"
  echo "add-engine: $bin/stockfish.exe ($(du -h "$bin/stockfish.exe" | cut -f1))"
fi
