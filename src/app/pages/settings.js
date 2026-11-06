/** 设置 — the look, the sound, and the coach. */
import { h } from "../lib/dom.js";
import { effect } from "../lib/signal.js";
import { PIECE_SET_IDS, BOARD_THEMES } from "../core/pieces.js";
import { LEVELS } from "../state/settings.js";

const LABEL = {
  appearance: "外观", boardTheme: "棋盘", pieceSet: "棋子", sound: "声音", coach: "落子前提醒", level: "我的水平",
  system: "跟随系统", light: "浅色", dark: "深色", wood: "木纹", green: "绿", blue: "蓝",
  merida: "Merida", cburnett: "Burnett", classic: "经典", on: "开", off: "关", auto: "按水平",
  600: "刚入门", 1000: "会下棋", 1500: "俱乐部", 2000: "很强",
};

export function mount(el, { store }) {
  const settings = store.select((s) => s.settings);
  const field = (key, options, parse = (v) => v) => {
    const sel = h("select", { "data-test": "set-" + key, onchange: (e) => store.dispatch("settings.set", { key, value: parse(e.target.value) }) },
      options.map((o) => h("option", { value: o }, LABEL[o] || String(o))));
    return { row: h("label", { class: "field" }, h("span", { text: LABEL[key] }), sel), sel, key };
  };
  const fields = [field("appearance", ["system", "light", "dark"]), field("boardTheme", BOARD_THEMES), field("pieceSet", PIECE_SET_IDS),
    field("sound", ["on", "off"]), field("level", LEVELS, Number), field("coach", ["auto", "on", "off"])];
  el.append(h("div", { class: "placeholder" }, h("h1", { text: "设置" }), ...fields.map((f) => f.row)));
  return effect(() => { const s = settings.value; for (const f of fields) f.sel.value = String(s[f.key]); });
}
