/**
 * 名局猜着（v8-2-plan T3）：从名局里选一方，每一步先猜，再看大师走的。
 *
 * A chunk (js/chunk-guess.js), fetched the first time a game is started from
 * 学习's 目录; what the bundle keeps is the list entry and the stand-in in
 * trainer/lessons.js. A run is a learn-mode run like the endgame camp's
 * (`learn.gs`, beside `learn.eg`), so the task strip, the lesson card, 重来
 * and R, the keyboard board and the move announcer all work as they do for a
 * lesson; this module draws the board model and the card's middle, and
 * judges the guesses.
 *
 * Scoring (v8-2-plan §8 decision 6): the master's own move is full marks,
 * 100. Any other move is scored by what it gives away against the master's
 * move, in the mover's win-percentage points — review.js winPctDrop of the
 * position after the master's move and the position after the guess, each
 * searched by the engine:
 *
 *   loss  = max(0, win%(after master) − win%(after guess))   mover's view
 *   score = 100 − min(100, loss)
 *
 * and graded on the review's own scale (review-grade.js gradeMoves, less the
 * grades that need the game around the move): 最佳 under BEST_EPS, 优秀
 * under EXCELLENT, 良好 under GOOD, then review.js's ?! / ? / ??. A move the
 * engine likes better than the master's loses nothing. A game's figures are
 * the average loss over every guess (a match counts 0) and 100 minus it.
 *
 * Determinism: every search is the review pass's budget (review/analysis.js
 * SCAN_BUDGET — engine.js turns it into a fixed node count, searched from
 * `ucinewgame`), at the PLAY level of the scheduler (engine-sched.js: the
 * player is waiting), and each position's number and each (position, guess)
 * verdict is kept for the session, so guessing a game again scores the same
 * move the same way without asking the engine twice.
 * @module trainer/guess
 */

/** How long the other side's move waits, so the verdict can be read (ms). */
const REPLY_MS = 700;

/**
 * @param {object} d trainer/lessons.js's bag, plus what it adds: Chess,
 *   Engine, Review, Grade, CLASSICS, classicText, carryToken, startClassic
 */
export function createGuess(d) {
  const {
    store, t, tf, tdot, Chess, Engine, Review, Grade, CLASSICS, classicText, carryToken, saveLearnState,
    startClassic, sync, BoardView, animateReply, moveSound, selectSquare, clearSelection, choosePromotion,
    kingSquare, cursorSquare, evalScalar, scanBudget, sideName,
  } = d;
  /** White-view scalar per position after a move (fen), and loss per (fen, guess) */
  const scalars = new Map();
  const judged = new Map();
  const ui = {};

  const run = () => (store.session.learn && store.session.learn.gs) || null;
  const uci = (m) => m.from + m.to + (m.promotion || "");
  const r1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
  /** 「12. Qd2」 / 「12… Rxd7」 */
  const label = (m, ply) => Math.floor(ply / 2) + 1 + (ply % 2 ? "… " : ". ") + m.san;

  /** The review's grade for a loss of `loss` points (gradeMoves' plain branch). */
  function gradeOf(loss) {
    const tag = Review.classifyByWinPct(loss);
    return tag === "??" ? "blunder" : tag === "?" ? "mistake" : tag === "?!" ? "inaccuracy"
      : loss < Grade.BEST_EPS ? "best" : loss < Grade.EXCELLENT ? "excellent" : "good";
  }

  /** The position after `m` from `fen`, White's view; the ended ones without the engine. */
  async function scalarAfter(fen, m) {
    const g = new Chess(fen);
    g.move(m);
    const key = g.fen();
    if (scalars.has(key)) return scalars.get(key);
    let s = null;
    if (g.in_checkmate()) s = g.turn() === "w" ? -10000 : 10000;
    else if (g.in_stalemate() || g.insufficient_material()) s = 0;
    else {
      try { s = evalScalar(await Engine.analyze(key, scanBudget())); } catch (_) { s = null; }
    }
    if (s != null) scalars.set(key, s);
    return s;
  }

  /** @returns {Promise<number|null>} the guess's loss against the master's move */
  async function lossOf(fen, master, guess, side) {
    const key = fen + "|" + uci(guess);
    if (judged.has(key)) return judged.get(key);
    const sm = await scalarAfter(fen, master);
    const sg = sm == null ? null : await scalarAfter(fen, guess);
    const loss = sg == null ? null : Review.winPctDrop(sm, sg, side);
    if (loss != null) judged.set(key, loss);
    return loss;
  }

  /** learnState.gs, made whole: old saves have none, a hand-edited one may be anything */
  function records() {
    const ls = store.session.learnState;
    if (!ls.gs || typeof ls.gs !== "object") ls.gs = {};
    return ls.gs;
  }

  /** Start game `ci` from the top, guessing `side` (default: the winner's). */
  function start(ci, side) {
    const c = CLASSICS[ci];
    if (!c) return;
    const g0 = new Chess();
    if (!g0.load_pgn(c.pgn, { sloppy: true })) return;
    const moves = g0.history({ verbose: true });
    const s = side === "w" || side === "b" ? side : c.result === "0-1" ? "b" : "w";
    const was = store.session.learn;
    store.session.study = null;
    store.session.learn = {
      li: was ? was.li : store.session.learnState.last || 0, ti: 0, g: new Chess(), stars: new Set(), tapStep: 0,
      last: null, done: false, engineBusy: false, token: carryToken(), misses: 0, helpOn: false, helpArrow: null,
      flash: null, demoing: false, wantDemo: false,
      gs: { ci, side: s, moves, at: 0, phase: "wait", res: [], arrow: null, mark: null, said: null, view: null,
        total: moves.filter((m) => m.color === s).length },
    };
    store.game.selection = null;
    // the board faces the side being guessed through the model alone, as a
    // puzzle's does: store.game.flipped is the play board's saved setting
    BoardView.cancelAnim();
    advance(store.session.learn.gs);
  }

  /** The other side's moves, one at a time, until it is the guesser's turn or the game ends. */
  function advance(s) {
    if (run() !== s) return;
    if (s.at >= s.moves.length) { finish(s); return; }
    if (s.moves[s.at].color === s.side) { s.phase = "guess"; sync(); return; }
    s.phase = "wait";
    sync();
    setTimeout(() => {
      if (run() !== s) { s.stall = "wait"; return; }
      const L = store.session.learn;
      const played = L.g.move(s.moves[s.at].san);
      s.at++;
      s.arrow = null; s.mark = null;
      if (played) { L.last = { from: played.from, to: played.to }; animateReply(played); moveSound(played, L.g); }
      advance(s);
    }, REPLY_MS);
  }

  function click(sq) {
    const s = run();
    const g = store.session.learn.g;
    if (!s || s.phase !== "guess") { clearSelection(); return; }
    if (store.game.selection && store.game.selection.targets.includes(sq)) {
      const from = store.game.selection.sq;
      const vmv = g.moves({ square: from, verbose: true }).find((m) => m.to === sq);
      if (vmv && vmv.promotion) { choosePromotion(g.turn(), sq).then((p) => { if (p) guess(from, sq, p); }); return; }
      guess(from, sq, "q");
      return;
    }
    const piece = g.get(sq);
    if (piece && piece.color === s.side) { selectSquare(sq, g.moves({ square: sq, verbose: true }).map((m) => m.to)); return; }
    clearSelection();
  }

  async function guess(from, to, promotion) {
    const s = run();
    if (!s || s.phase !== "guess") return;
    const L = store.session.learn;
    const fen = L.g.fen();
    const mv = L.g.move({ from, to, promotion });
    if (!mv) return;
    const master = s.moves[s.at];
    const ply = s.at;
    store.game.selection = null;
    L.last = { from: mv.from, to: mv.to };
    BoardView.cancelAnim();
    moveSound(mv, L.g);
    if (uci(mv) === uci(master)) {
      s.said = { ply, fen, you: mv, master, same: true, loss: 0, grade: "best" };
      s.res.push(s.said);
      s.arrow = null;
      s.mark = { sq: mv.to, ok: true };
      s.at++;
      advance(s);
      return;
    }
    s.phase = "check";
    s.said = null;
    sync();
    judge(s, { ply, fen, mv, master });
  }

  /** The engine's verdict on guess `p.mv`, then the master's move in its place. */
  async function judge(s, p) {
    const { ply, fen, mv, master } = p;
    const loss = await lossOf(fen, master, mv, s.side);
    if (run() !== s) { s.stall = p; return; }
    const L = store.session.learn;
    const r = { ply, fen, you: mv, master, same: false, loss, grade: loss == null ? null : gradeOf(loss) };
    s.res.push(r);
    s.said = r;
    // the master's move replaces the guess, which stays on the board as the arrow
    L.g.undo();
    const played = L.g.move(master.san);
    L.last = { from: master.from, to: master.to };
    s.arrow = { from: mv.from, to: mv.to };
    s.mark = null;
    if (played) animateReply(played);
    s.at++;
    advance(s);
  }

  /** A game's figures: matches, the average loss, the score, and the worst guess. */
  function summary(s) {
    const scored = s.res.filter((r) => r.loss != null);
    const avg = scored.length ? scored.reduce((a, r) => a + r.loss, 0) / scored.length : 0;
    const worst = scored.reduce((w, r) => (r.loss > 0 && (!w || r.loss > w.loss) ? r : w), null);
    return { same: s.res.filter((r) => r.same).length, n: s.res.length, avg, score: 100 - Math.min(100, avg), worst };
  }

  function finish(s) {
    s.phase = "done";
    const m = summary(s);
    const c = CLASSICS[s.ci];
    // the last result per game and side — the list's ✓, and nothing a reload depends on
    const rec = records();
    rec[c.id] = Object.assign(rec[c.id] && typeof rec[c.id] === "object" ? rec[c.id] : {},
      { [s.side]: { same: m.same, n: m.n, avg: Math.round(m.avg * 10) / 10, at: Date.now() } });
    saveLearnState();
    sync();
  }

  /** The biggest deviation, on the board: the position before it, both moves as arrows. */
  function jump() {
    const s = run();
    if (!s || s.phase !== "done") return;
    const w = summary(s).worst;
    s.view = w ? s.res.indexOf(w) : null;
    // the position shown, kept for the board and for what a11y.js reads out
    s.vg = w ? new Chess(w.fen) : null;
    store.game.selection = null;
    sync();
  }

  function model() {
    const L = store.session.learn, s = L.gs;
    const v = s.view != null ? s.res[s.view] : null;
    const g = s.vg || L.g;
    const guessArrow = v ? { from: v.you.from, to: v.you.to } : s.arrow;
    return {
      position: g.board(), flipped: s.side === "b",
      selected: store.game.selection ? store.game.selection.sq : null,
      legalTargets: store.game.selection ? store.game.selection.targets : [],
      lastMove: v ? null : L.last,
      checkSquare: g.in_check() ? kingSquare(g, g.turn()) : null,
      mated: g.in_checkmate(),
      success: s.phase === "done" && !v,
      hintMove: v ? { from: v.master.from, to: v.master.to } : null,
      shapes: guessArrow ? { arrows: [Object.assign({ color: "B" }, guessArrow)], circles: [] } : undefined,
      mark: v ? null : s.mark,
      stars: [], cursor: cursorSquare(), drag: store.ui.dragging,
      coords: store.ui.coordsOn, blind: store.ui.blindfold,
    };
  }

  /** The run as a one-task lesson, for the lesson card's title and dots. */
  function lesson() {
    const s = run();
    const c = CLASSICS[s.ci], tx = classicText(c);
    return { id: "gs:" + c.id, part: t("gs.part"), title: tdot(tx.white + " – " + tx.black, c.year, tf("gs.as", [sideName(s.side)])),
      text: [], tasks: [{ type: "guess" }] };
  }

  /** The task strip and the card's task line. */
  function task() {
    const s = run();
    if (s.phase === "done") return t("gs.done");
    if (s.phase === "check") return t("gs.check");
    if (s.phase === "wait") return t("gs.wait");
    return tf("gs.turn", [Math.floor(s.at / 2) + 1 + (s.at % 2 ? "…" : ".")]);
  }
  const progress = () => { const s = run(); return s.res.length + "/" + s.total; };

  /**
   * The card's middle, into #lesson-text: the rule, the last verdict (a live
   * region), the running figures, and at the end the biggest deviation.
   * Built once and only written to afterwards — its buttons are never
   * rebuilt under a press (7.6), and a timer's move may land during one.
   */
  function build() {
    const p = (cls) => { const e = document.createElement("p"); if (cls) e.className = cls; return e; };
    const b = (id, fn) => { const e = document.createElement("button"); e.type = "button"; e.className = "tool-btn"; e.id = id; e.onclick = fn; return e; };
    ui.root = document.createElement("div");
    ui.root.id = "gs-panel";
    ui.intro = p();
    ui.say = p();
    ui.say.id = "gs-say";
    ui.say.setAttribute("role", "status");
    ui.say.setAttribute("aria-live", "polite");
    ui.sum = p("hint");
    ui.sum.id = "gs-sum";
    ui.worst = p("hint");
    ui.worst.id = "gs-worst";
    const row = document.createElement("div");
    row.className = "lesson-controls fit-row fit-fill";
    ui.jump = b("gs-jump", jump);
    ui.swap = b("gs-swap", () => { const s = run(); if (s) start(s.ci, s.side === "w" ? "b" : "w"); });
    ui.quit = b("gs-quit", () => { const s = run(); if (s) startClassic(s.ci); });
    row.append(ui.jump, ui.swap, ui.quit);
    ui.root.append(ui.intro, ui.say, ui.sum, ui.worst, row);
  }
  /** The verdict on one guess, in the language of the moment it is read. */
  function sayOf(r) {
    if (!r) return "";
    const you = label(r.you, r.ply), m = label(r.master, r.ply);
    return r.same ? tf("gs.same", [you]) : r.loss == null ? tf("gs.noEval", [you, m])
      : tf("gs.diff", [you, m, t(Grade.LABEL[r.grade]), r1(r.loss)]);
  }
  const put = (e, text) => { if (e.textContent !== text) e.textContent = text; };

  function render(box) {
    const s = run();
    if (!s || !box) return;
    if (!ui.root) build();
    // M2 review: a run set aside while a load asked 「替换当前棋局？」
    // (puzzles.js leaveTrainer) and brought back on 取消 — the other side's
    // move or the engine's check that gave up meanwhile is taken up again
    if (s.stall) {
      const p = s.stall;
      s.stall = null;
      setTimeout(() => { if (run() === s) { if (p === "wait") advance(s); else judge(s, p); } }, 0);
    }
    // 重来 restarts the game (lessons.js startLearnTask); 读棋 may have hidden it
    const again = document.getElementById("lesson-restart");
    if (again) again.hidden = false;
    if (box.firstChild !== ui.root || box.childNodes.length !== 1) box.replaceChildren(ui.root);
    const m = summary(s);
    ui.root.dataset.phase = s.phase;
    ui.root.dataset.at = String(s.at);
    ui.root.dataset.view = s.view == null ? "" : String(s.res[s.view].ply);
    put(ui.intro, t("gs.intro"));
    put(ui.say, sayOf(s.said));
    put(ui.sum, m.n ? tf("gs.sum", [m.same, m.n, r1(m.avg), r1(m.score)]) : "");
    const w = s.phase === "done" ? m.worst : null;
    put(ui.worst, w ? tf("gs.worst", [label(w.you, w.ply), label(w.master, w.ply), r1(w.loss), t(Grade.LABEL[w.grade])]) : "");
    ui.worst.hidden = !w;
    ui.jump.hidden = !w;
    put(ui.jump, t("gs.jump"));
    put(ui.swap, t("gs.swap"));
    put(ui.quit, t("study.head"));
  }

  const restart = () => { const s = run(); if (s) start(s.ci, s.side); };

  return { start, restart, click, model, lesson, task, progress, render, summary, gradeOf };
}
