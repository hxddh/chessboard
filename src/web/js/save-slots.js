/**
 * 存档槽 → 棋谱库 (19.0 S7).
 *
 * Through 18.0 the ⋯ menu had five save slots: store the game on the board,
 * load it back later. The game history and the library do the same job (keep
 * a game, open it again), so 19.0 took the slots out. A profile that has
 * games in `chess.slots` gets them once, at launch, as library games tagged
 * 旧存档槽 n — where every other kept game already is, searchable and
 * openable from 我的. Not into the play history: that is the record of rated
 * games against the engine, and a slot held two-player games and set-ups too.
 *
 * A slot is cleared only once the library has taken its game. A slot whose
 * game has no moves (a set-up position parked before the first move) cannot
 * be a library game — the library keeps a mainline — and it stays where it
 * was, in `chess.slots`, so 导出全部数据 still carries it.
 * @module save-slots
 */

/** The slot's PGN with its Event tag naming the slot it came from. */
function tagged(pgn, label) {
  const text = String(pgn || "").trim();
  const ev = '[Event "' + label.replace(/["\\]/g, "") + '"]';
  return /^\[Event\s+"[^"]*"\]/m.test(text) ? text.replace(/^\[Event\s+"[^"]*"\]/m, ev) : ev + "\n" + text;
}

/** A PGN's movetext has at least one move (anything past the tags and the result). */
function hasMoves(pgn) {
  const body = String(pgn || "").replace(/^\s*\[[^\]]*\]\s*$/gm, "").replace(/\{[^}]*\}/g, " ")
    .replace(/\b(1-0|0-1|1\/2-1\/2)\b|\*/g, " ").replace(/\d+\.(\.\.)?/g, " ").trim();
  return body.length > 0;
}

/**
 * @param {object} d {Persist, t, tf, importPgnToLibrary}
 * @returns {Promise<number>} how many slots went into the library
 */
export async function migrateSlots(d) {
  const st = d.Persist.read("slots").value;
  if (!st || !Array.isArray(st.slots)) return 0;
  const moving = st.slots.map((s, i) => (s && s.pgn && hasMoves(s.pgn) ? i : -1)).filter((i) => i >= 0);
  if (!moving.length) return 0;
  const text = moving.map((i) => tagged(st.slots[i].pgn, d.tf("slots.legacyN", [i + 1]))).join("\n\n");
  const r = await d.importPgnToLibrary(text, d.t("slots.legacy"), { wait: true });
  if (!r) return 0;   // refused or unreadable: the slots stay, the next launch tries again
  const left = st.slots.map((s, i) => (moving.includes(i) ? null : s));
  if (left.some(Boolean)) d.Persist.setJson("slots", { v: 1, slots: left });
  else d.Persist.remove("slots");
  return moving.length;
}

export const SaveSlotsTest = { tagged, hasMoves };
