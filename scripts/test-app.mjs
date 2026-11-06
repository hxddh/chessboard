/**
 * Unit tests for the 20.0 app (src/app), in Node, no browser.
 * Each scripts/app/*.test.mjs exports `default (test) => { … }`.
 *   node scripts/test-app.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createHarness } from "./app/harness.mjs";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "app");
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".test.mjs")).sort();
const h = createHarness();
let total = { passed: 0, failed: 0 };
for (const f of files) {
  const mod = await import(pathToFileURL(path.join(DIR, f)));
  await mod.default(h.test);
  const before = { ...total };
  const r = await h.run(f.replace(".test.mjs", "") + ": ");
  total = { passed: r.passed, failed: r.failed };
  console.log(f + ": " + (total.passed - before.passed) + " passed" +
    (total.failed > before.failed ? ", " + (total.failed - before.failed) + " failed" : ""));
}
console.log("\ntest-app: " + total.passed + " passed, " + total.failed + " failed");
process.exit(total.failed ? 1 : 0);
