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
    doc, store, t, tf, tdot, sideName, analysisFor, sanHistory, startFen, boardMoveNo, setViewIndex, writeSan,
    inModal, Retry, Grade, oppName, Review, result, LESSONS, lessonText, openLesson,
  } = d;
  const document = doc;

  /**
   * Which moment the card shows, and whether its 为什么 is open — per
   * analysis record. In the session, like the engine arrows' memo, and not
   * persisted: a view of the report, not a fact about the game.
   *
   * v10-0-plan A2: 为什么 is open as a moment comes up — the coach's sentence
   * is the point of the card (Chess.com's Game Review leads with it); it can
   * still be folded away, until the card turns.
   */
  function view() {
    if (!store.session._km) store.session._km = { at: 0, whyOpen: null, forA: null, lines: null };
    return store.session._km;
  }

  /** Your side, in a game against the engine; null where nobody at the board is "you". */
  const you = () => (store.session.mode === "ai" ? store.session.humanColor : null);
  /**
   * The moments of the analysed game, in the order they were played — 14.0
   * B: in a game of yours, yours first, then the opponent's (the review is
   * about what you can change; it led with whichever came first).
   */
  function momentsOf(a) {
    const firstMover = startFen() ? (startFen().split(" ")[1] === "b" ? "b" : "w") : "w";
    const graded = a.v === 2 && Array.isArray(a.grades) ? a.grades : null;
    const m = Grade.keyMoments({ sans: sanHistory(), scalars: a.scalars, bests: a.bests, seconds: a.seconds || [] },
      graded, firstMover, boardMoveNo);
    const me = you(), byPly = (x, y) => x.ply - y.ply;
    if (!me) return m.w.concat(m.b).sort(byPly);
    // 19.0 T2: against the engine, your moments only — the opponent's were
    // three of five cards and none of them yours to replay; a chance you
    // missed after one of its mistakes is already yours (错失良机)
    return m[me].slice().sort(byPly);
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
    v.whyOpen = null;
    v.lines = null;
    setViewIndex(list[v.at].ply + 1);
  }

  function render() {
    const box = document.getElementById("rv-km");
    const row = document.getElementById("rv-learn-row");
    const a = analysisFor();
    const list = a && !inModal() ? momentsOf(a) : [];
    const v = view();
    if (a !== v.forA) {
      const fresh = !!a && !!v.forA !== !!a;
      Object.assign(v, { forA: a, at: 0, whyOpen: null, lines: null });
      // 22.0 A1: a review that has just arrived opens on its first key
      // moment. The board stood on the last move while the card spoke of
      // move 7 — two positions on one screen. Only from the end of the game:
      // a reader who has already stepped back is left where they are, and a
      // game still being played here keeps its board on the move to be made.
      const over = store.game.imported || (!!result && result() !== "*");
      if (fresh && over && list.length && store.game.viewIndex === sanHistory().length && !store.session.analyzing && !store.session.retry) {
        setViewIndex(list[0].ply + 1);
        return;
      }
    }
    // 看引擎线 stood the board before this moment's move — after the move
    // before it, which may be a moment too: while the board stays there, the
    // card stays on the moment whose lines these are (#89 review)
    if (v.lines !== store.game.viewIndex) v.lines = null;
    // the board standing on a moment (a click on the curve, the move list,
    // the keys) turns the card to it: the card follows the board
    const here = v.lines == null ? list.findIndex((m) => m.ply + 1 === store.game.viewIndex) : -1;
    if (here >= 0 && here !== v.at) Object.assign(v, { at: here, whyOpen: null });
    if (v.at >= list.length) v.at = 0;
    const at = v.at;
    renderLearn(row, a);
    renderSummary(a, list);
    if (!box) return;
    box.hidden = !list.length;
    if (!list.length) { box.dataset.key = ""; return; }
    const m = list[at];
    // 14.0 B: 再试一次 is for your own moves — the opponent's are not yours to replay
    const canRetry = (!you() || m.side === you()) && !!(Retry.retryFacts(m.ply) || {}).better;
    // 21.0 T1: a moment you can replay opens on 再试一次, not on the answer.
    // 为什么 is the coach's reason, and for a mistake that reason is the better
    // move (「更好的是 Bxd4…」) — open by default, it was the answer printed
    // right above the 再试一次 that asked you to find it. Until you open it
    // yourself (whyOpen true / false), it is open only where there is nothing
    // to replay, and for a good move, where it spoils nothing.
    const good0 = m.grade === "brilliant" || m.grade === "only";
    const whyOpen = v.whyOpen == null ? good0 || !canRetry : v.whyOpen;
    const ex = whyOpen ? Retry.mistakeFacts(m.ply) : null;
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
    what.textContent = tdot(sideName(m.side), t(Grade.LABEL[m.grade]));
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
    // 21.0 T1: 再试一次 first, and the card's main action
    const retry = act("retry", "rv.retry", () => Retry.startRetry(m.ply));
    retry.hidden = !canRetry;
    retry.classList.add("primary");
    const whyBtn = act("why", "rv.km.why", () => { v.whyOpen = !whyOpen; render(); });
    whyBtn.setAttribute("aria-expanded", whyOpen ? "true" : "false");
    // 19.0 T2: no reason in words, no 为什么 — it only said the win chance again
    whyBtn.hidden = !good0 && !Retry.mistakeFacts(m.ply);
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
      // 19.0 T2: the coach's reason alone — the card's own line above already
      // says the win chance (「胜率 96% → 26%」), and 为什么 repeated it
      const good = m.grade === "brilliant" || m.grade === "only";
      if (good) why.textContent = tf("rv.km.whyGood", [Math.round(m.swing)]);
      if (ex) {
        const coach = document.createElement("span");
        coach.className = "km-coach";
        Retry.writeWhy(coach, ex);
        why.append(coach);
      }
      if (!good && !ex) why.hidden = true;
    }
    card.appendChild(why);
    body.appendChild(card);
  }

  /**
   * 9.0 M2: the review's first line — one sentence for the whole game,
   * above the curve and the moments. Against the engine it is the
   * opponent's, about you (7.8's rule for the personas' lines holds: facts
   * — the move, the win chance — never a verdict); between two people or
   * for an imported game it names the side. Built from the same moments
   * the card steps through: the largest fall in win chance is the game's
   * turning point, and a game without one says so.
   */
  /**
   * 14.0 B: how a game of yours ended, when that is the story — resigned
   * with the game still in hand (≥ 70%), a won game (≥ 85% at some point)
   * lost, or the clock run out in a level position. Null otherwise.
   */
  function endingNote(a) {
    const me = store.session.humanColor, sc = a.scalars || [];
    if (!Review || !result) return null;
    const winOf = (x) => { const w = x == null ? null : Review.winPct(x); return w == null ? null : me === "w" ? w : 100 - w; };
    const token = result(), lost = token === (me === "w" ? "0-1" : "1-0");
    const last = winOf(sc[sc.length - 1]);
    if (lost && store.game.resigned === me && last != null && last >= 70) return tf("rv.sum.resignAhead", [Math.round(last)]);
    if (lost && store.game.flagFall === me && last != null && last >= 40 && last <= 60) return tf("rv.sum.flagDrawn", [Math.round(last)]);
    if (!lost) return null;
    let peak = null;
    sc.forEach((x, i) => { const w = winOf(x); if (w != null && (!peak || w > peak.w)) peak = { w, i }; });
    return peak && peak.w >= 85 ? tf("rv.sum.reversed", [Math.round(peak.w), boardMoveNo(Math.max(0, peak.i - 1))]) : null;
  }
  function summaryText(a, list) {
    const ai = store.session.mode === "ai";
    const you = store.session.humanColor;
    const drops = list.filter((m) => m.grade !== "brilliant" && m.grade !== "only" && (!ai || m.side === you));
    const m = drops.reduce((w, x) => (!w || x.swing > w.swing ? x : w), null);
    const pct = (x) => Math.round(x);
    if (ai) {
      const who = oppName ? oppName() : "";
      const ending = endingNote(a);
      if (ending) return tdot(who, ending);
      if (!m) return tf("rv.sum.clean", [who]);
      // 18.0 R4: …and when you won it back, the sentence says so — through
      // 17.0 a won game's summary ended on 「局面就到了我这边」
      const won = !!result && result() === (you === "w" ? "1-0" : "0-1");
      if (won && m.before >= 50 && m.after < 50) return tf("rv.sum.turnBack", [who, m.moveNo, pct(m.before), pct(m.after)]);
      return m.before >= 50 && m.after < 50
        ? tf("rv.sum.turn", [who, m.moveNo, pct(m.before)])
        : tf("rv.sum.drop", [who, m.moveNo, pct(m.before), pct(m.after)]);
    }
    if (!m) return t("rv.sum.calm");
    return tf("rv.sum.side", [Retry.plyLabel(m.ply) + m.san, sideName(m.side), pct(m.before), pct(m.after)]);
  }
  /**
   * 19.0 T2: one thing to work on — the motif behind most of your marked
   * moves, and the lesson that teaches it. Chess.com's Coach and Aimchess end
   * a review with one; this one ended on the numbers.
   */
  const LESSON_OF = { fork: "fork", pin: "pin", skewer: "skewer", discovered: "discovery", discoveredAttack: "discovery",
    double: "discovery", hanging: "protect", backRank: "backrank", mateThreat: "mate", removeDefender: "remove",
    overload: "overload", deflection: "deflect", decoy: "decoy", promotion: "promotion", loss: "defend" };
  /** …and, where the reason names no motif, the kind of sentence it is */
  const KIND_OF = (key) => !key ? null : /^ex\.allowsMate/.test(key) ? "mateThreat" : /^ex\.(hanging|hangingCheap|threatHanging|threatCheap)$/.test(key) ? "hanging"
    : /^ex\.(loss|motifLoss)$/.test(key) ? "loss" : null;
  function workOn() {
    if (!LESSONS || !Retry.mistakePlies) return null;
    const n = {};
    for (const i of Retry.mistakePlies()) { const m = Retry.mistakeMotif(i) || KIND_OF(Retry.mistakeKey(i)); if (m && LESSON_OF[m]) n[m] = (n[m] || 0) + 1; }
    const top = Object.keys(n).sort((x, y) => n[y] - n[x])[0];
    const li = top ? LESSONS.findIndex((L) => L.id === LESSON_OF[top]) : -1;
    return li < 0 ? null : { li, motif: top, times: n[top], title: lessonText(LESSONS[li]).title };
  }
  function renderSummary(a, list) {
    const el = document.getElementById("rv-summary");
    if (!el) return;
    const text = a && !inModal() && !store.session.analyzing ? summaryText(a, list) : "";
    el.hidden = !text;
    if (el.textContent !== text) el.textContent = text;
    // the one thing to work on, its own line under the summary
    let box = document.getElementById("rv-work");
    if (!box) { box = document.createElement("p"); box.id = "rv-work"; box.className = "rv-work"; el.after(box); }
    const w = text ? workOn() : null;
    box.hidden = !w;
    const key = w ? w.li + ":" + w.times + "|" + store.ui.langId : "";
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.replaceChildren();
    if (!w) return;
    const line = document.createElement("span");
    line.textContent = tf("rv.sum.work", [w.motif === "loss" ? t("rv.sum.workLoss") : t("motif." + w.motif), w.times, tf("today.lessonN", [w.li + 1, w.title])]);
    const go = document.createElement("button");
    go.type = "button";
    go.className = "pv-act rv-work-go";
    go.textContent = t("rv.sum.workGo");
    go.onclick = () => openLesson(w.li);
    box.append(line, " ", go);
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
