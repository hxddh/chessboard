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

/** How long a wanted lesson waits for the chunk before the wait is given up (ms). */
export const ADV_WAIT_MS = 8000;

/**
 * @param {(wanted: number) => void} onReady the chunk arrived — repaint, or
 *   open lesson `wanted` (a course index, -1 for none) that was asked for early
 * @param {() => void} onFail a wanted lesson's chunk failed to load, or took
 *   longer than ADV_WAIT_MS: the lesson standing in stays (M2 review)
 * @returns {{stubs: object[], ensure: () => void, want: (i: number, alive?: () => boolean) => void, ready: () => boolean}}
 */
export function createAdvLessons(onReady, onFail) {
  let byId = null;
  let asked = null;
  let wanted = -1;
  /** 25.4: is the wanted lesson still wanted — the runner's learnRuns token */
  let still = null;
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
        const i = wanted, ok = !still || still();
        wanted = -1;
        onReady(ok ? i : -1);
      }, () => { asked = null; give(); }); // a failed load is retried next time something asks
  }
  function give() {
    if (wanted < 0) return;
    wanted = -1;
    // the player moved on (残局, 名局, another lesson): nothing to say
    if (onFail && (!still || still())) onFail();
  }
  const src = (id) => (byId ? byId.get(id) : (ensure(), null));
  const stub = (id) => ({
    id,
    get part() { const L = src(id); return L ? L.part : ""; },
    get title() { const L = src(id); return L ? L.title : ""; },
    get text() { const L = src(id); return L ? L.text : []; },
    get tasks() { const L = src(id); return L ? L.tasks : []; },
    get n() { const L = src(id); return L ? L.tasks.length : 0; },
    get fen0() { const L = src(id); return L && L.tasks[0] ? L.tasks[0].fen : null; },
  });
  /**
   * open course lesson `i` once the chunk is here; -1 forgets one asked for.
   * 25.4: `alive` says whether it is still wanted when the chunk comes — the
   * runner's learnRuns rule (trainer/lessons.js deferOpen), so a lesson asked
   * for before the player went to 残局 or 名局 does not take the board back
   */
  const want = (i, alive) => {
    wanted = i;
    still = alive;
    if (i < 0) return;
    ensure();
    setTimeout(() => { if (wanted === i && !byId) give(); }, ADV_WAIT_MS);
  };
  return { stubs: ADV_IDS.map(stub), ensure, want, ready: () => !!byId };
}
