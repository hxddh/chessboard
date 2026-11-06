/**
 * The native Stockfish backend (src/app/services/engine-native.js) in Node,
 * behind a stand-in for the shell's bridge (src/engine.zig's three commands
 * and its "chess:engine" event, generations included):
 *
 *   - a scripted UCI engine in JS: the protocol, a crash mid-search and the
 *     restart, giving up into wasm, a binary that is missing;
 *   - with STOCKFISH_NATIVE=<path to a Stockfish binary>, the real one as a
 *     child process, through the whole engine contract.
 *
 * In the app the same contract runs against the packaged binary (the
 * `app-engine` automation scenario, scripts/automation-app.mjs).
 */
import { spawn } from "child_process";
import fs from "fs";
import { createEngineService, fakeBackend } from "../../src/app/services/engine.js";
import { nativeStockfishBackend, nativeOrWasm } from "../../src/app/services/engine-native.js";
import engineContract from "./engine-contract.mjs";

/**
 * The bridge, with `spawnEngine()` making the process: an object with
 * write(text), onLine(fn), onExit(fn), kill().
 */
export function fakeShellBridge(spawnEngine, { cores = 4 } = {}) {
  let gen = 0, proc = null;
  const handlers = [];
  const emit = (d) => setTimeout(() => handlers.forEach((h) => h(d)), 0);
  const log = [];
  return {
    log,
    on(name, fn) { if (name === "chess:engine") handlers.push(fn); return () => {}; },
    async invoke(cmd, payload) {
      log.push(cmd);
      if (cmd === "chess.engineStart") {
        if (proc) return { gen, cores, started: false };
        let p;
        try { p = spawnEngine(); } catch (e) { return { error: "spawn", detail: e.message }; }
        if (!p) return { error: "missing" };
        gen++;
        const mine = gen;
        proc = p;
        p.onLine((l) => emit({ gen: mine, lines: [l] }));
        p.onExit((code) => { if (proc === p) proc = null; emit({ gen: mine, exit: code }); });
        return { gen, cores, started: true };
      }
      if (cmd === "chess.engineSend") {
        if (!proc || payload.gen !== gen) return { error: "not_running" };
        proc.write(payload.text);
        return { ok: true };
      }
      if (cmd === "chess.engineStop") {
        if (proc && payload.gen === gen) { if (payload.kill) proc.kill(); else proc.write("quit\n"); }
        return { ok: true };
      }
      throw new Error("no such command " + cmd);
    },
  };
}

/** A UCI engine in JS: the fake backend's moves, the protocol's shape. `crashOnGo`: die at the n-th go. */
export function scriptedEngine({ crashOnGo = 0, silent = false } = {}) {
  const fake = fakeBackend();
  let line = () => {}, exit = () => {}, fen = null, gos = 0, dead = false, opts = {};
  const say = (l) => { if (!dead) setTimeout(() => line(l), 0); };
  const die = (code) => { if (dead) return; dead = true; setTimeout(() => exit(code), 0); };
  return {
    sent: [],
    onLine(fn) { line = fn; },
    onExit(fn) { exit = fn; },
    kill() { die(-9); },
    write(text) {
      for (const cmd of text.split("\n").filter(Boolean)) {
        this.sent.push(cmd);
        if (silent) continue;
        if (cmd === "uci") { say("id name Scripted"); say("uciok"); }
        else if (cmd === "isready") say("readyok");
        else if (cmd === "quit") die(0);
        else if (cmd.startsWith("setoption name ")) { const m = /^setoption name (\S+) value (.*)$/.exec(cmd); if (m) opts[m[1]] = m[2]; }
        else if (cmd.startsWith("position fen ")) fen = cmd.slice(13);
        else if (cmd.startsWith("go")) {
          gos++;
          if (crashOnGo && gos === crashOnGo) { say("info depth 1 seldepth 1 multipv 1 score cp 10 nodes 5 nps 5000 time 1 pv e2e4"); die(-11); continue; }
          fake.search(fen, { multipv: Number(opts.MultiPV || 1) }).then((r) => {
            r.lines.forEach((l, i) => say("info depth 12 seldepth 18 multipv " + (i + 1) + " score " + (l.score.mate !== undefined ? "mate " + l.score.mate : "cp " + l.score.cp) +
              " nodes 1000000 nps 2500000 hashfull 3 time 400 pv " + l.pv.join(" ")));
            say("bestmove " + (r.lines[0] ? r.lines[0].pv[0] : "(none)"));
          });
        }
      }
    },
    opts,
  };
}

/** A real binary as the process. */
function realEngine(path) {
  return () => {
    const c = spawn(path, [], { stdio: ["pipe", "pipe", "ignore"] });
    let buf = "", line = () => {}, exit = () => {};
    c.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i).replace(/\r$/, ""); buf = buf.slice(i + 1); if (l) line(l); }
    });
    c.on("exit", (code, sig) => exit(code ?? -(sig === "SIGKILL" ? 9 : 11)));
    return { onLine(fn) { line = fn; }, onExit(fn) { exit = fn; }, write(t) { if (c.stdin.writable) c.stdin.write(t); }, kill() { c.kill("SIGKILL"); } };
  };
}

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export default function (test) {
  {
    const engines = [];
    const bridge = fakeShellBridge(() => { const e = scriptedEngine(); engines.push(e); return e; });
    engineContract(test, () => createEngineService(nativeStockfishBackend({ bridge })), { label: "native (scripted): ", budget: { ms: 50 } });
    test("engine-native: Threads = cores − 1, Hash 256 MB, one process for all", async (a) => {
      const be = nativeStockfishBackend({ bridge });
      await be.search(START, { movetime: 10 });
      const e = engines[engines.length - 1];
      a.equal(e.opts.Threads, "3");
      a.equal(e.opts.Hash, "256");
      a.equal(be.info.threads, 3);
      a.ok(be.info.last && be.info.last.nps === 2500000 && be.info.last.depth === 12, JSON.stringify(be.info.last));
      a.equal(engines.length, 1, "every service above reused the one process");
    });
  }

  test("engine-native: a crash fails that search; the next starts a new process", async (a) => {
    const made = [];
    const bridge = fakeShellBridge(() => { const e = scriptedEngine({ crashOnGo: made.length === 0 ? 2 : 0 }); made.push(e); return e; });
    const be = nativeStockfishBackend({ bridge });
    a.ok((await be.search(START, { movetime: 10 })).lines.length);
    await a.rejects(be.search(START, { movetime: 10 }));
    const r = await be.search(START, { movetime: 10 });
    a.ok(r.lines[0].pv[0], "answered by the second process");
    a.equal(made.length, 2);
    a.equal(be.restarts, 1);
  });

  test("engine-native: nativeOrWasm retries a crash natively, falls back once when it cannot start", async (a) => {
    const made = [];
    const bridge = fakeShellBridge(() => { const e = scriptedEngine({ crashOnGo: made.length === 0 ? 1 : 0 }); made.push(e); return e; });
    let notices = 0;
    const svc = nativeOrWasm({ native: nativeStockfishBackend({ bridge }), wasm: () => ({ name: "wasm", search: () => { throw new Error("not wanted"); } }), onFallback: () => notices++ });
    const r = await svc.search(START, { movetime: 10 });
    a.ok(r.lines.length, "the crash was retried on a new process");
    a.equal(notices, 0);
    a.equal(svc.name, "stockfish-native");

    const missing = fakeShellBridge(() => null);
    let why = null;
    const fb = nativeOrWasm({ native: nativeStockfishBackend({ bridge: missing }), wasm: () => fakeBackend(), onFallback: (w) => { why = w; } });
    a.ok((await fb.search(START, { movetime: 10 })).lines.length);
    a.ok(/missing/.test(why), why);
    a.equal(fb.name, "fake");
    await fb.search(START, { movetime: 10 });
    a.equal(missing.log.filter((c) => c === "chess.engineStart").length, 1, "and does not try native again");
  });

  test("engine-native: a binary that never says uciok falls back", async (a) => {
    const bridge = fakeShellBridge(() => scriptedEngine({ silent: true }));
    let why = null;
    const svc = nativeOrWasm({ native: nativeStockfishBackend({ bridge, bootMs: 50 }), wasm: () => fakeBackend(), onFallback: (w) => { why = w; } });
    a.ok((await svc.search(START, { movetime: 10 })).lines.length);
    a.ok(/uciok/.test(why), why);
  });

  test("engine-native: a process that keeps dying is given up on", async (a) => {
    const bridge = fakeShellBridge(() => scriptedEngine({ crashOnGo: 1 }));
    let why = null;
    const svc = nativeOrWasm({ native: nativeStockfishBackend({ bridge, maxRestarts: 2 }), wasm: () => fakeBackend(), onFallback: (w) => { why = w; } });
    a.ok((await svc.search(START, { movetime: 10 })).lines.length);
    a.ok(why, "fell back");
    a.equal(svc.name, "fake");
  });

  const real = process.env.STOCKFISH_NATIVE;
  if (real && fs.existsSync(real)) {
    const bridge = fakeShellBridge(realEngine(real), { cores: 4 });
    const be = nativeStockfishBackend({ bridge });
    engineContract(test, () => createEngineService(be), { label: "native (" + real + "): ", budget: { ms: 200 } });
    test("engine-native (real): a kill mid-search is survived", async (a) => {
      const p = be.search(START, { movetime: 3000 });
      setTimeout(() => be.kill(), 200);
      await a.rejects(p);
      const r = await be.search(START, { depth: 12 });
      a.ok(r.lines[0].depth >= 12, JSON.stringify(r.stats));
      be.dispose();
    });
  }
}
