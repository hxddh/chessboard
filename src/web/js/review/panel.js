/**
 * 复盘面板：精准度、着法标记与分级、关键时刻、把转折点收进错题本，和导出复盘图。
 *
 * v8-0-plan F4 (M3): the review panel's code, moved out of app.js — the
 * view that follows every sync (setAnalyzeUI: the 分析 buttons, the engine
 * lines of the analysis, the curve's box), the report card (renderReview:
 * the accuracy headline, the marks and grades table, the key moments), the
 * hand-off of the turning point into the mistakes book (worstDrill,
 * bankWorst), and the exported picture of the report. Moved, not rewritten:
 * the bodies are the ones app.js had. The book itself stays app.js's (the
 * trainer's); its save functions arrive in the bag.
 *
 * Everything it needs from the app arrives in the bag handed to
 * `createReviewPanel()`, createLibraryUI's shape; nothing here reaches back
 * into app.js. The pure modules are imported, not passed.
 * @module review/panel
 */
import { Chess } from "../chess.js";
import { ChessHost } from "../host.js";
import { ChessMistakes } from "../mistakes.js";
import { ChessSrs } from "../srs.js";
import { loadChunk } from "../chunk.js";
import { REVIEW_CHUNKS } from "../lazy-content.js";
import { ChessReview } from "../review.js";
import { ChessReviewGrade as Grade } from "../review-grade.js";
import { tdot } from "../tdot.js";

/**
 * @param {object} d everything this module borrows from app.js
 */
export function createReviewPanel(d) {
  const {
    doc, store, t, tf, sideName, DIFF_NAMES, analysisFor, sanHistory, startFen, gameAt, viewGame,
    statusText, openingFor, avail, inModal, setText, toast, savedToast, pgnFileName,
    deskHead, lineRows, paintLineRow, reviewLines, savePvAsVariation, lockPgnEdits,
    drawEvalCurve, drawEvalBar, judgeColours, renderWhyLine, renderRetry, renderMistakeList, renderMoments,
    boardDrillSource, saveMines, savePuzzleState,
  } = d;
  const document = doc;
  const Host = ChessHost;
  const Mistakes = ChessMistakes;

  function setAnalyzeUI() {
    const btn = document.getElementById("an-run");
    // while a run is in flight the primary button becomes the stop control —
    // a deep pass over a long game is a minute of engine time to be stuck in
    if (btn) {
      btn.disabled = !store.session.analyzing && !sanHistory().length;
      btn.textContent = store.session.analyzing ? tf("act.stopAt", [store.session.analyzeProgress]) : t("act.analyze");
      btn.title = t(store.session.analyzing ? "tipRun.stop" : "tipRun.analyze");
    }
    const deep = document.getElementById("an-deep");
    if (deep) deep.disabled = store.session.analyzing || !sanHistory().length;
    const wrap = document.getElementById("eval-wrap");
    if (wrap) {
      wrap.hidden = !analysisFor();
      // 7.7 §5: the curve is drawn for every analysed game. 5.1 hid it below
      // the verdict's sample floor (Review.longEnough, 30 judged moves) as
      // "an empty box with a flat line in it" — but a curve over eleven moves
      // is not empty, it is short, and hiding it meant the one picture of the
      // game was missing after every analysis of an ordinary short game (the
      // 7.7 walk-through: no curve in three screenshots at 1440×900). The
      // floor still decides what the report may *say* (verdictKey); what
      // happened is always worth showing.
      if (!wrap.hidden) drawEvalCurve();
    }
    drawEvalBar();
    // the export and the mark legend describe a report — none, and they do
    // not stand there promising one (audit F7)
    avail(document.getElementById("report-export"), !!analysisFor());
    avail(document.getElementById("analysis-legend"), !!analysisFor());
    const pvEl = document.getElementById("pv-line");
    if (pvEl) {
      const a = analysisFor();
      const vi = store.game.viewIndex;
      const turn = viewGame().turn();
      const lines = a ? reviewLines(a, vi, turn) : [];
      // 再试一次 hides the lines: at the position before the mistake they are the answer
      pvEl.hidden = !lines.length || !!store.session.retry;
      // 7.6 (v7-6-plan §2): rebuilt only when what it shows changes. This
      // runs once a ply while a pass is in flight, over the previous
      // analysis's line — the same line every time — and rebuilding it
      // swapped the chip under a pointer that was mid-press for a new node:
      // the click then went to #pv-line itself and pinned nothing.
      const depth = a && a.depths ? a.depths[vi] : null;
      const key = lines.length ? JSON.stringify([lines, turn, depth || null,
        inModal(), store.ui.langId, !!store.session.analyzing]) : "";
      const fresh = pvEl.dataset.key !== key;
      pvEl.dataset.key = key;
      if (fresh) pvEl.replaceChildren();
      if (lines.length && fresh) {
        // 7.8 §2: the same desk as 持续分析 — a head with the depth, then one
        // row per line, numbered 1, 2, 3, each a score box and its moves. The
        // principal line used to be 「引擎主变」 and the others 「第 2 线」
        // 「第 3 线」, one thing under two names. Every chip is a button: a
        // click walks the board into that line, whichever line it is.
        const head = deskHead();
        setText(head.firstElementChild, tdot(t("an.pv"), depth ? tf("an.depthN", [depth]) : ""));
        pvEl.appendChild(head);
        const rows = lineRows(lines.length);
        rows.forEach((row, i) => { paintLineRow(row, i, lines[i], lines[i].sans, turn); pvEl.appendChild(row); });
        // …and the principal line can be kept: written into the tree as a
        // variation at this position (Q2.3)
        if (!inModal()) {
          const save = document.createElement("button");
          save.type = "button";
          save.className = "pv-act";
          save.textContent = t("an.pvSave");
          save.title = t("tip.pvSave");
          save.onclick = () => { savePvAsVariation(lines[0].sans.slice()); };
          head.appendChild(save);
        }
      }
    }
    renderWhyLine();
    renderRetry();
    renderReview();
    renderMoments();
    lockPgnEdits();
  }

  /**
   * The post-game report: what the analysis actually says, in words.
   *
   * The eval curve already shows *where* things went wrong; this answers the
   * questions a learner asks next — how well did I play, how many of those
   * marks were mine, and which single move decided the game. The turning-point
   * row jumps the replay to that move, so the answer is one click from the
   * position that caused it.
   */
  /**
   * One side's numbers, as [label, value] pairs — the single source both the
   * panel and the exported picture read.
   *
   * They used to share `rv.sideLine`, one key packing all five values into a
   * sentence. Splitting it for the panel alone would have left the picture
   * describing the same five numbers with different words, which is how the
   * two copies of every dialog title drifted, and how the picture came to name
   * the wrong player in the first place.
   *
   * The third row's label is the app's own move marks rather than three long
   * words: 「?! · ? · ??」 against 「3 · 2 · 1」, label and value lining up
   * term for term, and the legend for them sits in the same panel.
   * With 存疑标注 off the value has two terms, so the label drops its 「?!」
   * too (7.6: three marks over two numbers read one column off).
   */
  function sideRows(sum, side) {
    const c = sum.counts[side];
    const n = (x) => (x == null ? "—" : String(x));
    const soft = !!store.ui.showSoftMark;
    return [
      [t("rv.acc"), sum.acc[side] == null ? "—" : sum.acc[side] + "%"],
      [t("rv.acpl"), n(sum.acpl[side])],
      [t("rv.marks").split(" · ").slice(soft ? 0 : 1).join(" · "),
        (soft ? [c.inaccuracy, c.mistake, c.blunder] : [c.mistake, c.blunder]).join(" · ")],
    ];
  }

  function renderReview() {
    const el = document.getElementById("review-body");
    if (!el) return;
    const R = ChessReview;
    const a = analysisFor();
    const firstMover = startFen() ? (startFen().split(" ")[1] === "b" ? "b" : "w") : "w";
    const cp = R && a ? R.summarize(a.scalars, sanHistory(), firstMover) : null;
    // the report reads the win-percentage summary; the average loss (a
    // centipawn figure) is the one row still taken from the centipawn one
    const sum = R && a ? R.summarizeWinPct(a.scalars, sanHistory(), firstMover) : null;
    if (sum && cp) sum.acpl = cp.acpl;
    // the turning point is chosen by win-percentage drop, but the drill it
    // banks records what the move cost in centipawns (bankWorst → drillFrom)
    if (sum && sum.worst) sum.worst.loss = R.lossAt(a.scalars, sum.worst.ply, sum.worst.side);
    const card = document.getElementById("report-card");
    const hero = document.getElementById("acc-line");
    if (card) card.hidden = !sum;
    el.hidden = !sum;
    if (hero) hero.hidden = !sum;
    // v8-0-plan A4: the list of mistakes stands under the key moments, in
    // a box of its own, rebuilt with the report
    const list = document.getElementById("rv-mistakes");
    if (list) list.hidden = !sum;
    // 9.0 M2: all three sit in the folded 完整报告, which is there with them
    const full = document.getElementById("rv-full");
    if (full) full.hidden = !sum;
    if (!sum) { el.replaceChildren(); if (hero) hero.replaceChildren(); if (list) list.replaceChildren(); el.dataset.key = ""; return; }

    // the stored figure where there is one — it is what the statistics filed
    const acc = { w: sum.acc.w, b: sum.acc.b };
    if (a.acc) { if (a.acc.w != null) acc.w = a.acc.w; if (a.acc.b != null) acc.b = a.acc.b; }
    const soft = !!store.ui.showSoftMark;
    const isPlayer = (side) => store.session.mode === "ai" && side === store.session.humanColor;
    const worstBest = sum.worst && a.bests ? a.bests[sum.worst.ply] : null;
    const cand = sum.worst && worstBest ? worstDrill(sum.worst, worstBest) : null;
    const banked = !!cand && store.session.mines.some((m) => m.id === cand.id);
    // v8-0-plan B2: grades only where the pass measured them (`v: 2`); an
    // earlier record keeps its three marks, and its moments come from those
    const graded = a.v === 2 && Array.isArray(a.grades) ? a.grades : null;
    const gc = graded && Grade.countGrades(graded, firstMover);
    // 7.6 lesson: this runs on every sync, and rebuilding the card swapped the
    // turning-point button under a pointer that was mid-press. Rebuilt only
    // when something it shows has changed.
    const key = JSON.stringify([acc, sum.counts, sum.acpl, sum.judged, sum.measured, gc,
      sum.worst && [sum.worst.ply, Math.round(sum.worst.drop)], soft, store.ui.langId,
      store.session.mode, store.session.humanColor, !!worstBest, banked, sanHistory().length,
      (a.tags || []).join(","), a.budget || 0]);
    if (el.dataset.key === key && el.childElementCount) return;
    el.dataset.key = key;
    el.replaceChildren();

    // --- the headline: two accuracies, side by side, once -----------------
    // They were a text line above the report (「精准度 · 白 99% · 黑 98%」) AND
    // the first row of each side's block inside it — the same two numbers
    // twice, neither of them the thing the eye landed on.
    if (hero) {
      const cap = document.createElement("div");
      cap.className = "acc-cap";
      cap.textContent = t("acc.label");
      const cols = document.createElement("div");
      cols.className = "acc-cols";
      for (const side of ["w", "b"]) {
        const c = document.createElement("div");
        c.className = "acc-side" + (isPlayer(side) ? " is-you" : "");
        const num = document.createElement("span");
        num.className = "acc-num num";
        num.textContent = acc[side] == null ? "—" : acc[side] + "%";
        const who = document.createElement("span");
        who.className = "acc-who";
        const dot = document.createElement("span");
        dot.className = "acc-dot " + (side === "w" ? "is-w" : "is-b");
        dot.setAttribute("aria-hidden", "true");
        who.append(dot, document.createTextNode(sideName(side)));
        c.append(num, who);
        cols.appendChild(c);
      }
      hero.replaceChildren(cap, cols);
    }

    const line = (cls) => { const d = document.createElement("div"); d.className = cls; el.appendChild(d); return d; };
    // (the opening's name is not repeated here: the panel already heads with
    // it, a few centimetres up. The exported picture, which has no panel
    // around it, still carries it — report.js.)

    // --- the marks, per side: a small table, coloured by the marks' scale --
    // v7-7-plan §5 drew only the three marks: 7.9 had no basis for 妙着 or
    // 最佳. v8-0-plan B2 grades from a deeper MultiPV search (review-grade.js),
    // and the grades join the marks below — still only where one happened.
    const table = document.createElement("table");
    table.className = "rv-table";
    const tr = (cells, head) => {
      const row = document.createElement("tr");
      cells.forEach((c, i) => {
        const cell = document.createElement(head || i === 0 ? "th" : "td");
        if (i === 0 && !head) cell.scope = "row";
        if (head && i > 0) cell.scope = "col";
        if (c instanceof Node) cell.appendChild(c); else cell.textContent = c;
        row.appendChild(cell);
      });
      return row;
    };
    const thead = document.createElement("thead");
    thead.appendChild(tr(["", sideName("w"), sideName("b")], true));
    const tbody = document.createElement("tbody");
    // v8-0-plan A4: one table, every grade on one scale — praise at the top,
    // the marks at the bottom, the grades' own colours. The four quiet grades
    // (最佳 优秀 良好 谱着) were a footnote line a side under it, where the
    // two sides could not be read against each other. A grade no move got
    // has no row; the marks keep theirs, zero or not — "no ?? " is news.
    const KINDS = [["?!", "inaccuracy", "t-soft", "rv.kind.soft"], ["?", "mistake", "t-mid", "rv.kind.mid"],
      ["??", "blunder", "t-bad", "rv.kind.bad"]].filter((k) => soft || k[0] !== "?!");
    const GRADE_ROWS = [["brilliant", "!!", "t-good"], ["only", "!", "t-good"], ["best", "", "t-plain"],
      ["excellent", "", "t-plain"], ["good", "", "t-plain"], ["book", "", "t-plain"], ["miss", "", "t-mid"]];
    const labelled = (mark, cls, label) => {
      const lab = document.createDocumentFragment();
      const m = document.createElement("span");
      m.className = "rv-mark " + cls;
      m.textContent = mark;
      lab.append(m, document.createTextNode(t(label)));
      return lab;
    };
    for (const [g, mark, cls] of GRADE_ROWS) {
      if (!gc || !(gc.w[g] + gc.b[g])) continue;
      const row = tr([labelled(mark, cls, Grade.LABEL[g]), String(gc.w[g]), String(gc.b[g])]);
      row.className = "rv-grade " + cls;
      tbody.appendChild(row);
    }
    for (const [mark, field, cls, label] of KINDS) {
      const row = tr([labelled(mark, cls, label), String(sum.counts.w[field]), String(sum.counts.b[field])]);
      row.className = "rv-kind " + cls;
      // a zero is not news: only the counts that happened carry the colour
      for (const td of row.querySelectorAll("td")) td.classList.toggle("is-zero", td.textContent === "0");
      tbody.appendChild(row);
    }
    const n = (x) => (x == null ? "—" : String(x));
    const lossRow = tr([t("rv.acpl"), n(sum.acpl.w), n(sum.acpl.b)]);
    lossRow.className = "rv-loss";
    tbody.appendChild(lossRow);
    table.append(thead, tbody);
    for (const td of table.querySelectorAll("td")) td.classList.add("num");
    el.appendChild(table);

    // --- the footnote: what the numbers cannot carry ----------------------
    // 「只分析了 N 着」 is a caveat about the whole report, not about one side,
    // so it is said once. The advice lines stay per side and only where the
    // advice is for somebody: the player's side of an ai game, both sides of
    // anything else.
    const notes = [];
    let short = false;
    for (const side of ["w", "b"]) {
      if (acc[side] == null) continue;
      let vk = R.verdictKey(sum, side);
      if (vk === "rv.verdict.tooShort") { short = true; continue; }
      // 「挑战更高难度」 is advice to the player about the engine's level
      if (vk === "rv.verdict.excellent" && !isPlayer(side)) vk = "rv.verdict.excellentPlain";
      if (store.session.mode === "ai" && !isPlayer(side)) continue;
      if (vk) notes.push(tdot(sideName(side), t(vk)));
    }
    if (short) notes.unshift(tf("rv.verdict.tooShort", [sum.measured]));
    for (const txt of notes) {
      const note = line("review-note muted");
      note.textContent = txt;
    }

    // (v8-0-plan B2's three key moments a side are the stepper under the
    // graph since A4 — review/moments.js)
    if (sum.worst) {
      // …and one press away from never repeating it: the same drill the
      // automatic miner would make, banked by hand. Any game qualifies here —
      // the "games with a you" gate is the auto-miner's, not this button's:
      // pressing it IS the claim "this mistake is mine to fix".
      const bestUci = a && a.bests ? a.bests[sum.worst.ply] : null;
      if (bestUci) {
        const bank = document.createElement("button");
        bank.type = "button";
        bank.className = "review-bank";
        // already in the book — the auto-miner banked it, or this button did:
        // say so on the button instead of offering to bank it again (7.6)
        bank.textContent = banked ? t("rv.bankDup") : t("rv.bank");
        bank.disabled = banked;
        bank.title = banked ? "" : t("rv.bankTip");
        if (!banked) bank.onclick = () => bankWorst(sum.worst, bestUci);
        el.appendChild(bank);
      }
    }
    if (list) { list.replaceChildren(); renderMistakeList(list); list.hidden = !list.childElementCount; }
  }

  /** The drill the review's turning point would bank as, or null. */
  function worstDrill(worst, bestUci) {
    const fen = gameAt(worst.ply).fen();
    const a = analysisFor();
    const cand = Mistakes.drillFrom(fen, sanHistory()[worst.ply], bestUci, Math.round(worst.loss), worst.ply, Chess,
      // same rule as verifyAlt above: the fallback describes an analysis record
      // written before `budget` existed, so it stays at what that pass spent
      // …and it points back at the same game the auto-miner would have named
      { budget: (a && a.budget) || 120, src: "hand", from: boardDrillSource() });
    if (cand && a && a.pvs && typeof a.pvs[worst.ply] === "string") cand.pv = a.pvs[worst.ply];
    return cand;
  }

  /** Bank the review's turning point into the personal book, by hand. */
  function bankWorst(worst, bestUci) {
    const cand = worstDrill(worst, bestUci);
    if (!cand) { toast(t("rv.bankNone"), "fix"); return; }
    if (store.session.mines.some((m) => m.id === cand.id)) { toast(t("rv.bankDup")); return; }
    const solvedIds = new Set(Object.keys(store.session.puzzleState.solved).filter((k) => k.startsWith("mine:")));
    const r = Mistakes.addMines(store.session.mines, [cand], Date.now(), solvedIds);
    store.session.mines = r.list;
    saveMines();
    for (const id of r.dropped) {
      delete store.session.puzzleState.solved[id];
      delete store.session.puzzleState.missed[id];
    }
    if (ChessMistakes.queueFresh(store.session.puzzleState.missed, r.ids, Date.now(), ChessSrs.onMiss) || r.dropped.length) savePuzzleState();
    store.commit("session", "sync");
    toast(tf("rv.banked", [cand.solution[0]]));
  }

  // --- taking the review away ---------------------------------------------
  // The report is the most useful thing this app produces, and until now it
  // could only be looked at. Exporting the PGN hands somebody a move list and
  // makes them find their own software before they can see which move you mean.
  // A picture carries the conclusion.

  /** Draw the finished review onto an offscreen canvas. @returns {HTMLCanvasElement|null} */
  // the report image lives in report.js — a chunk since v8-0-plan A4 (F5's
  // budget), fetched on the first export; it reads the app through this bag
  function renderReportCanvas(ChessReport) {
    return ChessReport.render({ t, tf, sideName, statusText, openingFor, sanHistory, startFen,
      analysisFor, judgeColours, sideRows, DIFF_NAMES, store, ChessReview });
  }

  /** Base64 payload of a canvas PNG, without the data: prefix. */
  function canvasPngBase64(cv) {
    const url = cv.toDataURL("image/png");
    const at = url.indexOf(",");
    return at < 0 ? "" : url.slice(at + 1);
  }

  function reportFileName() {
    return pgnFileName().replace(/\.pgn$/, "") + ".png";
  }

  async function exportReport() {
    let R = null;
    try { R = await loadChunk(REVIEW_CHUNKS.report.file, REVIEW_CHUNKS.report.global); } catch (_) { R = null; }
    if (!R) { toast(t("msg.file.readFailed"), "fault"); return; }
    const cv = renderReportCanvas(R);
    if (!cv) { toast(t("rv.noReport")); return; }
    const name = reportFileName();
    const b64 = canvasPngBase64(cv);
    // the bridge refuses base64 past 512 KiB; a report this size is nowhere
    // near it, but falling back beats failing
    if (Host.hasZero() && b64 && b64.length < 512 * 1024) {
      try {
        // v8-1-plan N2: the dialog, the write and the reveal happen in main.zig
        const saved = await Host.saveText({ title: t("rv.exportTitle"), name, b64 });
        if (!saved) { toast(t("msg.export.cancelled")); return; }
        savedToast(saved.name, saved.path, saved.revealed);
        return;
      } catch (err) {
        // the dialog exists and refused (5.2.1): a picture has no clipboard
        // fallback worth the name, and the browser path below does nothing
        // inside a WKWebView — say it was not saved. No dialog API at all is
        // a browser, and the browser path is right.
        if (err && err.name !== Host.NO_FILE_DIALOG) { toast(t("msg.export.bridgeFailed"), "fault"); return; }
      }
    }
    try {
      const blob = await new Promise((res) => cv.toBlob(res, "image/png"));
      if (!blob) throw new Error("no blob");
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 2000);
      toast(tf("msg.export.doneDl", [name]), "fix");
    } catch (_) { toast(t("msg.file.readFailed"), "fault"); }
  }

  return { setAnalyzeUI, renderReview, exportReport };
}
