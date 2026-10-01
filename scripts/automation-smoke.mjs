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
 *            send commands one at a time, then kill it. build-macos.yml and
 *            build-windows.yml run it on the automation build (v8-2-plan V1
 *            step 2), before scripts/automation-scenarios.mjs:
 *              node scripts/automation-smoke.mjs <exe> [--manifest build/app.macos.zon]
 *
 * Each run gets a fresh working directory and profile (HOME / APPDATA) under
 * the system temp folder, like scripts/selftest-app.mjs. The dropbox itself
 * is scripts/lib/automation.mjs, shared with the scenarios' driver.
 */
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { makeWork, dropbox, launchApp, declaredMenus, snapshotMenus, latencyStats, sleep } from "./lib/automation.mjs";

const args = process.argv.slice(2);
const exe = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--manifest");
const nullMode = args.includes("--null");
const manifest = args.includes("--manifest") ? args[args.indexOf("--manifest") + 1] : "app.zon";
if (!exe || !fs.existsSync(exe)) {
  console.error("FAIL: 没有找到要驱动的可执行文件：" + exe);
  process.exit(1);
}
const LIMIT_MS = nullMode ? 30000 : 120000;

const { work, profile } = makeWork("chess-automation-");
const box = dropbox(work);
const declared = declaredMenus(fs.readFileSync(manifest, "utf8"));

const PROBE = { id: "automation-smoke", command: "chess.selftestMode", payload: {} };
const results = [];
const check = (name, pass, detail) => { results.push({ name, pass, detail }); };

function judgeSnapshot(snap) {
  const head = (snap || "").split("\n")[0];
  check("ready", /^ready=true protocol=0x[0-9a-f]+ /.test(head), head || "没有 snapshot.txt");
  const listed = snapshotMenus(snap);
  check("menus", listed.join(",") === declared.join(","),
    "快照 " + listed.length + " 项 [" + listed.join(",") + "]，" + manifest + " 声明 " + declared.length + " 项");
}

function judgeBridge(raw) {
  let resp = null;
  try { resp = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { /* reported below */ }
  check("bridge", !!resp && resp.id === PROBE.id && resp.ok === true && resp.result && resp.result.on === true,
    raw ? (typeof raw === "string" ? raw.trim() : JSON.stringify(raw)) : "没有 bridge-response.txt");
}

const env = { ...process.env, ...profile, CHESS_SELFTEST: "1", CHESS_SELFTEST_OUT: path.join(work, "selftest.json") };
if (nullMode) {
  // the null platform presents exactly one frame, so exactly one command is taken
  const queued = box.enqueue("bridge " + JSON.stringify(PROBE));
  const child = spawn(path.resolve(exe), [], { cwd: work, env, stdio: ["ignore", "ignore", "pipe"] });
  let log = "";
  child.stderr.on("data", (d) => { log += d; });
  const code = await Promise.race([
    new Promise((r) => child.on("exit", (c) => r(c))),
    sleep(LIMIT_MS).then(() => { child.kill(); return "timeout"; }),
  ]);
  check("exit", code === 0, "退出码 " + code);
  check("ack", !fs.existsSync(box.file(queued)), "排队的 " + queued + (fs.existsSync(box.file(queued)) ? " 没被取走" : " 已被取走"));
  judgeSnapshot(box.read("snapshot.txt"));
  judgeBridge(box.read("bridge-response.txt"));
  if (code !== 0) console.error(log.split("\n").slice(-20).join("\n"));
} else {
  const app = launchApp(exe, { work, env });
  try {
    const { snap, ms } = await app.ready(LIMIT_MS);
    console.log("ready 用了 " + ms + " ms");
    judgeSnapshot(snap);
    judgeBridge(await app.bridge(PROBE));
    const acks = [];
    for (let i = 0; i < 20; i++) acks.push(await app.send("wait"));
    const st = latencyStats(acks);
    // generous: a turning loop takes a queued command within a frame or two
    // of the watcher's 5 ms poll; the point here is "did it turn at all"
    check("latency", st.max < 2000, "20 次空命令的确认用时 p50 " + st.p50 + " ms，最长 " + st.max + " ms");
  } catch (e) {
    check("live", false, e.message);
  } finally {
    await app.stop();
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
