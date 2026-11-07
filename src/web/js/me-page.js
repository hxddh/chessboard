/**
 * 「我的」页：四块记录、诊断、成就，和什么都还没记下时的入口卡片。
 *
 * v8-0-plan B5. The 我的 page's own renderers — carved out of app.js (F4)
 * without a change in behaviour, so the progress page has a module of its
 * own to grow in.
 *
 * Everything it needs from the app arrives in the bag handed to
 * `createMePage()` (createLibraryUI's shape); nothing here reaches back into
 * app.js.
 *
 * 19.0 S3: four blocks — the two ratings with their curves, the practice
 * calendar with its streak, the endgame camp, the badge that is next (B5's
 * 成长 was one of nine). The arithmetic is progress-metrics.js; this is the
 * drawing, and the rule that a block with nothing to show is not there.
 * 19.0 S2: and the one diagnosis — 强项 / 弱项, and what the library's games
 * add up to (it was the 棋谱 page's sheet, library-ui.js's renderer).
 * @module me-page
 */
// 19.0 S3: a chunk now (chunk-me.js) — the helpers it shares with the
// bundle come in through `d`, so the chunk carries only this page

/**
 * @param {object} d everything this module borrows from app.js
 */
export function createMePage(d) {
  const {
    Icons, evalAch, libPlayedAt, loadStats, store, t, tf, Library, LIB_MIN_GAMES, drawRatingTrend, libEcoName,
    Endgames, Metrics, tdot, chartTokens, owedNow, Srs, ratingLabel, ratingTip, diag,
  } = d;

  function renderAchievements() {
    const el = document.getElementById("ach-body");
    if (!el) return;
    // 19.0 S1: above the library's buttons — not rebuilt under a press (see invalidate)
    if (store.ui.pointerPressed) { if (!growth.ach) growth.ach = setTimeout(() => { growth.ach = 0; renderAchievements(); }, 100); return; }
    const res = evalAch();
    const got = res.filter((r) => r.unlocked).length;
    const was = document.getElementById("ach-all");
    const wasOpen = !!(was && was.open);
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
      tip.textContent = tf("ach.nextOf", [nm, desc]);
      el.appendChild(tip);
    }
    // 12.0 F: one grid of medals — earned ones first, then the rest by how
    // close they are — each the badge's own icon (lit when earned, faint with
    // its progress drawn round it when not), the name under it. 15.0 S3: the
    // page shows the one that is next; the fifteen fold under 「全部 15 枚」
    const grid = () => { const g = document.createElement("div"); g.className = "ach-grid"; return g; };
    if (next) { const one = grid(); renderAchRows([next], res, one); el.appendChild(one); }
    const all = document.createElement("details");
    all.className = "ach-all"; all.id = "ach-all";
    all.open = wasOpen || !next;
    const sum = document.createElement("summary");
    sum.className = "setting-summary";
    sum.textContent = tf("ach.all", [res.length]);
    const g = grid();
    renderAchRows(unlocked.concat(locked), res, g);
    all.append(sum, g);
    el.appendChild(all);
  }

  /**
   * The records page, before there is anything to record: one sentence on
   * what it will hold. 10.0 M0: it also had three doors (上第 1 课 / 做一道题 /
   * 和引擎下一局) — the third copy of what 今天 and 训练 already offer; the
   * achievements card under it names what is closest to unlocking.
   */
  function renderRecordEntry() {
    invalidate();
    const box = document.getElementById("record-empty");
    if (box) box.hidden = hasRecord();
  }

  function renderAchRows(rows, res, el) {
    for (const r of rows) {
      const b = document.createElement("div");
      b.className = "ach-item" + (r.unlocked ? " got" : "");
      b.title = r.ach.descKey ? t(r.ach.descKey) : r.ach.desc;
      const ic = document.createElement("span");
      ic.className = "ach-ic";
      ic.appendChild(Icons.icon(r.ach.icon));
      const nm = document.createElement("span");
      nm.className = "ach-nm";
      nm.textContent = r.ach.nameKey ? t(r.ach.nameKey) : r.ach.name;
      b.append(ic, nm);
      // a locked counting badge draws how far along it is round its medal,
      // and says it — "12/53" (the puzzle set nearly doubled in 1.6, and
      // "solve every mate" silently got longer with nothing to show for it)
      if (!r.unlocked && r.ach.progress) {
        const [done, total] = r.ach.progress(res.summary);
        if (total > 0 && done < total) {
          ic.style.setProperty("--p", String(Math.round((100 * done) / total)));
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
   * draws more than that: one wrong first answer to a puzzle puts a rating
   * and a calendar day on it, under a card saying nothing had happened yet
   * (B5). Everything the page draws from, then.
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

  // --- the blocks (v8-0-plan B5, 19.0 S3) --------------------------------------
  //
  // Drawn while the page shows, and then at most every 250 ms: a library
  // pass re-renders the record once a ply, and the diagnosis read here walks
  // every game. Hidden, the canvases have no width to draw at, so nothing is
  // drawn until the page opens (shell.js show → onShow).
  const growth = { timer: null, ach: 0 };
  const shownNow = () => store.ui.view === "me";
  function invalidate(now) {
    if (!shownNow()) return;
    if (now) { clearTimeout(growth.timer); growth.timer = null; renderGrowth(); return; }
    if (growth.timer) return;
    // 19.0 S1: the library's buttons are under these blocks now — a block
    // that comes or goes while a pointer is down would move the button being
    // pressed, and WebKit drops that click (7.6); it waits for the release
    const tick = () => {
      if (store.ui.pointerPressed) { growth.timer = setTimeout(tick, 100); return; }
      growth.timer = null;
      if (shownNow()) renderGrowth();
    };
    growth.timer = setTimeout(tick, 250);
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

  /**
   * The puzzle rating, once a first answer has moved it, its curve, and the
   * reviews owed with tomorrow's share (6.0, v6-plan Q3.1 / Q3.3 — the 做题战绩
   * heading's line, before 19.0 S3 took the rows under it away).
   */
  function renderPzRating() {
    const head = byId("me-pz-head"), meta = byId("rating-meta"), rcv = byId("trend-rating");
    const st = store.session.puzzleState || {};
    const hist = Array.isArray(st.rhist) ? st.rhist : [];
    const owed = owedNow();
    const tomorrow = Math.max(0, Srs.dueCount(st.missed || {}, Date.now() + 86400000) - owed);
    const parts = [];
    if (hist.length) parts.push(ratingLabel());
    if (owed || tomorrow) parts.push(tf("rec.due", [owed, tomorrow]));
    head.hidden = !parts.length;
    setTxt(meta, tdot(...parts));
    meta.title = hist.length ? ratingTip() : "";
    rcv.hidden = hist.length < 2;
    if (!rcv.hidden) drawRatingTrend(rcv, hist.map((h) => h.r));
    return !head.hidden;
  }

  function renderGrowth() {
    const rs = byId("sec-ratings");
    if (!rs) return;
    const stats = loadStats();
    // the two ratings: shown before drawn — a hidden canvas has no width to draw at
    rs.hidden = false;
    const pz = renderPzRating();
    // the engine-game rating: v8-0-plan B4 files one per game (Metrics.ratingAfter)
    const series = Metrics.gameRatingSeries(stats.games, 60);
    const showRating = series.length >= 2;
    byId("me-rating-head").hidden = byId("me-rating").hidden = !showRating;
    if (showRating) {
      setTxt(byId("me-rating-meta"), String(series[series.length - 1].r));
      drawRatingTrend(byId("me-rating"), series.map((p) => p.r));
    }
    rs.hidden = !pz && !showRating;
    // the calendar and its streak
    const grid = Metrics.heatGrid(activity(stats), Date.now(), Metrics.HEAT_WEEKS);
    const cs = byId("sec-cal"), cal = byId("me-cal");
    cs.hidden = grid.active === 0;
    if (grid.active) {
      setTxt(byId("me-cal-meta"), tf("me.calMeta", [grid.cur, grid.best]));
      cal.setAttribute("aria-label", tf("aria.cal", [grid.weeks, grid.active]));
      drawHeat(cal, grid);
    }
    renderDiag();
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
    const k = chartTokens(document);
    const gap = 3 * dpr;
    const cell = Math.max(2 * dpr, Math.min((H - 6 * gap) / 7, (W - (grid.weeks - 1) * gap) / grid.weeks));
    const max = Math.max(1, ...grid.cells.map((c) => c.n));
    for (const c of grid.cells) {
      // three steps of --chart-now over a faint empty square of --chart-line
      ctx.fillStyle = c.n ? k.now : k.line;
      ctx.globalAlpha = c.n ? 0.35 + 0.65 * Math.ceil((c.n / max) * 3) / 3 : 0.15;
      ctx.fillRect(c.col * (cell + gap), c.row * (cell + gap), cell, cell);
    }
    ctx.globalAlpha = 1;
  }

  // --- 诊断 (19.0 S2) ------------------------------------------------------------
  //
  // One place: the same diagnosis was the 棋谱 page's 看诊断 sheet, and here
  // twice more as 跨局指标 and 失误按阶段. 强项 / 弱项 read the puzzle themes
  // with it; the library part is drawn from its sample floor up.

  function renderDiag() {
    const sec = byId("sec-diag"), box = byId("diag-lib"), swEl = byId("me-sw");
    if (!sec || !box || !swEl) return;
    // strengths and weaknesses, at the diagnosis's own floor
    const sw = Metrics.strengths((store.session.puzzleState || {}).themes, Library.diagnose(store.session.library, LIB_MIN_GAMES));
    swEl.hidden = !(sw.strong.length || sw.weak.length);
    if (!swEl.hidden) renderStrengths(swEl, sw);
    // v8-1-plan T5: any source with enough (the row picks which)
    const enough = diag.count() >= LIB_MIN_GAMES;
    box.hidden = !enough;
    sec.hidden = swEl.hidden && !enough;
    if (!enough) return;
    diag.prep(() => invalidate(true));
    const el = byId("lib-diag");
    renderDiagnosisInto(el);
    fitDiagColumn(el);
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

  /** What `diagnose()` found, in sentences (7.0–18.0 the dialog's; library-ui.js). */
  function renderDiagnosisInto(el) {
    el.replaceChildren();
    // v8-1-plan T5: the games of the source row (导入的 until the chunk is in)
    const view = diag.view();
    const charts = diag.charts();
    const d = Library.diagnose(view.games, LIB_MIN_GAMES);
    const para = (text, cls) => {
      const p = document.createElement("p");
      p.className = cls || "hint";
      p.textContent = text;
      el.appendChild(p);
    };
    const row = (kText, vText, pick, full) => {
      const r = document.createElement(pick ? "button" : "div");
      r.className = "stat-row" + (pick ? " stat-row-link" : "");
      if (pick) {
        r.type = "button";
        r.dataset.diagPick = JSON.stringify(pick);
        r.title = t("diag.openThese");
      }
      const k = document.createElement("span");
      k.className = "stat-k";
      k.textContent = kText;
      // `full` for a name that will not fit the name track: it is cut with an
      // ellipsis there, so the whole of it goes on `title` (7.3 B3). Only the
      // rows carrying data — an opening's name — need it; the fixed labels fit.
      if (full) k.title = kText;
      const v = document.createElement("span");
      v.className = "stat-v num";
      v.textContent = vText;
      r.append(k, v);
      el.appendChild(r);
    };
    // v7-plan §6.2: 「每一条都必须点到一个可执行的下一步；没有下一步的统计
    // 不写进这一页」。7.0 写了统计，一条下一步都没接上。These three are the
    // rows that name a subset of games, so each one is a door to that subset.
    const pickPara = (text, cls, pick) => {
      const p = document.createElement(pick ? "button" : "p");
      p.className = (cls || "hint") + (pick ? " hint-link" : "");
      if (pick) { p.type = "button"; p.dataset.diagPick = JSON.stringify(pick); }
      p.textContent = text;
      el.appendChild(p);
    };
    if (view.note) para(view.note);
    if (!d.enough) { para(tf("lib.needMore", [d.need - d.have, d.have, d.need])); return; }
    para(tf("diag.from", [d.games]));
    row(t("diag.record"), tf("diag.wld", [d.outcome.win, d.outcome.loss, d.outcome.draw]));
    if (d.acc != null) row(t("diag.acc"), d.acc + "%");
    const phaseName = {
      opening: tf("diag.phaseOpening", [Library.OPENING_UNTIL]),
      middle: t("diag.phaseMiddle"),
      end: t("diag.phaseEnd"),
    };
    for (const k of ["opening", "middle", "end"]) {
      const p = d.phase[k];
      if (p.acpl == null) continue;
      row(phaseName[k], tdot(tf("diag.acpl", [p.acpl]), tf("diag.badRate", [Math.round((p.badRate || 0) * 1000) / 10])));
    }
    if (charts) charts.drawPhaseChart(el, d, phaseName);
    if (d.weakestPhase) {
      const best = ["opening", "middle", "end"].map((k) => d.phase[k].acpl).filter((n) => n != null);
      para(tf("diag.weakest", [phaseName[d.weakestPhase], d.phase[d.weakestPhase].acpl,
        d.phase[d.weakestPhase].acpl - Math.min(...best)]), "hint warn");
    } else {
      para(t("diag.noWeakest"));
    }
    const peakAxes = charts && charts.drawPeakChart(el, view.games);
    // the chart is not the only place its numbers appear (v7-3-plan §4B)
    if (peakAxes) para(tf("diag.peakRange", [1, peakAxes.last, peakAxes.max]));
    if (d.peak) {
      pickPara(tf("diag.peak", [d.peak.move, d.peak.n]), "hint",
        { kind: "peak", value: d.peak.move, label: tf("diag.pickPeak", [d.peak.move]) });
    }
    if (d.motifs.length) {
      row(t("diag.motifs"), "");
      for (const m of d.motifs.slice(0, 6)) {
        row(t("motif." + m.motif), tf("diag.motifN", [m.n]),
          { kind: "motif", value: m.motif, label: tf("diag.pickMotif", [t("motif." + m.motif)]) });
      }
    }
    if (d.ecos.length) {
      row(t("diag.ecos"), "");
      if (charts) charts.drawEcoChart(el, d.ecos);
      for (const e of d.ecos.slice(0, 6)) {
        const name = libEcoName(e.eco, e.name);
        row(e.eco + (name ? " " + name : ""),
          tf("diag.ecoRow", [e.n, Math.round((e.score || 0) * 100)]),
          { kind: "eco", value: e.eco, label: tf("diag.pickEco", [e.eco + (name ? " " + name : "")]) },
          true);
      }
    }
  }

  /**
   * v8-0-plan §5: one value column as wide as the widest value in it, up to
   * two thirds of the block — measured, because the values are sentences
   * whose length depends on the language and the numbers.
   */
  function fitDiagColumn(el) {
    el.style.removeProperty("--stat-v-w");
    const vs = [...el.querySelectorAll(".stat-v")];
    if (!vs.length || !el.clientWidth) return;
    for (const v of vs) v.style.whiteSpace = "nowrap";
    // scrollWidth is rounded; the extra pixel keeps a 152.4px value on one line
    const need = Math.max(...vs.map((v) => v.scrollWidth)) + 1;
    for (const v of vs) v.style.removeProperty("white-space");
    const cap = Math.floor(el.clientWidth * 2 / 3);
    el.style.setProperty("--stat-v-w", Math.min(need, cap) + "px");
    // a narrow window can cut a fixed label too; it keeps itself on title
    for (const k of el.querySelectorAll(".stat-k")) {
      if (k.scrollWidth > k.clientWidth && !k.title) k.title = k.textContent;
    }
  }

  // a canvas drawn at one width and shown at another is blurred or cut
  window.addEventListener("resize", () => invalidate());

  /**
   * v8-1-plan T2: 残局训练营 — progress by theme and what is due
   * (trainer/endgames.js draws it). 9.0 S3: a record; the way in is 训练 · 残局.
   */
  function renderEndgames() {
    if (Endgames) Endgames.renderMe();
  }

  return {
    renderAchievements, renderRecordEntry, renderEndgames,
    /** 19.0 S3: the puzzle rating moved (an answer) — and S2: the diagnosis's source row changed */
    renderRatings: () => invalidate(), renderDiag: () => invalidate(true),
    /** The page is opening (shell.js): draw it at the size it opens at. */
    onShow: () => { invalidate(true); renderEndgames(); },
  };
}
