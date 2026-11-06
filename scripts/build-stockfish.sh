#!/usr/bin/env bash
# Build the native Stockfish the 20.0 app ships beside its executable
# (ADR 0004, v20-0-plan F3), from source, at a pinned tag and commit:
# full NNUE (the default network, embedded in the binary — `make` fetches it
# from tests.stockfishchess.org and checks its SHA-256 against its name),
# profile-guided (`profile-build` runs the bench and rebuilds).
#
#   scripts/build-stockfish.sh <out-dir>
#
#   macOS (arm64)    ARCH=apple-silicon, clang
#   Windows (x64)    ARCH=x86-64-avx2, MinGW-w64 GCC — run it in an MSYS2
#                    MINGW64 shell (build-windows.yml: msys2/setup-msys2).
#                    A CPU without AVX2 (before ~2013) cannot run it: the
#                    process dies at once and the app falls back to the
#                    wasm engine (engine-native.js nativeOrWasm).
#   Linux (x64)      ARCH=x86-64-avx2, for local tests only
#
# Writes <out-dir>/stockfish[.exe] and, for the licence (GPLv3 §6: the
# corresponding source), <out-dir>/stockfish-SOURCE.txt naming the tag, the
# commit and where the source is; Copying.txt and AUTHORS come along.
set -euo pipefail

TAG=sf_19
COMMIT=edb0d9db6731067ec50ce619ff372b463bc4dd5d
REPO=https://github.com/official-stockfish/Stockfish

out="${1:?usage: scripts/build-stockfish.sh <out-dir>}"
mkdir -p "$out"
out="$(cd "$out" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

case "$(uname -s)" in
  Darwin) arch=apple-silicon; comp=clang; exe=stockfish; jobs="$(sysctl -n hw.ncpu)" ;;
  MINGW*|MSYS*) arch=x86-64-avx2; comp=mingw; exe=stockfish.exe; jobs="$(nproc)" ;;
  Linux) arch=x86-64-avx2; comp=gcc; exe=stockfish; jobs="$(nproc)" ;;
  *) echo "build-stockfish: no recipe for $(uname -s)" >&2; exit 2 ;;
esac

git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$TAG" "$REPO" "$work/src"
got="$(git -C "$work/src" rev-parse HEAD)"
if [ "$got" != "$COMMIT" ]; then
  echo "build-stockfish: $TAG is $got, not the pinned $COMMIT — refusing to build an unreviewed source" >&2
  exit 1
fi

make -C "$work/src/src" -j"$jobs" profile-build ARCH="$arch" COMP="$comp"
strip "$work/src/src/$exe" || true
cp "$work/src/src/$exe" "$out/$exe"
cp "$work/src/Copying.txt" "$out/stockfish-COPYING.txt"
cp "$work/src/AUTHORS" "$out/stockfish-AUTHORS.txt"
net="$(grep -oE 'nn-[0-9a-f]{12}\.nnue' "$work/src/src/evaluate.h" | head -1)"
cat > "$out/stockfish-SOURCE.txt" <<EOF
Stockfish ($TAG), built for this app by scripts/build-stockfish.sh.
Licence: GNU GPL v3 (stockfish-COPYING.txt); authors: stockfish-AUTHORS.txt.
Source: $REPO/tree/$COMMIT
        (git clone --branch $TAG $REPO; commit $COMMIT)
Build:  make -C src profile-build ARCH=$arch COMP=$comp
Network: $net (embedded; https://tests.stockfishchess.org/api/nn/$net)
Unmodified.
EOF
"$out/$exe" bench 16 1 10 default depth > "$work/bench.txt" 2>&1 || true
echo "build-stockfish: $out/$exe ($(du -h "$out/$exe" | cut -f1)), $TAG $COMMIT, ARCH=$arch, $(grep -i 'Nodes/second' "$work/bench.txt" || echo 'no bench')"
