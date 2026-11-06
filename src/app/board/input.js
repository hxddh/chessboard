/**
 * The board's input, as a pure state machine: pointer and key events in,
 * commands out. The DOM wiring is in board.js; this file decides what a
 * click, a drag, a right-drag or a key means.
 *
 *   left click      select a piece of the side that may move; click a hint to move
 *   drag            past 3 px it is a drag: the piece follows, a ghost stays
 *   right click     toggle a mark on a square; right-drag toggles an arrow
 *                   (no modifier green, Shift red, Alt blue, Shift+Alt yellow)
 *   keys            arrows move a cursor, Enter/Space click on it, Escape cancels
 *   premove         a piece of the side waiting may be given a move in advance
 *
 * Commands returned: { type: "move", from, to, drop } and { type: "shapes" }.
 * @module board/input
 */
import { DRAG_THRESHOLD_PX } from "./tween.js";
import { sqFile, sqRank, sqName, onBoard } from "./geometry.js";

/**
 * @param {object} rules
 * @param {(sq: string) => "move"|"premove"|null} rules.canPick what picking the man on sq would mean
 * @param {(from: string) => string[]} rules.dests legal destinations now
 * @param {(from: string) => string[]} rules.premoveDests destinations for a premove
 * @param {() => "white"|"black"} rules.orientation
 */
export function createInput(rules) {
  const s = {
    selected: null,     // { sq, mode: "move"|"premove" }
    drag: null,         // { from, x0, y0, x, y, active, over }
    premove: null,      // { from, to }
    cursor: null,       // square, once a key has been used
    shapes: { arrows: [], marks: [] },
    right: null,        // square where a right press started
  };
  let toggleOff = false; // pressing the selected man again deselects it on release

  const targets = () => !s.selected ? [] :
    s.selected.mode === "move" ? rules.dests(s.selected.sq) : rules.premoveDests(s.selected.sq);

  function shapeColor(m = {}) {
    if (m.shiftKey && m.altKey) return "Y";
    if (m.shiftKey) return "R";
    if (m.altKey) return "B";
    return "G";
  }

  /** Try `to` as the target of the current selection. */
  function tryTarget(to, drop) {
    const sel = s.selected;
    if (!sel || !to || to === sel.sq || !targets().includes(to)) return null;
    s.selected = null;
    if (sel.mode === "move") return { type: "move", from: sel.sq, to, drop };
    s.premove = { from: sel.sq, to };
    return { type: "premove", from: sel.sq, to };
  }

  function down(sq, x, y, button = 0, mods = {}) {
    const out = [];
    if (button === 2) {
      s.right = sq;
      s.selected = null;
      s.premove = null;
      return out;
    }
    if (s.shapes.arrows.length || s.shapes.marks.length) {
      s.shapes = { arrows: [], marks: [] };
      out.push({ type: "shapes" });
    }
    if (!sq) { s.selected = null; return out; }
    // another man of one's own is picked up rather than taken as a premove target
    const mode = rules.canPick(sq);
    const hit = mode ? null : tryTarget(sq, false);
    if (hit) { out.push(hit); return out; }
    if (mode) {
      toggleOff = !!s.selected && s.selected.sq === sq;
      s.selected = { sq, mode };
      if (mode === "move") s.premove = null;
      s.drag = { from: sq, x0: x, y0: y, x, y, active: false, over: sq };
    } else {
      s.selected = null;
      s.premove = null;
    }
    return out;
  }

  function move(sq, x, y) {
    const d = s.drag;
    if (!d) return false;
    d.x = x; d.y = y; d.over = sq;
    if (!d.active && Math.hypot(x - d.x0, y - d.y0) >= DRAG_THRESHOLD_PX) { d.active = true; toggleOff = false; }
    return d.active;
  }

  function up(sq, x, y, button = 0, mods = {}) {
    const out = [];
    if (button === 2) {
      const from = s.right;
      s.right = null;
      if (!from || !sq) return out;
      const color = shapeColor(mods);
      if (from === sq) {
        const i = s.shapes.marks.findIndex((m) => m.sq === sq && m.color === color);
        const marks = s.shapes.marks.filter((m) => m.sq !== sq);
        if (i < 0) marks.push({ sq, color });
        s.shapes = { ...s.shapes, marks };
      } else {
        const i = s.shapes.arrows.findIndex((a) => a.from === from && a.to === sq && a.color === color);
        const arrows = s.shapes.arrows.filter((a) => !(a.from === from && a.to === sq));
        if (i < 0) arrows.push({ from, to: sq, color });
        s.shapes = { ...s.shapes, arrows };
      }
      out.push({ type: "shapes" });
      return out;
    }
    const d = s.drag;
    s.drag = null;
    if (!d) return out;
    if (d.active) {
      const hit = tryTarget(sq, true);
      if (hit) out.push(hit);
      else if (sq !== d.from) s.selected = null;
    } else if (toggleOff) {
      s.selected = null;
    }
    toggleOff = false;
    return out;
  }

  function cancel() { s.drag = null; s.right = null; toggleOff = false; }

  /** @returns {{ handled: boolean, commands: object[] }} */
  function key(k, origin = "e2") {
    const white = rules.orientation() !== "black";
    const step = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[k];
    if (step) {
      const c = s.cursor || (s.selected && s.selected.sq) || (white ? origin : origin.replace("2", "7"));
      const f = sqFile(c) + (white ? step[0] : -step[0]), r = sqRank(c) + (white ? step[1] : -step[1]);
      s.cursor = onBoard(f, r) ? sqName(f, r) : c;
      return { handled: true, commands: [] };
    }
    if (k === "Enter" || k === " ") {
      if (!s.cursor) { s.cursor = white ? origin : origin.replace("2", "7"); return { handled: true, commands: [] }; }
      const commands = down(s.cursor, 0, 0);
      commands.push(...up(s.cursor, 0, 0));
      return { handled: true, commands };
    }
    if (k === "Escape") {
      const had = !!(s.selected || s.premove);
      s.selected = null; s.premove = null;
      return { handled: had, commands: [] };
    }
    return { handled: false, commands: [] };
  }

  /**
   * The position changed. A premove whose turn has come is played if it is
   * legal now and dropped otherwise; a selection that is no longer pickable goes.
   */
  function positionChanged() {
    if (s.selected && rules.canPick(s.selected.sq) !== s.selected.mode) s.selected = null;
    const pm = s.premove;
    if (!pm) return [];
    if (rules.canPick(pm.from) !== "move") return [];
    s.premove = null;
    return rules.dests(pm.from).includes(pm.to) ? [{ type: "move", from: pm.from, to: pm.to, drop: false, premove: true }] : [];
  }

  function setShapes(shapes) { s.shapes = { arrows: [...(shapes.arrows || [])], marks: [...(shapes.marks || [])] }; }

  return { state: s, targets, down, move, up, cancel, key, positionChanged, setShapes,
    clearPremove() { s.premove = null; }, deselect() { s.selected = null; } };
}
