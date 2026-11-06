/** 设置 — the look, for now: appearance, board, pieces. */
import { h } from "../lib/dom.js";
import { effect } from "../lib/signal.js";
import { PIECE_SET_IDS, BOARD_THEMES } from "../core/pieces.js";

const LABEL = {
  appearance: "外观", boardTheme: "棋盘", pieceSet: "棋子",
  system: "跟随系统", light: "浅色", dark: "深色", wood: "木纹", green: "绿", blue: "蓝",
  merida: "Merida", cburnett: "Burnett", classic: "经典",
};

export function mount(el, { store }) {
  const settings = store.select((s) => s.settings);
  const field = (key, options) => {
    const sel = h("select", { "data-test": "set-" + key, onchange: (e) => store.dispatch("settings.set", { key, value: e.target.value }) },
      options.map((o) => h("option", { value: o }, LABEL[o] || o)));
    return { row: h("label", { class: "field" }, h("span", { text: LABEL[key] }), sel), sel, key };
  };
  const fields = [field("appearance", ["system", "light", "dark"]), field("boardTheme", BOARD_THEMES), field("pieceSet", PIECE_SET_IDS)];
  el.append(h("div", { class: "placeholder" }, h("h1", { text: "设置" }), ...fields.map((f) => f.row)));
  return effect(() => { const s = settings.value; for (const f of fields) f.sel.value = s[f.key]; });
}
