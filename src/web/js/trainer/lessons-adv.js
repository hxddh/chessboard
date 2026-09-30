/**
 * 进阶课程第三部的外壳（v8-2-plan T1）：目录与分块。
 *
 * The 24 lessons — 计算 12, 局面型 12 — are js/chunk-lessons-adv.js
 * (lessons-adv-chunk.js), words in all three languages; this module is what
 * the bundle keeps of them: their ids, in course order. Each id stands in
 * the lesson list as a placeholder whose part, title, text and tasks read
 * through to the chunk once it is here, so the course is 120 lessons long
 * from the first frame — progress (完成 N/120), the 全部课程 badge, 今天的训练's
 * next lesson and the saved bookmark all count the same before and after
 * the fetch. Reading a placeholder's words is what asks for the chunk: the
 * lesson list in 学习, or the home page naming the next lesson.
 *
 * Progress needs nothing new: a finished advanced lesson is `learn.done[id]`
 * like any other.
 * @module trainer/lessons-adv
 */
import { loadChunk } from "../chunk.js";

/** chunk file and global — scripts/bundle.mjs builds lessons-adv-chunk.js into it */
export const ADV_CHUNK = { file: "chunk-lessons-adv.js", global: "CHESS_LESSONS_ADV" };

/** The ids in course order; test-chess holds them to the chunk's lessons. */
export const ADV_IDS = [
  "cl-cands", "cl-order", "cl-checks", "cl-count", "cl-quiet", "cl-replies",
  "cl-threat", "cl-end", "cl-inter", "cl-race", "cl-mate", "cl-guard",
  "po-badb", "po-trap", "po-color", "po-hole", "po-outpost", "po-chain",
  "po-major", "po-file", "po-behind", "po-kpend", "po-trade", "po-prophy",
];

/**
 * @param {() => void} onReady the chunk arrived — repaint whoever asked
 * @returns {{stubs: object[], ensure: () => void, ready: () => boolean}}
 */
export function createAdvLessons(onReady) {
  let byId = null;
  let asked = null;
  /**
   * Start the fetch once. After the frame that asked, not during it — the
   * endgame camp's rule (trainer/endgames.js): a session restored into 学习
   * reads the list in its first frame, and F5's first paint fetches no chunk
   * but the boot one.
   */
  function ensure() {
    if (byId || asked) return;
    asked = new Promise((r) => (typeof requestAnimationFrame === "function"
      ? requestAnimationFrame(() => setTimeout(r, 0)) : setTimeout(r, 0)))
      .then(() => loadChunk(ADV_CHUNK.file, ADV_CHUNK.global))
      .then((m) => {
        byId = new Map(m.lessons.map((L) => [L.id, L]));
        onReady();
      }, () => { asked = null; }); // a failed load is retried next time something asks
  }
  const src = (id) => (byId ? byId.get(id) : (ensure(), null));
  const stub = (id) => ({
    id,
    get part() { const L = src(id); return L ? L.part : ""; },
    get title() { const L = src(id); return L ? L.title : ""; },
    get text() { const L = src(id); return L ? L.text : []; },
    get tasks() { const L = src(id); return L ? L.tasks : []; },
  });
  return { stubs: ADV_IDS.map(stub), ensure, ready: () => !!byId };
}
