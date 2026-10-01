/**
 * The Native SDK automation server's file dropbox, from the driver's side —
 * shared by scripts/automation-smoke.mjs and scripts/automation-scenarios.mjs
 * (v8-2-plan V1; the protocol is described in automation-smoke.mjs's header
 * and in v8-2-plan §9 M1).
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A fresh working directory (the dropbox is resolved against the app's
 * current directory) and a profile — HOME, and APPDATA on Windows — under
 * the system temp folder, as scripts/selftest-app.mjs makes one.
 */
export function makeWork(prefix) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const home = path.join(work, "home");
  const profile = process.platform === "win32"
    ? { HOME: home, APPDATA: path.join(home, "AppData", "Roaming") }
    : { HOME: home };
  for (const d of Object.values(profile)) fs.mkdirSync(d, { recursive: true });
  return { work, profile };
}

/**
 * A live launch writes into the WebView's storage, and that is the real
 * Chessboard's: the automation build has the release's bundle id, and
 * WKWebView keeps its data under the real user's ~/Library whatever $HOME
 * says (WebView2's beside the exe) — makeWork's profile does not reach it.
 * The scenarios overwrite the repertoire header and import fake games into
 * the library; the smoke test's plain self-test leaves its markers and may
 * switch the next launch's language. So a live run goes ahead only on a CI
 * runner (CI or GITHUB_ACTIONS set), or when the developer says, with
 * --real-profile-ok, that this machine's Chessboard data may be overwritten
 * (v8-2-plan §9 M4 评审修正). --null runs touch no WebView and need neither.
 * @returns {string|null} why the run is refused, or null to go ahead
 */
export function liveProfileRefusal(script, argv, env) {
  const set = (v) => !!v && v !== "0" && v.toLowerCase() !== "false";
  if (argv.includes("--real-profile-ok") || set(env.CI) || set(env.GITHUB_ACTIONS)) return null;
  return "REFUSED: " + script + " 的 live 模式会写进本机 Chessboard 的真实 WebView 数据" +
    "（自动化构建与发布版同一个 bundle id；WKWebView 的存储不跟 $HOME 走，在真实用户的 ~/Library 下，WebView2 的在 exe 旁边）：" +
    "场景会覆盖开局书、往对局库里导入假对局，冒烟的自检会留下标记、可能把下次启动的语言换成英文。" +
    "只在 CI（设了 CI 或 GITHUB_ACTIONS）上跑；确实要在本机跑，先备份，再加 --real-profile-ok。";
}

/** The menu commands a manifest declares, in order (`.command = "…"` appears only inside .menus). */
export function declaredMenus(zon) {
  const menusSrc = zon.slice(zon.indexOf(".menus"), zon.indexOf(".shortcuts"));
  return [...menusSrc.matchAll(/\.command = "([^"]+)"/g)].map((m) => m[1]);
}

/** The app-menu commands a snapshot lists, in order. */
export function snapshotMenus(snap) {
  return [...(snap || "").matchAll(/^\s+app-menu-item label="[^"]*" command="([^"]+)"/gm)].map((m) => m[1]);
}

/** The dropbox under `work`. */
export function dropbox(work) {
  const dir = path.join(work, ".zig-cache", "native-sdk-automation");
  const file = (name) => path.join(dir, name);
  const read = (name) => { try { return fs.readFileSync(file(name), "utf8"); } catch { return null; } };
  /** Claim the next queue slot the way the SDK CLI does (tools/native-sdk/automation.zig). */
  function enqueue(line) {
    fs.mkdirSync(dir, { recursive: true });
    for (;;) {
      const seqs = fs.readdirSync(dir).map((n) => /^command-(\d+)\.txt$/.exec(n)).filter(Boolean).map((m) => Number(m[1]));
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
  /** Leftovers of an earlier launch (a command it never took, its snapshot) go. */
  function reset() { fs.rmSync(dir, { recursive: true, force: true }); }
  return { dir, file, read, enqueue, reset };
}

/**
 * A live app: spawned in `work` with `env`, its exit noted.
 * `send(line)` queues one command and resolves with the ms until the app
 * took it (deleted the file — the ack); `ready()` waits for this process's
 * own ready=true snapshot; `bridge(req)` sends one bridge request and reads
 * the answer back.
 */
export function launchApp(exe, { work, env, stdio = "inherit" }) {
  const box = dropbox(work);
  const child = spawn(path.resolve(exe), [], { cwd: work, env, stdio });
  const state = { exited: null };
  child.on("exit", (c, sig) => { state.exited = c ?? sig; });
  async function send(line, limit = 10000) {
    const t0 = performance.now();
    const name = box.enqueue(line);
    while (fs.existsSync(box.file(name))) {
      if (state.exited !== null) throw new Error("应用在取走命令之前退出了（" + state.exited + "）：" + line);
      if (performance.now() - t0 > limit) throw new Error("应用 " + limit / 1000 + " 秒内没有取走命令：" + line);
      await sleep(5);
    }
    return performance.now() - t0;
  }
  async function ready(limit = 120000) {
    const t0 = Date.now();
    while (Date.now() - t0 < limit && state.exited === null) {
      const snap = box.read("snapshot.txt");
      if (snap && snap.startsWith("ready=true") && snap.includes(" publisher_pid=" + child.pid + " ")) return { snap, ms: Date.now() - t0 };
      await sleep(100);
    }
    throw new Error(state.exited !== null ? "应用退出了（" + state.exited + "），没有发布 ready=true" : limit / 1000 + " 秒内没有 ready=true");
  }
  async function bridge(req) {
    fs.rmSync(box.file("bridge-response.txt"), { force: true });
    await send("bridge " + JSON.stringify(req));
    for (let i = 0; i < 200; i++) {
      const raw = box.read("bridge-response.txt");
      if (raw) { try { return JSON.parse(raw); } catch { /* still being written */ } }
      await sleep(25);
    }
    return null;
  }
  async function stop() {
    if (state.exited === null) {
      child.kill();
      for (let i = 0; i < 100 && state.exited === null; i++) await sleep(50);
    }
    // the WebView's own processes (WebView2's msedgewebview2.exe hold the
    // user-data folder the next launch opens) go a moment after the app
    await sleep(2000);
  }
  return { child, box, state, send, ready, bridge, stop };
}

/** Percentile of a sorted list (nearest rank). */
export function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p / 100 * sorted.length) - 1))];
}

/** {n, p50, p95, max} of a list of ms, rounded. */
export function latencyStats(list) {
  const s = list.slice().sort((a, b) => a - b);
  const r = (x) => (x == null ? null : Math.round(x));
  return { n: s.length, p50: r(percentile(s, 50)), p95: r(percentile(s, 95)), max: r(s[s.length - 1] ?? null) };
}
