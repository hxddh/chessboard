/**
 * The vendored Stockfish, driven from Node — the harness scripts/test-mined.mjs
 * grew (clean hash per position, MultiPV, `searchmoves` for a move outside the
 * top lines), as a module so the puzzle re-verification (verify-puzzles.mjs)
 * searches exactly the same way.
 *
 * Why each piece is there is argued in test-mined.mjs; in short: `ucinewgame`
 * before every position (a warm hash made two passes disagree about the best
 * move and even about forced mates), and a stored move's score is asked for
 * with `searchmoves` rather than inferred from its rank.
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { ROOT } from "./app-module.mjs";

const require = createRequire(import.meta.url);

/** mate scores as big numbers that still order by distance: M1 > M3 > +900cp */
export const scoreOf = (line) => {
  const m = line.match(/\bscore (cp|mate) (-?\d+)\b/);
  if (!m) return null;
  const v = Number(m[2]);
  return m[1] === "mate" ? (v > 0 ? 100000 - v : -100000 - v) : v;
};

/**
 * Boot the engine. @param {Function} Chess to turn UCI into SAN
 * @returns {Promise<{topLines:Function, scoreOfMove:Function}>}
 */
export async function startEngine(Chess, depth) {
  const listeners = [];
  const engine = {
    wasmBinary: new Uint8Array(fs.readFileSync(path.join(ROOT, "third_party/stockfish/stockfish-19-lite-single.wasm"))),
    listener: (line) => { for (const h of listeners.slice()) h(line); },
  };
  const factory = require(path.join(ROOT, "third_party/stockfish/stockfish-19-lite-single.js"));
  await (factory.length >= 1 ? factory(engine) : factory()(engine));
  await new Promise((r) => { const tick = () => (engine._isReady && !engine._isReady() ? setTimeout(tick, 10) : r()); tick(); });
  const send = (cmd) => engine.ccall("command", null, ["string"], [cmd], { async: /^go\b/.test(cmd) });
  const waitFor = (pred, ms) => new Promise((res, rej) => {
    const timer = setTimeout(() => { drop(); rej(new Error("engine timeout")); }, ms);
    const h = (line) => { if (pred(line)) { clearTimeout(timer); drop(); res(line); } };
    const drop = () => { const i = listeners.indexOf(h); if (i >= 0) listeners.splice(i, 1); };
    listeners.push(h);
  });
  const uciok = waitFor((l) => l === "uciok", 30000); send("uci"); await uciok;
  const ready = async () => { const w = waitFor((l) => l === "readyok", 20000); send("isready"); await w; };
  const freshSearch = async () => { await ready(); send("ucinewgame"); await ready(); };

  /** the top `n` moves in SAN with their scores (side to move's view), best first */
  async function topLines(fen, n) {
    await freshSearch();
    send("setoption name MultiPV value " + n);
    send("position fen " + fen);
    const found = new Map();
    const collect = (line) => {
      const mp = /\bmultipv (\d+)\b/.exec(line);
      const sc = scoreOf(line);
      const pv = /\bpv ((?:[a-h][1-8][a-h][1-8][qrbn]?\s*)+)/.exec(line);
      if (mp && sc != null && pv) found.set(Number(mp[1]), { score: sc, uci: pv[1].trim().split(/\s+/)[0] });
    };
    listeners.push(collect);
    const done = waitFor((l) => /^bestmove/.test(l), 300000);
    send("go depth " + depth);
    await done;
    listeners.splice(listeners.indexOf(collect), 1);
    return [...found.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => {
      const g = new Chess(fen);
      const m = g.move({ from: v.uci.slice(0, 2), to: v.uci.slice(2, 4), promotion: v.uci[4] });
      return { san: m ? m.san : v.uci, score: v.score };
    });
  }

  /** what one specific move is worth at the same depth, or null */
  async function scoreOfMove(fen, san) {
    const g = new Chess(fen);
    const m = g.move(san);
    if (!m) return null;
    const uci = m.from + m.to + (m.promotion || "");
    await freshSearch();
    send("setoption name MultiPV value 1");
    send("position fen " + fen);
    let best = null;
    const collect = (line) => { const sc = scoreOf(line); if (sc != null && /\bpv\b/.test(line)) best = sc; };
    listeners.push(collect);
    const done = waitFor((l) => /^bestmove/.test(l), 300000);
    send("go depth " + depth + " searchmoves " + uci);
    await done;
    listeners.splice(listeners.indexOf(collect), 1);
    return best;
  }
  /**
   * v8-3-plan T2: the best move (UCI) at `nodes` nodes, sent in the order and
   * with the options engine.js analyzeInner uses (`ucinewgame`, full
   * strength, `hash` MB), so a test can tell what the page's fixed-node
   * search will answer.
   */
  async function bestAt(fen, nodes, hash = 32) {
    send("ucinewgame");
    await ready();
    for (const c of ["setoption name MultiPV value 1", "setoption name Skill Level value 20",
      "setoption name UCI_LimitStrength value false", "setoption name Hash value " + hash]) send(c);
    send("position fen " + fen);
    const done = waitFor((l) => /^bestmove/.test(l), 300000);
    send("go nodes " + nodes);
    const line = await done;
    const u = line.split(/\s+/)[1];
    return u && u !== "(none)" ? u : null;
  }
  return { topLines, scoreOfMove, bestAt };
}
