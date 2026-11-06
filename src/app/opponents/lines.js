/**
 * What an opponent is called and says, in a language (Chinese for now; a
 * language is one more dictionary here). `_` holds the lines a person
 * without their own says.
 * @module opponents/lines
 */
import zh from "./lines.zh.js";

const DICTS = { zh };

/** `key` of opponent `id` (name, note, hello, react, won, lost, drawn, resign), or "" */
export function oppText(id, key, lang = "zh") {
  const d = DICTS[lang] || zh;
  const own = d[id] && d[id][key];
  if (own != null) return own;
  if (key === "name" || key === "note") return "";
  return (d._ && d._[key]) || "";
}

/** "皮普：我刚学会马怎么走！" */
export const sayLine = (id, key, lang) => {
  const line = oppText(id, key, lang);
  return line ? oppText(id, "name", lang) + "：" + line : "";
};
