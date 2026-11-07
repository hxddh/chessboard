/**
 * Drive the 20.0 app (`zig build -Dautomation=true`, packaged with
 * its Stockfish) through its self-test scenarios (src/app/selftest.js) and
 * judge what only the outside sees — v20-0-plan A1–A3, F3: the build
 * workflows' `scenarios` jobs (build-macos.yml, build-windows.yml), and with
 * `--only smoke` their `package` jobs' self-test of the package as shipped
 * (a release build: the smoke needs no automation seam).
 *
 *   smoke        CHESS_SELFTEST=1 alone: the page reports and the app exits
 *                0 — board drawn, the native db and the native engine answer
 *   app-move     a new game, e2e4 e7e5, into the native db
 *   app-restore  the next launch (same profile): that game is back
 *   app-db       the db contract in the app; append latency
 *   app-engine   the engine contract in the app; the 60-ply review on the
 *                board: time to the first card, the whole pass, depth per
 *                level, and the 19.0 way for comparison; a kill survived; and,
 *                once the app is gone, no Stockfish left running
 *   app-menu     menu commands sent through the automation server reach the
 *                page and act (我, 下, 翻转棋盘, 新对局); the bar is rebuilt in
 *                the page's language (read off the snapshot) and back
 *   app-open     a .pgn the OS hands over is imported: on Windows named on
 *                the command line at launch, then a second launch with
 *                another file, which hands it to the running app and exits
 *                0; on macOS both through `open -a` (the 'odoc' Apple event)
 *
 *   node scripts/automation-app.mjs <exe> [--out report.json] [--only app-db,app-engine]
 *
 * Live: on a CI runner only, unless --real-profile-ok (lib/automation.mjs
 * liveProfileRefusal — the WebView's storage is the real user's).
 */
import fs from "fs";
import path from "path";
import { spawn, execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { makeWork, dropbox, launchApp, sleep, liveProfileRefusal, snapshotMenuLabels } from "./lib/automation.mjs";

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const exe = args.find((a, i) => !a.startsWith("--") && !["--out", "--only"].includes(args[i - 1]));
const outFile = opt("--out");
const only = opt("--only") ? opt("--only").split(",") : null;
const LAUNCH_MS = 420000;
/** What app-open hands the app (src/app/selftest.js counts the games: 2, then 1 more). */
const OPEN_FILES = [
  ["open-1.pgn", '[Event "Open 1"]\n[White "Me"]\n[Black "A"]\n[Result "1-0"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0\n\n[Event "Open 1b"]\n[White "B"]\n[Black "Me"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1\n'],
  ["open-2.pgn", '[Event "Open 2"]\n[White "Me"]\n[Black "C"]\n[Result "1/2-1/2"]\n\n1. d4 d5 2. c4 e6 1/2-1/2\n'],
];

const results = [];
const check = (name, pass, detail) => { results.push({ name, pass: !!pass, detail }); console.log((pass ? "ok" : "FAIL") + ": " + name + " —— " + detail); };
const readReport = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };

/** Stockfish processes on this machine (null: cannot tell). */
function engines() {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("tasklist", ["/FI", "IMAGENAME eq stockfish.exe", "/FO", "CSV", "/NH"], { encoding: "utf8" });
      return out.split(/\r?\n/).filter((l) => /stockfish\.exe/i.test(l)).length;
    }
    const out = execFileSync("ps", ["-axo", "comm="], { encoding: "utf8" });
    return out.split("\n").filter((l) => /(^|\/)stockfish$/.test(l.trim())).length;
  } catch { return null; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!exe || !fs.existsSync(exe)) { console.error("FAIL: 没有找到要驱动的可执行文件：" + exe); process.exit(1); }
  const refusal = liveProfileRefusal("automation-app.mjs", args, process.env);
  if (refusal) { console.error(refusal); process.exit(1); }
  const beside = path.join(path.dirname(path.resolve(exe)), process.platform === "win32" ? "stockfish.exe" : "stockfish");
  check("package:engine", fs.existsSync(beside), "Stockfish 在可执行文件旁边：" + beside + (fs.existsSync(beside) ? "（" + (fs.statSync(beside).size / 1048576).toFixed(1) + " MB）" : ""));
  await main();
}

async function main() {
  const { work, profile } = makeWork("chess-app-");
  const reports = {};
  const run = (name) => !only || only.includes(name);

  // the plain self-test: no scenario, so the shell exits on the page's report
  if (run("smoke")) {
    const out = path.join(work, "report-smoke.json");
    const child = spawn(path.resolve(exe), [], { cwd: work, env: { ...process.env, ...profile, CHESS_SELFTEST: "1", CHESS_SELFTEST_OUT: out }, stdio: "inherit" });
    const code = await Promise.race([new Promise((r) => child.on("exit", (c) => r(c))), sleep(LAUNCH_MS).then(() => { child.kill(); return "timeout"; })]);
    const rep = reports.smoke = readReport(out);
    check("smoke", code === 0 && rep && rep.ok, "退出码 " + code + "，报告 " + JSON.stringify(rep && { checks: rep.checks, err: rep.err }));
    await sleep(1500);
  }

  /**
   * One scenario. `onStage(stage, rep, app, env)` answers each `await:<x>`
   * stage the page reports, once (the menu command, the file to open).
   */
  async function scenario(name, { args = [], onStage = null } = {}) {
    if (!run(name)) return null;
    const out = path.join(work, "report-" + name + ".json");
    fs.rmSync(out, { force: true });
    dropbox(work).reset();
    const env = { ...process.env, ...profile, CHESS_SELFTEST: "1", CHESS_SELFTEST_SCENARIO: name, CHESS_SELFTEST_OUT: out };
    const t0 = Date.now();
    const app = launchApp(exe, { work, env, args });
    let rep = null;
    const answered = new Set();
    try {
      await app.ready(120000);
      while (Date.now() - t0 < LAUNCH_MS) {
        rep = readReport(out);
        if (rep && rep.stage === "done") break;
        if (onStage && rep && typeof rep.stage === "string" && rep.stage.startsWith("await:") && !answered.has(rep.stage)) {
          answered.add(rep.stage);
          await onStage(rep.stage.slice(6), rep, app, env);
        }
        if (app.state.exited !== null) throw new Error("应用退出了（" + app.state.exited + "）");
        await sleep(250);
      }
      if (!rep || rep.stage !== "done") throw new Error(LAUNCH_MS / 1000 + " 秒内页面没有报告 done（最后：" + JSON.stringify(rep) + "）");
    } catch (e) {
      check(name + ":launch", false, e.message);
    } finally {
      await app.stop();
    }
    reports[name] = rep;
    if (rep) {
      for (const [k, c] of Object.entries(rep.checks || {})) check(name + ":" + k, c.pass, JSON.stringify(c));
      if (rep.err) check(name + ":error", false, rep.err);
      console.log(name + "：" + ((Date.now() - t0) / 1000).toFixed(1) + " s");
    }
    return rep;
  }

  await scenario("app-move");
  await scenario("app-restore");
  if (reports["app-move"] && reports["app-restore"]) {
    const a = reports["app-move"], b = reports["app-restore"];
    check("restart:same-game", a.wrote && a.wrote === b.found, "第一次写的对局 " + a.wrote + "，重启后回来的 " + b.found);
  }
  // --- the menu bar: a command reaches the page and acts; the bar in the page's language ---
  await scenario("app-menu", {
    onStage: async (cmd, rep, app) => {
      if (rep.expectMenu) {
        let labels = [];
        for (let i = 0; i < 40; i++) {
          labels = snapshotMenuLabels(app.box.read("snapshot.txt"));
          if (labels.includes(rep.expectMenu)) break;
          await sleep(250);
        }
        check("app-menu:bar:" + rep.expectMenu, labels.includes(rep.expectMenu), "菜单栏（快照）：" + labels.slice(0, 8).join(" / "));
      }
      const ms = await app.send("menu-command " + cmd);
      console.log("menu-command " + cmd + "：" + Math.round(ms) + " ms 取走");
    },
  });

  // --- a .pgn the OS hands over is imported ---------------------------------------------------
  if (run("app-open")) {
    const files = OPEN_FILES.map(([n, text]) => { const p = path.join(work, n); fs.writeFileSync(p, text); return p; });
    const win = process.platform === "win32";
    const bundle = path.resolve(exe, "..", "..", "..");
    const openA = (file) => new Promise((resolve) => {
      const c = spawn("open", ["-a", bundle, file], { stdio: "inherit" });
      c.on("exit", (code) => resolve(code));
    });
    await scenario("app-open", {
      // Windows: the first file on this launch's command line, as Explorer starts it
      args: win ? [files[0]] : [],
      onStage: async (stage, rep, app, env) => {
        if (stage === "open-1" && !win) check("app-open:open-a-1", (await openA(files[0])) === 0, "open -a " + path.basename(bundle) + " " + path.basename(files[0]));
        if (stage !== "open-2") return;
        if (!win) { check("app-open:open-a-2", (await openA(files[1])) === 0, "open -a " + path.basename(bundle) + " " + path.basename(files[1])); return; }
        // a second launch while the app runs: hands the file over and exits 0
        const second = { ...env };
        delete second.CHESS_SELFTEST; delete second.CHESS_SELFTEST_SCENARIO; delete second.CHESS_SELFTEST_OUT;
        const t1 = Date.now();
        const c = spawn(path.resolve(exe), [files[1]], { cwd: work, env: second, stdio: "inherit" });
        const code = await Promise.race([new Promise((r) => c.on("exit", (x) => r(x))), sleep(20000).then(() => { c.kill(); return "timeout"; })]);
        check("app-open:second-launch-hands-over", code === 0 && app.state.exited === null, "第二次启动退出码 " + code + "（" + (Date.now() - t1) + " ms），第一个还在：" + (app.state.exited === null));
      },
    });
  }
  const db = await scenario("app-db");
  if (db && db.latency) console.log("append 延迟（每步一个任务、等它落盘）：中位 " + db.latency.appendMedianMs + " ms，p95 " + db.latency.appendP95Ms + " ms，最长 " + db.latency.appendMaxMs + " ms；100 条一批 " + db.latency.batch100Ms + " ms；读 200 步 " + db.latency.read200Ms + " ms");
  const eng = await scenario("app-engine");
  if (eng && eng.review) {
    const r = eng.review, l = eng.long || {}, b = eng.checks.boot || {}, o = eng.review19 || {}, h = eng.reviewHalf || {};
    const lv = (x) => x ? x.searches + " 次、深度中位 " + x.medianDepth + "（最低 " + x.minDepth + "）、" + Math.round((x.medianNps || 0) / 1000) + " knps" : "—";
    console.log("原生 Stockfish（" + b.threads + " 线程 / " + b.cores + " 核，Hash " + b.hashMb + " MB）：" + r.plies + " 个半回合的复盘——" +
      "第一张卡 " + r.firstCardMs + " ms（快扫 " + r.scanMs + " ms），整盘 " + r.fullMs + " ms；快扫 " + lv(r.scan) + "；常规 " + lv(r.normal) + "；深搜 " + lv(r.deep) +
      "；每线程节点 " + JSON.stringify(r.nodesPerThread) + "；卡片 " + JSON.stringify(r.moments));
    console.log("对照：19.0 的做法（每个局面 " + o.budgetMs + " ms）" + o.reviewS + " s、" + o.searches + " 次搜索、深度中位 " + o.medianDepth + "；常规减半：第一张卡 " + h.firstCardMs + " ms、整盘 " + h.fullMs + " ms、常规深度中位 " + (h.normal && h.normal.medianDepth) +
      "；3 s 从开局：深度 " + l.depth + "、" + Math.round((l.nps || 0) / 1000) + " knps");
    console.log("MEASURED " + JSON.stringify({ firstCardMs: r.firstCardMs, fullMs: r.fullMs, normalDepth: r.normal && r.normal.medianDepth, review19S: o.reviewS, half: { firstCardMs: h.firstCardMs, fullMs: h.fullMs } }));
  }
  if (eng) {
    let left = engines();
    for (let i = 0; i < 20 && left; i++) { await sleep(250); left = engines(); }
    if (left === null) console.log("note: 数不了 Stockfish 进程");
    else check("lifetime:no-engine-left", left === 0, "应用结束后还在跑的 Stockfish：" + left);
  }

  if (outFile) fs.writeFileSync(outFile, JSON.stringify({ results, reports }, null, 2));
  fs.rmSync(work, { recursive: true, force: true });
  const failed = results.filter((r) => !r.pass);
  if (failed.length) { console.error("FAIL: 20.0 应用的场景没过：" + failed.map((r) => r.name).join("、")); process.exit(1); }
  console.log("ok: 20.0 应用的场景全部通过（" + results.length + " 项）");
}
