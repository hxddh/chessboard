/**
 * docs/deps-inventory.json says what the repo pins; this checks that it does
 * (v8-1-plan §1.7).
 *
 * The inventory is only worth keeping if it is true. Every entry's `current`
 * is compared with the place the version is actually written — package.json
 * and the lock for esbuild, the workflows for Playwright, the SDK, Node, Zig
 * and every GitHub Action, build.zig.zon for Zig, the vendored engine's own
 * header for Stockfish. Raise a pin and forget the inventory, or the other
 * way round, and this goes red on the spot.
 *
 * Offline by design. Whether a pin is behind upstream is
 * scripts/deps-check.mjs's question, asked in the nightly, and never a
 * failure; its pure parts are exercised at the bottom of this file.
 *
 * Run: node scripts/test-deps.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { INVENTORY, leadingVersion, compareVersions, check } from "./deps-check.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

let failed = 0;
function assert(cond, msg, detail) {
  if (cond) console.log("ok   " + msg);
  else { failed++; console.error("FAIL " + msg + (detail ? "\n     " + detail : "")); }
}

const inv = JSON.parse(fs.readFileSync(INVENTORY, "utf8"));
const WF_DIR = ".github/workflows";
const workflows = fs.readdirSync(path.join(root, WF_DIR)).filter((f) => /\.ya?ml$/.test(f)).sort()
  .map((f) => ({ file: WF_DIR + "/" + f, text: read(WF_DIR + "/" + f) }));

/** Every capture of `re` across the workflows, as [{file, v}]. */
function inWorkflows(re) {
  const out = [];
  for (const w of workflows) for (const m of w.text.matchAll(re)) out.push({ file: w.file, v: m[1] });
  return out;
}
/** "all of these are `want`", with the stragglers named. */
function allEqual(found, want, what, min = 1) {
  const bad = found.filter((x) => x.v !== want);
  assert(found.length >= min && bad.length === 0,
    `${what}：${found.length} 处都是 ${want}（清单 current）`,
    found.length < min ? `只找到 ${found.length} 处，至少应有 ${min} 处` : bad.map((x) => `${x.file}: ${x.v}`).join("; "));
}
/** The inventory entry, or a failure saying which one is missing. */
function entry(pred, what) {
  const e = inv.deps.find(pred);
  assert(!!e, "清单里有 " + what);
  return e || { current: "" };
}

// --- esbuild: package.json + lock ---------------------------------------------
{
  const want = leadingVersion(entry((d) => d.npm === "esbuild", "esbuild").current);
  const pkg = JSON.parse(read("package.json"));
  const lock = JSON.parse(read("package-lock.json"));
  allEqual([
    { file: "package.json devDependencies", v: pkg.devDependencies && pkg.devDependencies.esbuild },
    { file: "package-lock.json packages[\"\"]", v: lock.packages[""].devDependencies.esbuild },
    { file: "package-lock.json node_modules/esbuild", v: (lock.packages["node_modules/esbuild"] || {}).version },
  ], want, "esbuild", 3);
}

// --- Playwright: the install lines and release.yml's prose -----------------
{
  const want = leadingVersion(entry((d) => d.npm === "playwright", "playwright").current);
  // `npm install --no-save playwright@X` and `npx playwright@X install`, in
  // checks.yml's two browser jobs and release.yml's one
  allEqual(inWorkflows(/playwright@(\d+\.\d+\.\d+)/g), want, "Playwright 安装行", 6);
  // release.yml's sdk_version comment: "everything else … is pinned too (playwright X, …)"
  allEqual(inWorkflows(/\(playwright (\d+\.\d+\.\d+),/g), want, "release.yml 注释里的 Playwright 版本", 1);
}

// --- Native SDK: every default, fallback and env pin -------------------------
{
  const want = leadingVersion(entry((d) => d.npm === "@native-sdk/cli", "Native SDK").current);
  const found = [
    ...inWorkflows(/SDK_VERSION:\s*"([^"]+)"/g),
    ...inWorkflows(/inputs\.sdk_version \|\| '([^']+)'/g),
  ];
  // the `default:` of each `sdk_version:` input block (workflow_dispatch and workflow_call)
  for (const w of workflows) {
    const lines = w.text.split("\n");
    lines.forEach((l, i) => {
      const m = /^(\s*)sdk_version:\s*$/.exec(l);
      if (!m) return;
      for (let j = i + 1; j < lines.length; j++) {
        const ind = /^(\s*)/.exec(lines[j])[1].length;
        if (lines[j].trim() && ind <= m[1].length) break;
        const d = /^\s*default:\s*"([^"]*)"/.exec(lines[j]);
        if (d) { found.push({ file: w.file + ":" + (j + 1), v: d[1] }); break; }
      }
    });
  }
  // checks.yml env, build-{macos,windows} ×(2 defaults + 1 fallback), release.yml default
  allEqual(found, want, "Native SDK 版本（SDK_VERSION / sdk_version 默认值与回退）", 8);
}

// --- Node: setup-node everywhere, package.json engines -------------------------
{
  const want = leadingVersion(entry((d) => /^Node\.js/.test(d.name), "Node.js").current);
  allEqual(inWorkflows(/node-version:\s*["']?(\d+)/g), want, "workflow 的 node-version", 5);
  const engines = (JSON.parse(read("package.json")).engines || {}).node;
  assert(engines === ">=" + want, "package.json engines.node 是 >=" + want, "实际 " + engines);
}

// --- Zig: setup-zig's version, build.zig.zon's minimum --------------------------
{
  const want = leadingVersion(entry((d) => d.name === "Zig", "Zig").current);
  allEqual(inWorkflows(/mlugg\/setup-zig@\S+\s*\n\s*with:\s*\n\s*version:\s*["']?([\d.]+)/g), want, "setup-zig 的 version", 3);
  const zon = /\.minimum_zig_version\s*=\s*"([^"]+)"/.exec(read("build.zig.zon"));
  assert(!!zon && zon[1] === want, "build.zig.zon minimum_zig_version 是 " + want, "实际 " + (zon && zon[1]));
}

// --- GitHub Actions: every `uses: owner/action@vN` -----------------------------
// and its sub-actions, `owner/action/restore@vN` — one repository, one tag
// (actions/cache/restore and /save, v8-4-plan V2)
for (const d of inv.deps.filter((x) => /^[\w-]+\/[\w-]+$/.test(x.name))) {
  const want = "v" + leadingVersion(d.current);
  const re = new RegExp("uses:\\s*" + d.name.replace("/", "\\/") + "(?:/[\\w-]+)*@(\\S+)", "g");
  const found = inWorkflows(re);
  allEqual(found, want, d.name, 1);
  // "（全部 N 处）" is a claim too: 8.1 F1 wrote 12 for actions/checkout's 13
  const said = /全部 (\d+) 处/.exec(d.current);
  if (said) assert(found.length === Number(said[1]), `${d.name}：清单说全部 ${said[1]} 处，workflow 里正好 ${found.length} 处`);
}

// --- Stockfish: the vendored loader's own header --------------------------------
{
  const e = entry((d) => d.npm === "stockfish", "Stockfish.js");
  const js = read("third_party/stockfish/stockfish-19-lite-single.js").slice(0, 2000);
  const major = /Stockfish\.js (\d+)/.exec(js);
  assert(!!major && major[1] === leadingVersion(e.current).split(".")[0],
    "Stockfish.js 文件头的大版本与清单一致（" + (major && major[1]) + "）");
  const net = /nn-[0-9a-f]{12}/.exec(js);
  assert(!!net && e.current.includes(net[0]), "文件头的网络 " + (net && net[0]) + " 就是清单里写的那个");
  // the loader carries the wasm's byte length; the inventory writes it with separators
  const len = /\bl=(\d+)/.exec(js);
  const wasm = fs.statSync(path.join(root, "third_party/stockfish/stockfish-19-lite-single.wasm")).size;
  const said = /wasm ([\d,]+) 字节/.exec(e.current);
  assert(!!len && Number(len[1]) === wasm && !!said && Number(said[1].replace(/,/g, "")) === wasm,
    "wasm " + wasm + " 字节：文件、加载器里记的长度、清单三处一致");
}

// --- deps-check.mjs's pure parts -----------------------------------------------
{
  assert(leadingVersion("1.63.0（Chromium 153）") === "1.63.0" && leadingVersion("@v7（全部 12 处）") === "7" &&
    leadingVersion("24（setup-node node-version: 24）") === "24" && leadingVersion("没有版本") === null,
  "leadingVersion 取 current 开头的版本号");
  assert(compareVersions("0.10.2", "0.10.1") > 0 && compareVersions("1.63.0", "1.63") === 0 &&
    compareVersions("0.9.10", "0.10.0") < 0, "compareVersions 按数字逐段比");
  const fake = { deps: [{ npm: "a", current: "1.2.3（x）" }, { npm: "b", current: "2.0.0" }, { npm: "c", current: "1.0.0" }, { name: "no npm", current: "9" }] };
  const r = check(fake, (p) => { if (p === "c") throw new Error("offline"); return { a: "1.3.0", b: "2.0.0" }[p]; });
  assert(r.newer === 1 && r.lines.length === 3 && r.lines[0].startsWith("↑ a: 有新版 1.3.0") &&
    r.lines[1].startsWith("= b") && r.lines[2].startsWith("? c"),
  "deps-check：有新版一行、已最新一行、查不到一行，没有 npm 字段的不查、不抛", r.lines.join(" | "));
}

if (failed) { console.error(failed + " test(s) failed"); process.exit(1); }
console.log("all passed");
