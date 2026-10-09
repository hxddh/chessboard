/**
 * 谜题的玩法：冲刺、连胜、按主题练，以及常驻的评级与评级曲线（v8-0-plan B1）。
 *
 * Built on the puzzle trainer (trainer/puzzles.js), which creates this module
 * and hands it the pieces of itself it needs: a puzzle is still seated,
 * graded and answered by the trainer, and this module decides which puzzle
 * comes next and what the panel says around it.
 *
 *   冲刺 / 连胜   trainer/runs.js holds the rules; here are the clock, the card
 *                 and the hand-off from one puzzle to the next.
 *   主题          a sheet over 谜题 listing every theme the importer can
 *                 verify (trainer/themes.js), searchable and filterable by
 *                 progress, each with its count, the player's first answers
 *                 in it and its own rating — kept beside the global one in
 *                 the puzzle state (`themes`).
 *   评级          the rating and its curve, on the puzzle view at all times.
 *
 * The imported Lichess puzzles (puzzle-db.js) are served from here: a theme
 * or a run asks for the bands it needs, and a band joins the pool when its
 * chunk arrives. A band is added at the end of what is already loaded, so a
 * theme's list only ever grows at its end — the index of the puzzle on the
 * board keeps naming the same puzzle, as with the mined set's join.
 *
 * Every flow that starts something from here reveals the board (setSideTab,
 * which leaves a page for the board) and saves where the app should reopen.
 * @module trainer/puzzle-modes
 */
import { ChessDialog } from "../dialog.js";
import { ChessPuzzleDb } from "../puzzle-db.js";
import { ChessLazy } from "../lazy-content.js";
import { ChessRating } from "../rating.js";
import { THEME_IDS, themesOf, themeRecord, attemptsIn, filterThemes } from "./themes.js";
import { ChessRuns as Runs } from "./runs.js";
import { VIS_KINDS } from "./visual.js";
import { tdot } from "../tdot.js";

/** A theme's category id in the puzzle state: "theme:fork". */
export const THEME_CAT = "theme:";
export const isThemeCat = (cat) => typeof cat === "string" && cat.startsWith(THEME_CAT);

/**
 * 9.0 S3: the six kinds a player picks from — one set, where 8.x had the
 * built-in book's twelve categories beside the importer's twenty-eight
 * themes. Four are pools of puzzles from both books (a group category,
 * "grp:mate"); 开局 and 我的错题 are the book's own categories, served as
 * before ("op", "mine").
 */
export const GROUP_CAT = "grp:";
export const isGroupCat = (cat) => typeof cat === "string" && cat.startsWith(GROUP_CAT);
export const PUZZLE_GROUPS = ["mate", "tactic", "endgame", "defense", "opening", "mine"];
/** The endings the importer verifies (trainer/themes.js): 残局 is these. */
const ENDINGS = ["knightEnding", "bishopEnding", "queenEnding", "queenRookEnding", "pawnEnding", "rookEnding"];
/** A pooled group's categories, in both books (a Lichess puzzle has one too). */
const GROUP_CATS = { mate: ["m1", "m2", "m3"], tactic: ["win", "tac", "real"], defense: ["def", "draw"] };
/** The group a category is shown under, so the tile of what is on the board is lit. */
export function groupOfCat(cat) {
  if (isGroupCat(cat)) return cat.slice(GROUP_CAT.length);
  for (const g of Object.keys(GROUP_CATS)) if (GROUP_CATS[g].includes(cat)) return g;
  if (cat === "op" || cat === "rep" || cat === "repdue") return "opening";
  if (cat === "mine") return "mine";
  return null;
}
/** Is `p` in the pooled group `g`? Endings by their verified themes. */
export function inGroup(g, p) {
  if (g === "endgame") return Array.isArray(p.themes) && p.themes.some((x) => ENDINGS.includes(x));
  return !!GROUP_CATS[g] && GROUP_CATS[g].includes(p.cat);
}

/**
 * @param {object} d everything this module borrows from the trainer and app.js
 */
export function createPuzzleModes(d) {
  const {
    doc, store, t, tf, el, avail, setText, sync, toast, Audio2, drawRatingTrend,
    ALL_PUZZLES, isRatedCat, puzzleRating, playerRating, motifKeyOf,
    savePuzzleState, saveSettings, switchMode, setSideTab, seatPuzzle, startPuzzles, puzzleHumanSide, makeVis,
  } = d;
  const Db = ChessPuzzleDb;
  const Dlg = ChessDialog;
  // the run in progress (or just finished): trainer/runs.js's record, plus
  // the clock that drives it. Session state, never saved: a run is a sitting.
  if (!("run" in store.session)) store.session.run = null;
  // …and one set aside while a load asks first (parkRun)
  if (!("parkedRun" in store.session)) store.session.parkedRun = null;
  if (!("themeUi" in store.ui)) store.ui.themeUi = { q: "", prog: "all" };

  // --- the Lichess bands ------------------------------------------------------

  /** Bands in the order their chunks arrived — the order they join a list in. */
  const arrived = [];
  /** Every decoded puzzle of the bands that are here. */
  function lcPool() {
    const out = [];
    for (const b of arrived) out.push(...(Db.band(b) || []));
    return out;
  }
  /**
   * Ask for a band; `then` runs once it is part of the pool. A band already
   * here answers at once, and a failed load is reported and forgotten (the
   * next ask tries again — chunk.js does not remember failures); `failed`,
   * if given, runs after that report.
   */
  function wantBand(b, then, failed) {
    if (b == null) return;
    if (arrived.includes(b)) { if (then) then(); return; }
    Db.ensureBand(b).then((list) => {
      if (list && !arrived.includes(b)) arrived.push(b);
      if (then) then();
    }, () => { toast(t("theme.loadFailed"), "fix"); if (failed) failed(); });
  }

  /**
   * Run `fn` once the Lichess index is here. It rides in chunk-mined.js
   * (mined-chunk.js), which every session fetches right after the first
   * paint; a player quicker than that waits for it instead of getting a
   * theme or a run without the Lichess set.
   */
  function withIndex(fn) {
    if (Db.indexReady()) { fn(); return; }
    ChessLazy.ensureMined().then(fn, () => toast(t("theme.loadFailed"), "fix"));
  }

  // --- 主题 ---------------------------------------------------------------------

  const themeName = (id) => t("pzt." + id);
  /** motif keys cost a derivation per puzzle: worked out once per book size */
  const localThemes = { n: -1, byId: new Map() };
  function localByTheme() {
    if (localThemes.n === ALL_PUZZLES.length) return localThemes.byId;
    const byId = new Map(THEME_IDS.map((id) => [id, []]));
    for (const p of ALL_PUZZLES) {
      if (!p.fen || !isRatedCat(p.cat)) continue;
      for (const id of themesOf(p, motifKeyOf(p))) byId.get(id).push(p);
    }
    localThemes.n = ALL_PUZZLES.length;
    localThemes.byId = byId;
    return byId;
  }
  /** The puzzles of theme `id` that can be served right now, in a stable order. */
  function themeList(id) {
    const local = localByTheme().get(id) || [];
    return local.concat(lcPool().filter((p) => p.themes.includes(id)));
  }
  /** How many puzzles theme `id` has in all, loaded or not. */
  function themeCount(id) {
    const lc = Db.index.themes[id];
    return (localByTheme().get(id) || []).length + (lc ? lc.n : 0);
  }
  function themeRating(id) {
    const rec = store.session.puzzleState.themes && store.session.puzzleState.themes[id];
    return rec && rec.rating ? rec.rating : null;
  }
  // v9-0-plan S6: a provisional rating says 定级中 in words, not 「1104?」
  const ratingText = (r) => (ChessRating.isProvisional(r) ? tf("rating.prov", [Math.round(r.r)]) : String(Math.round(r.r)));
  /**
   * The player's rating for showing: the trainer's (idle days charged) once
   * there is one, else a fresh one that is NOT filed — a view must not write
   * a rating nobody has earned (7.3 B1: a rote drill leaves `rating` unset).
   */
  const seenRating = () => (store.session.puzzleState.rating ? playerRating() : ChessRating.newRating());

  /**
   * The first answer to a puzzle moves the rating of every theme it belongs
   * to, against the puzzle's rating as it stood before the answer — the same
   * Glicko-2 step as the global rating, on a record per theme.
   */
  function rateThemes(p, score, puzzleR) {
    const st = store.session.puzzleState;
    for (const id of themesOf(p, motifKeyOf(p))) {
      const rec = themeRecord(st, id);
      rec.rating = ChessRating.rate1v1(rec.rating || ChessRating.newRating(), puzzleR, score).player;
      if (score) rec.solve = (rec.solve || 0) + 1; else rec.miss = (rec.miss || 0) + 1;
    }
  }

  /** Nearest the theme's own rating first, unsolved first. */
  function themeStartIdx(id, list) {
    const r = (themeRating(id) || seenRating()).r;
    let best = -1;
    list.forEach((p, i) => {
      if (store.session.puzzleState.solved[p.id]) return;
      if (best < 0 || Math.abs(puzzleRating(p).r - r) < Math.abs(puzzleRating(list[best]).r - r)) best = i;
    });
    return best < 0 ? 0 : best;
  }

  /**
   * Put theme `id` on the board: the local puzzles at once, the bands that
   * hold the theme as they arrive — nearest the theme's rating first. With
   * nothing local, the board waits for the first band.
   */
  function startTheme(id) {
    const cat = THEME_CAT + id;
    const serve = () => {
      // the player may have gone elsewhere while the chunk loaded
      if (store.session.mode !== "puzzle" || store.session.puzzleState.cat !== cat || store.session.run) return;
      if (store.session.puzzle && store.session.puzzle.cat === cat) { sync(); return; }
      const list = themeList(id);
      if (list.length) seatPuzzle(cat, themeStartIdx(id, list));
      else sync();
    };
    withIndex(() => {
      const bands = Db.bandsWith(id).map((x) => x.band);
      const r = (themeRating(id) || seenRating()).r;
      bands.sort((a, b) => Math.abs(a + 100 - r) - Math.abs(b + 100 - r));
      // the nearest band first, the rest once it is here: whichever arrives
      // first seats the puzzle, so it has to be the near one — and if it
      // cannot load, the next nearest takes its place (Codex #89)
      const from = (k) => wantBand(bands[k], () => { serve(); for (const b of bands.slice(k + 1)) wantBand(b, serve); }, () => from(k + 1));
      from(0);
    });
    store.session.puzzle = null;
    serve();
  }

  /** From the browser (or its row on the panel): into the theme, on the board. */
  function goTheme(id) {
    closeThemes();
    endRun();
    store.session.run = null;
    store.session.puzzleState.cat = THEME_CAT + id;
    savePuzzleState();
    if (store.session.mode !== "puzzle") switchMode("puzzle"); // startPuzzles → startTheme
    else startTheme(id);
    setSideTab("play", { top: true });
    saveSettings();
    sync();
  }

  // --- 按类 (9.0 S3) -----------------------------------------------------------

  /** A group's local puzzles, worked out once per book size (as the themes). */
  const localGroups = { n: -1, byId: new Map() };
  function localInGroup(g) {
    if (localGroups.n !== ALL_PUZZLES.length) {
      localGroups.byId = new Map();
      localGroups.n = ALL_PUZZLES.length;
    }
    if (!localGroups.byId.has(g)) {
      localGroups.byId.set(g, ALL_PUZZLES.filter((p) => p.fen && isRatedCat(p.cat) && inGroup(g, p)));
    }
    return localGroups.byId.get(g);
  }
  /** The puzzles of group `g` that can be served now, in a stable order. */
  function groupList(g) {
    return localInGroup(g).concat(lcPool().filter((p) => inGroup(g, p)));
  }
  /**
   * How many puzzles group `g` has in all, loaded or not. The index counts
   * per theme: the three mate lengths and the defence are themes there, the
   * endings do not overlap, and a tactic is whatever is none of the others.
   */
  function groupCount(g) {
    const ix = Db.index;
    const n = (ids) => ids.reduce((sum, id) => sum + (ix.themes[id] ? ix.themes[id].n : 0), 0);
    const lc = g === "mate" ? n(["m1", "m2", "m3"]) : g === "defense" ? n(["def"]) : g === "endgame" ? n(ENDINGS)
      : g === "tactic" ? Math.max(0, ix.total - n(["m1", "m2", "m3", "def"])) : 0;
    return localInGroup(g).length + lc;
  }
  /** The bands that hold some of group `g`: every band for the tactics. */
  function groupBands(g) {
    if (g === "tactic") return Db.index.bands.map((x) => x.band);
    const ids = g === "mate" ? ["m1", "m2", "m3"] : g === "defense" ? ["def"] : ENDINGS;
    const set = new Set();
    for (const id of ids) for (const x of Db.bandsWith(id)) set.add(x.band);
    return [...set];
  }
  /** Nearest the player's rating first, unsolved first (themeStartIdx's rule). */
  function groupStartIdx(list) {
    const r = seenRating().r;
    let best = -1;
    list.forEach((p, i) => {
      if (store.session.puzzleState.solved[p.id]) return;
      if (best < 0 || Math.abs(puzzleRating(p).r - r) < Math.abs(puzzleRating(list[best]).r - r)) best = i;
    });
    return best < 0 ? 0 : best;
  }
  /** Put group `g` on the board: startTheme's flow, over the group's bands. */
  function startGroup(g) {
    const cat = GROUP_CAT + g;
    const serve = () => {
      if (store.session.mode !== "puzzle" || store.session.puzzleState.cat !== cat || store.session.run) return;
      if (store.session.puzzle && store.session.puzzle.cat === cat) { sync(); return; }
      const list = groupList(g);
      if (list.length) seatPuzzle(cat, groupStartIdx(list));
      else sync();
    };
    withIndex(() => {
      const r = seenRating().r;
      const bands = groupBands(g).sort((a, b) => Math.abs(a + 100 - r) - Math.abs(b + 100 - r));
      const from = (k) => wantBand(bands[k], () => { serve(); for (const b of bands.slice(k + 1, k + 3)) wantBand(b, serve); }, () => from(k + 1));
      from(0);
    });
    store.session.puzzle = null;
    serve();
  }
  /** A tile: into its group, on the board (开局 and 我的错题 are categories). */
  function goGroup(g) {
    endRun();
    store.session.run = null;
    const cat = g === "opening" ? "op" : g === "mine" ? "mine" : GROUP_CAT + g;
    store.session.puzzleState.cat = cat;
    savePuzzleState();
    if (store.session.mode !== "puzzle") switchMode("puzzle"); // startPuzzles → startGroup
    else if (isGroupCat(cat)) startGroup(g);
    else startPuzzles();
    setSideTab("play", { top: true });
    saveSettings();
    sync();
  }

  function themeRows() {
    const st = store.session.puzzleState;
    return THEME_IDS.map((id) => ({ id, name: themeName(id), n: themeCount(id), tried: attemptsIn(st, id), rating: themeRating(id) }));
  }

  function renderThemes() {
    const list = el("theme-list");
    if (!list) return;
    const ui = store.ui.themeUi;
    const rows = filterThemes(themeRows(), ui.q, ui.prog);
    doc.querySelectorAll("#theme-prog-seg button").forEach((b) => b.classList.toggle("active", b.dataset.tprog === ui.prog));
    list.replaceChildren(...rows.map((r) => {
      const b = doc.createElement("button");
      b.type = "button";
      b.className = "pick-item";
      b.dataset.theme = r.id;
      b.disabled = !r.n;
      b.textContent = r.name;
      const sub = doc.createElement("span");
      sub.className = "pick-sub";
      sub.textContent = tdot(tf("theme.sub", [r.n, r.tried]), r.rating ? tf("me.sw.theme", [ratingText(r.rating)]) : "");
      b.appendChild(sub);
      return b;
    }));
    const count = el("theme-list-count");
    setText(count, rows.length ? tf("theme.count", [rows.length]) : t("theme.none"));
  }
  function openThemes() {
    renderThemes();
    // the counts include the Lichess set: redraw them once its index is here
    if (!Db.indexReady()) withIndex(renderThemes);
    Dlg.open(el("theme-modal"), el("theme-search"));
  }
  function closeThemes() { Dlg.close(el("theme-modal")); }

  // --- 冲刺 / 连胜 --------------------------------------------------------------

  /** What a run may serve: the rated puzzles with a position, and the bands here. */
  function runPool() {
    return ALL_PUZZLES.filter((p) => p.fen && isRatedCat(p.cat)).concat(lcPool());
  }
  const runRating = (p) => puzzleRating(p).r;
  /** The band the run is heading into, and the one after it, asked for early. */
  function wantRunBands(run) {
    const aim = Runs.targetOf(run);
    withIndex(() => {
      wantBand(Db.bandFor(aim));
      wantBand(Db.bandFor(aim + 200));
    });
  }

  /**
   * M2 评审 P2-1: a set of 看 N 步 / 盲走 takes a while to make (its band, the
   * engine, the first question's searches). Each ask is numbered, and any run
   * starting or stopping, or the mode changing, makes it stale: a set made
   * for an older ask is dropped, never started over what the player did
   * since. Its button says it is busy meanwhile — an attribute, so nothing is
   * rebuilt under it between pointerdown and pointerup (7.6).
   */
  const vis = { ask: 0, kind: null };
  function visWait(kind) {
    vis.kind = kind;
    doc.querySelectorAll("#pz-modes button[data-run], #vis-look, #vis-blind").forEach((b) => {
      if (kind && (b.dataset.run || b.id.slice(4)) === kind) b.setAttribute("aria-busy", "true");
      else b.removeAttribute("aria-busy");
    });
  }
  function dropVis() { vis.ask++; if (vis.kind) visWait(null); }

  function startRun(kind, made) {
    // v8-2-plan T2: 看 N 步 / 盲走 — a set made by trainer/visual.js (its
    // chunk loads first), a run like these two from here on, with `own`
    // answering for it where the rules below are runs.js's
    if (!made && VIS_KINDS.includes(kind)) {
      if (vis.kind === kind) return; // already being made
      const ask = ++vis.ask, mode = store.session.mode;
      const alive = () => ask === vis.ask && store.session.mode === mode;
      visWait(kind);
      const done = (r) => {
        if (ask !== vis.ask) return;
        visWait(null);
        if (r && alive()) startRun(kind, r);
      };
      makeVis(kind, alive).then(done, () => done(null));
      return;
    }
    endRun();
    const run = made || Runs.newRun(kind, Date.now(), Date.now());
    if (!run) return;
    store.session.run = run;
    if (store.session.mode !== "puzzle") switchMode("puzzle");
    if (!run.own) wantRunBands(run);
    serveNext();
    run.timer = run.endsAt ? setInterval(tick, 250) : 0;
    setSideTab("play", { top: true });
    saveSettings();
  }

  /** The next puzzle of the run on the board, or the run's end. */
  function serveNext() {
    const run = store.session.run;
    if (!run) return;
    if (Runs.checkClock(run, Date.now())) { finishRun(); return; }
    if (run.own) { run.own.serve(run); return; }
    const p = Runs.pickNext(run, runPool(), runRating);
    if (!p) { run.over = true; run.why = "spent"; finishRun(); return; }
    Runs.served(run, p);
    wantRunBands(run);
    seatPuzzle(run.kind, run.used.length - 1, p, run);
  }

  /** After a solve or a miss: the next one, once the answer has been seen. */
  function advanceLater(pz, ms) {
    setTimeout(() => {
      const run = store.session.run;
      if (!run || store.session.puzzle !== pz || run !== pz.run) return;
      if (run.over) finishRun(); else serveNext();
    }, ms);
  }

  /** The trainer's puzzleSolved, for a run's puzzle (done and the sound are its). */
  function runSolved() {
    const pz = store.session.puzzle;
    const run = pz.run;
    if (run.own) { run.own.solved(pz); return; }
    Runs.onSolve(run);
    pz.fb = { ok: true, head: t("pz.fb.best"), sub: tf("run.score", [run.score]) };
    sync();
    advanceLater(pz, 450);
  }

  /** The trainer's puzzleWrong (and 答案), for a run's puzzle: a strike. */
  function runMissed(reason) {
    const pz = store.session.puzzle;
    const run = pz.run;
    if (pz.done) return;
    if (run.own) { run.own.missed(pz, reason); return; }
    pz.done = true;
    store.game.selection = null;
    Audio2.playWrong();
    Runs.onMiss(run);
    pz.fb = { ok: false, head: t("run.missed"), sub: reason || "" };
    store.commit("session", "sync");
    advanceLater(pz, 900);
  }

  function tick() {
    const run = store.session.run;
    // leaving 谜题 ends the run (stopPuzzles), and with it this clock
    if (!run || run.over) { stopClock(run); return; }
    if (Runs.checkClock(run, Date.now())) { finishRun(); return; }
    paintClock(run);
  }
  function stopClock(run) {
    if (run && run.timer) { clearInterval(run.timer); run.timer = 0; }
  }

  /** The run is over: its score is filed, the board keeps the last puzzle. */
  function finishRun(run = store.session.run) {
    if (!run || run.filed) return;
    run.over = true;
    run.filed = true;
    stopClock(run);
    const pz = store.session.puzzle;
    if (pz && pz.run === run) pz.done = true;
    run.newBest = Runs.recordBest(store.session.puzzleState, run);
    savePuzzleState();
    if (run.newBest) toast(tf("run.newBest", [run.score]));
    store.commit("session", "sync");
  }
  /** Stop the run in progress (leaving the mode, 结束, another run). */
  function endRun() {
    dropVis();
    // a parked run ends here too: the load it was parked for went ahead
    const run = store.session.run || store.session.parkedRun;
    store.session.parkedRun = null;
    if (!run) return;
    if (!run.why) run.why = "stopped";
    finishRun(run);
  }

  /**
   * Set the run aside while a load asks 「替换当前棋局？」 (the trainer's
   * leaveTrainer). The answer may be no, and then the same run goes on — so
   * nothing is ended or filed here, only its clock stopped; a yes leaves the
   * mode, and stopPuzzles' endRun files the parked run then (Codex on #88).
   */
  function parkRun() {
    const run = store.session.run;
    store.session.run = null;
    if (!run) return;
    stopClock(run);
    store.session.parkedRun = run;
  }
  /** The load was refused: the parked run is back, its puzzle already seated. */
  function unparkRun() {
    const run = store.session.parkedRun;
    store.session.parkedRun = null;
    if (!run) return;
    store.session.run = run;
    // an ending (the last strike, the clock) that was waiting on the board
    if (run.over || Runs.checkClock(run, Date.now())) { finishRun(run); return; }
    // endsAt is wall-clock time, so the clock resumes where it stands now
    if (run.endsAt) run.timer = setInterval(tick, 250);
    // an answered puzzle whose hand-off fell while the run was parked
    // (advanceLater found another board) moves on now — not a mode's own
    // (看 N 步 / 盲走), whose answer card waits for 下一题 (M2 review)
    const pz = store.session.puzzle;
    if (pz && pz.run === run && pz.done && !run.own) serveNext();
  }
  function paintClock(run) {
    const left = Runs.timeLeft(run, Date.now());
    const clock = el("pz-run-clock");
    avail(clock, Number.isFinite(left));
    if (Number.isFinite(left)) {
      const s = Math.ceil(left / 1000);
      setText(clock, Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"));
    }
  }

  // --- the panel -------------------------------------------------------------

  /** The rating, its curve, the mode row, the run card and the theme row. */
  function render() {
    const st = store.session.puzzleState;
    const run = store.session.run;
    const cat = store.session.puzzle ? store.session.puzzle.cat : st.cat;
    // 评级: always here — the number, and the curve of the last first answers
    const v = el("pz-rating-v");
    const theme = !run && isThemeCat(cat) ? cat.slice(THEME_CAT.length) : null;
    const tr = theme ? themeRating(theme) : null;
    setText(v, tdot(ratingText(seenRating()), theme && tf("ui.pair", [themeName(theme), tr ? ratingText(tr) : "—"])));
    if (v) v.title = ChessRating.isProvisional(seenRating()) ? t("tip.ratingProv") : "";
    const cv = el("pz-rating-curve");
    if (cv && cv.clientWidth) {
      const ys = (Array.isArray(st.rhist) ? st.rhist : []).map((h) => h.r);
      if (!ys.length) ys.push(Math.round(seenRating().r));
      drawRatingTrend(cv, ys.length > 1 ? ys : [ys[0], ys[0]]);
    }
    // 9.0 S3: 挑战 and 专项 are buttons, lit while their run is on
    doc.querySelectorAll("#pz-modes button[data-run]").forEach((b) => {
      const on = !!run && b.dataset.run === run.kind;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    // the theme being practised, and the way to another
    avail(el("row-pz-theme"), !!theme);
    if (theme) setText(el("pz-theme-name"), themeName(theme));
    const card = el("pz-run");
    avail(card, !!run);
    if (run) {
      if (!run.own) setText(el("pz-run-head"), run.over ? t("run.over." + (run.why || "stopped")) : t("run.rule." + run.kind));
      setText(el("pz-run-score"), tf("run.score", [run.score]));
      const strikes = el("pz-run-strikes");
      avail(strikes, run.kind === "rush");
      if (!run.own) setText(strikes, tf("run.strikes", [run.strikes, Runs.RUN_RULES[run.kind].strikes]));
      paintClock(run);
      if (run.over) avail(el("pz-run-clock"), false);
      setText(el("pz-run-best"), run.over && run.newBest ? tf("run.newBest", [run.score]) : tf("run.best", [Runs.bestOf(st, run.kind)]));
      avail(el("pz-run-stop"), !run.over);
      avail(el("pz-run-again"), run.over);
      // practice's own controls stand down while a run owns the board (the
      // panel's paint sets the last three afresh on every sync)
      for (const id of ["puzzle-review-nudge", "row-op-side"]) avail(el(id), false);
    }
    avail(el("puzzle-retry"), !run);
    avail(el("puzzle-next"), !run);
    // the picker is practice's: a run owns the board until it is over, and
    // then the picker is the way on (its score card stays above it)
    const picking = !run || !!run.over;
    for (const id of ["pz-hero", "pz-review", "pz-groups-sec", "pz-themes-row"]) avail(el(id), picking);
    avail(el("pz-list-fold"), !run);
    if (!store.session.puzzle && (theme || isGroupCat(cat)) && !run) setText(el("puzzle-task"), t("theme.loading"));
    // v8-2-plan T2: a set of 看 N 步 / 盲走 asks its question in a card of its own
    const own = run && run.own;
    avail(el("pz-vis"), !!own);
    avail(el("puzzle-task"), !own);
    if (own) own.render(run);
  }

  /** The chrome's 答案 in a run: giving up this puzzle is a miss. */
  function runAnswer() {
    const pz = store.session.puzzle;
    if (!pz || !pz.run || pz.done) return;
    if (pz.run.own) { pz.run.own.answer(pz); return; }
    if (pz.g.turn() !== puzzleHumanSide()) return;
    runMissed(t("run.gaveUp"));
  }

  function wire() {
    const seg = el("pz-modes");
    if (seg) seg.onclick = (ev) => {
      const b = ev.target.closest("button[data-run]");
      if (!b) return;
      const cur = store.session.run ? store.session.run.kind : "practice";
      // staying where one is drops a set still being made for another click
      if (b.dataset.run === cur && !(store.session.run && store.session.run.over)) { dropVis(); return; }
      startRun(b.dataset.run);
    };
    const stop = el("pz-run-stop");
    if (stop) stop.onclick = () => endRun();
    const again = el("pz-run-again");
    if (again) again.onclick = () => { if (store.session.run) startRun(store.session.run.kind); };
    const open = el("pz-themes-open");
    if (open) open.onclick = () => openThemes();
    const change = el("pz-theme-change");
    if (change) change.onclick = () => openThemes();
    const modal = el("theme-modal");
    // Escape's closer is registered with the others (app.js wireDialogs)
    if (modal) {
      modal.onclick = (ev) => { if (ev.target === modal) closeThemes(); };
    }
    const close = el("theme-close");
    if (close) close.onclick = () => closeThemes();
    const search = el("theme-search");
    if (search) search.oninput = () => { store.ui.themeUi.q = search.value; renderThemes(); };
    const prog = el("theme-prog-seg");
    if (prog) prog.onclick = (ev) => {
      const b = ev.target.closest("button[data-tprog]");
      if (!b || b.dataset.tprog === store.ui.themeUi.prog) return;
      store.ui.themeUi.prog = b.dataset.tprog;
      renderThemes();
    };
    const list = el("theme-list");
    if (list) list.onclick = (ev) => {
      const b = ev.target.closest("button[data-theme]");
      if (b && !b.disabled) goTheme(b.dataset.theme);
    };
  }

  return { lcPool, themeList, startTheme, groupList, groupCount, startGroup, goGroup, rateThemes, runSolved, runMissed, runAnswer, endRun, parkRun, unparkRun, render, wire, closeThemes, startRun, finishRun };
}
