/** 我 — the player's games and progress; for now the list of games in the db. */
import { h } from "../lib/dom.js";

export function mount(el, { ready }) {
  const list = h("ul", { class: "games", "data-test": "games" });
  el.append(h("div", { class: "placeholder" }, h("h1", { text: "我" }), list));
  let live = true;
  ready.then((db) => db.query("game.recent", { limit: 20 })).then((games) => {
    if (!live) return;
    list.replaceChildren(...games.map((g) => h("li", {},
      new Date(g.startedAt).toLocaleString() + " · " + (g.mode === "engine" ? "对电脑" : "双人") +
      (g.result ? " · " + g.result.result : ""))));
  });
  return () => { live = false; };
}
