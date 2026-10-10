/**
 * 「今天」页：问候、今天的三项进度、三门课各停在哪、最近的对局和两个等级分（9.0 S1）。
 *
 * The page the app opens on. Its first card — the one thing to do next, on
 * a board — is the coach's (trainer/today.js syncDailyUI), because the plan
 * and its sitting live there; this module draws the rest of the page from
 * what the app already keeps:
 *
 *   今天      lessons and endgames finished today, first answers to puzzles
 *             today (the rating history's stamps), games filed today — each
 *             against a small goal, with the run of practice days
 *   继续      the lesson bookmarked, the endgame last opened, the classic
 *             last opened: each named, with its unit's progress, one click
 *             back into 训练 at that segment
 *   最近对局  the last four games filed, with the rating each one moved
 *   等级分    对局等级分 and 谜题等级分, the number and its curve
 *
 * Everything is relabelled in place (7.6): the cards are index.html's, and
 * a repaint on every commit writes only what changed.
 * @module today-page
 */
import { paintMini } from "./mini-board.js";
import { ChessProgressMetrics as Metrics } from "./progress-metrics.js";
import { ChessProgress } from "./progress.js";

/** Today's goals: one lesson, five puzzles, one game — a sitting, not a quota. */
export const TODAY_GOALS = { lesson: 1, puzzle: 5, game: 1 };
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const RECENT = 4;

/**
 * @param {object} d everything this module borrows from app.js
 */
export function createTodayPage(d) {
  const {
    doc, store, t, tf, tdot, Chess, pieceSrc, LESSONS, lessonText, Endgames, CLASSICS, classicsTotal, classicText,
    loadStats, historyGames, historyLabel, historySub, loadHistoryRecord, puzzleRatingText, drawRatingTrend,
    Shell, requestNewGame,
  } = d;
  const $ = (id) => doc.getElementById(id);
  const put = (node, s) => { if (node && node.textContent !== s) node.textContent = s; };
  const mini = (node, fen, last) => paintMini(node, fen || START, { last, pieceSrc, set: store.ui.pieceSet });

  /** Midnight today, local time. */
  function dayStart(now) {
    const x = new Date(now);
    return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  }

  /** What was done today: lessons and endgames finished, first answers, games. */
  function counts(now) {
    const from = dayStart(now);
    const ls = store.session.learnState || {};
    const at = (v) => typeof v === "number" && v >= from;
    const lesson = Object.values(ls.done || {}).filter(at).length
      + Object.values((ls.eg && ls.eg.done) || {}).filter(at).length;
    const st = store.session.puzzleState || {};
    const puzzle = (Array.isArray(st.rhist) ? st.rhist : []).filter((h) => Number(h.t) >= from).length;
    const game = loadStats().games.filter((g) => Number(g.t) >= from).length;
    return { lesson, puzzle, game };
  }

  function renderHead(now) {
    const h = new Date(now).getHours();
    put($("home-h"), t(h < 5 || h >= 18 ? "today.evening" : h < 12 ? "today.morning" : "today.afternoon"));
    let date = "";
    try {
      date = new Intl.DateTimeFormat(store.ui.langId || "zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date(now));
    } catch (_) { date = new Date(now).toDateString(); }
    put($("today-date"), date);
  }

  function renderProgress(now) {
    const c = counts(now);
    const left = [];
    for (const ring of doc.querySelectorAll("#today-rings .today-ring")) {
      const k = ring.dataset.k;
      const goal = TODAY_GOALS[k];
      const n = Math.min(c[k], goal);
      put(ring.querySelector("b"), c[k] + "/" + goal);
      ring.style.setProperty("--p", String(Math.round((n / goal) * 100)));
      ring.classList.toggle("done", c[k] >= goal);
      if (c[k] < goal) left.push(tf("today.left." + k, [goal - c[k]]));
    }
    put($("today-prog-note"), left.length ? tf("today.leftNote", [tdot(...left)]) : t("today.allDone"));
    const run = ChessProgress.streak(ChessProgress.coerce(store.session.progress), now);
    const streak = $("today-streak");
    if (streak) {
      streak.hidden = run < 2;
      if (run >= 2) put(streak, tf("daily.streak", [run]));
    }
  }
  /** A classic's position some way in, for its card (the start is the same forty times). */
  const classicFen = new Map();
  function fenOfClassic(i) {
    if (classicFen.has(i)) return classicFen.get(i);
    const c = CLASSICS[i];
    let fen = START;
    try {
      const g = new Chess();
      if (c && g.load_pgn(c.pgn, { sloppy: true })) {
        const n = g.history().length;
        for (let k = n; k > Math.min(n, 24); k--) g.undo();
        fen = g.fen();
      }
    } catch (_) { /* the start, then */ }
    classicFen.set(i, fen);
    return fen;
  }

  function card(seg) { return doc.querySelector('#today-cont .today-c[data-seg="' + seg + '"]'); }
  function fillCard(node, fen, meta, title, done, total) {
    if (!node) return;
    mini(node.querySelector(".mini-board"), fen);
    put(node.querySelector("small"), meta);
    put(node.querySelector("b"), title);
    const bar = node.querySelector(".today-bar");
    if (bar) {
      bar.style.setProperty("--p", String(total ? Math.round((done / total) * 100) : 0));
      // v10-0-plan T5: not begun is an invitation, not an empty bar and 0/7
      bar.classList.toggle("fresh", !done);
      bar.dataset.n = done ? done + "/" + total : t("today.notStarted");
    }
  }

  function renderContinue() {
    const ls = store.session.learnState || {};
    // 课程: the lesson bookmarked, with its unit's progress
    const li = Math.max(0, Math.min(ls.last || 0, LESSONS.length - 1));
    const L = LESSONS[li];
    if (L) {
      const lt = lessonText(L);
      const unit = LESSONS.filter((x) => x.tasks.length && lessonText(x).part === lt.part);
      const done = unit.filter((x) => ls.done && ls.done[x.id]).length;
      fillCard(card("course"), L.tasks[0] && L.tasks[0].fen, tdot(t("train.course"), lt.part),
        tf("today.lessonN", [li + 1, lt.title]), done, unit.length);
    }
    // 残局: the camp is a chunk — asked for here, drawn when it is in
    const eg = card("endgame");
    if (Endgames.ready()) {
      const id = Endgames.resumeId();
      const it = id && Endgames.item(id);
      const L2 = id && Endgames.lesson(id);
      if (it && L2) {
        fillCard(eg, it.fen, L2.part, L2.title, Endgames.doneCount(it.g), Endgames.groupSize(it.g));
      }
    } else Endgames.ensure();
    if (eg) eg.hidden = !Endgames.ready();
    // 名局: the game last opened, and how many of the forty were guessed through
    const ci = Math.max(0, Math.min(ls.cl || 0, CLASSICS.length - 1));
    const c = CLASSICS[ci];
    if (c) {
      const tx = classicText(c);
      const gs = ls.gs || {};
      const total = classicsTotal ? classicsTotal() : CLASSICS.length;
      // counted from the records, not the loaded list: until the chunk is in,
      // CLASSICS holds ten of the forty and a game guessed among the other
      // thirty went missing from the count (Codex on #113)
      fillCard(card("classic"), fenOfClassic(ci), tdot(t("train.classic"), String(c.year)),
        tx.white + " – " + tx.black, Math.min(total, Object.keys(gs).filter((k) => gs[k]).length), total);
    }
  }

  function renderGames() {
    const list = $("today-games");
    if (!list) return;
    const games = historyGames().slice(0, RECENT);
    // the rating each game moved: its own after, less the one before it
    const all = loadStats().games.filter((g) => Number.isFinite(Metrics.ratingAfter(g))).sort((a, b) => a.t - b.t);
    const delta = (g) => {
      const i = all.indexOf(g);
      return i > 0 ? Metrics.ratingAfter(g) - Metrics.ratingAfter(all[i - 1]) : null;
    };
    const sig = games.map((g) => g.id + ":" + g.t).join() + "|" + store.ui.langId;
    $("today-games-empty").hidden = games.length > 0;
    if (list.dataset.sig === sig) return;
    list.dataset.sig = sig;
    list.replaceChildren(...games.map((g) => {
      const li = doc.createElement("li");
      const res = doc.createElement("span");
      res.className = "today-res " + (g.result || "draw");
      res.textContent = t(g.result === "win" ? "hist.win" : g.result === "loss" ? "hist.loss" : "hist.draw");
      const who = doc.createElement("span");
      who.className = "today-who";
      const name = doc.createElement("b");
      name.textContent = historyLabel(g);
      const sub = doc.createElement("small");
      sub.textContent = historySub(g);
      who.append(name, sub);
      const dr = doc.createElement("span");
      const dv = delta(g);
      dr.className = "today-d num" + (dv != null && dv < 0 ? " neg" : "");
      dr.textContent = dv == null ? "" : (dv > 0 ? "+" : dv < 0 ? "−" : "±") + Math.abs(Math.round(dv));
      const b = doc.createElement("button");
      b.type = "button";
      b.className = "tool-txt";
      b.textContent = t("today.review");
      b.onclick = () => { loadHistoryRecord(g); };
      li.append(res, who, dr, b);
      return li;
    }));
  }

  function renderRatings() {
    // v10-0-plan T5: a rating not yet earned says how to earn it — no dash,
    // no flat line, no 1500 nobody has played for
    const rate = (id, has, text, ys) => {
      const b = $(id), cv = $(id + "-cv");
      put(b, has ? text : t(id === "today-r-game" ? "today.rGameNone" : "today.rPzNone"));
      if (b) b.classList.toggle("today-invite", !has);
      if (cv) cv.hidden = ys.length < 2;
      if (cv && cv.clientWidth && ys.length > 1) drawRatingTrend(cv, ys);
    };
    const series = Metrics.gameRatingSeries(loadStats().games, 60);
    rate("today-r-game", series.length > 0, series.length ? String(series[series.length - 1].r) : "", series.map((p) => p.r));
    const st = store.session.puzzleState || {};
    const ys = (Array.isArray(st.rhist) ? st.rhist : []).map((h) => h.r);
    rate("today-r-pz", ys.length > 0, puzzleRatingText(), ys);
  }

  function render() {
    const now = Date.now();
    renderHead(now);
    renderProgress(now);
    renderContinue();
    renderGames();
    renderRatings();
  }

  function wire() {
    const nw = $("today-new");
    if (nw) nw.onclick = () => { Shell.go("play"); requestNewGame(); };
    const all = $("today-all-games");
    if (all) all.onclick = () => Shell.go("library");
    const cont = $("today-cont");
    if (cont) cont.onclick = (ev) => {
      const b = ev.target.closest(".today-c[data-seg]");
      if (b) Shell.openTrain(b.dataset.seg);
    };
  }

  return { render, wire, counts };
}
