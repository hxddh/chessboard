/**
 * The vendored Stockfish (19 lite, single-threaded wasm) as an engine-service
 * backend in Node — the same `search(fen, { multipv, depth, movetime, nodes,
 * elo })` contract and the same UCI sequence as services/engine.js's
 * stockfishBackend, so the opponent harnesses (scripts/test-convert.mjs,
 * scripts/ladder20.mjs) play the app's opponents over the app's engine.
 *
 *   const sf = await nodeStockfish();
 *   createEngineService(maia3Backend({ analyst: sf, runner: inlineRunner(loadInNode()) }))
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { ROOT } from "./app-module.mjs";
import { parseInfo } from "../../src/app/services/engine.js";

const require = createRequire(import.meta.url);

export async function nodeStockfish({ hash = 16 } = {}) {
  const listeners = [];
  const engine = {
    wasmBinary: new Uint8Array(fs.readFileSync(path.join(ROOT, "third_party/stockfish/stockfish-19-lite-single.wasm"))),
    listener: (line) => { for (const h of listeners.slice()) h(String(line)); },
  };
  const factory = require(path.join(ROOT, "third_party/stockfish/stockfish-19-lite-single.js"));
  await (factory.length >= 1 ? factory(engine) : factory()(engine));
  await new Promise((r) => { const t = () => (engine._isReady && !engine._isReady() ? setTimeout(t, 10) : r()); t(); });
  const send = (cmd) => engine.ccall("command", null, ["string"], [cmd], { async: /^go\b/.test(cmd) });
  const waitFor = (pred, ms) => new Promise((res, rej) => {
    const timer = setTimeout(() => { drop(); rej(new Error("stockfish timeout")); }, ms);
    const h = (line) => { if (pred(line)) { clearTimeout(timer); drop(); res(line); } };
    const drop = () => { const i = listeners.indexOf(h); if (i >= 0) listeners.splice(i, 1); };
    listeners.push(h);
  });
  const uciok = waitFor((l) => l === "uciok", 30000); send("uci"); await uciok;
  send("setoption name Hash value " + hash);
  let limited = null;
  let chain = Promise.resolve();
  let nodesSearched = 0;

  async function run(fen, { multipv = 1, depth, movetime = 1000, nodes, elo }) {
    const want = elo ? Math.max(1320, Math.min(3190, Math.round(elo))) : null;
    if (want !== limited) {
      send("setoption name UCI_LimitStrength value " + (want ? "true" : "false"));
      if (want) send("setoption name UCI_Elo value " + want);
      limited = want;
    }
    send("setoption name MultiPV value " + multipv);
    send("position fen " + fen);
    const lines = new Map();
    const collect = (l) => {
      const info = parseInfo(l);
      if (info) lines.set(info.multipv, info);
      const nd = / nodes (\d+)/.exec(l);
      if (nd) last = Number(nd[1]);
    };
    let last = 0;
    listeners.push(collect);
    const done = waitFor((l) => l.startsWith("bestmove"), (depth || nodes ? 120000 : movetime) + 30000);
    send(depth ? "go depth " + depth : nodes ? "go nodes " + nodes : "go movetime " + movetime);
    let bm;
    try { bm = await done; } finally { listeners.splice(listeners.indexOf(collect), 1); }
    nodesSearched += last;
    const out = [...lines.values()].sort((a, b) => a.multipv - b.multipv);
    const best = bm.split(" ")[1];
    if (!out.length && best && best !== "(none)") out.push({ multipv: 1, depth: 0, score: { cp: 0 }, pv: [best] });
    // UCI_LimitStrength plays its own (weakened) pick; the first line is the search's best
    if (want && best && out[0] && out[0].pv[0] !== best) out[0] = { ...out[0], pv: [best] };
    return { lines: out };
  }

  return {
    name: "stockfish-node",
    search(fen, opts = {}) {
      const job = chain.then(() => run(fen, opts));
      chain = job.catch(() => {});
      return job;
    },
    async newGame() { const w = waitFor((l) => l === "readyok", 20000); send("ucinewgame"); send("isready"); await w; },
    get nodes() { return nodesSearched; },
    dispose() {},
  };
}
