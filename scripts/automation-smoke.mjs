/**
 * Talk to the Native SDK automation server of a `-Dautomation=true` build and
 * check the native half of the app from outside it (v8-2-plan §3 V1, step 1:
 * the proof that the channel works; the findings are in v8-2-plan §9 M1).
 *
 * The automation server (SDK src/automation/, wired in src/runner.zig) is a
 * file dropbox under `.zig-cache/native-sdk-automation`, resolved against the
 * app's working directory:
 *
 *   snapshot.txt         the app publishes it: `ready=true protocol=0x…
 *                        publisher_pid=…`, windows and views, and the app-menu
 *                        catalog it handed the platform
 *   command-<n>.txt      we write one line per command, claiming <n> with an
 *                        exclusive create; the app takes the lowest <n> once
 *                        per frame and deletes the file — that delete is the ack
 *   bridge-response.txt  the app writes the answer to a `bridge <json>`
 *                        command there (origin zero://inline, which app.zon
 *                        trusts, so our own chess.* commands answer)
 *
 * What it checks:
 *
 *   ready    the app published ready=true with a protocol fingerprint
 *   menus    the app-menu catalog in the snapshot is exactly the commands the
 *            manifest declares, in order (the runtime got the menus; 1.10–1.21
 *            shipped a menu bar that was drawn, not native)
 *   bridge   `bridge chess.selftestMode` reaches main.zig through the
 *            automation origin and answers {"on":true} (CHESS_SELFTEST=1)
 *   latency  (live mode only) ack time of 20 no-op `wait` commands: the loop
 *            thread takes one command per frame, so a long ack is a loop that
 *            did not turn — the outside view of "the window froze"
 *
 * Two modes:
 *
 *   --null   a `-Dplatform=null` build runs one frame and exits, so the one
 *            command it will take is queued before launch, and everything is
 *            read back after it exits. This is the mode that runs on Linux:
 *              zig build -Dplatform=null -Dautomation=true -Dnative-sdk-path=<sdk>
 *              node scripts/automation-smoke.mjs zig-out/bin/chessboard --null
 *   (live)   a macOS / Windows automation build stays up: wait for ready,
 *            send commands one at a time, then kill it. Not yet run on a real
 *            runner (that is V1 step 2):
 *              node scripts/automation-smoke.mjs <exe> [--manifest build/app.macos.zon]
 *
 * Each run gets a fresh working directory and profile (HOME / APPDATA) under
 * the system temp folder, like scripts/selftest-app.mjs.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";

const args = process.argv.slice(2);
const exe = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--manifest");
const nullMode = args.includes("--null");
const manifest = args.includes("--manifest") ? args[args.indexOf("--manifest") + 1] : "app.zon";
if (!exe || !fs.existsSync(exe)) {
  console.error("FAIL: 没有找到要驱动的可执行文件：" + exe);
  process.exit(1);
}
const LIMIT_MS = nullMode ? 30000 : 120000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const work = fs.mkdtempSync(path.join(os.tmpdir(), "chess-automation-"));
const home = path.join(work, "home");
const profile = process.platform === "win32"
  ? { HOME: home, APPDATA: path.join(home, "AppData", "Roaming") }
  : { HOME: home };
for (const d of Object.values(profile)) fs.mkdirSync(d, { recursive: true });
const dropbox = path.join(work, ".zig-cache", "native-sdk-automation");
const file = (name) => path.join(dropbox, name);
const read = (name) => { try { return fs.readFileSync(file(name), "utf8"); } catch { return null; } };

// the manifest's menu commands, in declaration order (`.command = "…"` only
// appears inside .menus; shortcuts use `.id`)
const zon = fs.readFileSync(manifest, "utf8");
const menusSrc = zon.slice(zon.indexOf(".menus"), zon.indexOf(".shortcuts"));
const declared = [...menusSrc.matchAll(/\.command = "([^"]+)"/g)].map((m) => m[1]);

/** Claim the next queue slot the way the SDK CLI does (tools/native-sdk/automation.zig). */
function enqueue(line) {
  fs.mkdirSync(dropbox, { recursive: true });
  for (;;) {
    const seqs = fs.readdirSync(dropbox).map((n) => /^command-(\d+)\.txt$/.exec(n)).filter(Boolean).map((m) => Number(m[1]));
    const name = "command-" + (seqs.length ? Math.max(...seqs) + 1 : 1) + ".txt";
    try {
      // one write, newline-terminated: the app treats a line without its
      // newline as still being written (server.zig takeCommand)
      fs.writeFileSync(file(name), line + "\n", { flag: "wx" });
      return name;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
  }
}

let exited = null; // live mode: the app's exit code once it is gone

/** Live mode: send one command and wait for the app to delete it. @returns ack ms */
async function send(line, limit = 10000) {
  const t0 = performance.now();
  const name = enqueue(line);
  while (fs.existsSync(file(name))) {
    if (exited !== null) throw new Error("应用在取走命令之前退出了（" + exited + "）：" + line);
    if (performance.now() - t0 > limit) throw new Error("应用 " + limit / 1000 + " 秒内没有取走命令：" + line);
    await sleep(5);
  }
  return performance.now() - t0;
}

const PROBE = { id: "automation-smoke", command: "chess.selftestMode", payload: {} };
const results = [];
const check = (name, pass, detail) => { results.push({ name, pass, detail }); };

function judgeSnapshot(snap) {
  const head = (snap || "").split("\n")[0];
  check("ready", /^ready=true protocol=0x[0-9a-f]+ /.test(head), head || "没有 snapshot.txt");
  const listed = [...(snap || "").matchAll(/^\s+app-menu-item label="[^"]*" command="([^"]+)"/gm)].map((m) => m[1]);
  check("menus", listed.join(",") === declared.join(","),
    "快照 " + listed.length + " 项 [" + listed.join(",") + "]，" + manifest + " 声明 " + declared.length + " 项");
}

function judgeBridge(raw) {
  let resp = null;
  try { resp = JSON.parse(raw); } catch { /* reported below */ }
  check("bridge", !!resp && resp.id === PROBE.id && resp.ok === true && resp.result && resp.result.on === true,
    raw ? raw.trim() : "没有 bridge-response.txt");
}

const env = { ...process.env, ...profile, CHESS_SELFTEST: "1", CHESS_SELFTEST_OUT: path.join(work, "selftest.json") };
if (nullMode) {
  // the null platform presents exactly one frame, so exactly one command is taken
  const queued = enqueue("bridge " + JSON.stringify(PROBE));
  const child = spawn(path.resolve(exe), [], { cwd: work, env, stdio: ["ignore", "ignore", "pipe"] });
  let log = "";
  child.stderr.on("data", (d) => { log += d; });
  const code = await Promise.race([
    new Promise((r) => child.on("exit", (c) => r(c))),
    sleep(LIMIT_MS).then(() => { child.kill(); return "timeout"; }),
  ]);
  check("exit", code === 0, "退出码 " + code);
  check("ack", !fs.existsSync(file(queued)), "排队的 " + queued + (fs.existsSync(file(queued)) ? " 没被取走" : " 已被取走"));
  judgeSnapshot(read("snapshot.txt"));
  judgeBridge(read("bridge-response.txt"));
  if (code !== 0) console.error(log.split("\n").slice(-20).join("\n"));
} else {
  const child = spawn(path.resolve(exe), [], { cwd: work, env, stdio: "inherit" });
  child.on("exit", (c, sig) => { exited = c ?? sig; });
  const t0 = Date.now();
  let snap = null;
  while (Date.now() - t0 < LIMIT_MS && exited === null) {
    snap = read("snapshot.txt");
    if (snap && snap.startsWith("ready=true") && snap.includes(" publisher_pid=" + child.pid + " ")) break;
    snap = null;
    await sleep(100);
  }
  try {
    if (!snap) throw new Error(exited !== null ? "应用退出了（" + exited + "），没有发布 ready=true" : LIMIT_MS / 1000 + " 秒内没有 ready=true");
    console.log("ready 用了 " + (Date.now() - t0) + " ms");
    judgeSnapshot(snap);
    fs.rmSync(file("bridge-response.txt"), { force: true });
    await send("bridge " + JSON.stringify(PROBE));
    let raw = null;
    for (let i = 0; i < 200 && !raw; i++) { raw = read("bridge-response.txt"); if (!raw) await sleep(25); }
    judgeBridge(raw);
    const acks = [];
    for (let i = 0; i < 20; i++) acks.push(await send("wait"));
    acks.sort((a, b) => a - b);
    const p50 = acks[10], max = acks[19];
    // generous: a turning loop takes a queued command within a frame or two
    // of the watcher's 5 ms poll; the point here is "did it turn at all"
    check("latency", max < 2000, "20 次空命令的确认用时 p50 " + p50.toFixed(0) + " ms，最长 " + max.toFixed(0) + " ms");
  } catch (e) {
    check("live", false, e.message);
  } finally {
    child.kill();
  }
}

for (const r of results) console.log((r.pass ? "ok" : "FAIL") + ": " + r.name + " —— " + r.detail);
const failed = results.filter((r) => !r.pass);
fs.rmSync(work, { recursive: true, force: true });
if (failed.length) {
  console.error("FAIL: automation 冒烟没过：" + failed.map((r) => r.name).join("、"));
  process.exit(1);
}
console.log("ok: automation server 可用 —— 就绪、菜单目录与清单一致、bridge 经 zero://inline 到达 main.zig" +
  (nullMode ? "（null 平台，单帧）" : "，事件循环在转"));
