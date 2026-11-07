/** 设置 — the language, the look, the sound, and the coach. */
import { h } from "../lib/dom.js";
import { effect } from "../lib/signal.js";
import { PIECE_SET_IDS, BOARD_THEMES } from "../core/pieces.js";
import { LEVELS } from "../state/settings.js";
import { LANGS, LANG_NAMES } from "../text/lang.js";
import { learnText } from "../text/learn.js";

/**
 * An option's label: the language's own name for a language, else set.<value>.
 * A piece set added without a label (core/pieces.js) is named from its id —
 * "alpha" → "Alpha", "pixel-art" → "Pixel art": a set's name is a proper
 * name, the same in every language — never the raw id.
 */
export function optionLabel(t, key, o) {
  if (key === "lang") return LANG_NAMES[o] || String(o);
  if (t.has("set." + o)) return t("set." + o);
  if (key === "pieceSet") {
    const words = String(o).split(/[-_\s]+/).filter(Boolean).join(" ");
    return words ? words[0].toUpperCase() + words.slice(1) : String(o);
  }
  return String(o);
}

export function mount(el, { store }) {
  const t = learnText();
  const settings = store.select((s) => s.settings);
  const label = (key, o) => optionLabel(t, key, o);
  const field = (key, options, parse = (v) => v) => {
    const sel = h("select", { "data-test": "set-" + key, onchange: (e) => store.dispatch("settings.set", { key, value: parse(e.target.value) }) },
      options.map((o) => h("option", { value: o, ...(key === "lang" ? { lang: o === "zh" ? "zh-CN" : o } : {}) }, label(key, o))));
    return { row: h("label", { class: "field" }, h("span", { text: t("set." + key) }), sel), sel, key };
  };
  const fields = [field("lang", LANGS), field("appearance", ["system", "light", "dark"]), field("boardTheme", BOARD_THEMES), field("pieceSet", PIECE_SET_IDS),
    field("sound", ["on", "off"]), field("level", LEVELS, Number), field("coach", ["auto", "on", "off"])];
  el.append(h("div", { class: "placeholder" }, h("h1", { text: t("set.title") }), ...fields.map((f) => f.row)));
  return effect(() => { const s = settings.value; for (const f of fields) f.sel.value = String(s[f.key]); });
}
