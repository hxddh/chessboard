/**
 * `npm run test:static`: every check that needs no browser and no native
 * build, side by side. Each is its own process; each one's output is printed
 * whole, in the order of the list, once it is done; the run fails if any
 * fails.
 *
 *   test-app.mjs          the app's unit tests (scripts/app/*.test.mjs):
 *                         rules, the db contract (memory and node:sqlite),
 *                         the engine contract, content, the learner model,
 *                         review, opponents, three languages, contrast …
 *   gen-skills --check    the generated content (src/app/content) is what the
 *                         generator makes from its sources, re-proved
 *   ci-check.mjs          the workflows: pinned runners, every suite runs in
 *                         a PR check, nothing runs only at release
 *   test-sdk-diff.mjs     sdk-diff, offline (the fork registry is true)
 *   manifest-check.mjs    every manifest key is read; the bridge commands the
 *                         page calls are registered; one version everywhere
 *   test-deps.mjs         docs/deps-inventory.json says what the repo pins
 *   test-brand.mjs        the committed icons
 *
 *   node scripts/run-static.mjs            (JOBS=n to set the width)
 */
import { spawn } from "child_process";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const STATIC = [
  ["test-app.mjs"], ["gen-skills.mjs", "--check"], ["ci-check.mjs"], ["test-sdk-diff.mjs"],
  ["manifest-check.mjs"], ["test-deps.mjs"], ["test-brand.mjs"],
];

function run([file, ...args]) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(process.execPath, [path.join(HERE, file), ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { out += d; });
    p.on("close", (code) => resolve({ name: [file, ...args].join(" "), code, out, s: (Date.now() - t0) / 1000 }));
  });
}

async function main() {
  const t0 = Date.now();
  const width = Math.max(1, Number(process.env.JOBS) || os.availableParallelism?.() || os.cpus().length);
  const queue = STATIC.slice(), done = new Map();
  await Promise.all(Array.from({ length: Math.min(width, queue.length) }, async () => {
    while (queue.length) { const f = queue.shift(); done.set(f, await run(f)); }
  }));
  const results = STATIC.map((f) => done.get(f));
  for (const r of results) process.stdout.write("\n== " + r.name + " (" + r.s.toFixed(1) + " s, exit " + r.code + ")\n" + r.out);
  const bad = results.filter((r) => r.code !== 0);
  console.log("\n" + results.length + " checks, " + ((Date.now() - t0) / 1000).toFixed(0) + " s" +
    (bad.length ? " — failed: " + bad.map((r) => r.name).join(", ") : " — all passed"));
  process.exit(bad.length ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
