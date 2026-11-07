/**
 * What an opponent is called and says, in a language: Chinese here, English
 * and Japanese in their pack (text/lang.js). `_` holds the lines a person
 * without their own says; `say` joins a name and a line.
 * @module opponents/lines
 */
import { getLang, pack } from "../text/lang.js";
import zh from "./lines.zh.js";

const dict = (lang) => (lang !== "zh" && pack(lang) ? pack(lang).lines : zh);

/** `key` of opponent `id` (name, note, hello, react, won, lost, drawn, resign), or "" */
export function oppText(id, key, lang = getLang()) {
  const d = dict(lang);
  const own = d[id] && d[id][key];
  if (own != null) return own;
  if (key === "name" || key === "note") return "";
  return (d._ && d._[key]) || "";
}

/** "皮普：我刚学会马怎么走！" · "Pip: I just learned how the knight moves!" */
export const sayLine = (id, key, lang = getLang()) => {
  const line = oppText(id, key, lang);
  return line ? (dict(lang)._.say || "{0}：{1}").replace(/\{([01])\}/g, (_, i) => (i === "0" ? oppText(id, "name", lang) : line)) : "";
};
