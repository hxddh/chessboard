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
import { makeWork, dropbox, launchApp, sleep, liveProfileRefusal } from "./lib/automation.mjs";

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const exe = args.find((a, i) => !a.startsWith("--") && !["--out", "--only"].includes(args[i - 1]));
const outFile = opt("--out");
const only = opt("--only") ? opt("--only").split(",") : null;
const LAUNCH_MS = 420000;

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

  async function scenario(name) {
    if (!run(name)) return null;
    const out = path.join(work, "report-" + name + ".json");
    fs.rmSync(out, { force: true });
    dropbox(work).reset();
    const env = { ...process.env, ...profile, CHESS_SELFTEST: "1", CHESS_SELFTEST_SCENARIO: name, CHESS_SELFTEST_OUT: out };
    const t0 = Date.now();
    const app = launchApp(exe, { work, env });
    let rep = null;
    try {
      await app.ready(120000);
      while (Date.now() - t0 < LAUNCH_MS) {
        rep = readReport(out);
        if (rep && rep.stage === "done") break;
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
