#!/usr/bin/env bash
# Build the native Stockfish the 20.0 app ships beside its executable
# (ADR 0004, v20-0-plan F3), from source, at a pinned tag and commit:
# Stockfish 19 with the *lite* network embedded — the 1.2 MB network
# nn-61e7af4bb97d (mirrored piece-square features, "P_hm") instead of sf_19's
# 98 MB nn-1a298aa575a0 (threat features). sf_19 itself has one network only
# (no small net to pick with EvalFileSmall, as 16.1–18 had), so the source is
# nmrugg/stockfish.js — sf_19 plus the lite-net option (LITE_NET=yes: the
# P_hm feature set, evaluate.h's EvalFileLiteName) and its wasm glue, which a
# native build leaves out. It is the same engine and network as the wasm
# fallback (third_party/stockfish, stockfish.js 19 lite-single), native and
# multi-threaded. Why lite (v20-0-plan §10 F3b): the package goes from
# 114 / 116 MB to about 20 MB; what it costs the review's marks is measured
# there.
# `make` fetches the network from tests.stockfishchess.org and checks its
# SHA-256 against its name; profile-guided (`profile-build` runs the bench
# and rebuilds).
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

TAG=v19.0.1
COMMIT=0d5dd7944f88c817c07a26bc4fb1905d5f9c46d6
REPO=https://github.com/nmrugg/stockfish.js
UPSTREAM="official-stockfish/Stockfish sf_19 (edb0d9db6731067ec50ce619ff372b463bc4dd5d)"
NET=nn-61e7af4bb97d.nnue

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

# the one change made here: stockfish.js v19.0.1's native main() calls
# loop() on the unique_ptr (`uci.loop()`) and does not compile outside
# Emscripten; `uci->loop()` is what sf_19 has. Refuse if the line moved.
grep -q '^    uci\.loop();' "$work/src/src/main.cpp"
sed -i.orig 's/^    uci\.loop();/    uci->loop();/' "$work/src/src/main.cpp"
rm -f "$work/src/src/main.cpp.orig"
grep -q '^    uci->loop();' "$work/src/src/main.cpp"
make -C "$work/src/src" -j"$jobs" profile-build ARCH="$arch" COMP="$comp" LITE_NET=yes
strip "$work/src/src/$exe" || true
cp "$work/src/src/$exe" "$out/$exe"
cp "$work/src/Copying.txt" "$out/stockfish-COPYING.txt"
cp "$work/src/AUTHORS" "$out/stockfish-AUTHORS.txt"
net="$(grep -E '#define EvalFileLiteName' "$work/src/src/evaluate.h" | grep -oE 'nn-[0-9a-f]{12}\.nnue')"
if [ "$net" != "$NET" ]; then
  echo "build-stockfish: the lite network is $net, not the pinned $NET" >&2
  exit 1
fi
cat > "$out/stockfish-SOURCE.txt" <<EOF
Stockfish 19 (lite network), built for this app by scripts/build-stockfish.sh.
Licence: GNU GPL v3 (stockfish-COPYING.txt); authors: stockfish-AUTHORS.txt.
Source: $REPO/tree/$COMMIT
        (git clone --branch $TAG $REPO; commit $COMMIT)
        Stockfish.js $TAG is $UPSTREAM modified by its
        authors: a lite-network build option (USE_LITE_NET: the P_hm feature
        set in src/nnue/features/p_hm.*, src/nnue/nnue_architecture.h,
        src/evaluate.h) and WebAssembly glue the native build does not use.
Build:  make -C src profile-build ARCH=$arch COMP=$comp LITE_NET=yes
Network: $net (embedded; https://tests.stockfishchess.org/api/nn/$net)
Modified for this app: one line of src/main.cpp, "uci.loop();" to
"uci->loop();" (as in sf_19), so the native build compiles.
EOF
"$out/$exe" bench 16 1 10 default depth > "$work/bench.txt" 2>&1 || true
echo "build-stockfish: $out/$exe ($(du -h "$out/$exe" | cut -f1)), $TAG $COMMIT, ARCH=$arch, $(grep -i 'Nodes/second' "$work/bench.txt" || echo 'no bench')"
