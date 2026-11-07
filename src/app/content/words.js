/**
 * The content's words in the language showing: content/practice.js and
 * lessons.js hold the Chinese, content/words.<lang>.js the rest (by the same
 * ids, loaded with the language's pack — text/lang.js).
 *
 *   localItem(item)     the item with its prompt / retry / name / idea in the language
 *   lessonOf(id, zh)    a lesson's { title, text } in the language (zh: content/lessons.js's)
 * @module content/words
 */
import { getLang, pack } from "../text/lang.js";

export function localItem(item) {
  const p = item && getLang() !== "zh" && pack();
  const w = p && p.items && p.items[item.id];
  return w ? { ...item, ...w } : item;
}

export function lessonOf(id, zh) {
  const p = getLang() !== "zh" && pack();
  return (p && p.lessons && p.lessons[id]) || zh || null;
}
