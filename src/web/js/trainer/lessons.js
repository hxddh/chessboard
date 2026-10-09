/**
 * 学习：零基础互动课程与名局阅读。
 *
 * The lesson runner — its state on disk, the task loop, the demos, the
 * engine-played drills and the side panel — and 6.0's classic-game reader.
 * Carved out of app.js in v8-0-plan F4 without a change in behaviour; the
 * data is still lessons.js / classics.js, the words come through
 * trainer/content.js.
 *
 * Everything it needs from the app arrives in the bag handed to
 * `createLessonsUI()` (createLibraryUI's shape); nothing here reaches back
 * into app.js.
 * @module trainer/lessons
 */
import { Chess } from "../chess.js";
import { loadChunk } from "../chunk.js";
import { CHESS_CLASSICS } from "../classics.js";
import { ChessDrills } from "../drills.js";
import { ChessEngine } from "../engine.js";
import { ChessTree } from "../game-tree.js";
import { CHESS_LESSONS } from "../lessons.js";
import { ChessEndgameRules } from "../endgame-rules.js";
import { createEndgames } from "./endgames.js";
import { ChessReview } from "../review.js";
import { ChessReviewGrade } from "../review-grade.js";
import { createAdvLessons } from "./lessons-adv.js";
import { createMoreClassics } from "./classics-more.js";
import { tdot } from "../tdot.js";

/**
 * @param {object} d everything this module borrows from app.js
 */
export function createLessonsUI(d) {
  const {
    Audio2, BoardView, PROMO_NAMES, Persist, adoptHeaderResult, animateReply, appEl,
    checkNewAchievements, choosePromotion, clearPreview, clearSelection, contentField, cursorSquare,
    draw, el, gameLoadPgn, invalidateEngine, kingSquare, lessonText, moveSound, practiceLeft,
    resetClocks, sanHistory, selectSquare, setSideTab, store, sync, t, taskText, tf, toast,
    confirmNative, maybeEngineTurn, puzzleMotif, puzzlesInCat, saveSettings, startPuzzleAt, syncAutoFlip,
  } = d;

  // --- learn mode: zero-basis interactive lessons (data in lessons.js) ---
  // v8-2-plan T1: the advanced part 3 follows as placeholders over its chunk;
  // one asked for before the chunk is here opens when it arrives
  const Adv = createAdvLessons((i) => { if (i >= 0 && store.session.mode === "learn") startLesson(i); else sync(); }, () => toast(t("learn.advFailed"), "fix"));
  const LESSONS = (CHESS_LESSONS || []).concat(Adv.stubs);

  function loadLearnState() {
    return Persist.read("learn").value || { v: 1, done: {}, last: 0 };
  }
  store.session.learnState = loadLearnState();
  function saveLearnState() {
    Persist.setJson("learn", store.session.learnState);
  }
  // v8-1-plan T2: the endgame camp — its content is a chunk, its runs are
  // one-task drills in this runner (`learn.eg` names the position)
  const Endgames = createEndgames({ store, t, tf, saveLearnState, onReady: () => sync() });

  function startLearn() {
    startLesson(Math.max(0, Math.min(store.session.learnState.last || 0, LESSONS.length - 1)));
  }
  function stopLearn() { if (store.session.learn) store.session.lastLearnToken = ++store.session.learn.token; store.session.learn = null; store.session.study = null; }
  /**
   * A new run's first token: past the run being left (or the last one
   * stopped), so an engine reply still in flight for it can never match —
   * a lesson started from an endgame used to begin at 0 again (M3 评审).
   */
  function carryToken() { return (store.session.learn ? store.session.learn.token : store.session.lastLearnToken || 0) + 1; }

  // --- 6.0: reading a classic game (v6-plan Q3.5) ----------------------------
  // A study is learn mode with no lesson: the main board holds the game, the
  // lesson pane holds the note for the move on the board, and every replay and
  // variation tool works as in a finished game. Nothing is graded.
  // v8-4-plan T2: the first ten are in the bundle, thirty more are appended
  // when their chunk arrives (trainer/classics-more.js) — to a copy, so the
  // module's own array stays the ten
  const CLASSICS = (CHESS_CLASSICS || []).slice();
  const More = createMoreClassics({ store, list: CLASSICS, onReady: () => sync() });
  function classicText(c) {
    // the thirty carry their own translations; the ten read the language chunks
    const tr = c.tr ? c.tr[store.ui.langId] : null;
    const field = (k) => (c.tr ? tr && tr[k] : contentField("classics", c.id, k));
    return {
      white: field("white") || c.white,
      black: field("black") || c.black,
      event: field("event") || c.event,
      intro: field("intro") || c.intro || "",
      note: (ply) => {
        const notes = field("notes");
        if (notes && notes[ply]) return notes[ply];
        const n = (c.notes || []).find((x) => x.ply === ply);
        return n ? n.text : null;
      },
    };
  }
  function startClassic(i) {
    const c = CLASSICS[i];
    if (!c) return;
    stopLearn();
    invalidateEngine();
    clearPreview();
    store.session.study = { ci: i };
    // 9.0 S3: 名局 picks up at the game last opened
    store.session.learnState.cl = i;
    saveLearnState();
    const text = '[Event "' + c.event.replace(/"/g, "'") + '"]\n[White "' + c.white.replace(/"/g, "'") + '"]\n[Black "' + c.black.replace(/"/g, "'") + '"]\n[Date "' + c.year + '.??.??"]\n[Result "' + c.result + '"]\n\n' + c.pgn + " " + c.result + "\n";
    if (!gameLoadPgn(text, { sloppy: true })) { toast(t("msg.import.badPgn"), "fault"); return; }
    // the notes ride the tree as comments, so they show in the move list and
    // travel with an export (Q2.1)
    const tx = classicText(c);
    for (const n of c.notes || []) {
      const id = store.game.line[n.ply];
      if (id != null && store.game.tree) ChessTree.setComment(store.game.tree, id, tx.note(n.ply) || n.text);
    }
    store.game.resigned = null; store.game.drawAgreed = false; store.game.drawClaimed = null;
    adoptHeaderResult();
    store.game.imported = true;
    store.game.selection = null;
    store.game.viewIndex = 0;
    resetClocks();
    setSideTab("play", { top: true });
    store.commit("game", "action");
    sync();
  }
  function syncStudyUI() {
    const st = store.session.study;
    if (store.session.mode !== "learn" || !st) return;
    const c = CLASSICS[st.ci];
    if (!c) return;
    const tx = classicText(c);
    const title = document.getElementById("lesson-title");
    const body = document.getElementById("lesson-text");
    const task = document.getElementById("lesson-task");
    const prog = document.getElementById("learn-progress");
    if (prog) prog.textContent = t("study.head");
    if (title) title.textContent = tx.white + " – " + tx.black + " · " + c.year;
    if (body) {
      body.replaceChildren();
      const at = store.game.viewIndex;
      const p = document.createElement("p");
      if (at === 0) p.textContent = tf("study.intro", [tx.event, c.year, c.eco, c.result]);
      else {
        const note = tx.note(at);
        p.textContent = tf(note ? "study.ofNote" : "study.ofNoNote", [at, sanHistory()[at - 1] || "", note]);
      }
      body.appendChild(p);
      // v8-4-plan T2: a game's own paragraph, before the first move
      if (at === 0 && tx.intro) { const q = document.createElement("p"); q.textContent = tx.intro; body.appendChild(q); }
    }
    if (task) { task.hidden = true; task.replaceChildren(); }
    // a classic being read has no tasks, so no progress dots
    const dots = el("lesson-dots");
    if (dots && dots.firstChild) { dots.replaceChildren(); delete dots.dataset.sig; }
    for (const id of ["lesson-restart", "lesson-demo", "lesson-practice", "lesson-next"]) {
      const b = document.getElementById(id);
      if (b) b.hidden = true;
    }
    renderCatalog();
  }

  // v8-2-plan T3: 名局猜着 — the runner is a chunk (trainer/guess.js), made on
  // the first start; a run is `learn.gs`, so until then there is none to draw
  const Gs = { m: null };
  function startGuess(ci) {
    store.session.learnState.cl = ci;
    if (Gs.m) { Gs.m.start(ci); return; }
    loadChunk("chunk-guess.js", "createGuess").then((create) => {
      Gs.m = Gs.m || create(Object.assign({ tdot, Chess, Engine: ChessEngine, Review: ChessReview, Grade: ChessReviewGrade, CLASSICS, classicText, carryToken, startClassic, saveLearnState }, d));
      Gs.m.start(ci);
    }, () => {}); // a failed load is retried on the next click
  }

  // --- 9.0 S3: 训练's segments ------------------------------------------------

  /** The segment of what is on the board in 学习: 课程, 残局 or 名局 (null outside it). */
  function learnSeg() {
    if (store.session.mode !== "learn") return null;
    const l = store.session.learn;
    if (store.session.study || (l && l.gs)) return "classic";
    return l && l.eg ? "endgame" : "course";
  }
  /** Read a classic, or guess it: 名局's one switch (store.ui.classicMode). */
  const guessing = () => store.ui.classicMode === "guess";
  /** Open classic `ci` the way the switch says. */
  function openClassic(ci) { if (guessing()) startGuess(ci); else startClassic(ci); }
  /**
   * Into segment `seg` (学习 is on): where the player left it — the lesson
   * bookmarked, the endgame last opened (or the first not done), the
   * classic last opened.
   */
  function openSeg(seg) {
    if (seg === learnSeg()) return;
    if (seg === "course") startLesson(Math.max(0, Math.min(store.session.learnState.last || 0, LESSONS.length - 1)));
    else if (seg === "endgame") {
      Endgames.whenReady(() => {
        if (store.session.mode !== "learn" || learnSeg() === "endgame") return;
        const id = Endgames.resumeId();
        if (id) startEndgame(id);
        sync();
      });
      return;
    } else if (seg === "classic") openClassic(Math.max(0, Math.min(store.session.learnState.cl || 0, CLASSICS.length - 1)));
    sync();
  }

  function curLesson() { const l = store.session.learn; return (l.gs && Gs.m.lesson()) || (l.eg && Endgames.lesson(l.eg)) || LESSONS[l.li]; }
  function curTask() { return curLesson().tasks[store.session.learn.ti]; }

  function startLesson(i, stand) {
    if (!LESSONS[i]) return;
    store.session.study = null;
    if (!stand) { store.session.learnState.last = i; saveLearnState(); Adv.want(-1); }
    // an advanced lesson before its chunk: opened when it arrives; meanwhile,
    // and if it never does (lessons-adv.js), the nearest lesson before it
    // stands in, so 学习 is not a blank page — the bookmark stays (M2 review)
    if (!LESSONS[i].tasks.length) { Adv.want(i); if (!store.session.learn) startLesson((CHESS_LESSONS || []).length - 1, true); return; }
    store.session.learn = { li: i, ti: 0, g: null, stars: new Set(), tapStep: 0, last: null, done: false, engineBusy: false, token: carryToken(), misses: 0, helpOn: false, helpArrow: null, flash: null, demoing: false, wantDemo: !stand && !store.session.learnState.done[LESSONS[i].id] };
    startLearnTask();
  }

  /** v8-1-plan T2: open endgame `id` of the camp (learn mode must be on) */
  function startEndgame(id) {
    if (!Endgames.lesson(id)) return;
    // 9.0 S3: 残局 picks up at the one last opened
    Endgames.state().last = id;
    saveLearnState();
    const li = store.session.learn ? store.session.learn.li : store.session.learnState.last || 0;
    store.session.study = null;
    // the token carries on from the run being left: an engine reply still in
    // flight for it must not match the new run's first token
    store.session.learn = { li, eg: id, ti: 0, g: null, stars: new Set(), tapStep: 0, last: null, done: false, engineBusy: false, token: carryToken(), misses: 0, helpOn: false, helpArrow: null, flash: null, demoing: false, wantDemo: false };
    startLearnTask();
  }

  function startLearnTask() {
    if (store.session.learn.gs) { Gs.m.restart(); return; }
    const task = curTask();
    store.session.learn.token++;
    BoardView.cancelAnim();
    store.session.learn.g = new Chess(task.fen);
    store.session.learn.stars = new Set(task.stars || []);
    store.session.learn.tapStep = 0;
    store.session.learn.last = null;
    store.session.learn.done = false;
    store.session.learn.engineBusy = false;
    store.session.learn.misses = 0;
    store.session.learn.helpOn = false;
    store.session.learn.helpArrow = null;
    store.session.learn.flash = null;
    store.session.learn.demoing = false;
    // T2: what the engine starts with (a new queen is the defence failing),
    // and whether this try leaned on undo or the hint (→ the review queue)
    store.session.learn.egStart = task.eg ? ChessEndgameRules.startOf(store.session.learn.g) : null;
    store.session.learn.egHelped = false;
    store.game.selection = null;
    // first visit to an unfinished lesson: show the solution once, then reset
    if (store.session.learn.wantDemo && task.solution && (task.type === "stars" || task.type === "move")) {
      store.session.learn.wantDemo = false;
      runLessonDemo();
      return;
    }
    sync();
  }

  /** Auto-play the task's solution as a watch-first demo; any board click skips. */
  function runLessonDemo() {
    const task = curTask();
    const sol = task.solution;
    store.session.learn.demoing = true;
    const token = store.session.learn.token;
    let i = 0;
    toast(t("lm.demoIntro"));
    store.commit("session", "sync");
    const step = () => {
      if (!store.session.learn || store.session.learn.token !== token) return;
      if (i >= sol.length) {
        setTimeout(() => {
          if (!store.session.learn || store.session.learn.token !== token) return;
          endLessonDemo();
        }, 800);
        return;
      }
      const s = sol[i++];
      const g = store.session.learn.g;
      const mv = /^[a-h][1-8][a-h][1-8]$/.test(s)
        ? g.move({ from: s.slice(0, 2), to: s.slice(2, 4), promotion: "q" })
        : g.move(s);
      if (!mv) { endLessonDemo(); return; }
      store.session.learn.last = { from: mv.from, to: mv.to };
      if (task.type === "stars") {
        if (store.session.learn.stars.has(mv.to)) store.session.learn.stars.delete(mv.to);
        // hand the turn back, exactly like real star play
        const f = g.fen().split(" ");
        f[1] = "w"; f[3] = "-";
        store.session.learn.g = new Chess(f.join(" "));
      }
      Audio2.playMove("w");
      sync();
      setTimeout(step, 800);
    };
    setTimeout(step, 700);
  }

  function endLessonDemo() {
    const task = curTask();
    store.session.learn.demoing = false;
    store.session.learn.g = new Chess(task.fen);
    store.session.learn.stars = new Set(task.stars || []);
    store.session.learn.last = null;
    store.game.selection = null;
    sync();
    toast(t("lm.yourTurn"), "fix");
  }

  function skipLessonDemo() {
    store.session.learn.token++; // kill the pending demo timers
    endLessonDemo();
  }

  function learnModel() {
    if (store.session.learn.gs) return Gs.m.model();
    const g = store.session.learn.g;
    const task = curTask();
    let stars = Array.from(store.session.learn.stars);
    // stuck-help: after repeated misses, highlight the tap answer with stars
    if (store.session.learn.helpOn && task.type === "tap" && store.session.learn.tapStep < task.steps.length) {
      stars = task.steps[store.session.learn.tapStep].squares;
    }
    return {
      position: g.board(),
      flipped: false, // lessons are authored from the white side
      selected: store.game.selection ? store.game.selection.sq : null,
      legalTargets: store.game.selection ? store.game.selection.targets : [],
      lastMove: store.session.learn.last,
      checkSquare: g.in_check() ? kingSquare(g, g.turn()) : null,
      mated: g.in_checkmate(),
      // v8-0-plan A5: while the success flash is up, or the lesson is done,
      // a mate that completed the task is not lit in the check's red
      success: !!(store.session.learn.flash || store.session.learn.done),
      hintMove: store.session.learn.helpArrow,
      flashSquare: store.session.learn.flash,
      stars,
      cursor: cursorSquare(),
      // the drag is part of the picture, not a thing pushed in beforehand
      drag: store.ui.dragging,
    };
  }

  /** Two misses on the same task → show the answer (stars for taps, arrow for moves). */
  function learnRegisterMiss() {
    store.session.learn.misses++;
    if (store.session.learn.misses < 2 || store.session.learn.helpOn) return;
    store.session.learn.helpOn = true;
    const task = curTask();
    if (task.type === "move" && task.solution && task.solution.length) {
      try {
        const probe = new Chess(task.fen);
        const mv = probe.move(task.solution[0]);
        if (mv) store.session.learn.helpArrow = { from: mv.from, to: mv.to };
      } catch (_) {}
    }
    toast(t("lm.answerShown"), "fix");
    store.commit("session", "sync");
  }

  function learnFlash(sq) {
    store.session.learn.flash = sq;
    draw();
    const token = store.session.learn.token;
    setTimeout(() => {
      if (store.session.learn && store.session.learn.token === token && store.session.learn.flash === sq) { store.session.learn.flash = null; draw(); }
    }, 380);
  }

  function learnTaskText() {
    if (store.session.learn.gs) return Gs.m.task();
    const task = curTask();
    if (store.session.learn.demoing) return t("lm.demoing");
    if (store.session.learn.done && store.session.learn.eg) return tf("lm.doneThen", [t(Endgames.next(store.session.learn.eg) ? "eg.tapNext" : "eg.allDone")]);
    if (store.session.learn.done) return tf("lm.doneThen", [t(store.session.learn.li + 1 < LESSONS.length ? "lm.tapNext" : "lm.allDone")]);
    const tx = taskText(curLesson(), store.session.learn.ti);
    if (task.type === "tap") return tx.step(store.session.learn.tapStep) + " (" + (store.session.learn.tapStep + 1) + "/" + task.steps.length + ")";
    if (task.type === "drill" && store.session.learn.engineBusy) return t("lm.sparThinking");
    // tx, not task: reading the prompt straight off the lesson showed every
    // move/stars/drill task in Chinese to English readers — the translations
    // were sitting in lessons-en.js unused, and only the tap tasks (which go
    // through tx.step above) ever looked translated
    return tx.prompt;
  }

  function learnClick(sq) {
    if (store.session.learn && store.session.learn.gs) { Gs.m.click(sq); return; }
    if (!store.session.learn || store.session.learn.done) return;
    if (store.session.learn.demoing) { skipLessonDemo(); return; }
    const task = curTask();
    if (task.type === "tap") {
      if (task.steps[store.session.learn.tapStep].squares.includes(sq)) {
        store.session.learn.tapStep++;
        store.session.learn.helpOn = false;
        store.session.learn.misses = 0;
        Audio2.playStar();
        learnFlash(sq);
        if (store.session.learn.tapStep >= task.steps.length) learnTaskDone();
        else sync();
      } else {
        // the localised tip, not the authored one — same reason as learnTaskText
        toast(tf("lm.wrongSquare", [taskText(curLesson(), store.session.learn.ti).step(store.session.learn.tapStep)]));
        learnRegisterMiss();
      }
      return;
    }
    if (task.type === "drill" && store.session.learn.engineBusy) return;
    const g = store.session.learn.g;
    if (g.game_over()) return;
    const piece = g.get(sq);
    if (store.game.selection && store.game.selection.targets.includes(sq)) {
      const from = store.game.selection.sq;
      const vmv = g.moves({ square: from, verbose: true }).find((m) => m.to === sq);
      if (vmv && vmv.promotion) {
        choosePromotion(g.turn(), sq).then((p) => { if (p) learnMove(from, sq, p); });
        return;
      }
      learnMove(from, sq, "q");
      return;
    }
    if (piece && piece.color === "w" && g.turn() === "w" && (!task.only || piece.type === task.only)) {
      selectSquare(sq, g.moves({ square: sq, verbose: true }).map((m) => m.to));
      return;
    }
    if (task.only && piece && piece.color === "w" && piece.type !== task.only) {
      toast(tf("lm.onlyPiece", [PIECE_NAMES[task.only]]));
      return;
    }
    clearSelection();
  }

  const PIECE_NAMES = new Proxy({}, { get: (_, k) => t("piece." + String(k)) });

  function learnRetryTask(msg) {
    // T2: a camp position that went wrong joins the review queue (srs.js)
    const eg = store.session.learn.eg;
    if (eg) Endgames.record(eg, false, false);
    toast(eg ? tf("lm.tip2", [msg, t("eg.queued")]) : msg, "fix");
    const token = store.session.learn.token;
    setTimeout(() => { if (store.session.learn && store.session.learn.token === token) startLearnTask(); }, 1400);
  }

  function learnMove(from, to, promotion) {
    const task = curTask();
    const g = store.session.learn.g;
    const mv = g.move({ from, to, promotion });
    if (!mv) return;
    store.game.selection = null;
    store.session.learn.last = { from: mv.from, to: mv.to };
    store.session.learn.helpArrow = null;
    BoardView.cancelAnim(); // the student's own move — see animateReply
    moveSound(mv, g);
    if (task.type === "stars") {
      if (store.session.learn.stars.has(mv.to)) {
        store.session.learn.stars.delete(mv.to);
        Audio2.playStar();
        learnFlash(mv.to);
      }
      if (store.session.learn.stars.size === 0) { learnTaskDone(); return; }
      // hand the turn straight back to the student — the opponent never replies
      const f = g.fen().split(" ");
      f[1] = "w"; f[3] = "-";
      store.session.learn.g = new Chess(f.join(" "));
      sync();
      return;
    }
    if (task.type === "move") {
      const okByGoal =
        task.goal === "any" ? true :
        task.goal === "check" ? g.in_check() :
        task.goal === "mate" ? g.in_checkmate() :
        task.goal === "castle-k" ? mv.flags.includes("k") :
        task.goal === "castle-q" ? mv.flags.includes("q") :
        task.goal === "ep" ? mv.flags.includes("e") :
        task.goal === "promote" ? !!mv.promotion :
        task.goal === "capture" ? (mv.to === task.target && !!mv.captured) :
        task.goal === "one-of" ? (Array.isArray(task.accept) && task.accept.includes(mv.san)) :
        // safe: the moved piece cannot be captured by any reply
        task.goal === "safe" ? !g.moves({ verbose: true }).some((m) => m.to === mv.to) :
        task.goal === "draw-insufficient" ? g.insufficient_material() : false;
      if (okByGoal) {
        if (mv.promotion) toast(tf("mm.promoted", [PROMO_NAMES[mv.promotion]]));
        learnTaskDone();
        return;
      }
      if (task.failOnStalemate && g.in_stalemate()) {
        sync();
        learnRetryTask(t("lm.stalemateFail"));
        return;
      }
      g.undo();
      store.session.learn.last = null;
      // the translated retry hint, not the raw Chinese one on the task
      // a lesson retry is a correction, not a receipt
      toast(taskText(curLesson(), store.session.learn.ti).retry || t("lm.retry"), "fix");
      learnRegisterMiss();
      sync();
      return;
    }
    if (task.type === "drill") {
      if (task.winOn === "promote" && mv.promotion) {
        toast(t("lm.promoWin"));
        learnTaskDone();
        return;
      }
      sync();
      const done = drillOutcome(g, task);
      if (done === "win") { learnTaskDone(); return; }
      if (done) { learnRetryTask(done); return; }
      learnEngineReply();
    }
  }

  /**
   * How a drill position stands after a move.
   * @returns {"win"|string|null} "win", a retry message, or null to play on.
   * Defensive drills (`winOn: "draw"`) invert the usual verdict: reaching a
   * draw *is* the goal, and being mated is the failure.
   */
  const EG_FAIL = { mated: "lm.mated", stalemate: "lm.stalemated", draw: "lm.drawn", material: "lm.lostMaterial", queened: "lm.blackQueened" };
  function drillOutcome(g, task) {
    // What happened, then what to do about it: the outcome names the result and
    // `drillAdvice()` reads the technique that was missing off the position.
    // Where it has nothing certain to say the plain outcome stands alone. 缺陷 26.
    const say = (key, goal, how) => {
      const tip = ChessDrills.drillAdvice(g, goal, how);
      return tip ? tf("lm.tip2", [t(key), t(tip)]) : t(key);
    };
    if (task.eg) {
      // v8-1-plan T2: the camp's own rules (endgame-rules.js), one table for
      // the app and for test-endgames.mjs
      const r = ChessEndgameRules.outcome(g, task.goal, store.session.learn.egStart);
      if (!r) return null;
      if (r.ok) return "win";
      return t(EG_FAIL[r.how] || "lm.drawn");
    }
    if (task.winOn === "draw") {
      if (g.in_checkmate()) return say("lm.mateDefLost", "draw", "mated");
      if (g.game_over()) return "win"; // stalemate / 50-move / insufficient
      // black queening means the defence has already collapsed
      for (const row of g.board()) for (const p of row) {
        if (p && p.color === "b" && p.type === "q") return say("lm.blackQueened", "draw", "queened");
      }
      return null;
    }
    if (g.in_checkmate()) return g.turn() === "b" ? "win" : say("lm.mated", "win", "mated");
    if (g.game_over()) {
      return g.in_stalemate()
        ? say("lm.stalemated", "win", "stalemate")
        : say("lm.drawn", "win", "draw");
    }
    return null;
  }

  /** White still has winning material for this drill (health check). */
  function learnHasHeavy(g) {
    for (const row of g.board()) for (const p of row) {
      if (p && p.color === "w" && (p.type === "q" || p.type === "r" || p.type === "p")) return true;
    }
    return false;
  }

  async function learnEngineReply() {
    if (!ChessEngine) { toast(t("lm.noEngine"), "fault"); return; }
    const g = store.session.learn.g;
    const token = store.session.learn.token;
    // drills default to the weakest tier: the sparring partner is there to
    // teach the technique, not to punish a beginner with perfect defense
    const tier = curTask().engine || "beginner";
    store.session.learn.engineBusy = true;
    store.commit("session", "sync");
    let mv = null;
    try { mv = await ChessEngine.bestMove(g.fen(), tier); } catch (_) {}
    if (!store.session.learn || token !== store.session.learn.token) return;
    store.session.learn.engineBusy = false;
    if (mv) {
      const played = g.move({ from: mv.from, to: mv.to, promotion: mv.promotion || "q" });
      if (played) {
        store.session.learn.last = { from: played.from, to: played.to };
        animateReply(played);
        moveSound(played, g);
      }
    }
    const task = curTask();
    const done = drillOutcome(g, task);
    if (done === "win") { sync(); learnTaskDone(); return; }
    if (done) { sync(); learnRetryTask(done); return; }
    // attacking drills need the material that makes the win possible; the
    // defensive one is *expected* to be down material, so skip the check
    if (task.winOn !== "draw" && !task.eg && !learnHasHeavy(g)) {
      store.commit("session", "sync");
      learnRetryTask(t("lm.lostMaterial"));
      return;
    }
    store.commit("session", "sync");
  }

  /** Drill-only: take back the last white move (and the engine reply with it). */
  function learnUndo() {
    if (!store.session.learn || store.session.learn.done || curTask().type !== "drill") return;
    const g = store.session.learn.g;
    if (!g.history().length) return;
    store.session.learn.token++; // drop any in-flight engine reply
    store.session.learn.engineBusy = false;
    store.session.learn.egHelped = true; // T2: a taken-back try is not a clean one
    if (ChessEngine) ChessEngine.cancel();
    g.undo();
    if (g.history().length && g.turn() !== "w") g.undo();
    store.session.learn.last = null;
    store.session.learn.helpArrow = null;
    store.game.selection = null;
    sync();
  }

  /** Drill-only engine hint, drawn as an arrow (full strength, brief think). */
  async function learnHint() {
    if (!store.session.learn || store.session.learn.done || curTask().type !== "drill" || store.session.learn.engineBusy) return;
    if (!ChessEngine) { toast(t("msg.engine.unavailable"), "fault"); return; }
    const g = store.session.learn.g;
    if (g.game_over() || g.turn() !== "w") return;
    if (store.session.hintPending) return;
    const token = store.session.learn.token;
    const sig = g.fen();
    store.session.hintPending = true;
    store.commit("session", "sync");
    let e = null;
    try { e = await ChessEngine.analyze(sig, 400); } catch (_) {}
    store.session.hintPending = false;
    if (!store.session.learn || token !== store.session.learn.token || store.session.learn.g.fen() !== sig) { sync(); return; }
    if (!e || !e.best) { sync(); toast(t("msg.engine.noHint"), "fault"); return; }
    store.session.learn.egHelped = true;
    store.session.learn.helpArrow = { from: e.best.slice(0, 2), to: e.best.slice(2, 4) };
    store.commit("session", "sync");
  }

  function learnTaskDone() {
    const L = curLesson();
    store.game.selection = null;
    if (store.session.learn.ti + 1 < L.tasks.length) {
      Audio2.playMove("b");
      toast(t("lm.nextSubtask"), "fix");
      store.session.learn.ti++;
      // startLearnTask resets the per-task cursors, but it runs 900ms later —
      // and the board and prompt are redrawn now. A tap task followed by
      // another tap task would spend that gap reading step[3] of a 1-step task.
      store.session.learn.tapStep = 0;
      store.session.learn.helpOn = false;
      const token = ++store.session.learn.token;
      setTimeout(() => { if (store.session.learn && store.session.learn.token === token) startLearnTask(); }, 900);
      sync();
      return;
    }
    store.session.learn.done = true;
    Audio2.playWin();
    if (L.eg) {
      // T2: the camp keeps its own record; a try that used undo or the hint
      // counts as reached, and comes back for review
      Endgames.record(L.eg, true, store.session.learn.egHelped);
      if (store.session.learn.egHelped) toast(t("eg.helped"), "fix");
      sync();
      return;
    }
    if (!store.session.learnState.done[L.id]) {
      // 9.0 S1: when, so 今天 can count the lessons finished today
      if (!store.session.learnState.done[L.id]) store.session.learnState.done[L.id] = Date.now();
      saveLearnState();
      checkNewAchievements();
    }
    // no toast (7.7 §4): the dot row fills, the task card says 完成 and
    // points at 下一课, and 下一课 takes the fill — the lesson's own screen
    // says it is finished, where the next step is
    sync();
  }

  /**
   * One lesson paragraph as a <p>, with `**…**` rendered bold.
   *
   * The course has emphasised its key sentences with `**…**` since 1.4 — the
   * one line in each lesson a beginner should carry away. The renderer set
   * `textContent`, so every reader saw the asterisks instead of the emphasis;
   * 24 paragraphs in the Chinese course and 17 in the English one. Split
   * rather than parsed, and assembled from text nodes rather than markup, so
   * lesson prose can never become HTML.
   * @param {string} src
   * @returns {HTMLParagraphElement}
   */
  function lessonParagraph(src) {
    const el = document.createElement("p");
    // odd indices are the bold runs; an unpaired ** leaves its text alone
    const parts = String(src).split("**");
    parts.forEach((chunk, i) => {
      if (!chunk) return;
      if (i % 2 === 1 && i < parts.length - 1) {
        const b = document.createElement("strong");
        b.textContent = chunk;
        el.appendChild(b);
      } else {
        el.appendChild(document.createTextNode(i % 2 === 1 ? "**" + chunk : chunk));
      }
    });
    return el;
  }

  function syncLearnUI() {
    const sec = document.getElementById("sec-learn");
    if (!sec) return;
    sec.hidden = store.session.mode !== "learn";
    // the strip over the board (7.6 §3f): a lesson task, not a classic being
    // read — the stylesheet decides where it shows, this only says there is one
    const hasTask = store.session.mode === "learn" && !!store.session.learn;
    appEl.classList.toggle("has-task", hasTask);
    const strip = document.getElementById("task-strip-text");
    if (strip) strip.textContent = hasTask ? learnTaskText() : "";
    if (store.session.mode !== "learn" || !store.session.learn) return;
    const L = curLesson();
    const doneCount = LESSONS.filter((x) => store.session.learnState.done[x.id]).length;
    const prog = document.getElementById("learn-progress");
    // "完成 3/72" reads differently from the header chip's "4/72", which is
    // where you ARE. Two bare N/72 on one screen meant two different things.
    const eg = store.session.learn.eg, gs = store.session.learn.gs;
    if (prog) prog.textContent = gs ? Gs.m.progress() : tf("learn.doneN", eg ? [Endgames.doneCount(), Endgames.total()] : [doneCount, LESSONS.length]);
    const loc = lessonText(L);
    const title = document.getElementById("lesson-title");
    if (title) title.textContent = tdot(!eg && !gs && tf("learn.lessonN", [store.session.learn.li + 1]), loc.part, loc.title);
    // 7.7 (v7-7-plan §4): the lesson's tasks as a row of dots — done filled,
    // current ringed; a finished lesson is a full row
    const dots = el("lesson-dots");
    if (dots) {
      const n = L.tasks.length;
      const ti = store.session.learn.ti;
      const done = !!store.session.learn.done;
      const sig = L.id + "|" + n + "|" + ti + "|" + done + "|" + store.ui.langId;
      if (dots.dataset.sig !== sig) {
        dots.dataset.sig = sig;
        dots.replaceChildren(...L.tasks.map((_, i) => {
          const d = document.createElement("li");
          d.className = "lesson-dot" + (done || i < ti ? " done" : i === ti ? " current" : "");
          return d;
        }));
        dots.classList.toggle("complete", done);
        dots.setAttribute("aria-label", tf("aria.lessonDotsOf", [done ? n : ti, n]));
      }
    }
    const textEl = document.getElementById("lesson-text");
    if (gs) Gs.m.render(textEl);
    else if (textEl) {
      textEl.replaceChildren();
      for (const p of loc.text) {
        textEl.appendChild(lessonParagraph(p));
      }
    }
    const task = document.getElementById("lesson-task");
    if (task) task.textContent = learnTaskText();
    const demoBtn = document.getElementById("lesson-demo");
    if (demoBtn) {
      const curT = curTask();
      // Most tasks have nothing to demonstrate. Greying the button out on
      // those lessons said "this is unavailable" without ever saying when it
      // would be available — for a lesson with no solution to replay, the
      // answer is never. It is hidden there and shown where it works; the
      // disabled state is now only "a demo is playing right now", which the
      // moving pieces already explain.
      const canDemo = !!curT.solution && (curT.type === "stars" || curT.type === "move");
      demoBtn.hidden = !canDemo;
      demoBtn.disabled = store.session.learn.demoing;
    }
    const practice = document.getElementById("lesson-practice");
    if (practice) {
      // Shown only where the course has somewhere to send you. A lesson with
      // no matching puzzles offers no button at all rather than a dead one —
      // 缺陷 24 was the missing link, not a missing affordance for it.
      const rest = practiceLeft(L);
      practice.hidden = !rest.total;
      practice.disabled = false;
      if (rest.total) {
        practice.textContent = tf("act.practice", [rest.left || rest.total]);
        // Never the filled one (7.7 §3): once the lesson is done that is
        // 下一课, and two filled buttons in one row say nothing about which
        // to press. 接着练 stays one click away beside it.
        practice.classList.remove("primary");
      }
    }
    const next = document.getElementById("lesson-next");
    if (next && gs) next.hidden = true;
    else if (next && eg) {
      // T2: the camp's own 下一个 — the next untried position, then what is due
      next.textContent = t("eg.next");
      next.hidden = !Endgames.next(eg);
      next.disabled = false;
      next.classList.toggle("primary", !!store.session.learn.done);
    } else if (next) {
      const isLast = store.session.learn.li + 1 >= LESSONS.length;
      next.textContent = isLast ? t("lm.toBeginnerAi") : t("act.next");
      // `learn.done` only records whether the tasks were finished *this
      // session*, so someone returning to a course they already completed
      // found the graduation button greyed out — the one button the whole
      // teaching track exists to reach. The saved progress counts too.
      const everDone = !!store.session.learnState.done[LESSONS[store.session.learn.li].id];
      // Not drawn rather than greyed. The gate itself is right — 「去人机·
      // 新手」 is graduation, and graduating out of the last lesson before
      // finishing it is not a thing to offer — but P3 says an action that does
      // not apply is absent, not disabled, and this was the app's last greyed
      // control: measured across eight states (人机 对局/设置/记录, 双人, 教学
      // 第 1 课, 教学 第 72 课, 做题 未解/已解) it was the only one, and only
      // because 3d has always looked at 人机 and the lesson row only exists in
      // 教学. Openly disabled for so long precisely because nothing looked.
      next.hidden = isLast && !store.session.learn.done && !everDone;
      next.disabled = false;
      next.classList.toggle("primary", store.session.learn.done || (isLast && everDone));
    }
    renderCatalog();
  }

  /**
   * 9.0 S3: the catalog is the segment's — 120 lessons by unit, the 40
   * classics once (read or guess is a switch, not a second list), or the
   * camp's 90 endgames by group. From the lesson's sync and the classic's.
   */
  function renderCatalog() {
    const l = store.session.learn;
    const eg = l ? l.eg : null, gs = l ? l.gs : null;
    const li = l ? l.li : -1;
    const seg = learnSeg() || "course";
    const list = document.getElementById("lesson-list");
    const mode = document.getElementById("classic-mode");
    if (mode) {
      mode.hidden = seg !== "classic";
      mode.querySelectorAll("button[data-cmode]").forEach((b) => {
        const on = b.dataset.cmode === (guessing() ? "guess" : "read");
        b.classList.toggle("active", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
    }
    const head = document.getElementById("lesson-list-h");
    const headText = seg === "classic" ? tf("train.allClassics", [CLASSICS.length])
      : seg === "endgame" ? tf("train.allEndgames", [Endgames.total() || 90])
      : tf("train.allLessons", [LESSONS.filter((x) => x.tasks.length).length]);
    if (head && head.textContent !== headText) head.textContent = headText;
    if (list) {
      list.replaceChildren();
      if (seg === "course") {
        // a unit's head carries its progress, so the list reads as fourteen units
        const units = new Map();
        for (const x of LESSONS) {
          if (!x.tasks.length) continue;
          const part = lessonText(x).part;
          const u = units.get(part) || { n: 0, done: 0 };
          u.n++;
          if (store.session.learnState.done[x.id]) u.done++;
          units.set(part, u);
        }
        let lastPart = null;
        LESSONS.forEach((x, i) => {
          if (!x.tasks.length) return; // T1: an advanced lesson, its chunk still on the way
          const xl = lessonText(x);
          if (xl.part !== lastPart) {
            lastPart = xl.part;
            const h = document.createElement("div");
            h.className = "lesson-part";
            const u = units.get(xl.part);
            h.textContent = tf("ui.pair", [xl.part, u.done + "/" + u.n]);
            list.appendChild(h);
          }
          const b = document.createElement("button");
          b.type = "button";
          b.className = "lesson-item" + (!eg && !gs && i === li ? " current" : "");
          b.dataset.i = String(i);
          const mark = store.session.learnState.done[x.id] ? "✓ " : "";
          b.textContent = mark + (i + 1) + ". " + xl.title;
          list.appendChild(b);
        });
      } else if (seg === "classic") {
        // v8-4-plan T2: the thirty more follow each ten, headed by their eras
        const gsDone = store.session.learnState.gs || {};
        const key = guessing() ? "gs" : "c";
        const cur = gs ? gs.ci : store.session.study ? store.session.study.ci : -1;
        More.ensure();
        let head2 = null;
        CLASSICS.forEach((c, i) => {
          const want = c.g ? More.groupName(c.g) : t("study.part");
          if (want !== head2) {
            head2 = want;
            const h = document.createElement("div");
            h.className = "lesson-part";
            h.textContent = want;
            list.appendChild(h);
          }
          const tx = classicText(c);
          const b = document.createElement("button");
          b.type = "button";
          b.className = "lesson-item" + (i === cur ? " current" : "");
          b.dataset[key] = String(i);
          b.textContent = (gsDone[c.id] ? "✓ " : "") + tx.white + " – " + tx.black + " · " + c.year;
          list.appendChild(b);
        });
      } else Endgames.renderList(list, eg);
    }
  }

  /** The lesson panel's controls — wired from app.js's boot as before (v8-0-plan F4). */
  function wireLessonPanel() {
    document.getElementById("lesson-restart").onclick = () => {
      if (store.session.learn) { startLearnTask(); toast(t("lm.restarted")); }
    };
    document.getElementById("lesson-demo").onclick = () => {
      if (!store.session.learn || store.session.learn.demoing) return;
      const task = curTask();
      if (!task.solution || (task.type !== "stars" && task.type !== "move")) { toast(t("lm.noDemo"), "fix"); return; }
      store.session.learn.wantDemo = true;
      startLearnTask();
    };
    document.getElementById("learn-reset").onclick = async () => {
      if (!(await confirmNative(t("dlg.resetLearn"), t("dlg.resetLearnTitle"),
        { ok: t("act.reset"), cancel: t("act.cancel"), danger: true }))) return;
      store.session.learnState = { v: 1, done: {}, last: 0 };
      saveLearnState();
      if (store.session.learn) startLesson(0);
      toast(t("lm.progressReset"));
    };
    document.getElementById("lesson-next").onclick = () => {
      if (!store.session.learn) return;
      if (store.session.learn.eg) { const to = Endgames.next(store.session.learn.eg); if (to) startEndgame(to); return; }
      if (store.session.learn.li + 1 < LESSONS.length) { startLesson(store.session.learn.li + 1); return; }
      // graduation: straight into a beginner AI game
      store.session.difficulty = "beginner";
      store.session.mode = "ai";
      stopLearn();
      saveSettings();
      store.game.selection = null;
      sync();
      toast(t("lm.firstGame"));
      maybeEngineTurn();
    };
    document.getElementById("lesson-practice").onclick = () => {
      if (!store.session.learn) return;
      const L = LESSONS[store.session.learn.li];
      const rest = practiceLeft(L);
      if (!rest.total) return;
      const want = rest.all.find((p) => !store.session.puzzleState.solved[p.id]) || rest.all[0];
      invalidateEngine();
      stopLearn();
      store.session.mode = "puzzle";
      store.session.puzzleState.cat = "tac";
      const list = puzzlesInCat("tac");
      startPuzzleAt("tac", Math.max(0, list.findIndex((p) => p.id === want.id)));
      setSideTab("play", { top: true });
      saveSettings();
      syncAutoFlip();
      sync();
      toast(tf("pz.fromLesson", [puzzleMotif(want)]));
    };
    // 9.0 S3: 名局's switch — the same game, read or guessed
    const cmode = document.getElementById("classic-mode");
    if (cmode) cmode.onclick = (ev) => {
      const b = ev.target.closest("button[data-cmode]");
      if (!b || b.dataset.cmode === (guessing() ? "guess" : "read")) return;
      store.ui.classicMode = b.dataset.cmode;
      saveSettings();
      if (learnSeg() === "classic") openClassic(store.session.learnState.cl || 0);
      sync();
    };
    document.getElementById("lesson-list").onclick = (ev) => {
      const b = ev.target.closest("button[data-i]");
      if (b && (store.session.learn || store.session.study)) startLesson(Number(b.dataset.i));
      const cb = ev.target.closest("button[data-c]");
      if (cb) startClassic(Number(cb.dataset.c));
      const gb = ev.target.closest("button[data-gs]");
      if (gb) startGuess(Number(gb.dataset.gs));
      const eb = ev.target.closest("button[data-eg]");
      if (eb && (store.session.learn || store.session.study)) startEndgame(eb.dataset.eg);
    };
  }
  return {
    wireLessonPanel,
    LESSONS, loadLearnState, saveLearnState, startLearn, stopLearn, syncStudyUI,
    curTask, startLesson, startLearnTask, learnModel, learnClick, learnEngineReply, learnUndo,
    learnHint, syncLearnUI, Endgames, startEndgame, learnSeg, openSeg, CLASSICS, classicText,
  };
}
