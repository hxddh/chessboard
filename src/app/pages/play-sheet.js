/**
 * The new-game sheet: opponent, colour, clock, the coach's question, start.
 * Over the board, not a page; at most 12 controls (v20-0-plan §3 P4).
 * @module pages/play-sheet
 */
import { h } from "../lib/dom.js";
import { OPPONENTS } from "../core/opponents.js";
import { PRESET_IDS } from "../core/clock.js";

/**
 * @param {object} o
 * @param {Function} o.t
 * @param {{ opponent, color, tc, coach }} o.last  what the previous game used
 * @param {(choice) => void} o.onStart
 * @param {() => void} o.onClose
 */
export function openSheet(host, { t, last, onStart, onClose }) {
  const pick = { ...last };
  const opps = OPPONENTS.map((op) => {
    const b = h("button", { type: "button", class: "opp", "data-test": "opp-" + op.id, "aria-pressed": String(pick.opponent === op.id),
      onclick: () => { pick.opponent = op.id; sync(); } },
      h("strong", { text: t("opp." + op.id) }), h("small", { text: op.rating ? String(op.rating) : t("opp.friend.note") }));
    return [op.id, b];
  });
  const colors = ["w", "random", "b"].map((c) => [c, h("button", { type: "button", "data-test": "color-" + c,
    onclick: () => { pick.color = c; sync(); } }, t("color." + c))]);
  const clock = h("select", { "data-test": "clock", onchange: (e) => { pick.tc = e.target.value; } },
    PRESET_IDS.map((id) => h("option", { value: id }, id === "none" ? t("clock.none") : id)));
  clock.value = pick.tc || "none";
  const coach = h("input", { type: "checkbox", "data-test": "coach", onchange: (e) => { pick.coach = e.target.checked; } });
  coach.checked = !!pick.coach;
  const start = h("button", { type: "button", class: "primary", "data-test": "start", onclick: () => { close(); onStart({ ...pick }); } }, t("new.start"));
  const cancel = h("button", { type: "button", class: "quiet", "data-test": "sheet-close", "aria-label": t("act.cancel"), onclick: () => { close(); onClose(); } }, "×");

  const colorRow = h("div", { class: "seg" }, colors.map(([, b]) => b));
  const sheet = h("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": t("new.title"), "data-test": "sheet" },
    h("header", {}, h("h2", { text: t("new.title") }), cancel),
    h("div", { class: "opps" }, opps.map(([, b]) => b)),
    h("div", { class: "sheet-row" }, h("span", { text: t("new.color") }), colorRow),
    h("label", { class: "sheet-row" }, h("span", { text: t("new.clock") }), clock),
    h("label", { class: "sheet-row" }, h("span", { text: t("new.coach") }), coach),
    start);
  const scrim = h("div", { class: "scrim", onclick: (e) => { if (e.target === scrim) { close(); onClose(); } } }, sheet);

  function sync() {
    for (const [id, b] of opps) b.setAttribute("aria-pressed", String(pick.opponent === id));
    const friend = pick.opponent === "friend";
    for (const [c, b] of colors) { b.setAttribute("aria-pressed", String(pick.color === c)); b.disabled = friend; }
    coach.disabled = friend;
  }
  function onKey(e) { if (e.key === "Escape") { close(); onClose(); } }
  function close() { scrim.remove(); removeEventListener("keydown", onKey); }
  addEventListener("keydown", onKey);
  sync();
  host.append(scrim);
  start.focus();
  return close;
}
