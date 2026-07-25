/**
 * PGN text utilities — pure string work, no game state and no DOM.
 * Kept out of app.js so the parsing rules can be read (and tested) on their
 * own; scripts/test-chess.mjs exercises them directly.
 * @module pgn
 */
(function (global) {
  /**
   * Split a PGN file into individual games.
   *
   * A `[Event ...]` tag always opens a game, so every occurrence at the start
   * of a line begins a new one. Files with a single game (or none at all, i.e.
   * bare movetext) come back as one entry, so callers can treat the result
   * uniformly.
   * @param {string} text
   * @returns {string[]} non-empty game chunks, in file order
   */
  function splitGames(text) {
    const t = String(text || "");
    if (!t.trim()) return [];
    const starts = [];
    const re = /^\[Event\s/gm;
    let m;
    while ((m = re.exec(t))) starts.push(m.index);
    if (starts.length <= 1) return [t.trim()];
    const out = [];
    for (let i = 0; i < starts.length; i++) {
      const chunk = t.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : undefined).trim();
      if (chunk) out.push(chunk);
    }
    return out;
  }

  /** Value of a PGN tag, or "" when absent. */
  function tag(text, name) {
    const m = new RegExp("^\\[" + name + '\\s+"([^"]*)"\\]', "m").exec(String(text || ""));
    return m ? m[1] : "";
  }

  /**
   * One-line summary for a game picker: 白 vs 黑 · 结果 · N 着.
   * The move count is a cheap token estimate — it never parses the game, so a
   * malformed chunk still yields a usable label instead of throwing.
   */
  function summary(text) {
    const white = tag(text, "White") || "?";
    const black = tag(text, "Black") || "?";
    const result = tag(text, "Result") || "*";
    const event = tag(text, "Event");
    const date = tag(text, "Date");
    const movetext = String(text || "").split(/\n\s*\n/).slice(1).join("\n") || "";
    const plies = (movetext.match(/[a-hKQRBNO][^\s]*/g) || [])
      .filter((tk) => !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(tk) && !/^\d+\.+$/.test(tk)).length;
    return { white, black, result, event, date, plies };
  }

  global.ChessPgn = { splitGames, tag, summary };
})(typeof window !== "undefined" ? window : globalThis);
