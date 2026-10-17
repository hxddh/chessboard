/**
 * The review's engine pass: every position once at the pass budget, then the
 * moves that matter again, deeper (v8-0-plan B2).
 *
 * Carved out of app.js analyzeGame so the measurement that decides whether
 * the pass is reproducible (scripts/test-analysis.mjs `winPctNoise`) runs the
 * very code the app runs, on a node engine instead of the worker — and so the
 * pass is one function the review view (A4) can call, not a loop inside a
 * button handler.
 *
 * Two stages:
 *   1. quick scan — every position at `budget` (engine.js turns it into a
 *      node count, from a cleared engine: the same game gives the same
 *      numbers on every run), MultiPV ≥ 2 so the grader sees the second
 *      line everywhere;
 *   2. deepening — the positions review-grade.js deepTargets names (a drop
 *      of ≥ 5 points, or an only-move candidate) again at DEEP_FACTOR × the
 *      budget with MultiPV 3, their numbers replacing the quick ones; the
 *      new numbers can mark new moves, so it repeats until nothing new is
 *      named. Each position is deepened at most once.
 *
 * The engine, the scalar conversion and the stop test are passed in; this
 * module owns no state.
 * @module review-pass
 */
import { Chess } from "./chess.js";
import { ChessFide as Fide } from "./fide.js";
import { ChessReviewGrade as Grade } from "./review-grade.js";

/** SAN for the first `max` moves of a UCI line from `fen`. */
function sansOf(fen, ucis, max) {
  const out = [];
  if (!Array.isArray(ucis)) return out;
  const g = new Chess(fen);
  for (const u of ucis.slice(0, max || 8)) {
    const m = g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || "q" });
    if (!m) break;
    out.push(m.san);
  }
  return out;
}

/**
 * @param {object} o
 * @param {string[]} o.fens every position of the line, [0] = start
 * @param {string[]} o.sans the moves between them
 * @param {number} o.budget ms-equivalent per position (SCAN_BUDGET, 400 for 精析)
 * @param {number} [o.lines] how many engine lines the panel shows (store.ui.multipv)
 * @param {(fen: string, budget: number, opts: object) => Promise<object|null>} o.analyze
 * @param {(e: object|null) => number|null} o.evalScalar engine result → White-view scalar
 * @param {() => ("abort"|"gone"|null)} [o.halt] asked before every search
 * @param {number} [o.width] searches in flight at once (14.0 B; default 1)
 * @param {(done: number, total: number, p: object) => void} [o.progress] `p` the arrays so far
 * @returns {Promise<object>} the arrays below, plus `halted` ("abort" / "gone"
 *   with `at` = the position it stopped before) when the pass was cut short,
 *   or `deepCut: true` when Stop came during the deepening — the pass is whole
 *   then, the positions not yet searched again keep their quick numbers
 */
async function runPass(o) {
  const { fens, budget } = o;
  const n = fens.length;
  const view = Math.max(1, o.lines || 1);
  const quickMpv = Math.max(2, view), deepMpv = Math.max(Grade.DEEP_MULTIPV, view);
  const p = {
    fens, sans: o.sans,
    scalars: new Array(n).fill(null),
    // every line the engine gave, in SAN, with its score — the panel shows
    // them under the principal one (v6-plan Q2.6); only when it asked for more than one
    linesAt: new Array(n).fill(null),
    // 7.8 §2: how deep the principal line went, for the desk's head
    depths: new Array(n).fill(null),
    // the engine's own choice at each position, UCI — this is what the board
    // draws an arrow for when the move actually played was a mistake
    bests: new Array(n).fill(null),
    // principal variation in SAN (first five), for display and for the grader
    pvs: new Array(n).fill(null),
    // the second-best line's score, White's view — what "only move" is measured against
    seconds: new Array(n).fill(null),
    deep: new Array(n).fill(false),
    terminal: new Array(n).fill(false),
  };
  const take = (i, e) => {
    p.scalars[i] = o.evalScalar(e);
    const lines = e && Array.isArray(e.lines) ? e.lines : [];
    p.linesAt[i] = view > 1 && lines.length > 1
      ? lines.slice(0, view).map((l) => ({ cp: l.cp, mate: l.mate, pv: sansOf(fens[i], l.pv, 6) })) : null;
    p.bests[i] = e && typeof e.best === "string" && e.best.length >= 4 ? e.best : null;
    p.depths[i] = lines[0] && lines[0].depth ? lines[0].depth : null;
    const pv = e && e.pv && e.pv.length ? sansOf(fens[i], e.pv, 5) : [];
    p.pvs[i] = pv.length ? pv.join(" ") : null;
    p.seconds[i] = lines[1] ? o.evalScalar({ cp: lines[1].cp, mate: lines[1].mate, turn: e.turn }) : null;
  };
  const search = async (i, b, mpv) => {
    let e = null;
    try { e = await o.analyze(fens[i], b, { multipv: mpv }); } catch (_) { e = null; }
    return e;
  };
  const stop = () => (o.halt ? o.halt() : null);

  // 14.0 B: `width` searches in flight at once (engine.js passWidth: the
  // second engine beside the shared one). Each search is a pure function of
  // its position, so the order they come back in changes no number; the
  // first runner to meet a stop ends the pool, the others finish the search
  // they are in.
  const width = Math.max(1, o.width || 1);
  async function pool(list, fn) {
    let next = 0, out = null;
    const runner = async () => {
      while (out == null && next < list.length) { const r = await fn(list[next++]); if (r && out == null) out = r; }
    };
    await Promise.all(Array.from({ length: Math.min(width, list.length) || 1 }, runner));
    return out;
  }

  // --- 1. quick scan ------------------------------------------------------
  // Repetition count per position as the replay walks forward, so the
  // terminal test can tell fivefold (art. 9.6, the game is over) from
  // threefold (art. 9.2, a player may claim and the game otherwise goes on).
  // Walked first, in order, because the count depends on what came before.
  const repSeen = new Map();
  const todo = [];
  const done = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    const probe = new Chess(fens[i]);
    const repKey = Fide.positionKey(fens[i], probe);
    const reps = (repSeen.get(repKey) || 0) + 1;
    repSeen.set(repKey, reps);
    // NOT probe.game_over(): chess.js ends the game at threefold and at the
    // 50-move mark, both of which are only claimable under FIDE and which
    // this app plays through everywhere else. Scoring those plies a flat 0
    // dropped the curve to the axis mid-game and mis-tagged every move after
    // it — the accuracy figure included. Same rule as naturalGameOver().
    if (probe.in_checkmate()) { p.scalars[i] = probe.turn() === "w" ? -10000 : 10000; p.terminal[i] = true; }
    else if (Fide.positionFinished(probe, reps)) { p.scalars[i] = 0; p.terminal[i] = true; }
    else todo.push(i);
  }
  const firstMissing = () => { const k = todo.find((i) => !done[i]); return k == null ? n : k; };
  const stopAt = (why) => {
    // what was kept is the prefix measured without a gap — a search that
    // came back past the stop is dropped, so a partial curve has no holes
    const at = firstMissing();
    for (let i = at; i < n; i++) { p.scalars[i] = null; p.bests[i] = null; p.pvs[i] = null; p.linesAt[i] = null; p.depths[i] = null; p.seconds[i] = null; }
    return Object.assign(p, { halted: why, at });
  };
  if (!todo.length) { const why = stop(); if (why) return Object.assign(p, { halted: why, at: 0 }); }
  const quick = { done: n - todo.length };
  const halted = await pool(todo, async (i) => {
    const why = stop();
    if (why) return why;
    const e = await search(i, budget, quickMpv);
    const late = stop();
    if (late === "gone") return late;
    take(i, e);
    done[i] = true;
    if (o.progress) o.progress(++quick.done, n, p);
    return null;
  });
  if (halted) return stopAt(halted);

  // --- 2. deepening -------------------------------------------------------
  const count = { done: n, total: n };
  for (let round = 0; round < 4; round++) {
    const targets = Grade.deepTargets(p, Chess);
    if (!targets.length) break;
    count.total += targets.length;
    const cut = await pool(targets, async (i) => {
      // a Stop here is not a halt: every position already has its quick
      // numbers, so the pass is whole and the caller grades and files it;
      // `deepCut` only says the deepening was cut (review of PR #87)
      const why = stop();
      if (why) return why;
      const e = await search(i, budget * Grade.DEEP_FACTOR, deepMpv);
      // a search Stop cancelled is cut short, not deeper: keep the quick
      // numbers and do not count the position as deepened (confirmed)
      const late = stop();
      if (late) return late;
      // a failed deep search keeps the quick numbers rather than a hole
      if (o.evalScalar(e) != null) take(i, e);
      p.deep[i] = true;
      if (o.progress) o.progress(++count.done, count.total, p);
      return null;
    });
    if (cut === "gone") return Object.assign(p, { halted: cut, at: n });
    if (cut) return Object.assign(p, { deepCut: true });
  }
  return p;
}

export const ChessReviewPass = { runPass, sansOf };
