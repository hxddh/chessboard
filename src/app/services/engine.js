/**
 * The engine service (ADR 0004): pages ask, the service answers; nobody above
 * it knows which engine did the work.
 *
 *   analyse(fen, { lines, budget })  → { lines: [{ moves, score, depth }] }
 *   bestMove(fen, profile)           → { move, thinkMs }        (move null when the game is over)
 *   humanMoves(fen, rating)          → [{ move, p }]           (a distribution, p sums to 1)
 *   review(game, { onPly, budget })  → [{ ply, move, best, before, after, loss }]
 *   tablebase(fen)                   → null | { wdl }          (−2…2 for the side to move)
 *
 * Every score is White's: { cp } or { mate } (mate > 0: White mates). Moves are UCI.
 *
 * Backends implement `search(fen, { multipv, depth, movetime, elo })` returning
 * lines from the side to move's point of view (as UCI does), plus optionally
 * `human(fen, rating)` and `tablebase(fen)`. Two today: a fake one for tests and
 * the 19.0 Stockfish wasm. Native Stockfish and Maia-3 come next, behind the same five calls.
 * @module services/engine
 */
import { Chess } from "../core/chess.js";
import { applyMove, START_FEN } from "../core/rules.js";

const sideToMove = (fen) => (String(fen).split(" ")[1] === "b" ? "b" : "w");

/** A side-to-move score as White's. */
export function whiteScore(score, fen) {
  if (sideToMove(fen) === "w") return { ...score };
  return score.mate !== undefined ? { mate: -score.mate } : { cp: -score.cp };
}

/** Centipawns for comparing scores; a mate is worth more than any material. */
export function scoreCp(s) {
  if (s.mate !== undefined) return s.mate > 0 ? 100000 - s.mate * 100 : -100000 - s.mate * 100;
  return s.cp;
}

const budgetOpts = (budget = {}) => (budget.depth ? { depth: budget.depth } : { movetime: budget.ms || 1000 });

export function createEngineService(backend) {
  const over = (fen) => new Chess(fen).moves().length === 0;

  async function analyse(fen, { lines = 1, budget } = {}) {
    if (over(fen)) return { fen, lines: [] };
    const r = await backend.search(fen, { multipv: lines, ...budgetOpts(budget) });
    return {
      fen,
      lines: r.lines.slice(0, lines).map((l) => ({ moves: l.pv, score: whiteScore(l.score, fen), depth: l.depth })),
    };
  }

  async function bestMove(fen, profile = {}) {
    if (over(fen)) return { move: null, thinkMs: 0 };
    const t0 = Date.now();
    const r = await backend.search(fen, { multipv: 1, ...budgetOpts(profile.budget || { ms: profile.thinkMs || 300 }), elo: profile.rating });
    const move = r.lines[0] && r.lines[0].pv[0];
    return { move: move || null, thinkMs: Date.now() - t0 };
  }

  async function humanMoves(fen, rating = 1500) {
    if (over(fen)) return [];
    if (backend.human) return backend.human(fen, rating);
    // without a human model: the engine's top moves, softened by a temperature
    // that grows as the rating falls
    const r = await backend.search(fen, { multipv: 5, movetime: 200 });
    const temp = Math.max(30, (2600 - rating) / 6);
    const best = scoreCp(r.lines[0].score);
    const w = r.lines.map((l) => Math.exp((scoreCp(l.score) - best) / temp));
    const sum = w.reduce((a, b) => a + b, 0);
    return r.lines.map((l, i) => ({ move: l.pv[0], p: w[i] / sum }));
  }

  /**
   * Each position of the game once, start included; per move the mover's loss
   * in centipawns against the best move. `onPly` streams them as they come.
   */
  async function review({ startFen = START_FEN, moves }, { onPly, budget = { ms: 300 } } = {}) {
    const fens = [startFen];
    for (const m of moves) {
      const next = applyMove(fens[fens.length - 1], m);
      if (!next) throw new Error("review: illegal move " + m);
      fens.push(next.fen);
    }
    const evals = [];
    const out = [];
    const terminal = (fen) => {
      const g = new Chess(fen);
      return g.in_checkmate() ? { mate: 0, white: g.turn() === "b" } : g.moves().length === 0 ? { cp: 0 } : null;
    };
    for (let i = 0; i < fens.length; i++) {
      const end = terminal(fens[i]);
      if (end) evals.push({ best: null, score: end.mate === 0 ? { mate: end.white ? 1 : -1 } : { cp: 0 } });
      else {
        const a = await analyse(fens[i], { lines: 1, budget });
        evals.push({ best: a.lines[0].moves[0], score: a.lines[0].score });
      }
      if (i === 0) continue;
      const mover = sideToMove(fens[i - 1]), sign = mover === "w" ? 1 : -1;
      const before = evals[i - 1].score, after = evals[i].score;
      const loss = Math.max(0, sign * (scoreCp(before) - scoreCp(after)));
      const entry = { ply: i - 1, move: moves[i - 1], best: evals[i - 1].best, before, after, loss: Math.min(loss, 2000) };
      out.push(entry);
      if (onPly) onPly(entry);
    }
    return out;
  }

  async function tablebase(fen) {
    return backend.tablebase ? backend.tablebase(fen) : null;
  }

  return { analyse, bestMove, humanMoves, review, tablebase, name: backend.name, dispose: () => backend.dispose && backend.dispose() };
}

// --- fake backend -----------------------------------------------------------

const VALUE = { p: 100, n: 300, b: 310, r: 500, q: 900, k: 0 };

/** Material balance for the side to move of `g`. */
function material(g) {
  let s = 0;
  for (const row of g.board()) for (const p of row) if (p) s += (p.color === g.turn() ? 1 : -1) * VALUE[p.type];
  return s;
}

/**
 * Deterministic and instant: one ply of material with mate-in-one, ties
 * broken by move order. For tests of everything above the engine.
 */
export function fakeBackend({ delayMs = 0 } = {}) {
  let calls = 0;
  const wait = () => new Promise((r) => setTimeout(r, delayMs));
  return {
    name: "fake",
    get calls() { return calls; },
    async search(fen, { multipv = 1 } = {}) {
      calls++;
      if (delayMs) await wait();
      const g = new Chess(fen);
      const lines = g.moves({ verbose: true }).map((m, i) => {
        g.move(m);
        const uci = m.from + m.to + (m.promotion || "");
        const score = g.in_checkmate() ? { mate: 1 } : g.in_draw() ? { cp: 0 } : { cp: -material(g) };
        g.undo();
        return { pv: [uci], score, depth: 1, i };
      });
      lines.sort((a, b) => scoreCp(b.score) - scoreCp(a.score) || a.i - b.i);
      return { lines: lines.slice(0, multipv).map(({ i, ...l }) => l) };
    },
    async tablebase(fen) {
      const pieces = fen.split(" ")[0].replace(/[^a-zA-Z]/g, "");
      return pieces.length === 2 ? { wdl: 0 } : null;
    },
    dispose() {},
  };
}

// --- Stockfish wasm backend -------------------------------------------------

/** Parse one UCI `info` line into { multipv, depth, score, pv } or null. */
export function parseInfo(line) {
  if (!line.startsWith("info ") || !line.includes(" pv ")) return null;
  const t = line.split(" ");
  const at = (k) => t.indexOf(k);
  const num = (k) => (at(k) >= 0 ? Number(t[at(k) + 1]) : undefined);
  const s = at("score");
  if (s < 0) return null;
  const score = t[s + 1] === "mate" ? { mate: Number(t[s + 2]) } : { cp: Number(t[s + 2]) };
  return { multipv: num("multipv") || 1, depth: num("depth") || 0, score, pv: t.slice(at("pv") + 1) };
}

/**
 * The 19.0 Stockfish (lite, single-threaded NNUE) as a worker. The loader
 * finds its .wasm beside itself, so the worker is started from the file's
 * own URL. One search at a time; later ones wait their turn.
 */
export function stockfishBackend({
  url = new URL("../../../third_party/stockfish/stockfish-19-lite-single.js", import.meta.url).href,
  bootMs = 30000,
} = {}) {
  let worker = null, ready = null;
  let listener = null;
  let chain = Promise.resolve();
  let limited = null;

  function boot() {
    if (ready) return ready;
    worker = new Worker(url);
    worker.onmessage = (e) => { if (listener) listener(String(e.data)); };
    ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("stockfish did not start")), bootMs);
      worker.onerror = (e) => { clearTimeout(timer); reject(new Error("stockfish: " + (e.message || "worker error"))); };
      listener = (l) => { if (l === "uciok") { clearTimeout(timer); resolve(); } };
      worker.postMessage("uci");
    });
    ready.catch(() => { if (worker) worker.terminate(); worker = null; ready = null; });
    return ready;
  }
  const send = (cmd) => worker.postMessage(cmd);

  function run(fen, { multipv = 1, depth, movetime = 1000, elo }) {
    return new Promise((resolve, reject) => {
      const lines = new Map();
      const timer = setTimeout(() => { listener = null; send("stop"); reject(new Error("stockfish: no answer")); },
        (depth ? 60000 : movetime) + 10000);
      listener = (l) => {
        const info = parseInfo(l);
        if (info) { lines.set(info.multipv, info); return; }
        if (l.startsWith("bestmove")) {
          clearTimeout(timer);
          listener = null;
          const out = [...lines.values()].sort((a, b) => a.multipv - b.multipv);
          const bm = l.split(" ")[1];
          if (!out.length && bm && bm !== "(none)") out.push({ multipv: 1, depth: 0, score: { cp: 0 }, pv: [bm] });
          resolve({ lines: out });
        }
      };
      const want = elo ? Math.max(1320, Math.min(3190, Math.round(elo))) : null;
      if (want !== limited) {
        send("setoption name UCI_LimitStrength value " + (want ? "true" : "false"));
        if (want) send("setoption name UCI_Elo value " + want);
        limited = want;
      }
      send("setoption name MultiPV value " + multipv);
      send("position fen " + fen);
      send(depth ? "go depth " + depth : "go movetime " + movetime);
    });
  }

  return {
    name: "stockfish-wasm",
    search(fen, opts = {}) {
      const job = chain.then(() => boot()).then(() => run(fen, opts));
      chain = job.catch(() => {});
      return job;
    },
    dispose() { if (worker) worker.terminate(); worker = null; ready = null; },
  };
}
