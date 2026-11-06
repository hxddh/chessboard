/**
 * The new-game sheet: opponent, colour, clock, the coach's question, start.
 * Over the board, not a page; at most 12 controls (v20-0-plan §3 P4).
 * @module pages/play-sheet
 */
import { h } from "../lib/dom.js";
import { LADDER, opponentById, DEFAULT_OPPONENT } from "../core/opponents.js";
import { oppText } from "../opponents/lines.js";
import { portrait } from "../opponents/portraits.js";
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
  // the opponent: one person at a time, stepped along the ladder (15 people
  // in three controls, so the sheet stays ≤ 12); 朋友 is two people at one board
  let at = Math.max(0, LADDER.findIndex((o) => o.id === (pick.opponent === "friend" ? DEFAULT_OPPONENT : opponentById(pick.opponent).id)));
  const face = h("span", { class: "opp-face" });
  const name = h("strong", { "data-test": "opp-name" }), rating = h("small", { "data-test": "opp-rating" });
  const noteEl = h("span", { class: "opp-note", "data-test": "opp-note" });
  const dots = h("span", { class: "opp-dots", "aria-hidden": "true" }, LADDER.map(() => h("i")));
  const card = h("div", { class: "opp-card", "data-test": "opp-card", "aria-live": "polite" },
    face, h("span", { class: "opp-text" }, h("span", { class: "opp-head" }, name, rating), noteEl, dots));
  const stepTo = (i) => { at = Math.max(0, Math.min(LADDER.length - 1, i)); pick.opponent = LADDER[at].id; sync(); };
  const prev = h("button", { type: "button", class: "quiet step", "data-test": "opp-prev", "aria-label": t("new.weaker"), onclick: () => stepTo(at - 1) }, "‹");
  const next = h("button", { type: "button", class: "quiet step", "data-test": "opp-next", "aria-label": t("new.stronger"), onclick: () => stepTo(at + 1) }, "›");
  const friendBtn = h("button", { type: "button", class: "friend", "data-test": "opp-friend",
    onclick: () => { pick.opponent = pick.opponent === "friend" ? LADDER[at].id : "friend"; sync(); } }, oppText("friend", "name"));
  if (pick.opponent !== "friend") pick.opponent = LADDER[at].id;
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
    h("div", { class: "opps" }, prev, card, next),
    h("div", { class: "sheet-row" }, h("span", { text: oppText("friend", "note") }), friendBtn),
    h("div", { class: "sheet-row" }, h("span", { text: t("new.color") }), colorRow),
    h("label", { class: "sheet-row" }, h("span", { text: t("new.clock") }), clock),
    h("label", { class: "sheet-row" }, h("span", { text: t("new.coach") }), coach),
    start);
  const scrim = h("div", { class: "scrim", onclick: (e) => { if (e.target === scrim) { close(); onClose(); } } }, sheet);

  function sync() {
    const friend = pick.opponent === "friend";
    const op = LADDER[at];
    card.dataset.id = friend ? "friend" : op.id;
    card.classList.toggle("off", friend);
    face.replaceChildren(portrait(op.id));
    name.textContent = oppText(op.id, "name");
    rating.textContent = String(op.rating);
    noteEl.textContent = oppText(op.id, "note");
    [...dots.children].forEach((d, i) => d.classList.toggle("on", i === at));
    prev.disabled = friend || at === 0;
    next.disabled = friend || at === LADDER.length - 1;
    friendBtn.setAttribute("aria-pressed", String(friend));
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
