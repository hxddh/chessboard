/**
 * Build the Maia-3 gemm kernel: src/app/services/maia3/kernels.c → kernels.wasm
 * (wasm32 + SIMD128, no libc). Dev-time only: the .wasm is committed next to
 * its source, so neither the app nor the tests need clang.
 *
 *   node scripts/gen-maia3-wasm.mjs          (CLANG=path to pick a clang ≥ 16)
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "app", "services", "maia3");
const out = path.join(DIR, "kernels.wasm");
execFileSync(process.env.CLANG || "clang", [
  "--target=wasm32", "-O3", "-msimd128", "-nostdlib", "-ffreestanding", "-fno-builtin",
  "-Wl,--no-entry", "-Wl,--export=__heap_base", "-Wl,--strip-all", "-Wl,--initial-memory=131072",
  "-o", out, path.join(DIR, "kernels.c"),
], { stdio: "inherit" });
console.log(path.relative(process.cwd(), out) + ": " + fs.statSync(out).size + " bytes");
