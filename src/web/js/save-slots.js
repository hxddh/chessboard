/**
 * 存档位：五个有名字的位置，把棋盘上的这一局存起来、再取回来。
 *
 * 14.0 E: moved out of app.js, bodies unchanged. The autosave holds exactly
 * one game, so studying a second position meant losing the first. Slots are
 * explicit, user-named storage on top of it.
 *
 * Everything it needs from the app arrives in the bag handed to
 * `createSaveSlots()`, createLibraryUI's shape; nothing here reaches back
 * into app.js.
 * @module save-slots
 */
import { ChessPgn } from "./pgn.js";
import { tdot } from "./tdot.js";

/**
 * @param {object} d everything this module borrows from app.js
 */
export function createSaveSlots(d) {
  const {
    doc, store, Persist, t, tf, toast, Dlg, I18n, diffName, moveCount, sanHistory, startFen, pgnForExport, importPgnText,
  } = d;

  // The autosave holds exactly one game, so studying a second position meant
  // losing the first. Slots are explicit, user-named storage on top of it.
  const SLOT_COUNT = 5;

  function loadSlots() {
    const s = Persist.read("slots").value;
    return s || { v: 1, slots: new Array(SLOT_COUNT).fill(null) };
  }
  function saveSlots(s) {
    Persist.setJson("slots", s);
  }

  /**
   * A slot's one-line description, localised *at render time*.
   *
   * Slots store the mode and difficulty ids rather than a finished label, so a
   * game saved in Chinese still reads as English after a language switch.
   */
  /**
   * A slot in two lines, the same shape the game-history rows use: what kind
   * of game it is on the first, how long and when on the second.
   *
   * All four facts used to share the second line — 「Engine · Unrated · 3
   * moves · 8/2/2026, 8:59:30 AM」 — and in English it did not fit: 249px of
   * text into 228, so the two filled slots stood 71px and 87px against the
   * three empty ones' 55. Five identical things in three heights, in a dialog
   * whose whole job is to let you compare them.
   *
   * The timestamp is short-form too. A bare toLocaleString() carries seconds
   * in English; the history dialog next door shows a clock to the minute, and
   * a save does not need the second it was written.
   */
  function slotWhat(slot) {
    if (!slot) return "";
    if (!slot.mode) return "";
    return tdot(t(slot.mode === "ai" ? "mode.ai" : "mode.pvp"), slot.mode === "ai" && diffName(slot.diff));
  }
  function slotWhen(slot) {
    if (!slot) return t("slots.empty");
    const s = ChessPgn.summary(slot.pgn);
    const when = slot.savedAt
      ? I18n.fmtDate(slot.savedAt, { dateStyle: "short", timeStyle: "short" })
      : "";
    const moves = s && s.plies ? moveCount(Math.ceil(s.plies / 2)) : "";
    return [moves, when].filter(Boolean).join(" · ");
  }

  function renderSlots() {
    const list = doc.getElementById("slots-list");
    if (!list) return;
    const st = loadSlots();
    list.replaceChildren();
    for (let i = 0; i < SLOT_COUNT; i++) {
      const slot = st.slots[i];
      const row = doc.createElement("div");
      // the same row the history list is built from, by class rather than by
      // two inline styles restating it — `style.cssText` is a blind spot the
      // stylesheet's guards cannot reach, which is where 2.1.2's off-scale
      // values were found hiding in the markup
      row.className = "pick-row";
      const load = doc.createElement("button");
      load.type = "button";
      load.className = "pick-item";
      load.dataset.load = String(i);
      load.disabled = !slot;
      load.textContent = tdot(tf("slots.slotN", [i + 1]), slotWhat(slot));
      const sub = doc.createElement("span");
      sub.className = "pick-sub";
      sub.textContent = slotWhen(slot);
      load.appendChild(sub);
      const save = doc.createElement("button");
      save.type = "button";
      save.className = "tool-btn";
      save.dataset.save = String(i);
      save.textContent = t("slots.save");
      row.append(load, save);
      if (slot) {
        const del = doc.createElement("button");
        del.type = "button";
        del.className = "tool-btn";
        del.dataset.del = String(i);
        del.textContent = t("slots.delete");
        row.appendChild(del);
      }
      list.appendChild(row);
    }
  }

  function openSlots() {
    renderSlots();
    Dlg.open(doc.getElementById("slots-modal"));
  }
  function closeSlots() {
    Dlg.close(doc.getElementById("slots-modal"));
  }

  function saveToSlot(i) {
    // a set-up position with no moves yet is exactly the thing worth parking
    // in a slot, so "nothing to save" means neither moves nor a custom start
    if (!sanHistory().length && !startFen()) { toast(t("slots.nothing")); return; }
    const st = loadSlots();
    st.slots[i] = {
      pgn: pgnForExport(),
      savedAt: Date.now(),
      mode: store.session.mode,
      diff: store.session.difficulty,
    };
    saveSlots(st);
    renderSlots();
    toast(tf("slots.savedN", [i + 1]));
  }

  async function loadFromSlot(i) {
    const st = loadSlots();
    const slot = st.slots[i];
    if (!slot) return;
    closeSlots();
    const ok = await importPgnText(slot.pgn, tf("slots.slotN", [i + 1]),
      { msg: t("dlg.loadSlot"), title: t("dlg.loadSlotTitle"), ok: t("dlg.loadSlotOk") });
    if (ok) toast(tf("slots.loadedN", [i + 1]));
  }

  function deleteSlot(i) {
    const st = loadSlots();
    st.slots[i] = null;
    saveSlots(st);
    renderSlots();
    toast(tf("slots.deletedN", [i + 1]));
  }

  const modal = doc.getElementById("slots-modal");
  if (modal) {
    doc.getElementById("slots-open").onclick = () => {
      if (store.session.mode === "learn" || store.session.mode === "puzzle") { toast(t("msg.mode.needPlay"), "fix"); return; }
      openSlots();
    };
    doc.getElementById("slots-close").onclick = closeSlots;
    doc.getElementById("slots-list").onclick = (ev) => {
      const b = ev.target.closest("button");
      if (!b) return;
      if (b.dataset.save != null) saveToSlot(Number(b.dataset.save));
      else if (b.dataset.del != null) deleteSlot(Number(b.dataset.del));
      else if (b.dataset.load != null) loadFromSlot(Number(b.dataset.load));
    };
    modal.onclick = (ev) => { if (ev.target === modal) closeSlots(); };
  }

  return { open: openSlots, close: closeSlots };
}
