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
   * Old positional id → new content id. **Frozen data, not a derivation.**
   *
   * 1.22 derived this from the live book, which made the migration correct
   * only while the book still matched the one those indexes were written
   * against — and turned "do not change the opening book in this release" into
   * a rule someone had to remember. That rule cannot hold: it says nothing
   * about a player who skips the release entirely. Going 1.21.2 → a later
   * build with a bigger book, the derivation would read the new book to
   * explain old indexes, and measurement says the damage is not subtle —
   * inserting a single line drops 66 to 108 of the 109 drills on the floor,
   * because the ECO in the old key stops matching the row now sitting at that
   * index. (That ECO is also why almost nothing is *mis*-mapped: it acts as an
   * accidental checksum, so a stale key usually fails to match rather than
   * matching the wrong drill. Measured across the one real book change in this
   * app's history, 1.15's 38 → 109: zero mis-maps, 36 drops.)
   *
   * Frozen, none of that applies. The table describes the book as it stood
   * when positional ids were retired, which is the only book any legacy id was
   * ever written against. The opening book is free to change from now on.
   *
   * Generated once from the 1.22 book; scripts/test-chess.mjs checks it still
   * describes every drill that book contained.
   */
  const LEGACY_IDS = {
    "op-A57-0": "op-A57-8u9zzu", "op-A60-1": "op-A60-80t60k", "op-A08-2": "op-A08-vc3tne",
    "op-A13-3": "op-A13-5d0mux", "op-A29-4": "op-A29-1jy6ley", "op-A34-5": "op-A34-1p27j70",
    "op-A45-6": "op-A45-1klg7ob", "op-A48-7": "op-A48-o37j93", "op-A58-8": "op-A58-1ajpihs",
    "op-A70-9": "op-A70-139jnt1", "op-A88-10": "op-A88-1njppke", "op-A97-11": "op-A97-2770ea",
    "op-B04-12": "op-B04-1o7ufke", "op-B13-13": "op-B13-1bftb2c", "op-B18-14": "op-B18-gwmmx1",
    "op-B33-15": "op-B33-egzy0z", "op-B34-16": "op-B34-zcd3qa", "op-B41-17": "op-B41-5lq4xa",
    "op-B70-18": "op-B70-1vl4hz7", "op-B80-19": "op-B80-10iliw1", "op-B90-20": "op-B90-1vky6z9",
    "op-B01-21": "op-B01-140o8vn", "op-B02-22": "op-B02-1u0fwli", "op-B05-23": "op-B05-1saqk92",
    "op-B06-24": "op-B06-3i0au0", "op-B08-25": "op-B08-1fonl11", "op-B12-26": "op-B12-8rhmli",
    "op-B14-27": "op-B14-65igpi", "op-B18-28": "op-B18-m8swyz", "op-B19-29": "op-B19-1emm89y",
    "op-B21-30": "op-B21-bs5j5p", "op-B22-31": "op-B22-uufphl", "op-B23-32": "op-B23-13fggf5",
    "op-B31-33": "op-B31-xj5h9a", "op-B33-34": "op-B33-vz95sn", "op-B36-35": "op-B36-dcusv1",
    "op-B47-36": "op-B47-c9f3z2", "op-B51-37": "op-B51-4ygsn8", "op-B78-38": "op-B78-7psdjc",
    "op-B84-39": "op-B84-ydi0u2", "op-B90-40": "op-B90-1k5opx0", "op-C01-41": "op-C01-1gwda2c",
    "op-C11-42": "op-C11-18p4z8i", "op-C15-43": "op-C15-1k7efwk", "op-C45-44": "op-C45-1uprapx",
    "op-C47-45": "op-C47-1qb1glu", "op-C48-46": "op-C48-1pvc0sd", "op-C50-47": "op-C50-8qdq43",
    "op-C51-48": "op-C51-8in7i7", "op-C53-49": "op-C53-1duumrb", "op-C55-50": "op-C55-o2helv",
    "op-C57-51": "op-C57-1i3w6zt", "op-C65-52": "op-C65-ofl2ux", "op-C68-53": "op-C68-3w8hkt",
    "op-C70-54": "op-C70-xgxyf1", "op-C84-55": "op-C84-3etne0", "op-C00-56": "op-C00-13vxjn1",
    "op-C01-57": "op-C01-15jirp1", "op-C02-58": "op-C02-wuuzdz", "op-C07-59": "op-C07-1v333uo",
    "op-C11-60": "op-C11-13w8txq", "op-C19-61": "op-C19-1y9qaq2", "op-C24-62": "op-C24-h43bsa",
    "op-C29-63": "op-C29-175w657", "op-C39-64": "op-C39-253j4o", "op-C41-65": "op-C41-ebwd9g",
    "op-C42-66": "op-C42-tampqs", "op-C44-67": "op-C44-dhgkih", "op-C45-68": "op-C45-1y9nntl",
    "op-C49-69": "op-C49-1lgt2m5", "op-C50-70": "op-C50-1qnu8rs", "op-C52-71": "op-C52-1j2sxti",
    "op-C54-72": "op-C54-1wbhm41", "op-C58-73": "op-C58-1ye7n0", "op-C65-74": "op-C65-1ibxnxv",
    "op-C67-75": "op-C67-184o0r7", "op-C69-76": "op-C69-27z9ki", "op-C88-77": "op-C88-1yjxt5m",
    "op-C89-78": "op-C89-p15yp8", "op-D15-79": "op-D15-eawgab", "op-D35-80": "op-D35-1pan3su",
    "op-D37-81": "op-D37-9ascp", "op-D43-82": "op-D43-1laq51m", "op-D80-83": "op-D80-ggj6su",
    "op-D85-84": "op-D85-h3l0zz", "op-D02-85": "op-D02-1tmi5uj", "op-D10-86": "op-D10-1sp8dvz",
    "op-D19-87": "op-D19-ozfqo7", "op-D27-88": "op-D27-2ys0ck", "op-D31-89": "op-D31-1cq6ykf",
    "op-D34-90": "op-D34-18w7spk", "op-D36-91": "op-D36-n39o8x", "op-D45-92": "op-D45-9b7cvx",
    "op-D47-93": "op-D47-1lbslha", "op-D59-94": "op-D59-1s0xxcb", "op-D85-95": "op-D85-1s3tsay",
    "op-D87-96": "op-D87-w5ahri", "op-E01-97": "op-E01-1pok8pj", "op-E12-98": "op-E12-1k33760",
    "op-E20-99": "op-E20-291hr5", "op-E32-100": "op-E32-pqkglz", "op-E40-101": "op-E40-1cklhb7",
    "op-E70-102": "op-E70-1xkqo1e", "op-E06-103": "op-E06-vxnw7w", "op-E15-104": "op-E15-of64ir",
    "op-E32-105": "op-E32-11vyiez", "op-E53-106": "op-E53-1mur34m", "op-E60-107": "op-E60-110dqi",
    "op-E97-108": "op-E97-zd9g68",
  };

  /** @returns {object} the frozen old-id → new-id table (a copy) */
  function legacyIdMap() {
    return Object.assign({}, LEGACY_IDS);
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
