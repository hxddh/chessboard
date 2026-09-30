/**
 * 「我的」页：进步、成就，和什么都还没记下时的入口卡片。
 *
 * v8-0-plan B5. The 我的 page's own renderers — the 进步 rows and the
 * accuracy sparkline, the achievements list, the empty-page entry card —
 * carved out of app.js (F4) without a change in behaviour, so the progress
 * page has a module of its own to grow in.
 *
 * Everything it needs from the app arrives in the bag handed to
 * `createMePage()` (createLibraryUI's shape); nothing here reaches back into
 * app.js.
 *
 * B5 adds 成长 (#sec-growth): the engine-game rating curve, the practice
 * calendar with its streak, strengths and weaknesses by theme, and three
 * cross-game figures. The arithmetic is progress-metrics.js; this is the
 * drawing, and the rule that a block with nothing to show is not there.
 * @module me-page
 */
import { ChessProgressMetrics as Metrics } from "./progress-metrics.js";

/**
 * @param {object} d everything this module borrows from app.js
 */
export function createMePage(d) {
  const {
    ACH, Icons, Progress, evalAch, libPlayedAt, loadStats, setSideTab, store, switchMode, t, tf,
    Library, LIB_MIN_GAMES, drawRatingTrend, libEcoName, Endgames, startEndgame,
  } = d;

  /**
   * 进步 — change over time, on the record page (progress.js).
   * Everything here draws only when it has data (P3): the sparkline needs
   * two analysed games, the rows need a week with answers in it.
   */
  function renderTrends() {
    invalidate();
    const head = document.getElementById("trend-head");
    const body = document.getElementById("trend-body");
    const cv = document.getElementById("trend-acc");
    const streakEl = document.getElementById("trend-streak");
    if (!head || !body || !cv) return;
    const prog = store.session.progress;
    // 7.1: the games you played elsewhere are games you played. The library
    // stores an accuracy per side once a game is analysed, which is the same
    // measure `stats` records, so the two go on one axis in play order.
    const libPoints = store.session.library
      .filter((g) => g.side && g.an && g.an.acc && Number.isFinite(g.an.acc[g.side]))
      .map((g) => ({ t: libPlayedAt(g), acc: g.an.acc[g.side] }));
    const series = Progress.accSeries(loadStats().games.concat(libPoints), 30);
    const rows = Progress.weekOverWeek(prog, Date.now())
      .filter((r) => r.now != null || r.prev != null)
      .sort((a, b) => (a.now ?? a.prev) - (b.now ?? b.prev)); // weakest first
    const wk = prog.weeks[Progress.weekKey(Date.now())];
    const showCurve = series.length >= 2;
    const showRows = rows.length > 0 || !!wk;
    head.hidden = !(showCurve || showRows);
    cv.hidden = !showCurve;
    body.hidden = !showRows;
    const run = Progress.streak(prog, Date.now());
    if (streakEl) {
      streakEl.hidden = run < 2;
      if (run >= 2) streakEl.textContent = tf("daily.streak", [run]);
    }
    if (showRows) {
      body.replaceChildren();
      for (const r of rows) {
        const row = document.createElement("div");
        row.className = "stat-row";
        const name = document.createElement("span");
        name.className = "stat-k";
        name.textContent = t("pz.cat." + r.cat);
        const val = document.createElement("span");
        val.className = "stat-v num";
        const pc = (x) => Math.round(x * 100) + "%";
        val.textContent = r.now != null && r.prev != null ? tf("trend.row", [pc(r.now), pc(r.prev)])
          : r.now != null ? tf("trend.rowNew", [pc(r.now)])
          : tf("trend.rowPrev", [pc(r.prev)]);
        row.append(name, val);
        body.appendChild(row);
      }
      if (wk && (wk.mined || wk.red)) {
        const row = document.createElement("div");
        row.className = "stat-row";
        const name = document.createElement("span");
        name.className = "stat-k";
        name.textContent = t("pz.cat.mine");
        const val = document.createElement("span");
        val.className = "stat-v num";
        val.textContent = tf("trend.mines", [wk.mined, wk.red]);
        row.append(name, val);
        body.appendChild(row);
      }
    }
    if (showCurve) drawAccTrend(cv, series);
  }

  /** The accuracy sparkline — the eval curve's dress, the record's data. */
  function drawAccTrend(cv, series) {
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.round(cv.clientWidth * dpr));
    const H = Math.max(1, Math.round(cv.clientHeight * dpr));
    if (cv.width !== W) cv.width = W;
    if (cv.height !== H) cv.height = H;
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    const css = getComputedStyle(document.documentElement);
    const cMuted = css.getPropertyValue("--muted").trim() || "#999";
    const cAccent = css.getPropertyValue("--accent").trim() || "#e8c39e";
    const n = series.length - 1;
    const pad = 4 * dpr;
    // 50–100%: the honest floor for a metric that rarely dips below it, and
    // a fixed scale so two visits to this page are comparable
    const x = (i) => (n ? (i / n) * (W - 2 * pad) + pad : W / 2);
    const y = (a) => H - pad - (Math.max(50, Math.min(100, a)) - 50) / 50 * (H - 2 * pad);
    ctx.strokeStyle = cMuted;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = dpr;
    ctx.beginPath(); ctx.moveTo(0, y(75)); ctx.lineTo(W, y(75)); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = cAccent;
    ctx.lineWidth = 1.6 * dpr;
    ctx.beginPath();
    series.forEach((g, i) => { if (i) ctx.lineTo(x(i), y(g.acc)); else ctx.moveTo(x(i), y(g.acc)); });
    ctx.stroke();
    ctx.fillStyle = cAccent;
    series.forEach((g, i) => {
      ctx.beginPath(); ctx.arc(x(i), y(g.acc), 1.8 * dpr, 0, Math.PI * 2); ctx.fill();
    });
  }

  function renderAchievements() {
    const el = document.getElementById("ach-body");
    if (!el) return;
    const res = evalAch();
    const got = res.filter((r) => r.unlocked).length;
    el.replaceChildren();
    const head = document.getElementById("ach-count");
    if (head) head.textContent = got + "/" + res.length;

    // A new player used to open this and see fourteen padlocks in a row: no
    // grouping, and nothing to say which one is one game away versus seventy
    // puzzles away. Unlocked ones come first, then the locked ones ordered by
    // how close they are, and the closest gets called out by name.
    const frac = (r) => {
      if (!r.ach.progress) return 0.5; // no counter: neither near nor far
      const [done, total] = r.ach.progress(res.summary);
      return total > 0 ? Math.min(1, done / total) : 0;
    };
    const unlocked = res.filter((r) => r.unlocked);
    const locked = res.filter((r) => !r.unlocked).sort((a, b) => frac(b) - frac(a));
    const next = locked[0];
    if (next) {
      const tip = document.createElement("div");
      tip.className = "ach-next";
      const nm = next.ach.nameKey ? t(next.ach.nameKey) : next.ach.name;
      const desc = next.ach.descKey ? t(next.ach.descKey) : next.ach.desc;
      tip.textContent = t("ach.next") + nm + " · " + desc;
      el.appendChild(tip);
    }
    const groups = [];
    if (unlocked.length) groups.push(["ach.got", unlocked, false]);
    // The locked group is the long one and it only ever gets longer at the far
    // end: on a new install it is all fifteen, sorted by how close they are, so
    // rows four to fifteen are a list of things that are not close. Three, and
    // the rest behind a count you can press. The 展开 state is session-only —
    // it is a way of looking at the list, not a setting.
    if (locked.length) groups.push(["ach.locked", locked, true]);
    for (const [key, rows, foldable] of groups) {
      const h = document.createElement("div");
      h.className = "ach-group";
      h.textContent = t(key) + " " + rows.length;
      el.appendChild(h);
      const fold = foldable && rows.length > ACH_FOLD_AT && !store.session.achAll;
      renderAchRows(fold ? rows.slice(0, ACH_FOLD_AT) : rows, res, el);
      if (foldable && rows.length > ACH_FOLD_AT) {
        const more = document.createElement("button");
        more.type = "button";
        more.className = "act-btn ach-more";
        more.id = "ach-more";
        more.textContent = fold ? tf("ach.more", [rows.length - ACH_FOLD_AT]) : t("ach.less");
        more.onclick = () => { store.session.achAll = !store.session.achAll; renderAchievements(); };
        el.appendChild(more);
      }
    }
  }

  /** How many locked badges stand open before the rest fold away. */
  const ACH_FOLD_AT = 3;

  /**
   * The records page, before there is anything to record.
   *
   * It used to open on two sentences saying nothing had happened yet and
   * fifteen padlocks — a wall with 0/15 written on it. Three doors instead,
   * each labelled with the badge behind it, and each one *pressing the real
   * control*: the mode row on the settings page. Going through
   * `#mode-seg` rather than setting `store.session.mode` here is deliberate —
   * that handler stops the engine, leaves the editor, resets the clocks,
   * switches to the 对局 tab and says what happened, and a second copy of that
   * list is a second copy that can drift.
   */
  const REC_DOORS = [
    { mode: "learn", label: "rec.goLearn", ach: "first-lesson", win: false },
    { mode: "puzzle", label: "rec.goPuzzle", ach: "first-puzzle", win: false },
    { mode: "ai", label: "rec.goPlay", ach: "first-win", win: true },
  ];

  function renderRecordEntry() {
    invalidate();
    const box = document.getElementById("record-empty");
    const doors = document.getElementById("record-doors");
    if (!box || !doors) return;
    const fresh = !hasRecord();
    box.hidden = !fresh;
    if (!fresh) return;
    doors.replaceChildren();
    for (const d of REC_DOORS) {
      const a = ACH.find((x) => x.id === d.ach);
      const b = document.createElement("button");
      b.type = "button";
      b.className = "rec-door";
      b.dataset.mode = d.mode;
      const ic = document.createElement("span");
      ic.className = "rec-door-ic";
      if (a) ic.appendChild(Icons.icon(a.icon));
      const txt = document.createElement("span");
      txt.className = "rec-door-t";
      const k = document.createElement("span");
      k.className = "rec-door-k";
      k.textContent = t(d.label);
      const v = document.createElement("span");
      v.className = "rec-door-v";
      const nm = a ? (a.nameKey ? t(a.nameKey) : a.name) : "";
      v.textContent = tf(d.win ? "rec.winUnlocks" : "rec.unlocks", [nm]);
      txt.append(k, v);
      b.append(ic, txt);
      // already in that mode, the door still lands somewhere: the board,
      // with the panel showing 对局 (setSideTab leaves the page, A1)
      b.onclick = () => { if (d.mode !== store.session.mode) switchMode(d.mode); else setSideTab("play", { top: true }); };
      doors.appendChild(b);
    }
  }

  function renderAchRows(rows, res, el) {
    for (const r of rows) {
      const b = document.createElement("div");
      b.className = "ach-item" + (r.unlocked ? " got" : "");
      b.title = r.ach.descKey ? t(r.ach.descKey) : r.ach.desc;
      const ic = document.createElement("span");
      ic.className = "ach-ic";
      ic.appendChild(Icons.icon(r.unlocked ? r.ach.icon : "lock"));
      const nm = document.createElement("span");
      nm.className = "ach-nm";
      nm.textContent = r.ach.nameKey ? t(r.ach.nameKey) : r.ach.name;
      b.append(ic, nm);
      // "12/53" on a locked counting badge — the puzzle set nearly doubled in
      // 1.6, so "solve every mate" silently got much longer with nothing on
      // screen to say how far along you were
      if (!r.unlocked && r.ach.progress) {
        const [done, total] = r.ach.progress(res.summary);
        if (total > 0 && done < total) {
          const pg = document.createElement("span");
          pg.className = "ach-pg num";
          pg.textContent = done + "/" + total;
          b.appendChild(pg);
        }
      }
      el.appendChild(b);
    }
  }

  /**
   * Is anything recorded that this page shows?
   *
   * v8-0-plan §5 taught the entry card about the library — with 500 imported
   * games on this page it still opened on 「现在还空着」. It still counted
   * only three things (the library, the engine games, a badge), and the page
   * draws more than that: one wrong first answer to a puzzle puts a tally
   * row, a rating and a calendar day on it, under a card saying nothing had
   * happened yet (B5). Everything the page draws from, then.
   */
  function hasRecord() {
    const st = store.session.puzzleState || {};
    const prog = store.session.progress || {};
    return (store.session.library || []).length > 0 || loadStats().games.length > 0 ||
      Object.values(st.tally || {}).some((r) => r && (r.miss || 0) + (r.solve || 0) > 0) ||
      (Array.isArray(st.rhist) && st.rhist.length > 0) ||
      Object.keys(prog.weeks || {}).length > 0 || Object.keys(prog.days || {}).length > 0 ||
      evalAch().some((r) => r.unlocked);
  }

  // --- 成长 (v8-0-plan B5) ----------------------------------------------------
  //
  // Drawn while the page shows, and then at most every 250 ms: a library
  // pass re-renders the record once a ply, and the diagnosis read here walks
  // every game. Hidden, the canvases have no width to draw at, so nothing is
  // drawn until the page opens (shell.js show → onShow).
  const growth = { timer: null };
  const shownNow = () => store.ui.view === "me";
  function invalidate(now) {
    if (!shownNow()) return;
    if (now) { clearTimeout(growth.timer); growth.timer = null; renderGrowth(); return; }
    if (growth.timer) return;
    growth.timer = setTimeout(() => { growth.timer = null; if (shownNow()) renderGrowth(); }, 250);
  }

  /** Every claimed, analysed library game and every analysed engine game, as the metrics read them. */
  function gameFacts(stats) {
    const out = [];
    for (const g of store.session.library || []) {
      if (!g.side || !g.an) continue;
      out.push(Metrics.factsOf({ side: g.side, outcome: g.outcome, fen: g.fen, clk: g.clk, tc: g.tc,
        scalars: g.an.scalars, tags: g.an.tags }));
    }
    // an engine game files its extremes when it is analysed (review/analysis.js)
    for (const g of stats.games) {
      if (Number.isFinite(g.hi)) out.push(Metrics.factsOf({ side: g.color, outcome: g.result, hi: g.hi, lo: g.lo }));
    }
    return out;
  }

  /** The days something happened: games (here and imported), first answers, daily sessions. */
  function activity(stats) {
    const st = store.session.puzzleState || {};
    const prog = store.session.progress || {};
    const stamps = stats.games.map((g) => g.t)
      .concat((store.session.library || []).filter((g) => g.side).map(libPlayedAt))
      .concat((Array.isArray(st.rhist) ? st.rhist : []).map((h) => Number(h.t)))
      .concat(Object.keys(prog.days || {}).map((k) => new Date(k + "T12:00:00").getTime()));
    return Metrics.dayCounts(stamps);
  }

  const byId = (id) => document.getElementById(id);
  const setTxt = (node, s) => { if (node && node.textContent !== s) node.textContent = s; };
  const pct = (x) => Math.round(x * 100) + "%";

  function renderGrowth() {
    const sec = byId("sec-growth");
    if (!sec) return;
    const stats = loadStats();
    // the engine-game rating: v8-0-plan B4 files one per game (Metrics.ratingAfter)
    const series = Metrics.gameRatingSeries(stats.games, 60);
    const showRating = series.length >= 2;
    // shown before drawn: a hidden canvas has no width to draw at
    sec.hidden = false;
    byId("me-rating-head").hidden = byId("me-rating").hidden = !showRating;
    if (showRating) {
      setTxt(byId("me-rating-meta"), String(series[series.length - 1].r));
      drawRatingTrend(byId("me-rating"), series.map((p) => p.r));
    }
    // the calendar and its streak
    const grid = Metrics.heatGrid(activity(stats), Date.now(), Metrics.HEAT_WEEKS);
    const cal = byId("me-cal");
    byId("me-cal-head").hidden = cal.hidden = grid.active === 0;
    if (grid.active) {
      setTxt(byId("me-cal-meta"), tf("me.calMeta", [grid.cur, grid.best]));
      cal.setAttribute("aria-label", tf("aria.cal", [grid.weeks, grid.active]));
      drawHeat(cal, grid);
    }
    // strengths and weaknesses, at the diagnosis page's own floor
    const sw = Metrics.strengths((store.session.puzzleState || {}).themes,
      Library.diagnose(store.session.library, LIB_MIN_GAMES));
    const swEl = byId("me-sw");
    swEl.hidden = !(sw.strong.length || sw.weak.length);
    if (!swEl.hidden) renderStrengths(swEl, sw);
    // the three figures across games, once any game counts towards one
    const m = Metrics.crossGame(gameFacts(stats));
    const any = m.convert.n + m.resil.n + m.clock.n > 0;
    byId("me-metrics-head").hidden = byId("me-metrics").hidden = !any;
    if (any) renderMetrics(byId("me-metrics"), m);
    sec.hidden = !showRating && !grid.active && swEl.hidden && !any;
  }

  /**
   * The calendar: a column per week, Monday on top, one square a day. The
   * squares take the canvas's height, or less where the width runs out.
   */
  function drawHeat(cv, grid) {
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.round(cv.clientWidth * dpr));
    const H = Math.max(1, Math.round(cv.clientHeight * dpr));
    if (cv.width !== W) cv.width = W;
    if (cv.height !== H) cv.height = H;
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    const css = getComputedStyle(document.documentElement);
    const cMuted = css.getPropertyValue("--muted").trim() || "#999";
    const cAccent = css.getPropertyValue("--accent").trim() || "#e8c39e";
    const gap = 3 * dpr;
    const cell = Math.max(2 * dpr, Math.min((H - 6 * gap) / 7, (W - (grid.weeks - 1) * gap) / grid.weeks));
    const max = Math.max(1, ...grid.cells.map((c) => c.n));
    for (const c of grid.cells) {
      // three steps of the accent over a faint empty square
      ctx.fillStyle = c.n ? cAccent : cMuted;
      ctx.globalAlpha = c.n ? 0.35 + 0.65 * Math.ceil((c.n / max) * 3) / 3 : 0.15;
      ctx.fillRect(c.col * (cell + gap), c.row * (cell + gap), cell, cell);
    }
    ctx.globalAlpha = 1;
  }

  function renderStrengths(el, sw) {
    const eco = (x) => { const n = libEcoName(x.id, x.name); return n ? x.id + " " + n : x.id; };
    const name = (x) => (x.kind === "theme" ? t("pzt." + x.id) : x.kind === "motif" ? t("motif." + x.id) : eco(x));
    const val = (x) => (x.kind === "theme" ? tf("me.sw.theme", [x.r]) : x.kind === "motif" ? tf("me.sw.motif", [x.n])
      : tf("me.sw.eco", [Math.round(x.score * 100), x.n]));
    el.replaceChildren();
    for (const [key, rows] of [["me.strong", sw.strong], ["me.weak", sw.weak]]) {
      if (!rows.length) continue;
      const col = document.createElement("div");
      const h = document.createElement("h3");
      h.className = "me-sw-h";
      h.textContent = t(key);
      col.appendChild(h);
      for (const x of rows) col.appendChild(meRow(name(x), val(x)));
      el.appendChild(col);
    }
  }

  /** A label and its value that wrap rather than cut — three languages. */
  function meRow(k, v) {
    const row = document.createElement("div");
    row.className = "me-row";
    const a = document.createElement("span");
    a.className = "me-k";
    a.textContent = k;
    const b = document.createElement("span");
    b.className = "me-v num";
    b.textContent = v;
    row.append(a, b);
    return row;
  }

  /**
   * The three figures. Below its floor a figure has no number, only how
   * many games it needs and how many it has (the acceptance: 每项指标都标明
   * 最少需要多少局).
   */
  function renderMetrics(el, m) {
    el.replaceChildren();
    const rows = [
      ["convert", m.convert, () => tf("me.m.convertV", [m.convert.n, m.convert.won])],
      ["resil", m.resil, () => tf("me.m.resilV", [m.resil.n, m.resil.won + m.resil.drawn, m.resil.won])],
      ["clock", m.clock, () => (m.clock.press.n
        ? tf("me.m.clockV", [m.clock.press.n, m.clock.press.b, pct(m.clock.calmRate || 0)])
        : tf("me.m.clockNone", [m.clock.n]))],
    ];
    for (const [id, f, detail] of rows) {
      const box = document.createElement("div");
      box.className = "me-metric";
      box.dataset.metric = id;
      // what counts, on the row itself
      box.title = tf("me.m." + id + "D", [f.need]);
      const ready = f.n >= f.need;
      box.appendChild(meRow(t("me.m." + id), ready ? (f.rate != null ? pct(f.rate) : "—") : ""));
      const p = document.createElement("p");
      p.className = "hint";
      p.textContent = ready ? detail() : tf("me.m.need", [f.need, f.n]);
      box.appendChild(p);
      el.appendChild(box);
    }
  }

  // a canvas drawn at one width and shown at another is blurred or cut
  window.addEventListener("resize", () => invalidate());

  /**
   * v8-1-plan T2: 残局训练营 — progress by theme and the review queue
   * (trainer/endgames.js draws it); its buttons open the position in 学习.
   */
  function renderEndgames() {
    if (!Endgames) return;
    Endgames.renderMe((id) => {
      if (store.session.mode !== "learn") switchMode("learn");
      startEndgame(id);
      setSideTab("play", { top: true });
    });
  }

  return {
    renderTrends, renderAchievements, renderRecordEntry, renderEndgames,
    /** The page is opening (shell.js): draw it at the size it opens at. */
    onShow: () => { invalidate(true); renderEndgames(); },
  };
}
