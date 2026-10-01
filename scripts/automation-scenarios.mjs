/**
 * Drive the automation build through the page-side scenarios
 * (src/web/js/selftest-scenarios.js) and judge what only the outside can see
 * — v8-2-plan V1 step 2, the design in §9 M1 "第 2 步设计", the provisional
 * thresholds in §9 M4.
 *
 * Two channels at once:
 *
 *   automation   (scripts/lib/automation.mjs) the menus in the snapshot,
 *                safe chess.* commands over the bridge, `menu-command`, and
 *                the main loop's pulse: the ack time of an empty `wait`
 *                command is how long the loop took to turn (§9 M1). Never
 *                chess.openPgn / chess.saveText over the bridge: they open a
 *                modal panel nothing can answer, and the run would hang.
 *   the page     each launch runs one scenario (CHESS_SELFTEST_SCENARIO) and
 *                writes its report to CHESS_SELFTEST_OUT — more than once:
 *                in scenario mode main.zig writes it and stays up.
 *
 * All launches share one profile, as a person's restarts do — and as the
 * WebView's own storage does anyway (WKWebView keeps it under the real
 * user's ~/Library, WebView2 beside the exe; see selftest-app.mjs). In order:
 *
 *   rep-seed       snapshot menus = the manifest's; chess.selftestMode,
 *                  chess.appdataPath, chess.fetchProgress over the bridge;
 *                  20 `wait` acks while idle; (R5) no connection to anywhere
 *                  but loopback from the app's process; the page: 允许联网同步
 *                  off, a book written into the header
 *   rep-index      the page: the boot moved it into chessboard.replines and
 *                  chessboard.repertoire, a card due today (R17)
 *   rep-read       the page: the same records and lines after a restart (R17)
 *   sync           the fake server (scripts/fake-sync-server.mjs) streams
 *                  100 games at 100 ms each; a `wait` every 50 ms meanwhile
 *                  (R6: the window does not freeze); the page: counts,
 *                  已取到 k 局, frames, incremental (R6a), Chess.com (R7), no
 *                  answer (R8), no such user (R9), 429 (R11); the server: what
 *                  was asked, with since= and sort=dateAsc the second time
 *   prefetch-seed  the page: 300 games into the library (R18)
 *   prefetch-read  the page: the boot's prefetch answered with all of them
 *   menus          menu-command game.new → 新对局 opens; view.repertoire →
 *                  the library's 我的开局书 (B1–B5's command path)
 *
 *   node scripts/automation-scenarios.mjs <exe> [--manifest build/app.macos.zon] [--out report.json] [--only sync,menus]
 *   node scripts/automation-scenarios.mjs <null-platform exe> --null
 *
 * --null (Linux, a `-Dplatform=null -Dautomation=true` build, one frame and
 * out): only the native half of the seams — chess.selftestMode names the
 * scenario, and chess.selftestReport writes the report and does not exit.
 */
import fs from "fs";
import path from "path";
import { spawn, execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { makeWork, dropbox, launchApp, declaredMenus, snapshotMenus, latencyStats, sleep } from "./lib/automation.mjs";
import { startFakeSyncServer } from "./fake-sync-server.mjs";

/**
 * Provisional (v8-2-plan §9 M4): set before any runner had run this, loose
 * on purpose; the first CI runs' numbers replace them, recorded in §9.
 */
export const THRESHOLDS = {
  /** a `wait` taken by a turning loop: within a frame or two of the watcher's 5 ms poll */
  syncAckP95Ms: 500,
  syncAckMaxMs: 2000,
  idleAckMaxMs: 2000,
  /** the page's longest gap between frames while the 100 games stream in */
  syncFrameGapMs: 1000,
  /** a launch, from spawn to its scenario's last report */
  launchMs: 180000,
};
/** What main.zig sends as its User-Agent (SYNC_USER_AGENT). */
const USER_AGENT = "chessboard (+https://github.com/hxddh/chessboard)";

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const exe = args.find((a, i) => !a.startsWith("--") && !["--manifest", "--out", "--only"].includes(args[i - 1]));
const nullMode = args.includes("--null");
const manifest = opt("--manifest") || "app.zon";
const only = opt("--only") ? opt("--only").split(",") : null;
const outFile = opt("--out");

const results = [];
const check = (name, pass, detail) => { results.push({ name, pass: !!pass, detail }); console.log((pass ? "ok" : "FAIL") + ": " + name + " —— " + detail); };

function finish(extra) {
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(Object.assign({ thresholds: THRESHOLDS, results }, extra), null, 2));
  const failed = results.filter((r) => !r.pass);
  if (failed.length) {
    console.error("FAIL: automation 场景没过：" + failed.map((r) => r.name).join("、"));
    process.exit(1);
  }
  console.log("ok: automation 场景全部通过（" + results.length + " 项）");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!exe || !fs.existsSync(exe)) {
    console.error("FAIL: 没有找到要驱动的可执行文件：" + exe);
    process.exit(1);
  }
  if (nullMode) await runNull(); else await runLive();
}

/** One null-platform launch with one command queued; what the dropbox and the report file hold after. */
async function nullLaunch(work, env, request) {
  const box = dropbox(work);
  box.reset();
  box.enqueue("bridge " + JSON.stringify(request));
  const child = spawn(path.resolve(exe), [], { cwd: work, env, stdio: ["ignore", "ignore", "ignore"] });
  const code = await Promise.race([new Promise((r) => child.on("exit", (c) => r(c))), sleep(30000).then(() => { child.kill(); return "timeout"; })]);
  let answer = null;
  try { answer = JSON.parse(box.read("bridge-response.txt")); } catch { answer = null; }
  return { code, answer };
}

async function runNull() {
  const { work, profile } = makeWork("chess-scenarios-null-");
  const out = path.join(work, "report.json");
  const env = { ...process.env, ...profile, CHESS_SELFTEST: "1", CHESS_SELFTEST_OUT: out, CHESS_SELFTEST_SCENARIO: "sync" };
  const mode = await nullLaunch(work, env, { id: "m", command: "chess.selftestMode", payload: {} });
  check("null:scenario", mode.answer && mode.answer.ok && mode.answer.result.on === true && mode.answer.result.scenario === "sync",
    "chess.selftestMode 应答 " + JSON.stringify(mode.answer && mode.answer.result));
  // a failing report: without a scenario the app would exit 1 at once; with one it writes and stays
  const rep = await nullLaunch(work, env, { id: "r", command: "chess.selftestReport", payload: { ok: false, scenario: "sync", stage: "running" } });
  let file = null;
  try { file = JSON.parse(fs.readFileSync(out, "utf8")); } catch { file = null; }
  check("null:report", rep.code === 0 && rep.answer && rep.answer.ok && rep.answer.result.written === true && file && file.stage === "running",
    "退出码 " + rep.code + "，应答 " + JSON.stringify(rep.answer && rep.answer.result) + "，报告 " + JSON.stringify(file));
  const plain = { ...env };
  delete plain.CHESS_SELFTEST_SCENARIO;
  const exit = await nullLaunch(work, plain, { id: "x", command: "chess.selftestReport", payload: { ok: false } });
  check("null:exit", exit.code === 1, "不设场景时报告 ok:false 即退出，退出码 " + exit.code + "（应为 1，自检照旧）");
  const off = { ...env, CHESS_SELFTEST: "0" };
  const offMode = await nullLaunch(work, off, { id: "o", command: "chess.selftestMode", payload: {} });
  check("null:inert", offMode.answer && offMode.answer.ok && offMode.answer.result.on === false && !("scenario" in offMode.answer.result),
    "CHESS_SELFTEST 不是 1 时场景名不生效：" + JSON.stringify(offMode.answer && offMode.answer.result));
  fs.rmSync(work, { recursive: true, force: true });
  finish({ mode: "null" });
}

/** Read the page's report, whole (the native side truncates, then writes). */
function readReport(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

/** R5 (part): the app's own process holds no connection to anything but loopback. */
function foreignConnections(pid) {
  try {
    if (process.platform === "darwin") {
      const outp = execFileSync("lsof", ["-nP", "-a", "-i", "-p", String(pid)], { encoding: "utf8" });
      return { lines: outp.split("\n").slice(1).filter((l) => l.trim() && !/127\.0\.0\.1|\[::1\]|localhost|\*:/.test(l)) };
    }
    if (process.platform === "win32") {
      const outp = execFileSync("powershell", ["-NoProfile", "-Command",
        "Get-NetTCPConnection -OwningProcess " + pid + " -ErrorAction SilentlyContinue | Where-Object { $_.State -ne 'Listen' } | ForEach-Object { $_.RemoteAddress + ':' + $_.RemotePort }"], { encoding: "utf8" });
      return { lines: outp.split(/\r?\n/).filter((l) => l.trim() && !/^(127\.0\.0\.1|::1|0\.0\.0\.0|::):/.test(l.trim())) };
    }
  } catch (e) {
    // lsof exits 1 when it finds nothing to list
    if (e.status === 1 && !String(e.stdout || "").trim()) return { lines: [] };
    return { skipped: String(e.message).split("\n")[0] };
  }
  return { skipped: "no connection lister on " + process.platform };
}

async function runLive() {
  const { work, profile } = makeWork("chess-scenarios-");
  const declared = declaredMenus(fs.readFileSync(manifest, "utf8"));
  const fake = await startFakeSyncServer({ delayMs: 100, games: 100 });
  console.log("假同步服务器：" + fake.base);
  const reports = {};
  const extra = { latency: {}, frames: null, launches: {} };

  /**
   * One launch of one scenario: `during(app, reportNow)` runs once the app
   * is ready, alongside the page's own work; the launch ends at the page's
   * "done" (or at the limit) and the app is stopped.
   */
  async function scenario(name, during) {
    if (only && !only.includes(name)) return null;
    const out = path.join(work, "report-" + name + ".json");
    fs.rmSync(out, { force: true });
    dropbox(work).reset();
    const env = { ...process.env, ...profile, CHESS_SELFTEST: "1", CHESS_SELFTEST_SCENARIO: name, CHESS_SELFTEST_OUT: out, CHESS_SYNC_BASE: fake.base };
    const t0 = Date.now();
    const app = launchApp(exe, { work, env });
    let report = null;
    try {
      const { snap, ms } = await app.ready(120000);
      extra.launches[name] = { readyMs: ms };
      const reportNow = () => readReport(out);
      // caught here, not where it is awaited: a rejection left pending while
      // the loop below polls would end the whole run as an unhandled one
      const side = (during ? during(app, reportNow, snap) : Promise.resolve()).catch((e) => check(name + ":drive", false, e.message));
      while (Date.now() - t0 < THRESHOLDS.launchMs) {
        report = reportNow();
        if (report && report.stage === "done") break;
        if (app.state.exited !== null) throw new Error("应用退出了（" + app.state.exited + "）");
        await sleep(200);
      }
      await side;
      if (!report || report.stage !== "done") throw new Error(THRESHOLDS.launchMs / 1000 + " 秒内页面没有报告 done（最后的报告：" + JSON.stringify(report) + "）");
    } catch (e) {
      check(name + ":launch", false, e.message);
    } finally {
      await app.stop();
    }
    extra.launches[name] = Object.assign(extra.launches[name] || {}, { ms: Date.now() - t0 });
    reports[name] = report;
    if (report) {
      for (const [k, c] of Object.entries(report.checks || {})) check(name + ":" + k, c.pass, c.pass ? JSON.stringify(c) : c.err);
    }
    return report;
  }

  /** `wait` acks every `every` ms until `stop()` says so; [{at, ms}]. */
  async function pulse(app, stop, every = 50) {
    const samples = [];
    while (!stop()) {
      const at = Date.now();
      try { samples.push({ at, ms: await app.send("wait", 15000) }); } catch (e) { samples.push({ at, ms: 15000, err: e.message }); break; }
      await sleep(every);
    }
    return samples;
  }

  await scenario("rep-seed", async (app, _r, snap) => {
    const listed = snapshotMenus(snap);
    check("menus", listed.join(",") === declared.join(","), "快照 " + listed.length + " 项，" + manifest + " 声明 " + declared.length + " 项");
    const mode = await app.bridge({ id: "a1", command: "chess.selftestMode", payload: {} });
    check("bridge:selftestMode", mode && mode.ok && mode.result.scenario === "rep-seed", JSON.stringify(mode));
    const where = await app.bridge({ id: "a2", command: "chess.appdataPath", payload: {} });
    check("bridge:appdataPath", where && where.ok, JSON.stringify(where));
    const prog = await app.bridge({ id: "a3", command: "chess.fetchProgress", payload: {} });
    check("bridge:fetchProgress", prog && prog.ok && prog.result.busy === false, JSON.stringify(prog));
    const acks = [];
    for (let i = 0; i < 20; i++) acks.push(await app.send("wait"));
    const st = extra.latency.idle = latencyStats(acks);
    check("latency:idle", st.max < THRESHOLDS.idleAckMaxMs, "空闲时 20 次 wait：p50 " + st.p50 + " ms、p95 " + st.p95 + " ms、最长 " + st.max + " ms（< " + THRESHOLDS.idleAckMaxMs + "）");
    const conn = foreignConnections(app.child.pid);
    if (conn.skipped) console.log("note: R5 连接检查跳过：" + conn.skipped);
    else check("R5:connections", conn.lines.length === 0, conn.lines.length ? "进程有对外连接：" + conn.lines.join(" | ") : "应用进程没有任何对外连接（WebView 的网络进程不在此 pid 下）");
  });
  await scenario("rep-index");
  await scenario("rep-read");
  {
    const a = reports["rep-index"] && reports["rep-index"].checks.indexed, b = reports["rep-read"] && reports["rep-read"].checks.readBack;
    if (a && b) {
      check("R17:restart", a.pass && b.pass && JSON.stringify(a.records) === JSON.stringify(b.records) && JSON.stringify(a.lines) === JSON.stringify(b.lines),
        "重启前 " + (a.records || []).length + " 条记录、" + (a.lines || []).length + " 条线，重启后 " + (b.records || []).length + "、" + (b.lines || []).length);
    }
  }

  let samples = [];
  await scenario("sync", async (app, reportNow) => {
    samples = await pulse(app, () => { const r = reportNow(); return !!r && r.stage === "done"; });
  });
  if (reports.sync) {
    const lichess = fake.streams.find((s) => s.games >= 100);
    const inside = lichess ? samples.filter((s) => s.at >= lichess.start && s.at <= (lichess.end || Infinity)) : [];
    const st = extra.latency.sync = latencyStats(inside.map((s) => s.ms));
    check("R6:latency", lichess && st.n >= 20 && st.p95 < THRESHOLDS.syncAckP95Ms && st.max < THRESHOLDS.syncAckMaxMs,
      lichess ? "100 局慢速传输的 " + ((lichess.end - lichess.start) / 1000).toFixed(1) + " s 里 " + st.n + " 次 wait：p50 " + st.p50 + " ms、p95 " + st.p95 +
        " ms（< " + THRESHOLDS.syncAckP95Ms + "）、最长 " + st.max + " ms（< " + THRESHOLDS.syncAckMaxMs + "）" : "假服务器没有收到 100 局的请求");
    const li = reports.sync.checks.lichess;
    if (li && li.frames) {
      extra.frames = li.frames;
      if (li.frames.frames >= 10) check("R6:frames", li.frames.maxMs < THRESHOLDS.syncFrameGapMs, "同步期间页面最长帧间隔 " + li.frames.maxMs + " ms（< " + THRESHOLDS.syncFrameGapMs + "），共 " + li.frames.frames + " 帧");
      else console.log("note: 同步期间页面只画了 " + li.frames.frames + " 帧（窗口不在前台？），帧间隔不判");
    }
    const asked = fake.requests.filter((r) => r.path === "/api/games/user/slow_tester");
    check("R6a:requests", asked.length >= 3 && !asked[0].query.since && asked[0].query.max === "100" &&
      asked.slice(1).every((r) => r.query.since && r.query.sort === "dateAsc"),
      "Lichess 请求：" + asked.map((r) => "max=" + r.query.max + (r.query.since ? " since=" + r.query.since + " sort=" + r.query.sort : "")).join("；"));
    const cc = fake.requests.filter((r) => r.path.startsWith("/pub/player/cc_tester/"));
    check("R7:requests", cc.length >= 2 && cc[0].path.endsWith("/archives") && cc.some((r) => r.path.endsWith("/2026/09")), "Chess.com 请求：" + cc.map((r) => r.path).join("、"));
    const ua = [...new Set(fake.requests.map((r) => r.ua))];
    check("sync:userAgent", ua.length === 1 && ua[0] === USER_AGENT, "User-Agent：" + ua.join(" | "));
  }

  await scenario("prefetch-seed");
  await scenario("prefetch-read");
  {
    const seed = reports["prefetch-seed"] && reports["prefetch-seed"].checks.seeded, got = reports["prefetch-read"] && reports["prefetch-read"].checks.prefetch;
    if (seed && got) {
      extra.prefetch = got;
      check("R18:prefetch", seed.pass && got.pass && got.n === seed.n, "预读命中：摘要 " + got.n + " 局（写入时 " + seed.n + "），bundle 开始后 " + got.ms + " ms 拿到（先只记数）");
    }
  }

  await scenario("menus", async (app, reportNow) => {
    const stage = async (want) => {
      for (let i = 0; i < 300; i++) { const r = reportNow(); if (r && (r.stage === want || r.stage === "done")) return r.stage; await sleep(100); }
      throw new Error("页面 30 秒内没有到 " + want);
    };
    try {
      if (await stage("armed") !== "armed") return;
      await app.send("menu-command game.new");
      if (await stage("next") !== "next") return;
      await app.send("menu-command view.repertoire");
    } catch (e) {
      check("menus:drive", false, e.message);
    }
  });

  await fake.close();
  fs.rmSync(work, { recursive: true, force: true });
  finish(Object.assign(extra, { reports }));
}
