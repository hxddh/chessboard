/**
 * Identity for the opening drills.
 *
 * The drills are generated from the ECO book rather than authored one by one,
 * so unlike every other puzzle — whose id is a hand-written string like
 * `m1-backrank-r` — they need their ids computed. Until 1.21.3 that was:
 *
 *     .filter(([, , seq]) => seq.split(" ").length >= 6)
 *     .map(([eco, name, seq], i) => ({ id: "op-" + eco + "-" + i, ... }))
 *
 * where `i` is the row's position in the filtered book. A position is not an
 * identity. Insert one deep line anywhere near the front — which is exactly
 * what "more opening coverage" means — and 108 of the 109 ids move to a
 * different drill. Everything keyed by them (`puzzleState.solved`,
 * `puzzleState.missed`, and through those the review queue and the 开局博士
 * badge) silently re-attaches or is orphaned. Nothing tells the player.
 *
 * So the id is derived from what the drill *is*: its ECO code and its moves.
 * Renaming a line keeps its id — names get corrected, as C24's did in 1.21.1,
 * and a correction must not cost anyone their progress. Changing the moves
 * changes the id, which is right: those are different drills to memorise.
 * @module drills
 */
(function (global) {
  /** a line has to be this long before it is worth drilling */
  const MIN_PLIES = 6;

  /**
   * FNV-1a, 32 bits, printed base 36. Not a checksum against tampering — just
   * a short stable string that depends on every character of the input.
   */
  function hash36(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36);
  }

  /** Whitespace in the book is authored by hand; the id must not depend on it. */
  function normalizeSeq(seq) {
    return String(seq == null ? "" : seq).trim().replace(/\s+/g, " ");
  }

  /** @returns {string} identity of the drill for `eco` playing `seq` */
  function drillId(eco, seq) {
    return "op-" + eco + "-" + hash36(normalizeSeq(seq));
  }

  /** The book rows deep enough to drill, in book order. */
  function drillLines(book) {
    return (book || []).filter((row) => normalizeSeq(row[2]).split(" ").length >= MIN_PLIES);
  }

  /**
   * Old positional id → new content id, for the book as it stands.
   *
   * Exact for anyone upgrading from a build whose book matches this one, which
   * is every 1.21.x — and it is why this migration has to ship in a release
   * that does NOT touch the book. Change the book in the same release and the
   * positions no longer describe what the player actually solved.
   */
  function legacyIdMap(book) {
    const map = {};
    drillLines(book).forEach((row, i) => {
      map["op-" + row[0] + "-" + i] = drillId(row[0], row[2]);
    });
    return map;
  }

  /** a pre-1.21.3 drill key: op-<ECO>-<digits> */
  const LEGACY = /^op-[A-E][0-9]{2}-[0-9]+$/;

  /**
   * Rewrite legacy keys of `store` in place.
   *
   * A legacy key with no mapping is dropped rather than kept: it names a row
   * that is no longer in the book, and leaving it behind means carrying dead
   * weight in localStorage forever.
   * @returns {number} how many keys were rewritten
   */
  function migrateIds(store, map) {
    if (!store || typeof store !== "object") return 0;
    let n = 0;
    for (const key of Object.keys(store)) {
      if (!LEGACY.test(key)) continue;
      const now = map[key];
      const value = store[key];
      delete store[key];
      if (!now) continue; // the row it named is gone
      if (!(now in store)) store[now] = value;
      n++;
    }
    return n;
  }

  global.ChessDrills = { MIN_PLIES, hash36, drillId, drillLines, legacyIdMap, migrateIds };
})(typeof window !== "undefined" ? window : globalThis);
