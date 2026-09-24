/**
 * Launch the packaged app in self-test mode and read its verdict.
 *
 * 6.0 to 7.3 shipped an app whose engine never started. Every check the
 * release ran was green, because none of them ever launched the packaged app:
 * CI drove Chromium and WebKit, which stand in for WebView2 and WKWebView but
 * are not them. This is the one step that runs the real thing. The platform
 * build pipelines call it on the binary they just packaged, before uploading.
 *
 * CHESS_SELFTEST=1 makes the page start Stockfish and ask it for a move
 * (app.js runSelftest); the native side writes the page's report to
 * CHESS_SELFTEST_OUT and exits 0 or 1 (main.zig). This script gives it 90 s,
 * then prints the report and fails the step unless the report says ok.
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
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "chess-selftest-")), "report.json");
const LIMIT_MS = 90000;

const t0 = Date.now();
const child = spawn(exe, [], {
  env: { ...process.env, CHESS_SELFTEST: "1", CHESS_SELFTEST_OUT: out },
  stdio: "inherit",
});

const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
let timer = null;
const timedOut = new Promise((resolve) => { timer = setTimeout(() => resolve(null), LIMIT_MS); });
const result = await Promise.race([exited, timedOut]);
// the pending timer would otherwise keep node alive for the full 90 s after
// the app has already answered (the first CI run sat there, green, doing so)
clearTimeout(timer);
if (!result) {
  child.kill();
  console.error("FAIL: " + LIMIT_MS / 1000 + " 秒内应用没有交回自检结果（窗口没起来，或页面没跑到自检）");
  process.exit(1);
}

let report = null;
try { report = JSON.parse(fs.readFileSync(out, "utf8")); } catch { /* reported below */ }
console.log("自检：退出码 " + result.code + (result.signal ? "（信号 " + result.signal + "）" : "") +
  "，用时 " + Math.round((Date.now() - t0) / 1000) + " 秒");
console.log("自检报告：" + (report ? JSON.stringify(report) : "（没有写出报告）"));

if (!report) { console.error("FAIL: 应用退出了，但没有写出自检报告"); process.exit(1); }
if (report.ok !== true) { console.error("FAIL: 打包好的应用里，引擎没能给出一步棋：" + (report.err || "原因不明")); process.exit(1); }
if (result.code !== 0) { console.error("FAIL: 报告说 ok，退出码却是 " + result.code); process.exit(1); }
console.log("ok: 打包好的应用启动了引擎，第一步 " + report.move + "，" + report.ms + " ms");
process.exit(0);
