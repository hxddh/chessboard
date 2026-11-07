/**
 * 错题自炼：引擎复核另一步好棋，答案的道理与引擎主变。
 *
 * The personal book's extras, from trainer/puzzles.js — carved out in
 * v8-2-plan F1 without a change in behaviour. verifyAlt also judges a
 * different first move in the mined 战术 / 得子 puzzles; it lives here
 * because the personal drill is where it began (5.1).
 * @module trainer/puzzle-mine
 */
import { Chess } from "../chess.js";
import { ChessEngine } from "../engine.js";
import { ChessMistakes as Mistakes } from "../mistakes.js";

/**
 * @param {object} d app.js's bag, the book (puzzle-book.js) and the trainer's puzzleScript
 */
export function createPuzzleMine(d) {
  const {
    BoardView, Review, evalScalar, store, sync, t, tf, writeSan, saveMines, puzzleScript,
  } = d;

  /**
   * 5.1: the personal drill asks "what should I have played" and until now
   * accepted exactly one string — the engine's first choice at the budget of
   * the pass that minted it. Any other sound move was "weaker" (audit F3).
   * Now a different move is checked against the stored answer at the same
   * budget: costs less than a mistake, it is accepted and remembered.
   */
  async function verifyAlt(mv, opts) {
    const pz = store.session.puzzle;
    const p = pz.p;
    const g = pz.g;
    if (!ChessEngine || !ChessEngine.isReady || !ChessEngine.isReady()) return null;
    const stored = puzzleScript(p)[0];
    if (!stored) return null;
    // 120 and not SCAN_BUDGET: this is what a drill mined BEFORE the budget
    // was stored was mined at. It is a fact about old records, not a default
    // for new work — raising it here would claim those drills were searched
    // deeper than they were, and the whole point of storing the budget is
    // that a shallower pass may not overrule a deeper one (5.1, audit F2).
    const budget = (p.rev && p.rev.budget) || 120;
    const side = p.fen.split(" ")[1];
    const afterAlt = g.fen();
    const probe = new Chess(p.fen);
    if (!probe.move(stored)) return null;
    const afterBest = probe.fen();
    pz.verifying = true;
    sync();
    let eBest = null, eAlt = null;
    try {
      eBest = await ChessEngine.analyze(afterBest, budget);
      eAlt = await ChessEngine.analyze(afterAlt, budget);
    } catch (_) {}
    pz.verifying = false;
    if (store.session.puzzle !== pz || pz.done) return null;
    const cpBest = evalScalar(eBest), cpAlt = evalScalar(eAlt);
    if (cpBest == null || cpAlt == null) return null;
    const v = Mistakes.judgeAlt(cpBest, cpAlt, side, Review.MISTAKE);
    if (v.ok && opts && opts.remember) {
      p.alts = Array.isArray(p.alts) ? p.alts : [];
      if (!p.alts.includes(mv.san)) { p.alts.push(mv.san); saveMines(); }
    }
    return v;
  }
  const verifyMineAlt = (mv) => verifyAlt(mv, { remember: true });

  /** Why the stored answer is the answer — from the numbers the pass kept. */
  function mineWhy(p) {
    const rest = typeof p.pv === "string" ? p.pv.split(" ").slice(1, 4).join(" ") : "";
    const loss = p.loss != null ? (p.loss / 100).toFixed(1) : null;
    let why = loss != null ? tf("pz.mine.whyLoss", [p.played, loss]) : "";
    const line = rest ? tf("pz.mine.whyLine", [p.solution[0], rest]) : "";
    return why && line ? tf("ui.pair", [why, line]) : why || line;
  }

  /**
   * 5.2: the engine's line under a solved personal drill, as chips — the
   * same chips the review's 引擎主变 uses, but here a click WALKS the puzzle
   * board to that move, because the trainer owns the board and a preview
   * would yield to it. 题面 comes first and takes the board back.
   */
  function puzzleLineSans(p) {
    if (!p || p.cat !== "mine" || !p.solution || !p.solution[0]) return [];
    const pv = typeof p.pv === "string" ? p.pv.split(" ").filter(Boolean) : [];
    const line = pv.length && pv[0] === p.solution[0] ? pv : [p.solution[0]].concat(pv.slice(0, 4));
    // only as far as the position actually allows — a revised answer may
    // have orphaned an older continuation
    const g = new Chess(p.fen);
    const ok = [];
    for (const san of line.slice(0, 6)) { if (!g.move(san)) break; ok.push(san); }
    return ok;
  }
  function walkPuzzleLine(k) {
    const pz = store.session.puzzle;
    if (!pz || !pz.done) return;
    const sans = puzzleLineSans(pz.p);
    const g = new Chess(pz.p.fen);
    let last = null;
    for (let i = 0; i <= k && i < sans.length; i++) {
      const m = g.move(sans[i]);
      if (!m) break;
      last = { from: m.from, to: m.to };
    }
    pz.g = g;
    pz.last = last;
    pz.lineAt = k;
    store.game.selection = null;
    BoardView.cancelAnim();
    store.commit("game", "sync");
  }
  function renderPuzzleLine() {
    const el = document.getElementById("puzzle-line");
    if (!el) return;
    const pz = store.session.puzzle;
    const sans = pz && pz.done ? puzzleLineSans(pz.p) : [];
    el.hidden = !sans.length;
    el.replaceChildren();
    if (!sans.length) return;
    const lab = document.createElement("span");
    lab.className = "pv-label";
    lab.textContent = t("pz.line");
    el.appendChild(lab);
    const at = Number.isInteger(pz.lineAt) ? pz.lineAt : sans.length - 1;
    const start = pz.p.fen.split(" ")[1] === "b" ? "b" : "w";
    const chip = (text, k, color) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pv-chip" + (k === at ? " active" : "");
      b.dataset.k = String(k);
      if (color) writeSan(b, text, color); else b.textContent = text;
      b.onclick = () => walkPuzzleLine(k);
      el.appendChild(b);
    };
    chip(t("pz.lineStart"), -1, null);
    sans.forEach((san, k) => chip(san, k, k % 2 === 0 ? start : (start === "w" ? "b" : "w")));
  }

  return {
    verifyAlt, verifyMineAlt, mineWhy, renderPuzzleLine,
  };
}
