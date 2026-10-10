/**
 * 残局训练营的外壳（v8-1-plan T2）：内容分块、进度、复习队列、目录和「我的」。
 *
 * The ninety positions are js/chunk-endgames.js (endgames.js), fetched the
 * first time the lesson list or 「我的」 draws; this module is what the bundle
 * keeps of the camp. An endgame runs in the lesson runner (trainer/lessons.js)
 * as a one-task lesson built here — a drill against the engine at full
 * strength, judged by endgame-rules.js.
 *
 * Progress lives in the learn key, beside the course (`learnState.eg`), so the
 * learning-data file and 清除教学进度 need nothing new: a save with no `eg`
 * reads as nothing tried yet.
 *
 *   eg.done[id] = ms of the first time the goal was reached
 *   eg.srs[id]  = srs.js entry: a failed try, or a success that leaned on
 *                 undo or the hint, puts the position in the review queue;
 *                 clean successes walk it up the 1 → 3 → 7 → 21-day ladder
 *                 and out.
 * @module trainer/endgames
 */
import { loadChunk } from "../chunk.js";
import { ChessSrs } from "../srs.js";
import { tdot } from "../tdot.js";

/** chunk file and global — scripts/bundle.mjs builds endgames.js into it */
export const EG_CHUNK = { file: "chunk-endgames.js", global: "CHESS_ENDGAMES" };
const LANG_AT = { "zh-CN": 0, en: 1, ja: 2 };

/**
 * @param {object} d {store, t, tf, saveLearnState, onReady}
 */
export function createEndgames(d) {
  const { store, t, tf, saveLearnState, onReady } = d;
  let data = null;
  let asked = null;
  let meLater = null; // 「我的」 asked before the chunk was here
  const later = []; // 9.0 S3: whenReady's callers, until the chunk is here

  /**
   * Start the fetch once; `onReady` repaints whoever asked. After the frame
   * that asked, not during it: F5's first paint fetches no chunk but the boot
   * one, and a session restored into 学习 draws the list in its first frame.
   */
  function ensure() {
    if (data || asked) return;
    asked = new Promise((r) => (typeof requestAnimationFrame === "function"
      ? requestAnimationFrame(() => setTimeout(r, 0)) : setTimeout(r, 0)))
      .then(() => loadChunk(EG_CHUNK.file, EG_CHUNK.global))
      .then((m) => {
        data = m;
        onReady();
        for (const fn of later.splice(0)) fn();
        if (meLater) { meLater = null; renderMe(); }
      }, () => { asked = null; }); // a failed load is retried next time something asks
  }
  const ready = () => !!data;
  /** 9.0 S3: run `fn` once the camp is here (at once if it is). */
  function whenReady(fn) {
    if (data) { fn(); return; }
    later.push(fn);
    ensure();
  }
  /** Where 残局 picks up: the one last opened, else the first not done, else the first. */
  function resumeId() {
    if (!data) return null;
    const eg = state();
    if (eg.last && item(eg.last)) return eg.last;
    const open = data.ITEMS.find((x) => !eg.done[x.id]);
    return (open || data.ITEMS[0]).id;
  }
  const word = (arr) => (arr ? arr[LANG_AT[store.ui.langId] || 0] || arr[0] : "");
  const item = (id) => (data ? data.ITEMS.find((x) => x.id === id) || null : null);
  const group = (g) => data.GROUPS.find((x) => x.id === g);

  /** learnState.eg, made whole: old saves have none, a hand-edited one may be anything */
  function state() {
    const ls = store.session.learnState;
    let eg = ls.eg;
    if (!eg || typeof eg !== "object") eg = ls.eg = {};
    if (!eg.done || typeof eg.done !== "object") eg.done = {};
    if (!eg.srs || typeof eg.srs !== "object") eg.srs = {};
    return eg;
  }

  /** The endgame as a one-task lesson, in the interface language. */
  const cache = { key: "", L: null };
  function lesson(id) {
    const it = item(id);
    if (!it) return null;
    const key = id + "|" + store.ui.langId;
    if (cache.key === key) return cache.L;
    // v8-3-plan T5: a `pend` card says its table check is still to come
    const src = tdot(tf("eg.src", [word(it.src)]), t(it.v === "tb" ? "eg.verTb" : it.v === "pend" ? "eg.verPend" : "eg.verSf"));
    cache.key = key;
    cache.L = {
      id: "eg:" + id, eg: id,
      part: tdot(t("eg.camp"), word(group(it.g).n)),
      title: word(it.n),
      text: [word(it.tip), src],
      tasks: [{ type: "drill", eg: true, fen: it.fen, goal: it.goal, engine: "extreme",
        winOn: it.goal === "draw" ? "draw" : undefined,
        prompt: t(it.goal === "draw" ? "eg.goalDraw" : "eg.goalWin") }],
    };
    return cache.L;
  }

  /** @param {boolean} ok goal reached  @param {boolean} helped undo or hint was used */
  function record(id, ok, helped, now) {
    const eg = state();
    const at = Number.isFinite(now) ? now : Date.now();
    if (ok && !eg.done[id]) eg.done[id] = at;
    if (!ok || helped) eg.srs[id] = ChessSrs.onMiss(eg.srs[id], at);
    else if (eg.srs[id]) {
      const next = ChessSrs.onSolve(eg.srs[id], at);
      if (next) eg.srs[id] = next; else delete eg.srs[id];
    }
    saveLearnState();
  }

  /** ids whose review date has come, most overdue first */
  function due(now) {
    const srs = state().srs;
    const at = Number.isFinite(now) ? now : Date.now();
    return Object.keys(srs).filter((id) => ChessSrs.dueBy(srs[id], at) && (!data || item(id)))
      .sort((a, b) => ChessSrs.entry(srs[a]).due - ChessSrs.entry(srs[b]).due);
  }

  /** after `id`: the next one not yet done in camp order, else the first due review */
  function next(id) {
    if (!data) return null;
    const eg = state();
    const all = data.ITEMS;
    const at = Math.max(0, all.findIndex((x) => x.id === id));
    for (let k = 1; k <= all.length; k++) {
      const x = all[(at + k) % all.length];
      if (!eg.done[x.id]) return x.id;
    }
    return due().find((x) => x !== id) || null;
  }

  function doneCount(g) {
    const eg = state();
    return data ? data.ITEMS.filter((x) => (!g || x.g === g) && eg.done[x.id]).length : 0;
  }
  const total = () => (data ? data.ITEMS.length : 0);
  /** How many endgames group `g` holds (9.0 S1's 继续 card). */
  const groupSize = (g) => (data ? data.ITEMS.filter((x) => x.g === g).length : 0);

  /** The camp's part of the lesson list, after the classics; fetched on first draw. */
  function renderList(list, curId) {
    if (!data) { ensure(); return; }
    const eg = state();
    const soon = new Set(due());
    let n = 0;
    for (const gr of data.GROUPS) {
      const h = document.createElement("div");
      h.className = "lesson-part";
      h.textContent = tdot(t("eg.camp"), tf("ui.pair", [word(gr.n), doneCount(gr.id) + "/" + data.ITEMS.filter((x) => x.g === gr.id).length]));
      list.appendChild(h);
      for (const x of data.ITEMS) {
        if (x.g !== gr.id) continue;
        n++;
        const b = document.createElement("button");
        b.type = "button";
        b.className = "lesson-item" + (x.id === curId ? " current" : "");
        b.dataset.eg = x.id;
        const mark = soon.has(x.id) ? "↻ " : eg.done[x.id] ? "✓ " : "";
        b.textContent = tdot(mark + n + ". " + word(x.n), t(x.goal === "draw" ? "eg.draw" : "eg.win"));
        if (soon.has(x.id)) b.title = t("eg.dueTip");
        list.appendChild(b);
      }
    }
  }

  /**
   * 「我的」: the camp's section — per theme done/total and what is due.
   * Drawn from the first visit, at 0/90. 9.0 S3: a record only; the way in
   * is 训练 · 残局. Hidden only until its chunk is here.
   */
  function renderMe() {
    const sec = document.getElementById("sec-endgame");
    if (!sec) return;
    const eg = state();
    if (!data) { meLater = true; sec.hidden = true; ensure(); return; }
    sec.hidden = false;
    const meta = document.getElementById("eg-meta");
    if (meta) meta.textContent = doneCount() + "/" + total();
    const body = document.getElementById("eg-body");
    body.replaceChildren(...data.GROUPS.map((gr) => {
      const row = document.createElement("div");
      row.className = "stat-row";
      const k = document.createElement("span");
      k.className = "stat-k";
      k.textContent = word(gr.n);
      const v = document.createElement("span");
      v.className = "stat-v num";
      v.textContent = doneCount(gr.id) + "/" + data.ITEMS.filter((x) => x.g === gr.id).length;
      row.append(k, v);
      return row;
    }));
    // 9.0 S3: a record, not a second way in — the camp is 训练 · 残局; what
    // is due is a line here (and ↻ in that catalog)
    const soon = due();
    if (soon.length) {
      const row = document.createElement("div");
      row.className = "stat-row";
      const k = document.createElement("span");
      k.className = "stat-k";
      k.textContent = tf("eg.reviewN", [soon.length]);
      row.appendChild(k);
      body.appendChild(row);
    }
  }

  return { ensure, ready, whenReady, resumeId, item, lesson, record, due, next, doneCount, total, groupSize, renderList, renderMe, state };
}
