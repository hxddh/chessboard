/**
 * One rung's move, in node — engine.js bestMoveInner's UCI sequence and its
 * candidate rule, for the calibration harness (scripts/test-ladder.mjs).
 *
 * The UCI commands are mirrored (the browser worker plumbing is not what is
 * being measured); the rule that picks among the candidates is engine.js's
 * own pickCandidate, called, not copied — the lesson test-strength.mjs and
 * test-novice.mjs learned when each carried a transcription of it. No
 * `minMs` hold: it changes how a reply feels, not which move it is.
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { ROOT } from "./app-module.mjs";

const require = createRequire(import.meta.url);

const scoreOf = (line) => {
  const m = line.match(/\bscore (cp|mate) (-?\d+)\b/);
  if (!m) return null;
  const v = Number(m[2]);
  return m[1] === "mate" ? (v > 0 ? 100000 - v : -100000 - v) : v;
};

export async function startPlayer({ Chess, ChessEngine, ChessPersona }) {
  const listeners = [];
  const engine = {
    wasmBinary: new Uint8Array(fs.readFileSync(path.join(ROOT, "third_party/stockfish/stockfish-19-lite-single.wasm"))),
    listener: (line) => { for (const h of listeners.slice()) h(line); },
  };
  const factory = require(path.join(ROOT, "third_party/stockfish/stockfish-19-lite-single.js"));
  await (factory.length >= 1 ? factory(engine) : factory()(engine));
  await new Promise((r) => { const t = () => (engine._isReady && !engine._isReady() ? setTimeout(t, 10) : r()); t(); });
  const send = (cmd) => engine.ccall("command", null, ["string"], [cmd], { async: /^go\b/.test(cmd) });
  // in node the engine answers synchronously inside ccall: every waiter is
  // registered before its command is sent
  const waitFor = (pred, ms) => new Promise((res, rej) => {
    const timer = setTimeout(() => { drop(); rej(new Error("engine timeout")); }, ms);
    const h = (line) => { if (pred(line)) { clearTimeout(timer); drop(); res(line); } };
    const drop = () => { const i = listeners.indexOf(h); if (i >= 0) listeners.splice(i, 1); };
    listeners.push(h);
  });
  const uciok = waitFor((l) => l === "uciok", 30000); send("uci"); await uciok;
  const ready = async () => { const w = waitFor((l) => l === "readyok", 20000); send("isready"); await w; };

  async function newGame() { await ready(); send("ucinewgame"); await ready(); }

  /**
   * @param {string} [style] persona.js style — applied the way engine.js
   *   applies it: a lean inside a win-chance rung's draw, and otherwise a
   *   choice among 14 candidates within the style's slack
   * @returns {Promise<{uci: string, score: number|null}|null>}
   */
  async function move(fen, row, rng, style) {
    const styled = !!style && style !== "off";
    const tier = styled && !row.winT ? Object.assign({}, row, { multipv: Math.max(row.multipv || 0, 14) }) : row;
    await ready();
    send("setoption name MultiPV value " + (tier.multipv || 1));
    if (tier.skill != null) {
      send("setoption name UCI_LimitStrength value false");
      send("setoption name Skill Level value " + tier.skill);
    } else if (tier.elo != null) {
      send("setoption name Skill Level value 20");
      send("setoption name UCI_LimitStrength value true");
      send("setoption name UCI_Elo value " + tier.elo);
    } else {
      send("setoption name Skill Level value 20");
      send("setoption name UCI_LimitStrength value false");
    }
    send("position fen " + fen);
    const cands = new Map();
    let own = null;
    const collect = (line) => {
      if (typeof line !== "string" || !/^info\b/.test(line)) return;
      const mv = line.match(/\bmultipv (\d+)\b/);
      const sc = scoreOf(line);
      if (sc != null && (!mv || mv[1] === "1") && !/\b(lower|upper)bound\b/.test(line)) own = sc;
      if (!tier.multipv) return;
      const pv = line.match(/\bpv\s+([a-h][1-8][a-h][1-8][qrbn]?)/);
      if (mv && pv) cands.set(Number(mv[1]), { uci: pv[1], score: sc });
    };
    listeners.push(collect);
    const done = waitFor((l) => typeof l === "string" && l.startsWith("bestmove"), (tier.movetime || 2000) + 60000);
    send(tier.depth ? "go depth " + tier.depth : "go movetime " + tier.movetime);
    let line;
    try { line = await done; } finally { listeners.splice(listeners.indexOf(collect), 1); }
    let uci = line.split(/\s+/)[1];
    const list = [...cands.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
    if (tier.multipv && cands.size > 1 && tier.winT) {
      const lean = styled ? ChessPersona.lean(fen, list, style, Chess) : null;
      uci = ChessEngine.pickCandidate(list, tier, rng, lean) || uci;
    } else if (tier.multipv && cands.size > 1) {
      if (tier.worstBias) uci = ChessEngine.pickCandidate(list, tier, rng) || uci;
      if (styled) {
        const own = list.find((c) => c.uci === uci);
        uci = (own && ChessPersona.pick(fen, list, style, Chess, own.score)) || uci;
      }
      else if (!tier.worstBias) uci = ChessEngine.pickCandidate(list, tier, rng) || uci;
    }
    return uci && uci !== "(none)" ? { uci, score: own } : null;
  }

  return { newGame, move };
}
