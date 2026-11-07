/**
 * Imported games as the background review and the library list see them
 * (library/autoreview.js, library/list.js) — no engine, no DOM: which games
 * to review now, a row's date, a row replayed into the review's game.
 * @module library/records
 */
import { START_FEN } from "../core/rules.js";
import { Chess } from "../core/chess.js";

export const AUTO_RECENT = 20;
export const AUTO_PER_DAY = 5;
export const AUTO_MIN_PLIES = 10;
const DAY = 86400000;

/** A library row's date as ms: the PGN's Date tag (missing month or day: the first), else when it was played or imported. */
export function dateOf(rec) {
  const m = /^(\d{4})(?:[.\-/](\d{1,2}|\?\?))?(?:[.\-/](\d{1,2}|\?\?))?/.exec(rec.date || "");
  if (m && Number(m[1]) > 1000) {
    const mo = Number(m[2]) || 1, d = Number(m[3]) || 1;
    return Date.UTC(Number(m[1]), mo - 1, d);
  }
  return Number.isFinite(rec.playedAt) ? rec.playedAt : Number.isFinite(rec.importedAt) ? rec.importedAt : 0;
}

/**
 * The games to review now, from the library's rows: newest first, at most as
 * many as today still allows.
 * @param {object[]} rows  library rows
 * @param {number} now
 * @param {number} [tz]    minutes west of UTC, where a day starts
 */
export function pickGames(rows, now, tz = 0) {
  const day = (at) => Math.floor((at - tz * 60000) / DAY);
  const doneToday = rows.filter((r) => r.analysed && r.analysed.auto && day(r.analysed.at) === day(now)).length;
  const left = Math.max(0, AUTO_PER_DAY - doneToday);
  if (!left) return [];
  const recent = rows.filter((r) => (r.you === "w" || r.you === "b") && r.plies >= AUTO_MIN_PLIES)
    .sort((a, b) => dateOf(b) - dateOf(a) || (a.id < b.id ? -1 : 1)).slice(0, AUTO_RECENT);
  return recent.filter((r) => !r.analysed).slice(0, left);
}

/** A library row as the review's game: { id, startFen, moves: [{ san, fen, uci }] } (null if a move does not replay). */
export function gameOfRecord(rec) {
  const startFen = rec.startFen || START_FEN;
  const moves = [];
  let g;
  try { g = new Chess(startFen); } catch { return null; }
  for (const san of String(rec.sans || "").split(" ").filter(Boolean)) {
    let m = null;
    try { m = g.move(san); } catch { m = null; }
    if (!m) return null;
    moves.push({ san: m.san, uci: m.from + m.to + (m.promotion || ""), fen: g.fen() });
  }
  return { id: rec.id, startFen, moves };
}

