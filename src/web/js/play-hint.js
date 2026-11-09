/**
 * 提示 in a game you are playing: the piece first, the move after it.
 *
 * 21.0 T3: through 19.x one press of H in a game was the answer — 「提示 ·
 * Nf3」 and the arrow — while the puzzles had shown the piece first since
 * 8.x (trainer/puzzle-hint.js). Now a game does what a puzzle does: the first
 * press rings the piece the engine would move (「提示：动亮圈里的这个子。再按一次看
 * 答案」), the second, on the same position, draws the arrow and names the
 * move. The engine is asked once; the second press reads what the first one
 * found. Moved out of app.js, which was at its line ceiling.
 * @module play-hint
 */
import { tdot } from "./tdot.js";
import { ChessEngine } from "./engine.js";

/**
 * @param {object} d what this borrows from app.js
 */
export function createPlayHint(d) {
  const { store, t, toast, game, isLive, appGameOver, engineOut, engineDownToast, stopLiveAnalysis,
    learnHint, showPuzzleAnswer, sync } = d;

  /** The ring the first press put on the board, while its position stands. */
  function piece() {
    const p = store.session.hintPiece;
    return p && isLive() && p.fen === game.fen() && !store.session.hintMove ? p : null;
  }

  async function request() {
    if (store.session.mode === "learn" && store.session.learn) { learnHint(); return; }
    if (store.session.mode === "puzzle") { showPuzzleAnswer(); return; }
    if (!ChessEngine) { toast(t("msg.engine.unavailable"), "fault"); return; }
    if (engineOut()) { engineDownToast(); return; }
    if (!isLive()) { toast(t("msg.replay.returnToLive"), "fix"); return; }
    if (appGameOver()) return;
    if (store.session.mode === "ai" && (store.session.engineThinking || game.turn() !== store.session.humanColor)) return;
    // the second press: the answer the first one found
    const shown = piece();
    if (shown) {
      store.session.hintPiece = null;
      store.session.hintMove = { from: shown.from, to: shown.to };
      store.commit("session", "sync");
      toast(tdot(t("chrome.hint"), shown.san));
      return;
    }
    if (store.session.hintPending || store.session.analyzing) return;
    const sig = game.fen();
    store.session.hintPending = true;
    await stopLiveAnalysis();
    store.commit("session", "sync");
    let e = null;
    try { e = await ChessEngine.analyze(sig, 400); } catch (_) {}
    store.session.hintPending = false;
    if (!isLive() || game.fen() !== sig) { sync(); return; }
    if (!e || !e.best) { sync(); toast(t("msg.engine.noHint"), "fault"); return; }
    const from = e.best.slice(0, 2), to = e.best.slice(2, 4);
    const vmv = game.moves({ verbose: true }).find((m) => m.from === from && m.to === to);
    store.session.hintMove = null;
    store.session.hintPiece = { fen: sig, from, to, san: vmv ? vmv.san : from + " → " + to };
    store.commit("session", "sync");
    toast(t("pz.hintPiece"));
  }

  /** The board's circles plus the ring of a first press, if one stands. */
  function withRing(s) {
    const p = piece();
    return p ? { arrows: s.arrows, circles: s.circles.concat({ sq: p.from, color: "G" }) } : s;
  }

  /** Is a ring up — the next press is the answer (the button says 答案)? */
  const ringed = () => !!piece();

  return { request, withRing, ringed };
}
