/** 学 — the skill map and today's lesson come here (v20-0-plan §2). */
import { h } from "../lib/dom.js";

export function mount(el) {
  el.append(h("div", { class: "placeholder" }, h("h1", { text: "学" }), h("p", { text: "技能图与今日一课，下一步。" })));
}
