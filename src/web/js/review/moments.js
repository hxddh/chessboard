/**
 * 复盘的关键时刻：每方 3 个，可以依次翻看；和「从错误中学」的入口。
 *
 * v8-0-plan A4: B2 (review-grade.js keyMoments) decides the moments — the
 * three largest win-rate swings a side, a marked move by what it gave away,
 * a !! or ! by what it saved — and this draws them as one card you step
 * through, in the order they were played. Each step puts the board on the
 * position after the move (where its mark and the engine's arrow are), and
 * each card carries the three things to do about a moment: 为什么 (the
 * coach's sentence, explain.js through review/retry.js), 再试一次 (the same
 * retry the mistakes list uses) and 看引擎线 (the position before the move,
 * where the review's engine lines and their arrows answer "what then?").
 *
 * Under it, 从错误中学: every ? and ?? of the game as one run of 再试一次
 * (retry.js startLearn), Lichess's "Learn from your mistakes".
 *
 * Everything it needs from the app arrives in the bag handed to
 * `createMoments()`, createLibraryUI's shape; nothing here reaches back into
 * app.js. It is a chunk (review/moments-lazy.js), so even review-grade.js
 * arrives in the bag — imported here, it would be a second copy of the
 * module the bundle already carries.
 * @module review/moments
 */
/**
 * @param {object} d everything this module borrows from app.js
 */
export function createMoments(d) {
  const {
    doc, store, t, tf, sideName, analysisFor, sanHistory, startFen, boardMoveNo, setViewIndex, writeSan,
    inModal, Retry, Grade,
  } = d;
  const document = doc;

  /**
   * Which moment the card shows, and whether its 为什么 is open — per
   * analysis record. In the session, like the engine arrows' memo, and not
   * persisted: a view of the report, not a fact about the game.
   */
  function view() {
    if (!store.session._km) store.session._km = { at: 0, whyOpen: false, forA: null, lines: null };
    return store.session._km;
  }

  /** The moments of the analysed game, in the order they were played. */
  function momentsOf(a) {
    const firstMover = startFen() ? (startFen().split(" ")[1] === "b" ? "b" : "w") : "w";
    const graded = a.v === 2 && Array.isArray(a.grades) ? a.grades : null;
    const m = Grade.keyMoments({ sans: sanHistory(), scalars: a.scalars, bests: a.bests, seconds: a.seconds || [] },
      graded, firstMover, boardMoveNo);
    return m.w.concat(m.b).sort((x, y) => x.ply - y.ply);
  }

  /** The mark a moment carries: its glyph where it has one, else its tag. */
  function markOf(m) {
    return Grade.GLYPH[m.grade] || m.tag || "";
  }
  function markClass(m) {
    return m.grade === "brilliant" || m.grade === "only" ? "t-good"
      : m.tag === "??" ? "t-bad" : m.tag === "?" || m.grade === "miss" ? "t-mid" : "t-soft";
  }

  /** Step to moment `k`: the card turns, and the board stands after its move. */
  function go(list, k) {
    const v = view();
    v.at = Math.max(0, Math.min(list.length - 1, k));
    v.whyOpen = false;
    v.lines = null;
    setViewIndex(list[v.at].ply + 1);
  }

  function render() {
    const box = document.getElementById("rv-km");
    const row = document.getElementById("rv-learn-row");
    const a = analysisFor();
    const list = a && !inModal() ? momentsOf(a) : [];
    const v = view();
    if (a !== v.forA) Object.assign(v, { forA: a, at: 0, whyOpen: false, lines: null });
    // 看引擎线 stood the board before this moment's move — after the move
    // before it, which may be a moment too: while the board stays there, the
    // card stays on the moment whose lines these are (#89 review)
    if (v.lines !== store.game.viewIndex) v.lines = null;
    // the board standing on a moment (a click on the curve, the move list,
    // the keys) turns the card to it: the card follows the board
    const here = v.lines == null ? list.findIndex((m) => m.ply + 1 === store.game.viewIndex) : -1;
    if (here >= 0 && here !== v.at) Object.assign(v, { at: here, whyOpen: false });
    if (v.at >= list.length) v.at = 0;
    const at = v.at, whyOpen = v.whyOpen;
    renderLearn(row, a);
    if (!box) return;
    box.hidden = !list.length;
    if (!list.length) { box.dataset.key = ""; return; }
    const m = list[at];
    const ex = whyOpen ? Retry.mistakeFacts(m.ply) : null;
    const canRetry = !!(Retry.retryFacts(m.ply) || {}).better;
    // 7.6: rebuilt only when what it shows changes — the step keys are
    // written once in the page and never rebuilt, so they can be pressed
    // again and again while the card under them turns
    const key = JSON.stringify([list.map((x) => [x.ply, x.grade, x.swing]), at, whyOpen, canRetry, store.ui.langId, !!ex]);
    const pos = box.querySelector(".km-pos");
    if (pos) pos.textContent = (at + 1) + " / " + list.length;
    const prev = box.querySelector(".km-prev"), next = box.querySelector(".km-next");
    if (prev) { prev.disabled = at === 0; prev.onclick = () => go(list, at - 1); }
    if (next) { next.disabled = at === list.length - 1; next.onclick = () => go(list, at + 1); }
    const body = box.querySelector(".km-body");
    if (!body || box.dataset.key === key) return;
    box.dataset.key = key;
    body.replaceChildren();

    const card = document.createElement("div");
    card.className = "km-card";
    card.dataset.ply = String(m.ply);
    const head = document.createElement("button");
    head.type = "button";
    head.className = "km-move num";
    head.title = t("rv.jumpTip");
    const san = document.createElement("span");
    writeSan(san, m.san, m.side);
    const mark = document.createElement("span");
    mark.className = "rv-mark " + markClass(m);
    mark.textContent = markOf(m);
    head.append(document.createTextNode(Retry.plyLabel(m.ply)), san, mark);
    head.onclick = () => setViewIndex(m.ply + 1);
    const what = document.createElement("span");
    what.className = "km-what";
    what.textContent = sideName(m.side) + " · " + t(Grade.LABEL[m.grade]);
    const win = document.createElement("p");
    win.className = "km-win num";
    win.textContent = tf("rv.km.win", [Math.round(m.before), Math.round(m.after)]);
    const top = document.createElement("div");
    top.className = "km-top";
    top.append(head, what);
    card.append(top, win);

    const acts = document.createElement("div");
    acts.className = "km-acts";
    const act = (id, label, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pv-act";
      b.dataset.act = id;
      b.textContent = t(label);
      b.onclick = fn;
      acts.appendChild(b);
      return b;
    };
    const whyBtn = act("why", "rv.km.why", () => { v.whyOpen = !v.whyOpen; render(); });
    whyBtn.setAttribute("aria-expanded", whyOpen ? "true" : "false");
    const retry = act("retry", "rv.retry", () => Retry.startRetry(m.ply));
    retry.hidden = !canRetry;
    act("lines", "rv.km.lines", () => {
      // the position before the move: the review's lines and their arrows
      // are the engine's answer there (setAnalyzeUI draws them on the sync)
      v.lines = m.ply;
      setViewIndex(m.ply);
      const pv = document.getElementById("pv-line");
      if (pv && !pv.hidden && pv.scrollIntoView) pv.scrollIntoView({ block: "nearest" });
    });
    card.appendChild(acts);

    const why = document.createElement("p");
    why.className = "km-why";
    why.hidden = !whyOpen;
    if (whyOpen) {
      // what the move did to the game, in numbers, then — for a ? or ?? —
      // the coach's reason in words (explain.js, the mistakes list's own)
      const good = m.grade === "brilliant" || m.grade === "only";
      why.textContent = good ? tf("rv.km.whyGood", [Math.round(m.swing)]) : tf("rv.km.whyDrop", [Math.round(m.before), Math.round(m.after)]);
      if (ex) {
        const coach = document.createElement("span");
        coach.className = "km-coach";
        Retry.writeWhy(coach, ex);
        why.append(" ", coach);
      }
    }
    card.appendChild(why);
    body.appendChild(card);
  }

  /** 从错误中学, with how many there are to learn from — absent when none. */
  function renderLearn(row, a) {
    const btn = document.getElementById("rv-learn");
    if (!row || !btn) return;
    const n = a && !inModal() && !store.session.retry ? Retry.learnPlies().length : 0;
    row.hidden = !n;
    if (!n) return;
    const text = tf("rv.learn", [n]);
    if (btn.textContent !== text) btn.textContent = text;
    btn.onclick = () => Retry.startLearn();
  }

  return { render };
}
