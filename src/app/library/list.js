/**
 * The library list on 我 (pages/me-library.js), without the DOM: the games
 * imported (`library` rows) and the games played here and finished (`games`
 * rows) as one list, newest first; a search over the names, the event and
 * the date, a result filter (yours when it is known which side you were), a
 * year filter; pages of PAGE_SIZE so thousands of games are never thousands
 * of nodes. And 「这是你吗」's arithmetic: which games a name makes yours.
 * @module library/list
 */
import { dateOf } from "./records.js";

export const PAGE_SIZE = 30;
const RESULTS = new Set(["1-0", "0-1", "1/2-1/2"]);

/**
 * @param {object[]} library  library rows
 * @param {object[]} games    games rows (the unfinished ones are left out)
 * @param {(g: object) => { white: string, black: string }} namesOf  a played game's two sides as words
 * @returns {object[]} entries { id, kind, white, black, whiteElo, blackElo, result, you, date, dateText, event, site, plies, analysed, reviewed }
 */
export function entriesOf(library, games, namesOf = () => ({ white: "", black: "" })) {
  const out = [];
  for (const r of library) {
    out.push({ id: r.id, kind: "imported", white: r.white || "", black: r.black || "", whiteElo: r.whiteElo ?? null, blackElo: r.blackElo ?? null,
      result: RESULTS.has(r.result) ? r.result : "*", you: r.you === "w" || r.you === "b" ? r.you : null, date: dateOf(r), dateText: r.date || "",
      event: r.event || "", site: r.site || "", plies: r.plies || 0, analysed: !!r.analysed, reviewed: !!r.reviewed });
  }
  for (const g of games) {
    if (!g.result) continue;
    const you = g.mode === "engine" ? (g.engineColor === "w" ? "b" : "w") : null;
    const { white, black } = namesOf(g);
    out.push({ id: g.id, kind: "played", white, black, whiteElo: null, blackElo: null, result: RESULTS.has(g.result.result) ? g.result.result : "*",
      you, date: g.startedAt || 0, dateText: "", event: "", site: "", plies: 0, analysed: !!g.analysed, reviewed: !!g.reviewed });
  }
  return out.sort((a, b) => b.date - a.date || (a.id < b.id ? 1 : -1));
}

/**
 * A row's date in one form for the language (v20-0-plan §11 L5): the PGN's
 * Date tag and the day a game was played here read alike — 「2026年10月20日」,
 * "20 Oct 2026", 「2026/10/20」. A PGN date without a day is the month, one
 * without a month the year; a PGN date is a calendar day (UTC), a game
 * played here the local day it started.
 * @param {object} e        an entry (entriesOf)
 * @param {string} locale   the language's date locale (t("date.locale"))
 */
export function dateLabel(e, locale) {
  const m = e.kind === "imported" ? /^(\d{4})(?:[.\-/](\d{1,2}|\?\?))?(?:[.\-/](\d{1,2}|\?\?))?/.exec(e.dateText || "") : null;
  if (m && m[1] !== "????") {
    const y = Number(m[1]), mo = Number(m[2]) || 0, d = Number(m[3]) || 0;
    const at = new Date(Date.UTC(y, Math.max(mo, 1) - 1, Math.max(d, 1)));
    const opts = !mo ? { year: "numeric" } : !d ? { year: "numeric", month: "short" } : { dateStyle: "medium" };
    return new Intl.DateTimeFormat(locale, { ...opts, timeZone: "UTC" }).format(at);
  }
  if (!e.date) return "";
  // a game played here, or an imported row without a Date tag (dateOf: when it was imported): the local day
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(e.date));
}

/** "win" | "loss" | "draw" from your side, or null when it is not known which side you were (or there is no result). */
export function outcomeOf(e) {
  if (e.result === "1/2-1/2") return "draw";
  if (!e.you || (e.result !== "1-0" && e.result !== "0-1")) return null;
  return (e.result === "1-0") === (e.you === "w") ? "win" : "loss";
}

/** The other side's name, when it is known which side you were; else both. */
export const opponentOf = (e) => (e.you === "w" ? e.black : e.you === "b" ? e.white : "");

const yearOf = (e) => (e.date ? new Date(e.date).getUTCFullYear() : null);
/** The years the entries span, newest first (the year filter's options). */
export const yearsOf = (entries) => [...new Set(entries.map(yearOf).filter(Boolean))].sort((a, b) => b - a);

/**
 * @param {object[]} entries  from entriesOf
 * @param {{ q?: string, result?: "all"|"win"|"loss"|"draw", year?: "all"|number|string }} f
 */
export function filterEntries(entries, { q = "", result = "all", year = "all" } = {}) {
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  const y = year === "all" || year === "" || year == null ? null : Number(year);
  return entries.filter((e) => {
    if (result !== "all" && outcomeOf(e) !== result) return false;
    if (y && yearOf(e) !== y) return false;
    if (!words.length) return true;
    const hay = [e.white, e.black, e.event, e.site, e.dateText, e.date ? new Date(e.date).toISOString().slice(0, 10) : ""].join(" ").toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** One page of a list: { rows, page (0-based, clamped), pages, total }. */
export function pageOf(list, page, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(list.length / size));
  const p = Math.max(0, Math.min(pages - 1, page | 0));
  return { rows: list.slice(p * size, (p + 1) * size), page: p, pages, total: list.length };
}

/**
 * 「这是你吗」: the games a name makes yours — the ones nobody's yet with
 * that name on a side — as library.you's [id, side, the other side's Elo].
 */
export function claimsFor(rows, name) {
  const out = [];
  for (const r of rows) {
    if (r.you || !name) continue;
    const you = r.white === name ? "w" : r.black === name ? "b" : null;
    if (you) out.push([r.id, you, you === "w" ? r.blackElo ?? null : r.whiteElo ?? null]);
  }
  return out;
}
