/**
 * The review's engine pass, 19.0's review-pass.js in behaviour: every
 * position once at the budget (MultiPV ≥ 2, so the grader sees the second
 * line), then the positions core/grade deepTargets names again at
 * DEEP_FACTOR × the budget with MultiPV 3, until nothing new is named.
 * The engine arrives as `analyze`; `engineAnalyze` adapts the EngineService.
 * @module core/pass
 */
import { Chess, ChessFide as Fide } from "./chess.js";
import { deepTargets, DEEP_FACTOR, DEEP_MULTIPV } from "./grade.js";
import { scalarOf } from "./winpct.js";

/** SAN for the first `max` moves of a UCI line from `fen`. */
export function sansOf(fen, ucis, max = 8) {
  const out = [];
  if (!Array.isArray(ucis)) return out;
  const g = new Chess(fen);
  for (const u of ucis.slice(0, max)) {
    const m = g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || "q" });
    if (!m) break;
    out.push(m.san);
  }
  return out;
}

/**
 * The 19.0 analysis record ({ cp | mate, turn, best, pv, lines }, scores from
 * the side to move) from the engine service's answer (White-view scores).
 */
export function engineAnalyze(engine) {
  return async (fen, budget, { multipv = 2 } = {}) => {
    const a = await engine.analyse(fen, { lines: multipv, budget: { ms: budget } });
    if (!a.lines.length) return null;
    const turn = fen.split(" ")[1] === "b" ? "b" : "w", sign = turn === "w" ? 1 : -1;
    const stm = (s) => (s.mate != null ? { mate: sign * s.mate } : { cp: sign * s.cp });
    const lines = a.lines.map((l) => ({ ...stm(l.score), pv: l.moves, depth: l.depth }));
    return { ...stm(a.lines[0].score), turn, best: a.lines[0].moves[0], pv: a.lines[0].moves, lines };
  };
}

/** 19.0's evalScalar: a side-to-move record → White-view scalar. */
export function evalScalar(e) {
  if (!e) return null;
  const sign = e.turn === "w" ? 1 : -1;
  if (e.mate != null) return scalarOf({ mate: sign * e.mate }) ?? -sign * 10000;
  return e.cp != null ? sign * e.cp : null;
}

/**
 * @param {object} o
 * @param {string[]} o.fens   every position, [0] the start
 * @param {string[]} o.sans   the moves between them
 * @param {number} o.budget   ms per position in the quick scan
 * @param {(fen, budget, { multipv }) => Promise<object|null>} o.analyze
 * @param {(e) => number|null} [o.evalScalar]
 * @param {() => string|null} [o.halt]       asked before each search; a truthy answer stops
 * @param {(done, total, p) => void} [o.progress]
 * @param {number} [o.lines] lines the view shows (MultiPV floor)
 */
export async function runPass(o) {
  const { fens, budget } = o;
  const scalarOfE = o.evalScalar || evalScalar;
  const n = fens.length;
  const view = Math.max(1, o.lines || 1);
  const quickMpv = Math.max(2, view), deepMpv = Math.max(DEEP_MULTIPV, view);
  const p = {
    fens, sans: o.sans,
    scalars: new Array(n).fill(null), linesAt: new Array(n).fill(null), depths: new Array(n).fill(null),
    bests: new Array(n).fill(null), pvs: new Array(n).fill(null), seconds: new Array(n).fill(null),
    deep: new Array(n).fill(false), terminal: new Array(n).fill(false),
  };
  const take = (i, e) => {
    p.scalars[i] = scalarOfE(e);
    const lines = e && Array.isArray(e.lines) ? e.lines : [];
    p.linesAt[i] = view > 1 && lines.length > 1
      ? lines.slice(0, view).map((l) => ({ cp: l.cp, mate: l.mate, pv: sansOf(fens[i], l.pv, 6) })) : null;
    p.bests[i] = e && typeof e.best === "string" && e.best.length >= 4 ? e.best : null;
    p.depths[i] = lines[0] && lines[0].depth ? lines[0].depth : null;
    const pv = e && e.pv && e.pv.length ? sansOf(fens[i], e.pv, 5) : [];
    p.pvs[i] = pv.length ? pv.join(" ") : null;
    p.seconds[i] = lines[1] ? scalarOfE({ cp: lines[1].cp, mate: lines[1].mate, turn: e.turn }) : null;
  };
  const search = async (i, b, mpv) => {
    try { return await o.analyze(fens[i], b, { multipv: mpv }); } catch { return null; }
  };
  const stop = () => (o.halt ? o.halt() : null);

  // terminal positions by the laws alone: mate, stalemate, dead position,
  // fivefold, 75 moves (threefold and fifty are claims; the game goes on)
  const repSeen = new Map();
  const todo = [];
  for (let i = 0; i < n; i++) {
    const probe = new Chess(fens[i]);
    const key = Fide.positionKey(fens[i], probe);
    const reps = (repSeen.get(key) || 0) + 1;
    repSeen.set(key, reps);
    if (probe.in_checkmate()) { p.scalars[i] = probe.turn() === "w" ? -10000 : 10000; p.terminal[i] = true; }
    else if (Fide.positionFinished(probe, reps)) { p.scalars[i] = 0; p.terminal[i] = true; }
    else todo.push(i);
  }
  let done = n - todo.length;
  for (const i of todo) {
    const why = stop();
    if (why) return Object.assign(p, { halted: why, at: i });
    take(i, await search(i, budget, quickMpv));
    if (o.progress) o.progress(++done, n, p);
  }

  let total = n;
  for (let round = 0; round < 4; round++) {
    const targets = deepTargets(p);
    if (!targets.length) break;
    total += targets.length;
    for (const i of targets) {
      if (stop()) return Object.assign(p, { deepCut: true });
      const e = await search(i, budget * DEEP_FACTOR, deepMpv);
      if (scalarOfE(e) != null) take(i, e);
      p.deep[i] = true;
      if (o.progress) o.progress(++done, total, p);
    }
  }
  return p;
}
