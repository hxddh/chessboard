/**
 * 复盘里的「为什么错」和「再试一次」。
 *
 * v8-0-plan F4 (M3): app.js's 7.8 §3 section, moved whole — the reason a ?
 * or ?? was a mistake (explain.js's sentence, memoised per analysis record),
 * the report card's list of them, the line under the engine lines while the
 * cursor stands on one, and 再试一次 itself: its state on top of the
 * replay, the board model it draws, the click and move handlers and the
 * verdict panel. Moved, not rewritten: the bodies are the ones app.js had.
 *
 * Everything it needs from the app arrives in the bag handed to
 * `createRetry()`, createLibraryUI's shape; nothing here reaches back into
 * app.js. The pure modules are imported, not passed, because they are the
 * same objects app.js imports (patching ChessEngine through the test seam
 * patches this file's copy too).
 * @module review/retry
 */
import { Chess } from "../chess.js";
import { ChessBoardView } from "../board.js";
import { ChessEngine } from "../engine.js";
import { ChessExplain } from "../explain.js";
import { ChessMistakes } from "../mistakes.js";
import { ChessReview } from "../review.js";

/**
 * @param {object} d everything this module borrows from app.js
 */
export function createRetry(d) {
  const {
    doc, store, t, tf, sideName, analysisFor, sanHistory, gameAt, startFen, boardMoveNo, writeSan,
    setViewIndex, inModal, sync, draw, kingSquare, cursorSquare, bestArrowAt, choosePromotion,
    selectSquare, clearSelection, moveSound, evalScalar, SCAN_BUDGET, toast,
  } = d;
  const document = doc;
  const BoardView = ChessBoardView;
  const Mistakes = ChessMistakes;
  const Review = ChessReview;

  // --- 7.8 §3: why a ? or ?? was a mistake, and 再试一次 ---------------------
  //
  // The sentence is explain.js's: the refutation (the first move of the
  // engine line after the mistake) with its motif when motif.js is sure, what
  // that line wins, and the engine's own choice. Everything it reads is
  // already in the analysis record — `pvs[i + 1]` is the line after ply i
  // (continued by lineAfter where the game followed it), `pvs[i]` and
  // `bests[i]` the line and the move before it — so this is a
  // derivation like bestArrowAt: nothing stored, nothing to migrate.

  /** Memo per analysis record: a record is replaced, never edited. */
  const whyMemo = new WeakMap();

  /** The facts about ply `i` of the analysed game, or null. */
  function mistakeFacts(i) {
    const a = analysisFor();
    if (!a || !a.tags || !a.bests) return null;
    const tag = a.tags[i];
    if (tag !== "?" && tag !== "??") return null;
    let memo = whyMemo.get(a);
    if (!memo) { memo = new Map(); whyMemo.set(a, memo); }
    if (memo.has(i)) return memo.get(i);
    const h = sanHistory();
    const ex = i < h.length && a.bests[i] ? ChessExplain.explainMistake({
      fen: gameAt(i).fen(), played: h[i], best: a.bests[i],
      bestLine: a.pvs ? a.pvs[i] : null, line: a.pvs ? ChessExplain.lineAfter(a.pvs, h, i) : null, evalBefore: a.scalars && a.scalars[i], evalAfter: a.scalars && a.scalars[i + 1],
    }, Chess) : null;
    memo.set(i, ex);
    return ex;
  }

  /**
   * v8-0-plan A4: what 再试一次 asks at ply `i` wherever the engine chose a
   * move — a key moment is not always a ? or ?? (a ?!, a missed win, or a
   * !! / ! to find again). A marked move has its reason (mistakeFacts);
   * any other is the bare question: the move played, unless it WAS the
   * engine's choice (then there is nothing wrong to play again), and the
   * engine's move as the answer. Memoised beside the reasons.
   */
  /** The best move at ply `i` as an arrow, whatever the move's grade. */
  function retryArrow(i) {
    const a = analysisFor();
    const uci = a && a.bests ? a.bests[i] : null;
    return uci && uci.length >= 4 ? { from: uci.slice(0, 2), to: uci.slice(2, 4) } : null;
  }

  function retryFacts(i) {
    const ex = mistakeFacts(i);
    if (ex) return ex;
    const a = analysisFor();
    const h = sanHistory();
    const uci = a && a.bests ? a.bests[i] : null;
    if (!uci || uci.length < 4 || i >= h.length) return null;
    let memo = whyMemo.get(a);
    if (!memo) { memo = new Map(); whyMemo.set(a, memo); }
    if (memo.has("q" + i)) return memo.get("q" + i);
    const g = gameAt(i);
    const b = new Chess(g.fen()).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || "q" });
    const ex2 = b ? { side: g.turn(), played: b.san === h[i] ? null : h[i], refute: null, lost: null, better: { san: b.san } } : null;
    memo.set("q" + i, ex2);
    return ex2;
  }

  /** The sentence into `node`, moves drawn the way the move list draws them. */
  function writeWhy(node, ex) {
    node.replaceChildren();
    for (const p of ChessExplain.explainParts(ex, t)) {
      if (typeof p === "string") { node.appendChild(document.createTextNode(p)); continue; }
      const s = document.createElement("span");
      s.className = "why-san";
      writeSan(s, p.san, p.color);
      node.appendChild(s);
    }
  }

  /** 「9. a3」 / 「9… Nb4」 — ply `i` of the main line, numbered. */
  function plyLabel(i) {
    return boardMoveNo(i) + (gameAt(i).turn() === "w" ? ". " : "… ");
  }

  /** The plies the report lists: every ? and ??, the player's only in an ai game. */
  function mistakePlies() {
    const a = analysisFor();
    if (!a || !a.tags) return [];
    const out = [];
    const firstMover = startFen() ? (startFen().split(" ")[1] === "b" ? "b" : "w") : "w";
    a.tags.forEach((tag, i) => {
      if (tag !== "?" && tag !== "??") return;
      const side = (i % 2 === 0) === (firstMover === "w") ? "w" : "b";
      if (store.session.mode === "ai" && side !== store.session.humanColor) return;
      if (a.bests && a.bests[i]) out.push(i);
    });
    return out;
  }

  /** The report card's list: a row per ? / ??, its reason and 再试一次. */
  function renderMistakeList(el) {
    const plies = mistakePlies();
    if (!plies.length) return;
    const a = analysisFor();
    const h = sanHistory();
    const box = document.createElement("div");
    box.className = "rv-moments";
    const cap = document.createElement("div");
    cap.className = "rv-moments-cap";
    cap.textContent = t("rv.mistakes");
    box.appendChild(cap);
    for (const i of plies) {
      const ex = mistakeFacts(i);
      const row = document.createElement("div");
      row.className = "rv-moment";
      row.dataset.ply = String(i);
      const jump = document.createElement("button");
      jump.type = "button";
      jump.className = "rv-mo-jump num";
      const san = document.createElement("span");
      writeSan(san, h[i], gameAt(i).turn());
      const mark = document.createElement("span");
      mark.className = "rv-mark " + (a.tags[i] === "??" ? "t-bad" : "t-mid");
      mark.textContent = a.tags[i];
      jump.append(document.createTextNode(plyLabel(i)), san, mark);
      jump.title = t("rv.jumpTip");
      jump.onclick = () => setViewIndex(i + 1);
      const why = document.createElement("span");
      why.className = "rv-mo-why";
      if (ex) writeWhy(why, ex);
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "pv-act rv-mo-retry";
      retry.textContent = t("rv.retry");
      retry.onclick = () => startRetry(i);
      row.append(jump, why);
      if (ex && ex.better) row.appendChild(retry);
      box.appendChild(row);
    }
    el.appendChild(box);
  }

  /**
   * Under the engine line, while the cursor stands on a ? or ??: the reason,
   * and 再试一次. Rebuilt only when what it shows changes (7.6: never swap
   * the button under a press).
   */
  function renderWhyLine() {
    const box = document.getElementById("why-line");
    if (!box) return;
    const i = store.game.viewIndex - 1;
    const ex = i >= 0 && !store.session.retry && !inModal() ? mistakeFacts(i) : null;
    // the facts themselves, not the game's signature: 分析 again or 精析
    // replaces the record for the same game, and its reason may differ (Codex, #83)
    const key = ex ? JSON.stringify([i, store.ui.langId, sanHistory()[i], ex]) : "";
    box.hidden = !ex;
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.replaceChildren();
    if (!ex) return;
    const why = document.createElement("span");
    why.className = "why-text";
    writeWhy(why, ex);
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "pv-act";
    retry.id = "why-retry";
    retry.textContent = t("rv.retry");
    retry.onclick = () => startRetry(i);
    box.append(why, retry);
  }

  /**
   * 再试一次: the position before the mistake, on the board, one move to find.
   *
   * Not a puzzle: switching mode would leave the review, the analysis and the
   * report behind, and coming back is the whole point. It is a small state
   * on top of the replay — the board draws `retry.g`, a click moves on it,
   * and any replay navigation (a move-list row, ←/→, the curve) ends it,
   * because each of those is a way of saying "back to the game".
   *
   * Judged by the rule the personal drills use: the engine's move is right,
   * the mistake again is wrong, anything else is searched after both moves at
   * the budget of the pass that marked it and accepted when it costs less
   * than Review.MISTAKE against the best (Mistakes.judgeAlt).
   */
  function startRetry(i, run) {
    const ex = retryFacts(i);
    const a = analysisFor();
    if (!ex || !ex.better || !a) return;
    setViewIndex(i);
    const fen = gameAt(i).fen();
    // `run`: 从错误中学 (v8-0-plan A4) — the chain this question is one of.
    // It rides on the retry itself, so any way back to the game (which
    // clears the retry) ends the run with it.
    store.session.retry = { a, ply: i, fen, g: new Chess(fen), ex, side: ex.side, last: null, verdict: null, tried: null, run: run || null };
    store.game.selection = null;
    BoardView.cancelAnim();
    sync();
    const box = document.getElementById("retry-box");
    if (box && box.scrollIntoView) box.scrollIntoView({ block: "nearest" });
  }

  /**
   * 从错误中学 (v8-0-plan A4, Lichess's "Learn from your mistakes"): every ?
   * and ?? of this game that 再试一次 can ask, one after another — the
   * report's list of mistakes (mistakePlies: the player's own in an engine
   * game), as a run.
   */
  function learnPlies() {
    return mistakePlies().filter((i) => { const ex = retryFacts(i); return !!(ex && ex.better); });
  }
  function startLearn() {
    const plies = learnPlies();
    if (plies.length) startRetry(plies[0], { plies, k: 0, right: 0, judged: {} });
  }
  /** The next question of the run, or its end: back to the game, and the tally. */
  function nextLearn() {
    const r = store.session.retry;
    if (!r || !r.run) return;
    const run = r.run;
    if (run.k + 1 < run.plies.length) { startRetry(run.plies[run.k + 1], Object.assign({}, run, { k: run.k + 1 })); return; }
    endRetry();
    toast(tf("rt.learnDone", [run.right, run.plies.length]), "fix");
  }
  /** A verdict, counted once per question for the run's tally (a second try is practice). */
  function settle(r, v) {
    r.verdict = v;
    if (!r.run || (v !== "right" && v !== "wrong") || r.run.judged[r.ply]) return;
    r.run.judged[r.ply] = v;
    if (v === "right") r.run.right++;
  }

  /** Leave 再试一次, standing on the mistake so its reason is on screen. */
  function endRetry() {
    const r = store.session.retry;
    store.session.retry = null;
    store.game.selection = null;
    if (r) setViewIndex(r.ply + 1);
    else sync();
  }

  /** Put the position back and let the player try again. */
  function resetRetry() {
    const r = store.session.retry;
    if (!r || r.verdict === "checking") return;
    Object.assign(r, { g: new Chess(r.fen), last: null, verdict: null, tried: null });
    store.game.selection = null;
    sync();
  }

  function retryModel() {
    const r = store.session.retry;
    const g = r.g;
    return {
      position: g.board(), flipped: store.game.flipped,
      selected: store.game.selection ? store.game.selection.sq : null,
      legalTargets: store.game.selection ? store.game.selection.targets : [],
      lastMove: r.last,
      checkSquare: g.in_check() ? kingSquare(g, g.turn()) : null,
      mated: g.in_checkmate(),
      // after a verdict, the engine's choice as the arrow — "either way, show
      // the best move" — drawn from the position before the move tried; read
      // off the analysis itself, since a graded moment that is no mistake
      // (!!, 仅此一着, 错失良机) has a retry too and bestArrowAt keeps to mistakes (Codex #89)
      hintMove: r.verdict && r.verdict !== "checking" ? retryArrow(r.ply) : null,
      stars: [], cursor: cursorSquare(), drag: store.ui.dragging,
      coords: store.ui.coordsOn, blind: store.ui.blindfold,
    };
  }

  function retryClick(sq) {
    const r = store.session.retry;
    if (r.verdict || r.g.turn() !== r.side) return;
    const g = r.g;
    if (store.game.selection && store.game.selection.targets.includes(sq)) {
      const from = store.game.selection.sq;
      const vmv = g.moves({ square: from, verbose: true }).find((m) => m.to === sq);
      if (vmv && vmv.promotion) {
        choosePromotion(g.turn(), sq).then((p) => { if (p) retryMove(from, sq, p); });
        return;
      }
      retryMove(from, sq, "q");
      return;
    }
    const piece = g.get(sq);
    if (piece && piece.color === r.side) {
      selectSquare(sq, g.moves({ square: sq, verbose: true }).map((m) => m.to));
      return;
    }
    clearSelection();
  }

  async function retryMove(from, to, promotion) {
    const r = store.session.retry;
    if (!r || r.verdict) return;
    const mv = r.g.move({ from, to, promotion });
    if (!mv) return;
    store.game.selection = null;
    r.last = { from: mv.from, to: mv.to };
    r.tried = mv.san;
    BoardView.cancelAnim();
    moveSound(mv, r.g);
    const quick = ChessExplain.retryQuick(mv.san, r.ex);
    if (quick) { settle(r, quick); sync(); return; }
    if (!ChessEngine || !ChessEngine.isReady || !ChessEngine.isReady()) { r.verdict = "unknown"; sync(); return; }
    r.verdict = "checking";
    sync();
    const probe = new Chess(r.fen);
    probe.move(r.ex.better.san);
    const budget = r.a.budget || SCAN_BUDGET;
    let eBest = null, eAlt = null;
    try {
      eBest = await ChessEngine.analyze(probe.fen(), budget);
      eAlt = await ChessEngine.analyze(r.g.fen(), budget);
    } catch (_) {}
    if (store.session.retry !== r) return;
    const cpBest = evalScalar(eBest), cpAlt = evalScalar(eAlt);
    if (cpBest == null || cpAlt == null) { r.verdict = "unknown"; sync(); return; }
    const v = Mistakes.judgeAlt(cpBest, cpAlt, r.side, Review.MISTAKE);
    settle(r, v.ok ? "right" : "wrong");
    sync();
  }

  /** The 再试一次 panel: the question, then the verdict, the best move and why. */
  function renderRetry() {
    const box = document.getElementById("retry-box");
    if (!box) return;
    let r = store.session.retry;
    // the game or its analysis changed underneath: the question is gone too
    // — and the board may already have drawn the attempt in this same commit,
    // so it draws again (Codex, #83)
    if (r && (analysisFor() !== r.a || inModal())) {
      store.session.retry = r = null;
      store.game.selection = null;
      draw();
    }
    const key = r ? JSON.stringify([r.ply, r.verdict, r.tried, store.ui.langId, r.run && [r.run.k, r.run.plies.length]]) : "";
    box.hidden = !r;
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.replaceChildren();
    if (!r) return;
    const p = (cls, text) => {
      const d = document.createElement("p");
      d.className = cls;
      if (text != null) d.textContent = text;
      box.appendChild(d);
      return d;
    };
    if (r.run) p("rt-prog", tf("rt.progress", [r.run.k + 1, r.run.plies.length]));
    p("rt-ask", tf("rt.ask", [boardMoveNo(r.ply), sideName(r.side)]));
    const status = p("rt-verdict");
    status.setAttribute("role", "status");
    if (r.verdict) {
      const tried = document.createElement("span");
      tried.className = "why-san";
      writeSan(tried, r.tried, r.side);
      const word = { right: t("rt.right"), wrong: t("rt.wrong"), checking: t("rt.checking"), unknown: t("rt.noEngine") }[r.verdict];
      status.classList.add("is-" + r.verdict);
      status.append(tried, document.createTextNode(" · " + word));
    }
    if (r.verdict && r.verdict !== "checking") {
      const best = p("rt-best");
      const tpl = t("rt.best").split("{0}");
      const bs = document.createElement("span");
      bs.className = "why-san";
      writeSan(bs, r.ex.better.san, r.side);
      best.append(document.createTextNode(tpl[0]), bs, document.createTextNode(tpl[1] || ""));
      // a move that was the engine's own choice (a !! or ! key moment) has no
      // reason: explain.js would only say 「更好的是」 the move itself (#89 review)
      if (r.ex.played != null) writeWhy(p("rt-why"), r.ex);
    }
    const row = document.createElement("div");
    row.className = "rt-acts";
    if (r.verdict && r.verdict !== "checking") {
      const again = document.createElement("button");
      again.type = "button";
      again.className = "pv-act";
      again.id = "rt-again";
      again.textContent = t("rt.again");
      again.onclick = resetRetry;
      row.appendChild(again);
    }
    // 从错误中学: once judged, on to the next one — or, after the last, done
    if (r.run && r.verdict && r.verdict !== "checking") {
      const next = document.createElement("button");
      next.type = "button";
      next.className = "pv-act rt-next";
      next.id = "rt-next";
      next.textContent = t(r.run.k + 1 < r.run.plies.length ? "rt.next" : "rt.finish");
      next.onclick = nextLearn;
      row.appendChild(next);
    }
    const back = document.createElement("button");
    back.type = "button";
    back.className = "pv-act";
    back.id = "rt-back";
    back.textContent = t("rt.back");
    back.onclick = endRetry;
    row.appendChild(back);
    box.appendChild(row);
  }

  return { renderMistakeList, renderWhyLine, startRetry, retryModel, retryClick, renderRetry,
    mistakeFacts, retryFacts, writeWhy, plyLabel, learnPlies, startLearn };
}
