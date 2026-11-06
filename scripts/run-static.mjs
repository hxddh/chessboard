/**
 * `npm run test:static`, in parallel (18.0 E).
 *
 * Through 17.0 the script was 24 files chained with `&&`: 227 s on a
 * four-core machine, one test at a time, while README said 秒级. Each file
 * is its own process with its own temp dirs, so they run side by side —
 * with one exception: test-chess builds the bundle and writes it
 * (test/first-paint.mjs), so it runs first and alone, and nothing reads a
 * bundle half written. Each file's output is printed whole, in the order
 * of the list, once it is done; the run fails if any file fails.
 *
 *   node scripts/run-static.mjs            (JOBS=n to set the width)
 */
import { spawn } from "child_process";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIRST = "test-chess.mjs";
const REST = ["test-pgn.mjs", "test-learning.mjs", "test-library.mjs", "test-library-db.mjs", "test-library-local.mjs",
  "test-explorer.mjs", "test-sync.mjs", "test-brand.mjs", "test-progress-metrics.mjs", "test-persist.mjs",
  "test-repertoire.mjs", "test-rep-book.mjs", "test-eco.mjs", "test-review-winpct.mjs", "test-explain.mjs",
  "test-classics.mjs", "test-endgames.mjs", "test-lessons-adv.mjs", "test-engine.mjs", "test-human.mjs",
  "test-deps.mjs", "test-sdk-diff.mjs", "manifest-check.mjs", "test-app.mjs"];
export const STATIC_FILES = [FIRST, ...REST];

function run(file) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(process.execPath, [path.join(HERE, file)], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { out += d; });
    p.on("close", (code) => resolve({ file, code, out, s: (Date.now() - t0) / 1000 }));
  });
}

async function main() {
  const t0 = Date.now();
  const results = [await run(FIRST)];
  const width = Math.max(1, Number(process.env.JOBS) || os.availableParallelism?.() || os.cpus().length);
  const queue = REST.slice(), done = new Map();
  await Promise.all(Array.from({ length: Math.min(width, queue.length) }, async () => {
    while (queue.length) { const f = queue.shift(); done.set(f, await run(f)); }
  }));
  for (const f of REST) results.push(done.get(f));
  for (const r of results) {
    process.stdout.write("\n== " + r.file + " (" + r.s.toFixed(1) + " s, exit " + r.code + ")\n" + r.out);
  }
  const bad = results.filter((r) => r.code !== 0);
  console.log("\n" + results.length + " files, " + ((Date.now() - t0) / 1000).toFixed(0) + " s" +
    (bad.length ? " — failed: " + bad.map((r) => r.file).join(", ") : " — all passed"));
  process.exit(bad.length ? 1 : 0);
}

if (import.meta.url === "file://" + process.argv[1] || process.argv[1] && process.argv[1].endsWith("run-static.mjs")) main();
