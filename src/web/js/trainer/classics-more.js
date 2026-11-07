/**
 * 名局 10 → 40 局的外壳（v8-4-plan T2）：分块、目录的分组名、三语文字。
 *
 * The thirty further games are js/chunk-classics-more.js (classics-more-
 * chunk.js), words in all three languages; this module is all the bundle
 * keeps of them. The first time the lesson list draws it asks for the chunk
 * (after that frame, as the endgame camp does — trainer/endgames.js), and
 * on arrival appends the games to the catalog array trainer/lessons.js and
 * trainer/guess.js already index, so 读棋 and 名局猜着 both read them by
 * position, 10 to 39, exactly as they read the first ten. Each appended game
 * carries its translations (`tr.en`, `tr.ja`), which lessons.js classicText
 * reads before the language chunks' table.
 *
 * Nothing is saved by index: a guessed game's record is keyed by its id
 * (learnState.gs), and a run in progress is not saved at all, so the chunk
 * arriving late or not at all leaves nothing pointing past the first ten.
 * @module trainer/classics-more
 */
import { loadChunk } from "../chunk.js";

/** chunk file and global — scripts/bundle.mjs builds classics-more-chunk.js into it */
export const MORE_CHUNK = { file: "chunk-classics-more.js", global: "CHESS_CLASSICS_MORE" };
const LANG_AT = { "zh-CN": 0, en: 1, ja: 2 };
/** how many games the chunk appends — so a count can say 40 before it arrives
 * (10.0 M0: 今天 said 0/10 beside 训练's 全部 40 局); test-classics checks it */
export const MORE_COUNT = 30;

/**
 * @param {{store: object, list: object[], onReady: () => void}} d `list` is
 *   the catalog array the games are appended to; `onReady` repaints
 */
export function createMoreClassics(d) {
  const { store, list, onReady } = d;
  let groups = null;
  let asked = null;
  function ensure() {
    if (groups || asked) return;
    asked = new Promise((r) => (typeof requestAnimationFrame === "function"
      ? requestAnimationFrame(() => setTimeout(r, 0)) : setTimeout(r, 0)))
      .then(() => loadChunk(MORE_CHUNK.file, MORE_CHUNK.global))
      .then((m) => {
        if (groups) return;
        for (const g of m.games) list.push(Object.assign({}, g, { tr: { en: m.en[g.id], ja: m.ja[g.id] } }));
        groups = m.groups;
        onReady();
      }, () => { asked = null; }); // a failed load is retried the next time the list draws
  }
  /** an era's name in the interface language ("" before the chunk) */
  function groupName(id) {
    const gr = groups && groups.find((x) => x.id === id);
    return gr ? gr.n[LANG_AT[store.ui.langId] || 0] || gr.n[0] : "";
  }
  /** every classic, the chunk's thirty counted whether or not they are here yet */
  const total = () => (groups ? list.length : list.length + MORE_COUNT);
  return { ensure, groupName, ready: () => !!groups, total };
}
