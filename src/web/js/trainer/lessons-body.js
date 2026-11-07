/**
 * The course's first two parts, split into what 学习 lists and what a lesson
 * plays (14.0 E, docs/v14-0-plan.md §3).
 *
 * lessons.js is 120 KB, and the first paint read all of it: every lesson's
 * paragraphs, prompts, positions and solutions, to draw a list of titles and
 * the home page's next-lesson card. The bundle (scripts/bundle.mjs) now puts
 * an index in its place — per lesson the id, part, title, practice motif,
 * how many tasks and the first task's position (lessonIndex below) — and the
 * paragraphs and tasks are js/chunk-lessons-body.js (lessons-body-chunk.js),
 * fetched the first time a lesson is opened.
 *
 * Each index entry reads its `text` and `tasks` through to the chunk once it
 * is here; until then they are empty, and `n` / `fen0` answer what the list
 * and the cards ask. The tests compile trainer/lessons.js without the bundle,
 * so they hand this the full lessons: then everything is here from the start.
 * @module trainer/lessons-body
 */
import { loadChunk } from "../chunk.js";

/** chunk file and global — scripts/bundle.mjs builds lessons-body-chunk.js into it */
export const BODY_CHUNK = { file: "chunk-lessons-body.js", global: "CHESS_LESSONS_BODY" };

/** What the first paint keeps of each lesson. */
export function lessonIndex(list) {
  return list.map((L) => {
    const o = { id: L.id, part: L.part, title: L.title, n: L.tasks.length, fen0: L.tasks[0] ? L.tasks[0].fen : null };
    if (L.practice) o.practice = L.practice;
    return o;
  });
}

/** What the chunk carries: id → the lesson's paragraphs and tasks. */
export function lessonBodies(list) {
  const out = {};
  for (const L of list) out[L.id] = { text: L.text, tasks: L.tasks };
  return out;
}

/**
 * @param {object[]} list lessons.js's lessons, or the bundle's index of them
 * @param {() => void} onFail the chunk did not load for a lesson asked for
 * @returns {{lessons: object[], ready: () => boolean, want: (fn: () => void) => void}}
 */
export function createLessonBodies(list, onFail) {
  if (list.every((L) => Array.isArray(L.tasks))) {
    return {
      lessons: list.map((L) => Object.assign({ n: L.tasks.length, fen0: L.tasks[0] ? L.tasks[0].fen : null }, L)),
      ready: () => true,
      want: (fn) => fn(),
    };
  }
  let byId = null, asked = null, then = null;
  function ensure() {
    if (byId || asked) return;
    asked = loadChunk(BODY_CHUNK.file, BODY_CHUNK.global).then((m) => {
      byId = m;
      const fn = then;
      then = null;
      if (fn) fn();
    }, () => {
      asked = null; // retried the next time a lesson is opened
      if (then) { then = null; if (onFail) onFail(); }
    });
  }
  const body = (id) => (byId && byId[id]) || null;
  const lessons = list.map((ix) => Object.defineProperties(Object.assign({}, ix), {
    text: { get() { const b = body(ix.id); return b ? b.text : []; }, enumerable: true },
    tasks: { get() { const b = body(ix.id); return b ? b.tasks : []; }, enumerable: true },
  }));
  /** run `fn` once the chunk is here — now, if it is; only the latest waits */
  function want(fn) {
    if (byId) { fn(); return; }
    then = fn;
    ensure();
  }
  return { lessons, ready: () => !!byId, want };
}
