/**
 * 做题评级：玩家与每道题的 Glicko-2 评级，以及一次作答记进哪里（复习队列、累计、本周）。
 *
 * trainer/puzzles.js's ratings and the two calls every answer ends in —
 * markMissed on a miss or a look at the answer, clearMissed on a clean solve
 * — carved out in v8-2-plan F1 without a change in behaviour. A new way to
 * train that wants its own rating keeps it beside this one, the way each
 * theme does (puzzle-modes.js rateThemes), rather than moving this one.
 * @module trainer/puzzle-rating
 */
import { ChessPicker as Picker } from "../picker.js";
import { ChessProgress as Progress } from "../progress.js";
import { ChessRating } from "../rating.js";
import { ChessSrs as Srs } from "../srs.js";

/**
 * @param {object} d app.js's bag, the book (puzzle-book.js) and the trainer's `Modes` forwarder
 */
export function createPuzzleRating(d) {
  const {
    store, tf, motifKeyOf, Modes, saveProgress, bookNow, isRatedCat, puzzleTier,
    savePuzzleState, Bank,
  } = d;

  // --- 6.0: ratings (v6-plan Q3.1) -------------------------------------------
  // One Glicko-2 rating for the player, one per puzzle, both moved by the FIRST
  // answer to a puzzle only — a solve after a miss has already been counted as
  // the miss. Hand-written puzzles start from their derived tier, so the first
  // few answers already say something; the lichess import carries its own.
  function playerRating() {
    const st = store.session.puzzleState;
    if (!st.rating) st.rating = ChessRating.newRating();
    settleIdleRating(st);
    return st.rating;
  }

  /**
   * Charge the days since the rating last moved to its deviation.
   *
   * 6.1 review: rating.js documents `rd` as the thing that lets a returning
   * player's rating move again, and nothing in the app ever grew it back —
   * the only path that does was never called from anywhere.
   *
   * Settling also resets the idle clock, which is what makes this safe to call
   * from `playerRating()` on every access: a second call the same second sees
   * no whole day and does nothing. It also makes the charge exact across
   * sessions without a session flag (a flag on `st` would be persisted and
   * then never decay again): `rd²` is additive in days, so thirty daily opens
   * and one thirty-day absence land on the same deviation.
   *
   * `ratedAt` is written by ratePuzzleOnce. An archive from before 7.0 has
   * none, so the last rating-history stamp stands in. Neither present means
   * this rating has never moved — decaying from the epoch would hand every
   * such player a fresh 350 on first launch.
   */
  function settleIdleRating(st) {
    const last = Number(st.ratedAt) ||
      (Array.isArray(st.rhist) && st.rhist.length ? Number(st.rhist[st.rhist.length - 1].t) : 0);
    if (!last) return;
    const days = (Date.now() - last) / 86400000;
    if (!(days >= 1)) return;
    const next = ChessRating.decayIdle(st.rating, days);
    st.ratedAt = Date.now();
    if (next !== st.rating) st.rating = next;
    savePuzzleState();
  }
  function puzzleRating(p) {
    const st = store.session.puzzleState;
    if (!st.pr) st.pr = {};
    if (st.pr[p.id]) return st.pr[p.id];
    if (Number.isFinite(p.rating)) return { r: p.rating, rd: 150, vol: 0.06 };
    const tier = p.cat === "mine" ? "mid" : puzzleTier(p);
    const base = tier === "easy" ? 1200 : tier === "hard" ? 1800 : 1500;
    const bump = p.cat === "m3" ? 100 : p.cat === "m1" ? -100 : 0;
    return { r: base + bump, rd: 200, vol: 0.06 };
  }
  /** @returns {number|null} null for the categories that are not on the scale */
  function puzzleRatingOf(p) { return isRatedCat(p.cat) ? Math.round(puzzleRating(p).r) : null; }
  function ratePuzzleOnce(id, score) {
    const pz = store.session.puzzle;
    if (!pz || pz.p.id !== id || pz.rated || pz.run) return; // a run is not rated (trainer/runs.js)
    if (!isRatedCat(pz.p.cat)) return; // 背谱不是战术水平（7.3 B1）
    if (store.session.puzzleState.solved[id]) return; // not a first attempt
    // …nor is a restart of a missed one (R / 再试一次 builds a new puzzle object,
    // so pz.rated alone forgot it): st.pr[id] is written by the first answer
    // and is what persists it (Codex on #88)
    const pr = store.session.puzzleState.pr;
    if (pr && pr[id]) { pz.rated = true; return; }
    pz.rated = true;
    const st = store.session.puzzleState;
    const before = Math.round(playerRating().r);
    const r = ChessRating.rate1v1(playerRating(), puzzleRating(pz.p), score);
    // v8-0-plan B1: each theme the puzzle belongs to has its own rating
    Modes.rateThemes(pz.p, score, puzzleRating(pz.p));
    // what the answer did to the rating, for the feedback card (7.7 §4)
    pz.rating = { now: Math.round(r.player.r), delta: Math.round(r.player.r) - before,
      provisional: ChessRating.isProvisional(r.player) };
    st.rating = r.player;
    if (!st.pr) st.pr = {};
    st.pr[id] = r.puzzle;
    st.ratedAt = Date.now();
    if (!Array.isArray(st.rhist)) st.rhist = [];
    st.rhist.push({ t: st.ratedAt, r: Math.round(r.player.r) });
    while (st.rhist.length > 60) st.rhist.shift();
  }
  /**
   * "1523", or 「1104（定级中）」 while the rating is provisional (v8-0-plan
   * §5; v9-0-plan S6 put it in words — 「1104?」 read as a typo, and the
   * 「±180」 before that as a measurement with an error bar). The deviation
   * itself is never shown; the tooltip says what provisional means.
   */
  function ratingLabel() {
    const r = playerRating();
    return ChessRating.isProvisional(r) ? tf("rating.prov", [Math.round(r.r)]) : String(Math.round(r.r));
  }
  function ratingTip() {
    return ChessRating.isProvisional(playerRating()) ? tf("tip.ratingProv", []) : "";
  }
  function markMissed(id) {
    // Only a puzzle the book can still serve (7.4 D5). The one on screen can
    // outlive its book: replacing or clearing the repertoire (or a mined
    // drill retiring) forgets the ids, but the board keeps the drill — and a
    // wrong move on it then wrote the id straight back into the queue, a
    // review `owedNow()` counts for ever and nothing can hand out.
    // A Lichess puzzle is not in the book: v8-0-plan B1 left it out of the
    // queue for that reason. v8-1-plan T6 queues its id and notes its band,
    // and the review waits for the band when it is due (bank-review.js).
    const pz = store.session.puzzle;
    const lc = pz && pz.p.id === id && pz.p.src === "lichess" ? pz.p : null;
    const p = lc || bookNow().find((x) => x.id === id);
    if (!p) return;
    store.session.puzzleState.missed[id] = Srs.onMiss(store.session.puzzleState.missed[id], Date.now());
    if (lc) Bank.note(store.session.puzzleState, lc);
    // 6.0 (v6-plan Q3.1): the first answer to a puzzle moves both ratings
    ratePuzzleOnce(id, 0);
    // …and into the lifetime tally, which unlike the queue survives
    // graduation — it is the memory 为你出一题 reads (see picker.js)
    Picker.recordAnswer(store.session.puzzleState, p.cat, true, motifKeyOf(p));
    // …and into this week's bucket — the tally is the total, this is the change
    Progress.recordAnswer(store.session.progress, p.cat, true, Date.now());
    saveProgress();
    savePuzzleState();
  }
  /**
   * A clean solve advances the puzzle towards leaving the review queue — it no
   * longer graduates on the first correct answer, which was usually given
   * moments after reading the solution.
   */
  function clearMissed(id) {
    // owed by count, or served by date from the retention ladder — either way
    // a clean solve advances it; a retention entry solved early (from its own
    // category, before its date) is left where it is
    const cur = store.session.puzzleState.missed[id];
    if (!Srs.isDue(cur) && !Srs.dueBy(cur, Date.now())) return;
    const next = Srs.onSolve(store.session.puzzleState.missed[id], Date.now());
    if (next) store.session.puzzleState.missed[id] = next;
    else { delete store.session.puzzleState.missed[id]; Bank.forget(store.session.puzzleState, id); }
    savePuzzleState();
  }

  return {
    playerRating, puzzleRating, puzzleRatingOf, ratePuzzleOnce, ratingLabel, ratingTip,
    markMissed, clearMissed,
  };
}
