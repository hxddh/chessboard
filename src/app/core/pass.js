/**
 * The review's engine pass, 19.0's review-pass.js in behaviour: every
 * position once at the budget (MultiPV ≥ 2, so the grader sees the second
 * line), then the positions core/grade deepTargets names again at
 * DEEP_FACTOR × the budget with MultiPV 3, until nothing new is named
 * (runPass). runProgressive does the same work in the order the review on
 * the board wants it: a quick scan, the first turning point confirmed, then
 * the rest. A budget is ms (a number, as in 19.0) or a budget object.
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
    const a = await engine.analyse(fen, { lines: multipv, budget: typeof budget === "number" ? { ms: budget } : budget });
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
 * A budget DEEP_FACTOR times as large: ms and nodes scale; a review level
 * (services/engine.js REVIEW_NODES) goes to "deep"; a depth gets two plies
 * more (about 3 × the nodes at Stockfish's branching factor).
 */
export function deeper(budget, factor = DEEP_FACTOR) {
  if (typeof budget === "number") return budget * factor;
  if (!budget || typeof budget !== "object") return budget;
  if (budget.review) return { review: "deep" };
  if (budget.nodes) return { nodes: budget.nodes * factor };
  if (budget.depth) return { depth: budget.depth + Math.round(Math.log(factor) / Math.log(1.7)) };
  if (budget.ms) return { ms: budget.ms * factor };
  return budget;
}

/** The pass's arrays, its terminal positions found, and its one way to search. */
function startPass(o) {
  const { fens } = o;
  const scalarOfE = o.evalScalar || evalScalar;
  const n = fens.length;
  const view = Math.max(1, o.lines || 1);
  const p = {
    fens, sans: o.sans,
    scalars: new Array(n).fill(null), linesAt: new Array(n).fill(null), depths: new Array(n).fill(null),
    bests: new Array(n).fill(null), pvs: new Array(n).fill(null), seconds: new Array(n).fill(null),
    deep: new Array(n).fill(false), terminal: new Array(n).fill(false),
    level: new Array(n).fill(-1),
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
  const quickMpv = Math.max(2, view), deepMpv = Math.max(DEEP_MULTIPV, view);
  /** Search position i at level 0 (scan), 1 (the budget) or 2 (deep). A failed search keeps what was there, except on the first look. */
  const at = async (i, level, b) => {
    const e = await search(i, b, level === 2 ? deepMpv : quickMpv);
    if (level === 2) { if (scalarOfE(e) != null) take(i, e); p.deep[i] = true; }
    else if (scalarOfE(e) != null || p.level[i] < 0) take(i, e);
    p.level[i] = Math.max(p.level[i], level);
  };
  return { p, todo, at, stop: () => (o.halt ? o.halt() : null), n };
}

/** 19.0's deep rounds: what deepTargets names, again at the deep budget, until nothing new is named. */
async function deepRounds(s, o, deepBudget, tick) {
  for (let round = 0; round < 4; round++) {
    const targets = deepTargets(s.p);
    if (!targets.length) break;
    tick(0, targets.length);
    for (const i of targets) {
      if (s.stop()) return false;
      await s.at(i, 2, deepBudget);
      tick(1, 0);
    }
  }
  return true;
}

/**
 * @param {object} o
 * @param {string[]} o.fens   every position, [0] the start
 * @param {string[]} o.sans   the moves between them
 * @param {number|object} o.budget   per position in the first pass: ms, or a budget object
 *                                   ({ nodes } | { depth } | { ms } | { review: "normal" })
 * @param {number|object} [o.deepBudget]  for the deep rounds (default: deeper(budget))
 * @param {(fen, budget, { multipv }) => Promise<object|null>} o.analyze
 * @param {(e) => number|null} [o.evalScalar]
 * @param {() => string|null} [o.halt]       asked before each search; a truthy answer stops
 * @param {(done, total, p) => void} [o.progress]
 * @param {number} [o.lines] lines the view shows (MultiPV floor)
 */
export async function runPass(o) {
  const s = startPass(o);
  const { p, todo, n } = s;
  let done = n - todo.length, total = n;
  for (const i of todo) {
    const why = s.stop();
    if (why) return Object.assign(p, { halted: why, at: i });
    await s.at(i, 1, o.budget);
    if (o.progress) o.progress(++done, n, p);
  }
  const ok = await deepRounds(s, o, o.deepBudget ?? deeper(o.budget), (d, t) => { done += d; total += t; if (d && o.progress) o.progress(done, total, p); });
  return ok ? p : Object.assign(p, { deepCut: true });
}

/**
 * The review's pass, progressive (v20-0-plan §10 P5b): a quick scan of every
 * position at `scan`; then the turning point `pick` names (from the scan, or
 * from what has been refined since) is searched at the deep budget on both
 * sides — a card is "confirmed" when `confirmed` still says so — and
 * `onFirst(ply, p)` is told once, so the first card can be shown while the
 * rest is refined: every position not yet searched at `budget` is, and the
 * deep rounds run as in runPass. The finished arrays are what runPass gives,
 * up to the order the searches ran in (the hash): a position searched deep
 * first keeps the deep answer, as runPass's deep round would have replaced
 * the normal one with it.
 *
 * @param {object} o  runPass's, plus
 * @param {number|object} o.scan
 * @param {(p) => number|null} o.pick         the next turning point to confirm (a ply), null: none
 * @param {(p, ply) => boolean} o.confirmed   after its two positions are searched deep
 * @param {(ply, p) => void} [o.onFirst]      the first confirmed one
 * @param {(phase, p) => void} [o.onPhase]    "scan" done, "confirm" done (first card or none), "refine" done
 */
export async function runProgressive(o) {
  const s = startPass(o);
  const { p, todo, n } = s;
  const deepBudget = o.deepBudget ?? deeper(o.budget);
  let done = n - todo.length, total = n + todo.length;
  const tick = () => { if (o.progress) o.progress(++done, total, p); };
  const halted = (why, i) => Object.assign(p, { halted: why, at: i });
  for (const i of todo) {
    const why = s.stop();
    if (why) return halted(why, i);
    await s.at(i, 0, o.scan);
    tick();
  }
  if (o.onPhase) o.onPhase("scan", p);
  const tried = new Set();
  let first = null;
  for (let guard = 0; guard < 12 && first == null; guard++) {
    const ply = o.pick(p, tried);
    if (ply == null || tried.has(ply)) break;
    tried.add(ply);
    for (const i of [ply, ply + 1]) {
      const why = s.stop();
      if (why) return halted(why, i);
      if (!p.terminal[i] && !p.deep[i]) { await s.at(i, 2, deepBudget); total++; tick(); }
    }
    if (o.confirmed(p, ply)) first = ply;
  }
  if (first != null && o.onFirst) o.onFirst(first, p);
  if (o.onPhase) o.onPhase("confirm", p);
  for (const i of todo) {
    if (p.level[i] >= 1) { total--; continue; }
    const why = s.stop();
    if (why) return halted(why, i);
    await s.at(i, 1, o.budget);
    tick();
  }
  if (o.onPhase) o.onPhase("refine", p);
  const ok = await deepRounds(s, o, deepBudget, (d, t) => { total += t; if (d) tick(); });
  return ok ? p : Object.assign(p, { deepCut: true });
}
