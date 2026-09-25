/**
 * Launch the packaged app in self-test mode, twice, and read its verdict.
 *
 * 6.0 to 7.3 shipped an app whose engine never started. Every check the
 * release ran was green, because none of them ever launched the packaged app:
 * CI drove Chromium and WebKit, which stand in for WebView2 and WKWebView but
 * are not them. This is the one step that runs the real thing. The platform
 * build pipelines call it on the binary they just packaged, before uploading.
 *
 * CHESS_SELFTEST=1 makes the page run its checks (app.js runSelftest); the
 * native side writes the page's report to CHESS_SELFTEST_OUT and exits 0 or 1
 * (main.zig). Each launch gets 120 s. The report carries one entry per check:
 *
 *   engine   Stockfish starts and gives a legal move (7.5)
 *   appdata  the native save file takes a write and gives it back (7.6)
 *   chunk    js/chunk-eco.js loads over zero:// and names 1.e4 c5 (7.6)
 *   restart  a localStorage marker survives a restart (7.6)
 *
 * The first three the page judges for itself, on each launch. `restart` needs
 * two launches: every launch reports the marker it found and writes a fresh
 * one, and the second launch must have found the one the first wrote. That
 * comparison happens here, which is why the app is launched twice.
 *
 * The step fails unless every check passed on both launches, and the failure
 * names the checks that did not.
 *
 *   node scripts/selftest-app.mjs <path to the packaged executable>
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";

const exe = process.argv[2];
if (!exe || !fs.existsSync(exe)) {
  console.error("FAIL: 没有找到要自检的可执行文件：" + exe);
  process.exit(1);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chess-selftest-"));
const LIMIT_MS = 120000;
const CHECKS = ["engine", "appdata", "chunk", "restart"];

/** One launch. @returns {Promise<{report: object|null, code: number|null, why: string|null}>} */
async function launch(n) {
  const out = path.join(dir, "report-" + n + ".json");
  const t0 = Date.now();
  const child = spawn(exe, [], {
    env: { ...process.env, CHESS_SELFTEST: "1", CHESS_SELFTEST_OUT: out },
    stdio: "inherit",
  });
  const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
  let timer = null;
  const timedOut = new Promise((resolve) => { timer = setTimeout(() => resolve(null), LIMIT_MS); });
  const result = await Promise.race([exited, timedOut]);
  // the pending timer would otherwise keep node alive for the full limit
  // after the app has already answered (the first CI run sat there, green)
  clearTimeout(timer);
  if (!result) {
    child.kill();
    // let the killed process go before the next launch opens the same profile
    await exited.catch(() => {});
    return { report: null, code: null, why: LIMIT_MS / 1000 + " 秒内应用没有交回自检结果（窗口没起来，或页面没跑到自检）" };
  }
  let report = null;
  try { report = JSON.parse(fs.readFileSync(out, "utf8")); } catch { /* reported below */ }
  console.log("第 " + n + " 次启动：退出码 " + result.code + (result.signal ? "（信号 " + result.signal + "）" : "") +
    "，用时 " + Math.round((Date.now() - t0) / 1000) + " 秒");
  console.log("第 " + n + " 次启动的自检报告：" + (report ? JSON.stringify(report) : "（没有写出报告）"));
  if (!report) return { report: null, code: result.code, why: "应用退出了，但没有写出自检报告" };
  if (report.ok === true && result.code !== 0) return { report, code: result.code, why: "报告说 ok，退出码却是 " + result.code };
  return { report, code: result.code, why: null };
}

const runs = [await launch(1), await launch(2)];

// check → the reasons it failed, per launch
const failures = new Map();
const fail = (check, why) => { if (!failures.has(check)) failures.set(check, []); failures.get(check).push(why); };
runs.forEach((run, i) => {
  const n = "第 " + (i + 1) + " 次启动";
  if (run.why) fail("launch", n + "：" + run.why);
  if (!run.report) return;
  const checks = run.report.checks || {};
  for (const k of CHECKS) {
    const c = checks[k];
    if (!c) fail(k, n + "：报告里没有这一项（报告来自更早的页面？）");
    else if (c.pass !== true) fail(k, n + "：" + (c.err || "没有通过"));
  }
  if (run.report.ok !== true && !Object.keys(checks).length) fail("engine", n + "：" + (run.report.err || "原因不明"));
});
const [a, b] = runs.map((r) => r.report && r.report.checks && r.report.checks.restart);
if (a && b && a.pass && b.pass && b.found !== a.wrote) {
  fail("restart", "第 2 次启动读到的 localStorage 标记是 " + JSON.stringify(b.found ?? null) +
    "，第 1 次写的是 " + JSON.stringify(a.wrote) + " —— 重启之后状态没留下来");
}

console.log("各项：" + CHECKS.map((k) => k + " " + (failures.has(k) ? "FAIL" : "ok")).join("，"));
if (failures.size) {
  for (const [check, whys] of failures) for (const why of whys) console.error("FAIL: " + check + " —— " + why);
  console.error("FAIL: 打包好的应用自检没过：" + [...failures.keys()].join("、"));
  process.exit(1);
}
const r1 = runs[0].report;
console.log("ok: 打包好的应用启动了引擎（第一步 " + r1.move + "，" + r1.checks.engine.ms + " ms），存档读写来回一致，" +
  "eco 分块查到「" + r1.checks.chunk.name + "」，重启后 localStorage 标记还在");
process.exit(0);
