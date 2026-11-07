/**
 * The workflows, checked (ADR 0005, v20-0-plan §7 E3 / E4):
 *
 *   pinned      no runner label floats (`-latest` moves under you: macos-14's
 *               retirement failed a release); every job that runs on a runner
 *               has a timeout
 *   every suite every test package.json's `npm test` runs is run by a PR
 *               check, and every browser suite in scripts/ is in `npm test`
 *               (a suite nobody runs is a suite that rots)
 *   no release-only checks
 *               every check command the release workflow runs — in its own
 *               jobs and in every workflow it calls — is run by some workflow
 *               a pull request triggers (or one that workflow calls). 19.0.0's
 *               first release failed on test-strength, which only the release
 *               ran.
 *   one gate    release.yml's publishing job needs every other job
 *
 *   node scripts/ci-check.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const WF = path.join(ROOT, ".github/workflows");
let failed = 0;
const assert = (cond, msg) => { if (cond) console.log("ok:", msg); else { failed++; console.error("FAIL:", msg); } };
const read = (f) => fs.readFileSync(path.join(WF, f), "utf8").replace(/\r\n/g, "\n");
const files = fs.readdirSync(WF).filter((f) => /\.ya?ml$/.test(f)).sort();

/** The jobs of a workflow: name → its text (from its header line to the next job's). */
export function jobsOf(text) {
  const at = text.search(/^jobs:\s*$/m);
  if (at < 0) return {};
  const body = text.slice(at);
  const heads = [...body.matchAll(/^ {2}([\w-]+):\s*$/gm)];
  return Object.fromEntries(heads.map((m, i) => [m[1], body.slice(m.index, i + 1 < heads.length ? heads[i + 1].index : undefined)]));
}

/** Every command line in a job's `run:` steps (block scalars unfolded line by line). */
export function commandsOf(text) {
  const out = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:- )?run:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    if (m[2] && !/^[|>][-+]?\s*$/.test(m[2])) { out.push(m[2].trim()); continue; }
    const indent = m[1].length;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() && l.search(/\S/) <= indent) break;
      if (l.trim() && !l.trim().startsWith("#")) out.push(l.trim());
    }
  }
  return out;
}

/** Workflows a workflow calls (`uses: ./.github/workflows/x.yml`). */
const calls = (text) => [...text.matchAll(/uses:\s*\.\/\.github\/workflows\/([\w.-]+\.ya?ml)/g)].map((m) => m[1]);
function closure(roots) {
  const seen = new Set(), queue = [...roots];
  while (queue.length) {
    const f = queue.shift();
    if (seen.has(f) || !files.includes(f)) continue;
    seen.add(f);
    queue.push(...calls(read(f)));
  }
  return [...seen];
}
const triggers = (text) => {
  const on = /^on:\s*\n((?:[ \t]+.*\n|\s*\n)*)/m.exec(text);
  return on ? [...on[1].matchAll(/^ {2}([\w_]+):/gm)].map((m) => m[1]) : [];
};
/** A line that checks something: a test, a build, a verification — not plumbing (echo, cp, mkdir, gh …). */
const isCheck = (l) => /^(node|npm|npx|zig|python3?|native|scripts\/)\b/.test(l) && !/^npm (ci|install)\b/.test(l) && !/^npx --yes playwright@[\d.]+ install\b/.test(l);
const norm = (l) => l.replace(/\s+/g, " ").trim();

// --- pinned --------------------------------------------------------------------
for (const f of files) {
  const text = read(f);
  const floating = [...text.matchAll(/runs-on:\s*([^\n]+)/g)].map((m) => m[1]).filter((l) => /-latest\b/.test(l));
  const matrixFloating = [...text.matchAll(/\b[\w.]+-latest\b/g)].map((m) => m[0]);
  assert(floating.length === 0 && matrixFloating.length === 0, f + ": every runner label is a pinned image (" + [...floating, ...matrixFloating].join(", ") + ")");
  const jobs = jobsOf(text);
  const untimed = Object.entries(jobs).filter(([, t]) => /^\s{4}runs-on:/m.test(t) && !/^\s{4}timeout-minutes:/m.test(t)).map(([n]) => n);
  assert(untimed.length === 0, f + ": every job has a timeout" + (untimed.length ? " — none on " + untimed.join(", ") : ""));
}

// --- every suite ------------------------------------------------------------------
{
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const prFiles = closure(files.filter((f) => triggers(read(f)).includes("pull_request")));
  const prLines = new Set(prFiles.flatMap((f) => commandsOf(read(f)).map(norm)));
  const npmIn = (cmd) => [...String(cmd).matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]);
  const testScripts = npmIn(pkg.scripts.test);
  assert(testScripts.length >= 3, "npm test runs the static checks, the browser suites and the visual baseline (" + testScripts.join(", ") + ")");
  for (const s of testScripts) assert(prLines.has("npm run " + s), "a PR check runs `npm run " + s + "` (" + prFiles.join(", ") + ")");
  const suites = fs.readdirSync(path.join(ROOT, "scripts")).filter((f) => /-e2e\.mjs$/.test(f));
  const inTest = testScripts.map((s) => pkg.scripts[s]).join(" ");
  const orphans = suites.filter((f) => !inTest.includes("scripts/" + f));
  assert(suites.length > 0 && orphans.length === 0, "every browser suite in scripts/ is in npm test (" + suites.length + ")" + (orphans.length ? " — not run: " + orphans.join(", ") : ""));
}

// --- no release-only checks --------------------------------------------------------
{
  const prFiles = closure(files.filter((f) => triggers(read(f)).includes("pull_request")));
  const relFiles = closure(["release.yml"]);
  const prLines = new Set(prFiles.flatMap((f) => commandsOf(read(f)).map(norm)));
  const relChecks = [...new Set(relFiles.flatMap((f) => commandsOf(read(f)).filter(isCheck).map(norm)))];
  const releaseOnly = relChecks.filter((l) => !prLines.has(l));
  assert(relFiles.includes("release.yml") && relChecks.length > 10,
    "the release runs " + relChecks.length + " check commands (" + relFiles.join(", ") + ")");
  assert(releaseOnly.length === 0, "every check the release runs, a PR check runs too" + (releaseOnly.length ? " — release only: " + releaseOnly.join(" | ") : ""));
  // the called workflows can be called
  for (const f of new Set([...prFiles, ...relFiles].flatMap((x) => calls(read(x))))) {
    assert(triggers(read(f)).includes("workflow_call"), f + " is callable (workflow_call)");
  }
}

// --- one gate -----------------------------------------------------------------------
{
  const jobs = jobsOf(read("release.yml"));
  const names = Object.keys(jobs);
  const publisher = names.filter((j) => /gh release create|git push/.test(jobs[j]));
  const needs = publisher.length === 1 ? ((/^ {4}needs:\s*\[([^\]]*)\]/m.exec(jobs[publisher[0]]) || [])[1] || "").split(",").map((s) => s.trim()).filter(Boolean) : [];
  const unguarded = names.filter((j) => j !== publisher[0] && !needs.includes(j));
  assert(publisher.length === 1 && unguarded.length === 0,
    "release.yml: the job that tags and publishes needs every other job" + (unguarded.length ? " — not " + unguarded.join(", ") : ""));
}

// --- the parsers themselves ----------------------------------------------------------
{
  const sample = "jobs:\n  a:\n    runs-on: x\n    steps:\n      - run: node one.mjs\n      - name: two\n        run: |\n          echo hi\n          npm run test:static\n        env:\n          X: 1\n  b:\n    uses: ./.github/workflows/c.yml\n";
  assert(JSON.stringify(Object.keys(jobsOf(sample))) === '["a","b"]', "jobsOf finds the jobs");
  assert(JSON.stringify(commandsOf(sample)) === '["node one.mjs","echo hi","npm run test:static"]', "commandsOf reads inline and block run steps");
  assert(isCheck("npm run test:static") && !isCheck("npm ci") && !isCheck("echo x") && isCheck("zig build test"), "isCheck tells checks from plumbing");
}

if (failed) { console.error(failed + " check(s) failed"); process.exit(1); }
console.log("all passed");
