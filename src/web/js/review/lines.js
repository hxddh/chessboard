/**
 * 分析台：持续分析，和分析面板里引擎线的那几行。
 *
 * v8-0-plan F4 (M3): the engine-line desk, moved out of app.js — 持续分析
 * (`go infinite` on the position the board shows: when it may run, arming
 * and stopping it, painting #live-line in place every frame), and the rows
 * both it and the review's lines (setAnalyzeUI, review/panel.js) are drawn
 * with: the head, one row per line, the score box, the move chips. Moved,
 * not rewritten: the bodies are the ones app.js had.
 *
 * Everything it needs from the app arrives in the bag handed to
 * `createLines()`, createLibraryUI's shape; nothing here reaches back into
 * app.js. The pure modules are imported, not passed, because they are the
 * same objects app.js imports (patching ChessEngine through the test seam
 * patches this file's copy too).
 * @module review/lines
 */
import { ChessEngine } from "../engine.js";
import { ChessReview } from "../review.js";
import { ChessReviewPass } from "../review-pass.js";

/**
 * @param {object} d everything this module borrows from app.js
 */
export function createLines(d) {
  const {
    doc, store, t, tf, draw, avail, collapseEmptyGroups, sanHistory, viewGame, writeSan, setText,
  } = d;
  const document = doc;
  const Review = ChessReview;

  /** UCI moves → SAN from `fen`, at most `max` of them; stops at the first illegal. */
  function sansOf(fen, ucis, max) { return ChessReviewPass.sansOf(fen, ucis, max); }
  /** "胜率 62%" for a line scored from `turn`'s side. */
  function winLabel(l, turn) {
    const cp = l.mate != null ? (l.mate > 0 ? 100000 : -100000) : l.cp;
    if (cp == null) return "";
    // the panel reads from White's side, like the curve
    const white = turn === "w" ? cp : -cp;
    return t("an.win") + " " + Math.round(Review.winPct(white)) + "%";
  }

  // --- 6.0: continuous analysis (v6-plan Q2.6) -------------------------------
  // `go infinite` on whatever position the board shows, re-armed on every
  // cursor or line change, stopped whenever the one worker is needed for a
  // game move or a review pass. A toggle, not a mode: it follows the replay.
  function liveAllowed() {
    return store.session.liveOn && ChessEngine && !store.session.engineDown &&
      (store.session.mode === "ai" || store.session.mode === "pvp") &&
      !store.session.editor && !store.session.analyzing && !store.session.engineThinking &&
      // 7.6 §1a: a library pass (and 再深一遍, which runs under the same
      // token) owns the engine too. Without this, any sync during the pass
      // re-armed `go infinite`, which holds the exclusive lock until it is
      // stopped — and nothing stopped it, so the pass's next analyze() waited
      // forever. The pass ends with a sync(), which picks the line back up.
      !store.session.libRun &&
      // 7.8 §3: 再试一次 hides the answer, and a retried move may need the
      // engine for two searches — the same exclusive lock again (Codex, #83)
      !store.session.retry;
  }
  function stopLiveAnalysis() {
    const l = store.session.live;
    store.session.live = null;
    if (!l) return Promise.resolve();
    // its arrows go with it
    if (l.arrowKey) draw();
    return l.stop();
  }
  function syncLiveAnalysis() {
    const el = document.getElementById("live-line");
    const btn = document.getElementById("an-live");
    if (btn) {
      btn.classList.toggle("active", store.session.liveOn);
      btn.setAttribute("aria-pressed", store.session.liveOn ? "true" : "false");
      // like 分析: it stands above a game, not above an empty board — and the
      // group is re-collapsed here because this runs after renderGameActions
      // and is the last thing to change a button in it (layout e2e 4b)
      avail(btn, !!ChessEngine && !store.session.engineDown && sanHistory().length > 0 &&
        (store.session.mode === "ai" || store.session.mode === "pvp"));
      collapseEmptyGroups();
    }
    if (!liveAllowed()) {
      stopLiveAnalysis();
      if (el && (!store.session.liveOn || store.session.retry)) { el.hidden = true; el.replaceChildren(); el.style.minHeight = ""; }
      return;
    }
    const fen = viewGame().fen();
    if (store.session.live && store.session.live.fen === fen && store.session.live.multipv === store.ui.multipv) return;
    stopLiveAnalysis();
    const rec = { fen, multipv: store.ui.multipv, info: null, raf: 0, stop: null };
    rec.stop = ChessEngine.analyzeInfinite(fen, { multipv: store.ui.multipv }, (info) => {
      if (store.session.live !== rec) return;
      rec.info = info;
      if (!rec.raf) rec.raf = requestAnimationFrame(() => { rec.raf = 0; renderLiveAnalysis(rec); });
    });
    store.session.live = rec;
    // the frame for this search goes up at once, empty: rows for every line
    // it will report, so the first info — and every one after it — only
    // writes text into boxes that are already their final size
    if (el) { el.hidden = false; paintLive(el, rec); }
  }
  function renderLiveAnalysis(rec) {
    const el = document.getElementById("live-line");
    if (!el || store.session.live !== rec || !rec.info) return;
    el.hidden = false;
    paintLive(el, rec);
  }
  /**
   * #live-line in place (7.6, v7-6-plan §2). This runs every animation frame
   * while a search is reporting. It used to replaceChildren() the whole
   * block, and the block changed height as lines arrived and as their moves
   * wrapped or stopped wrapping: with MultiPV 3, 新局 under it jumped 22px
   * several times a second, and a button that moves between mouse-down and
   * mouse-up loses the click on WebKit. Now: one head and exactly
   * `rec.multipv` rows, built once per line count, and a frame only rewrites
   * their text.
   *
   * 7.8 §2: and a row is one line of text, never two — a score box, then the
   * moves, cut with an ellipsis where the panel ends (Lichess's analysis
   * desk). That also retired the high-water height 7.6 kept here: a row that
   * cannot wrap cannot change height. While a pointer is down inside the
   * block the rows are not touched at all, only the depth in the head —
   * the chips are buttons now (a click walks the board into the line), and
   * the one under the press stays the one under the release.
   */
  function paintLive(el, rec) {
    const n = rec.multipv || 1;
    const head0 = el.firstElementChild;
    if (el.childElementCount !== n + 1 || !head0 || !head0.classList.contains("pv-head")) {
      el.replaceChildren(deskHead(), ...lineRows(n));
      el.style.minHeight = "";
    }
    const info = rec.info;
    const turn = info ? info.turn : (rec.fen.split(" ")[1] === "b" ? "b" : "w");
    setText(el.firstElementChild.firstElementChild, t("act.live") + " · " + t("an.depth") + " " + ((info && info.depth) || 0));
    if (store.ui.liveHeld || liveOwnsPreview(el)) return;
    for (let i = 0; i < n; i++) {
      const l = info && info.lines[i];
      paintLineRow(el.children[i + 1], i, l || null, l ? sansOf(rec.fen, l.pv, 8) : [], turn);
    }
    // the board's engine arrows follow the lines' first moves — redrawn only
    // when one of those changes, not on every depth
    const key = engineArrowKey(info);
    if (key !== rec.arrowKey) { rec.arrowKey = key; draw(); }
  }

  /** What the live arrows depend on: the first move of each line. */
  function engineArrowKey(info) {
    return info ? info.lines.slice(0, 3).map((l) => (Array.isArray(l.pv) && l.pv[0]) || "").join(" ") : "";
  }

  /** A chip of this desk is showing its line on the board (pointer or focus,
      not pinned): the rows stand still until it lets go, or the board and
      the chip under it would say different things (Codex, #83). */
  function liveOwnsPreview(el) {
    if (!store.ui.preview || store.ui.preview.kind !== "pv" || store.ui.previewPinned) return false;
    const ae = document.activeElement;
    return el.matches(":hover") || (!!ae && el.contains(ae) && ae.matches("button.pv-chip"));
  }

  /** The desk's head row: a label (what, and how deep) and room for an action. */
  function deskHead() {
    const head = document.createElement("div");
    head.className = "pv-head";
    const lab = document.createElement("span");
    lab.className = "pv-label";
    head.appendChild(lab);
    return head;
  }
  /** `n` empty line rows: score box, line number, then the moves. */
  function lineRows(n) {
    const rows = [];
    for (let i = 0; i < n; i++) {
      const row = document.createElement("div");
      row.className = "pv-row";
      row.dataset.line = String(i);
      const no = document.createElement("span");
      no.className = "pv-no";
      no.textContent = String(i + 1);
      const box = document.createElement("span");
      box.className = "pv-eval";
      row.append(no, box);
      rows.push(row);
    }
    return rows;
  }
  /**
   * One line's row, written in place: the score box's text and side, its
   * tooltip (line number and win chance — 7.8 §2 moved the win chance here),
   * and one chip per move, a chip rewritten only when its move changed.
   * `sans` is kept on the row for the chip handlers.
   */
  function paintLineRow(row, i, l, sans, turn) {
    const box = row.children[1];
    const sc = l ? lineScore(l, turn) : null;
    setText(box, sc ? sc.text : "");
    box.classList.toggle("is-white", !!sc && sc.white);
    box.classList.toggle("is-black", !!sc && !sc.white);
    const tip = tf("an.line", [i + 1]) + (l && winLabel(l, turn) ? " · " + winLabel(l, turn) : "");
    if (box.title !== tip) box.title = tip;
    row._sans = sans;
    while (row.childElementCount - 2 > sans.length) row.lastElementChild.remove();
    for (let k = 0; k < sans.length; k++) {
      let b = row.children[k + 2];
      if (!b) {
        b = document.createElement("button");
        b.type = "button";
        b.className = "pv-chip";
        b.dataset.k = String(k);
        row.appendChild(b);
      }
      const color = k % 2 === 0 ? turn : (turn === "w" ? "b" : "w");
      if (b.dataset.san !== color + sans[k]) { b.dataset.san = color + sans[k]; writeSan(b, sans[k], color); }
    }
  }
  /**
   * A line's score as its box says it, from White's side (like the curve and
   * the gauge): "+1.2", "−0.4", "#3". `white` picks the box: light when
   * White is better, dark when Black is; level reads as White's, like the
   * gauge's number.
   */
  function lineScore(l, turn) {
    if (l.mate != null && l.mate !== 0) {
      const w = turn === "w" ? l.mate : -l.mate;
      return { text: "#" + Math.abs(w), white: w > 0 };
    }
    if (l.cp == null) return null;
    const w = turn === "w" ? l.cp : -l.cp;
    return { text: (w > 0 ? "+" : w < 0 ? "−" : "") + (Math.abs(w) / 100).toFixed(1), white: w >= 0 };
  }
  /** A stored White-side scalar (evalScalar) back into a side-to-move line score. */
  function scalarLine(s, turn) {
    if (s == null) return { cp: null, mate: null };
    const sign = turn === "w" ? 1 : -1;
    if (Math.abs(s) >= 9000) {
      const m = Math.max(1, Math.round((10000 - Math.abs(s)) / 10));
      return { cp: null, mate: sign * (s > 0 ? m : -m) };
    }
    return { cp: sign * s, mate: null };
  }
  /**
   * The review's lines at ply `i`: every line the pass kept (linesAt, MultiPV
   * above 1), or the principal one alone off `pvs` and the curve's scalar.
   */
  function reviewLines(a, i, turn) {
    const la = a.linesAt && a.linesAt[i];
    if (la && la.length) return la.map((l) => ({ cp: l.cp, mate: l.mate, sans: l.pv || [] }));
    const pv = a.pvs ? a.pvs[i] : null;
    if (typeof pv !== "string" || !pv) return [];
    return [Object.assign(scalarLine(a.scalars[i], turn), { sans: pv.split(" ") })];
  }

  return {
    sansOf, stopLiveAnalysis, syncLiveAnalysis, renderLiveAnalysis, deskHead, lineRows, paintLineRow, reviewLines,
  };
}
