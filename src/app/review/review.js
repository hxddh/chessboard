/**
 * The review on the board (v20-0-plan §3 P5): once a game ends, the pass
 * runs, at most three turning points are picked (core/grade selectMoments:
 * the player's own moves while the outcome was undecided), and each becomes
 * a card on the board — the position before the move, to be played again:
 *
 *   card k   你走了 X。再想想？   [看答案] [下一处 | 完成]
 *            a move tried → judged and explained for *that* move (B6)
 *   done     复盘完成。           (完整报告 on demand)
 *
 * The board stands on the first card's position as the review opens (B3).
 * The pass is stored in the `analysis` table and read back on reload, so a
 * review is never lost nor run twice (B1). Each turning point appends a
 * `review.finding` event for the learner model.
 *
 * No DOM here: the page renders `state` and `board`, and calls the verbs.
 * @module review/review
 */
import { signal, computed } from "../lib/signal.js";
import { runPass, engineAnalyze, sansOf } from "../core/pass.js";
import { gradeMoves, selectMoments, MARK } from "../core/grade.js";
import { gameAccuracy, winPctDrop, scalarOf, moveNumber, WIN_MISTAKE } from "../core/winpct.js";
import { explainMistake, explainText, explainMotif, explainKey, lineAfter, sanText } from "../core/explain.js";
import { applyMove, parseUci } from "../core/rules.js";
import { dangerAfter } from "../core/coach.js";
import { Chess } from "../core/chess.js";

export const REVIEW_BUDGET_MS = 200;
/** How long a wrong try stays on the board before the card's position comes back. */
export const RESET_MS = 1400;

const ROW_KEYS = ["scalar", "best", "second", "pv", "deep", "terminal"];
const P_KEYS = { scalar: "scalars", best: "bests", second: "seconds", pv: "pvs", deep: "deep", terminal: "terminal" };

/** The pass as rows (one per position) and back. */
export function passToRows(p, grades) {
  return p.fens.map((_, i) => {
    const r = {};
    for (const k of ROW_KEYS) { const v = p[P_KEYS[k]][i]; if (v != null && v !== false) r[k] = v; }
    if (i < grades.length && grades[i]) r.grade = grades[i];
    return r;
  });
}
export function rowsToPass(rows, fens, sans) {
  const p = { fens, sans };
  for (const k of ROW_KEYS) p[P_KEYS[k]] = rows.map((r) => (r[k] === undefined ? (k === "deep" || k === "terminal" ? false : null) : r[k]));
  return { p, grades: sans.map((_, i) => (rows[i] && rows[i].grade) || null) };
}

function sanToUci(fen, san) {
  try { const m = new Chess(fen).move(san); return m ? m.from + m.to + (m.promotion || "") : ""; } catch { return ""; }
}
const sideOf = (fen) => (fen.split(" ")[1] === "b" ? "b" : "w");

/**
 * Why a move was bad: the explainer's sentence when its facts carry one,
 * else what the board proves at once (a mate allowed, a man left to be
 * taken), else nothing.
 */
export function whyNot(facts, fen, uci, t, { withBetter = true } = {}) {
  const said = facts ? explainText(withBetter ? facts : { ...facts, better: null }, t) : "";
  if (said) return said;
  const d = dangerAfter(fen, uci);
  if (!d) return "";
  const them = sideOf(fen) === "w" ? "b" : "w";
  return d.kind === "mate" ? t("rv.ruleMate", sanText(d.san)) : t("rv.rulePiece", sanText(d.san), t("piece." + d.piece));
}

/**
 * @param {object} o
 * @param {object} o.engine   EngineService
 * @param {Promise<object>} o.db the db service (ready)
 * @param {Function} o.t      the page dictionary
 * @param {number} [o.budget] ms per position
 * @param {(ms: number, fn: () => void) => any} [o.later]
 */
export function createReview({ engine, db, t, budget = REVIEW_BUDGET_MS, later = (ms, fn) => setTimeout(fn, ms) }) {
  const state = signal({ phase: "idle" });
  let data = null;      // { gameId, fens, sans, p, grades, moments, facts, sides, orientation }
  let token = 0;
  const patch = (x) => { state.value = { ...state.peek(), ...x }; };
  const append = async (e) => (await db).append(e);

  /** Open the review of a finished `game` (the store's shape). */
  async function open(game, { orientation = "white", sides = ["w", "b"] } = {}) {
    const my = ++token;
    const fens = [game.startFen, ...game.moves.map((m) => m.fen)];
    const sans = game.moves.map((m) => m.san);
    const d = await db;
    let rows = await d.query("analysis.get", { gameId: game.id });
    if (my !== token) return;
    let p, grades, fresh = false;
    if (rows.length === fens.length) ({ p, grades } = rowsToPass(rows, fens, sans));
    else {
      state.value = { phase: "running", done: 0, total: fens.length };
      try {
        p = await runPass({ fens, sans, budget, analyze: engineAnalyze(engine), halt: () => (my !== token ? "gone" : null),
          progress: (done, total) => { if (my === token) patch({ done, total }); } });
      } catch (e) {
        if (my === token) state.value = { phase: "failed", error: String(e && e.message || e) };
        return;
      }
      if (my !== token || p.halted) return;
      grades = gradeMoves(p);
      fresh = true;
    }
    const moments = selectMoments(p, grades, sides);
    const facts = moments.map((m) => explainMistake({ fen: fens[m.ply], played: m.san, best: m.best,
      bestLine: p.pvs[m.ply], line: lineAfter(p.pvs, sans, m.ply), evalBefore: p.scalars[m.ply], evalAfter: p.scalars[m.ply + 1] }));
    data = { gameId: game.id, fens, sans, p, grades, moments, facts, sides, orientation };
    if (fresh) {
      append({ type: "review.analysis", gameId: game.id, budget, rows: passToRows(p, grades) });
      moments.forEach((m, i) => append({ type: "review.finding", gameId: game.id, ply: m.ply, san: m.san, side: m.side,
        severity: m.grade, swing: m.swing, motif: explainMotif(facts[i]) || null, fact: explainKey(facts[i]) || null }));
    }
    const row = await d.query("game.get", { id: game.id });
    if (my !== token) return;
    if (row && row.reviewed) state.value = { phase: "done", count: moments.length };
    else if (!moments.length) state.value = { phase: "empty" };
    else card(0);
  }

  function card(k) {
    const m = data.moments[k];
    state.value = { phase: "card", k, count: data.moments.length, ply: m.ply, fen: data.fens[m.ply],
      note: null, tone: null, arrows: [], solved: false, shown: false, busy: false, tries: 0 };
  }

  const current = () => (state.peek().phase === "card" ? data.moments[state.peek().k] : null);

  /** The card's sentence: move number and the move played. */
  function headline() {
    const m = current();
    if (!m) return "";
    const no = moveNumber(m.ply, sideOf(data.fens[0]));
    return t("rv.card", no, sanText(m.san), t("grade." + m.grade));
  }

  const fig = (san) => sanText(san);
  const bestArrow = (m) => { const u = parseUci(m.best); return u ? [{ from: u.from, to: u.to, color: "G" }] : []; };
  const bestSan = (m) => { const mv = m.best && applyMove(data.fens[m.ply], m.best); return mv ? mv.san : null; };

  /** A move tried on the card. Judged at once when it is the game's move or the engine's; else the engine is asked. */
  async function tryMove(uci) {
    const s = state.peek(), m = current();
    if (!m || s.busy) return;
    const fen = data.fens[m.ply];
    const mv = applyMove(fen, uci);
    if (!mv) return;
    const k = s.k;
    const tries = s.tries + 1;
    const record = (ok) => append({ type: "review.retry", gameId: data.gameId, ply: m.ply, uci: mv.uci, ok });
    const wrong = (note) => {
      patch({ note, tone: "bad", tried: { fen: mv.fen, lastMove: { from: uci.slice(0, 2), to: uci.slice(2, 4) } }, busy: false, tries });
      record(false);
      later(RESET_MS, () => { if (state.peek().phase === "card" && state.peek().k === k && !state.peek().solved) patch({ tried: null }); });
    };
    if (mv.san === m.san) {
      const why = whyNot(data.facts[k], fen, mv.uci, t);
      return wrong(t("rv.same") + (why ? " " + why + "。" : ""));
    }
    if (m.best && mv.uci === applyMove(fen, m.best)?.uci) {
      patch({ note: t("rv.right", fig(mv.san, fen)), tone: "good", solved: true, arrows: bestArrow(m), busy: false, tries,
        tried: { fen: mv.fen, lastMove: { from: uci.slice(0, 2), to: uci.slice(2, 4) } } });
      return record(true);
    }
    patch({ busy: true, note: t("rv.checking", fig(mv.san, fen)), tone: null, tried: { fen: mv.fen, lastMove: { from: uci.slice(0, 2), to: uci.slice(2, 4) } } });
    let a = null;
    try { a = await engine.analyse(mv.fen, { lines: 1, budget: { ms: budget } }); } catch { a = null; }
    if (state.peek().phase !== "card" || state.peek().k !== k) return;
    const line = a && a.lines[0];
    const after = line ? scalarOf(line.score) : null;
    const drop = after == null ? null : winPctDrop(data.p.scalars[m.ply], after, m.side);
    if (drop != null && drop < WIN_MISTAKE) {
      patch({ note: t("rv.alsoGood", fig(mv.san, fen), fig(bestSan(m) || "", fen)), tone: "good", solved: true, arrows: bestArrow(m), busy: false, tries });
      return record(true);
    }
    // explained for the move just tried, not the game's (B6)
    const facts = explainMistake({ fen, played: mv.san, best: m.best, bestLine: data.p.pvs[m.ply],
      line: line ? sansOf(mv.fen, line.moves, 6) : [] });
    const why = whyNot(facts && facts.refute ? facts : null, fen, mv.uci, t, { withBetter: false });
    wrong(why ? t("rv.wrong", fig(mv.san, fen), why) : t("rv.wrongPlain", fig(mv.san, fen)));
  }

  /** 看答案: the engine's move as an arrow, and why the game's move was not it. */
  function answer() {
    const s = state.peek(), m = current();
    if (!m) return;
    const why = whyNot(data.facts[s.k], data.fens[m.ply], sanToUci(data.fens[m.ply], m.san), t);
    const best = bestSan(m);
    const parts = [why ? why + "。" : "", best && !(why && why.includes(best.slice(1))) ? t("rv.better", fig(best, data.fens[m.ply])) : ""];
    patch({ note: parts.join(" ").trim(), tone: null, arrows: bestArrow(m), shown: true, tried: null });
  }

  function next() {
    const s = state.peek();
    if (s.phase !== "card") return;
    if (s.k + 1 < data.moments.length) card(s.k + 1);
    else finish();
  }

  function finish() {
    if (!data) return;
    state.value = { phase: "done", count: data.moments.length };
    append({ type: "review.done", gameId: data.gameId });
  }

  function close() { token++; data = null; state.value = { phase: "idle" }; }

  /** What the board shows while the review is open (null: the page's own view). */
  const board = computed(() => {
    const s = state.value;
    if (s.phase !== "card" || !data) return null;
    const m = data.moments[s.k];
    const shown = s.tried || { fen: s.fen, lastMove: m.ply > 0 ? lastOf(m.ply - 1) : null };
    return { fen: shown.fen, lastMove: shown.lastMove, arrows: s.arrows, orientation: data.orientation,
      movable: s.solved || s.busy || s.tried ? "none" : m.side === "w" ? "white" : "black", evalAt: data.p.scalars[m.ply] };
  });
  function lastOf(ply) {
    const u = sanToUci(data.fens[ply], data.sans[ply]);
    return u ? { from: u.slice(0, 2), to: u.slice(2, 4) } : null;
  }

  /** The full report: every move once, with its grade; the turning points flagged. */
  function report() {
    if (!data) return null;
    const first = sideOf(data.fens[0]);
    const at = new Set(data.moments.map((m) => m.ply));
    const rows = data.sans.map((san, i) => ({ ply: i, san, side: sideOf(data.fens[i]), moveNo: moveNumber(i, first),
      grade: data.grades[i], mark: MARK[data.grades[i]] || "", moment: at.has(i), scalar: data.p.scalars[i + 1] }));
    const acc = gameAccuracy(data.p.scalars, first);
    return { rows, accuracy: acc, sides: data.sides };
  }

  return { state, board, open, tryMove, answer, next, finish, close, report, headline,
    get data() { return data; }, scalarAt: (i) => (data ? data.p.scalars[i] : null) };
}
