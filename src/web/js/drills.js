/**
 * Identity for the opening drills.
 *
 * The drills are generated from the ECO book rather than authored one by one,
 * so unlike every other puzzle — whose id is a hand-written string like
 * `m1-backrank-r` — they need their ids computed. A row's position in the
 * book is not an identity: insert one deep line anywhere near the front —
 * which is exactly what "more opening coverage" means — and nearly every id
 * would move to a different drill, and everything keyed by them
 * (`puzzleState.solved`, `puzzleState.missed`, and through those the review
 * queue and the 开局博士 badge) would silently re-attach or be orphaned.
 *
 * So the id is derived from what the drill *is*: its ECO code and its moves.
 * Renaming a line keeps its id — names get corrected, and a correction must
 * not cost anyone their progress. Changing the moves
 * changes the id, which is right: those are different drills to memorise.
 * @module drills
 */
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
   * Ids whose book is not the frozen one, so its absence says nothing:
   * a Lichess puzzle's band is a chunk loaded on demand (puzzle-db.js), and
   * the personal book (`mine:`) and the repertoire (`rep-`) retire their own
   * ids through their own paths (forgetDrills, the library's re-mine).
   */
  const NOT_FROZEN = /^(lc-|mine:|rep-)/;

  /**
   * Drop the puzzle-state entries of puzzles the book no longer has (Codex
   * on #88). caf32fa retired 22 mined puzzles: a missed one stayed in
   * `missed`, owedNow() counted it and the review list — which resolves ids
   * against the book — could never serve it. `solved` and the per-puzzle
   * ratings (`pr`) go the same way, so a retired puzzle leaves nothing.
   *
   * Only run it against a whole book: the mined set is a chunk, and before it
   * joins every mined id would look retired.
   * @param {object} st the puzzle state
   * @param {(id: string) => boolean} has is this id in the frozen book?
   * @returns {number} how many entries were dropped
   */
  function forgetRetired(st, has) {
    if (!st || typeof st !== "object") return 0;
    let n = 0;
    for (const key of ["missed", "solved", "pr"]) {
      const m = st[key];
      if (!m || typeof m !== "object") continue;
      for (const id of Object.keys(m)) {
        if (NOT_FROZEN.test(id) || has(id)) continue;
        delete m[id];
        n++;
      }
    }
    return n;
  }


  /**
   * Why the drill went wrong, in terms of the technique — not the result.
   *
   * The eight drill tasks shared six failure lines, every one of them from
   * `drillOutcome()` and every one describing what happened: "被将死了 ——
   * 重来", "逼和了 —— 和棋,重来". None mentioned a technique. The opening
   * drills, meanwhile, say which principle you broke, and README calls that
   * the best feedback design in the app. 缺陷 26.
   *
   * Every rule here is a fact read off the position, and each is the standard
   * technique for the situation it names — nothing is inferred about intent
   * and nothing is guessed. Where the position does not match a rule the
   * answer is null and the plain outcome stands.
   *
   * Pure: a position in, an i18n key out. The caller does the wording.
   *
   * @param {object} g       chess.js instance at the failed position
   * @param {"win"|"draw"} goal  what the drill was asking for
   * @param {string} how     "stalemate" | "draw" | "mated" | "queened"
   * @returns {string|null}  an i18n key
   */
  function drillAdvice(g, goal, how) {
    let heavy = 0, pawns = 0;
    const sq = {};
    const b = g.board();
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const p = b[r][f];
        if (!p) continue;
        if (p.type === "k") sq[p.color] = { f, r: 7 - r };
        if (p.color === "w" && (p.type === "q" || p.type === "r")) heavy++;
        if (p.color === "w" && p.type === "p") pawns++;
      }
    }
    if (!sq.w || !sq.b) return null;
    const kingGap = Math.max(Math.abs(sq.w.f - sq.b.f), Math.abs(sq.w.r - sq.b.r));
    const defenderCentral = sq.b.f >= 2 && sq.b.f <= 5 && sq.b.r >= 2 && sq.b.r <= 5;

    if (goal === "draw") {
      // the defensive drills: the pawn got through
      if (how === "queened") return "lmTip.philidor";
      return null;
    }
    // Stalemate is the mating drill's signature mistake, and it has one cause:
    // every square taken away without a check being given.
    if (how === "stalemate") return "lmTip.stalemate";
    // A draw by the fifty-move rule or by running the pieces down means the
    // method was never applied. Which half is missing is readable: a king that
    // never came up, or a defender still in the middle.
    if (how === "draw") {
      if (heavy && kingGap > 3) return "lmTip.bringKing";
      if (heavy && defenderCentral) return "lmTip.driveToEdge";
      if (pawns && kingGap > 2) return "lmTip.escortPawn";
      return "lmTip.method";
    }
    // Being mated while a queen or a rook up means the attacker's own king
    // walked into it.
    if (how === "mated" && heavy) return "lmTip.ownKing";
    return null;
  }

  /**
   * v8-0-plan §5: the openings a player meets first, in the order to learn
   * them. Sorted by ECO alone the list opened on A01 Nimzo-Larsen (1.b3),
   * the first drill anyone was handed — an opening almost nobody plays and
   * nobody will face. These come first; the rest keep ECO order after them.
   * Keyed by the book's name ids; a test holds every one to being a drill.
   */
  const COMMON_OPENINGS = [
    "italian-game", "italian-game-giuoco-piano", "ruy-lopez", "ruy-lopez-berlin-defense",
    "sicilian-defense-najdorf-variation", "sicilian-defense-dragon-variation",
    "french-defense-classical-variation", "french-advance",
    "caro-kann-defense-classical-variation", "caro-kann-advance",
    "scotch-game", "two-knights-defense", "four-knights-game",
    "queens-gambit-declined", "queens-gambit-accepted-main", "slav-defense",
    "london-system-main-line", "kings-indian-defense", "nimzo-indian-defense",
    "english-opening-reversed-sicilian",
  ];

  /**
   * Drill order: the common openings in teaching order, then everything else
   * by ECO code, ties by the Chinese name (so the order does not move when
   * the interface language does).
   * @param {Array<{eco:string, nameId:string}>} drills
   * @param {Object<string,string>} names the Chinese name table
   * @returns {Array} a new, sorted array
   */
  function orderDrills(drills, names) {
    const rank = (d) => { const i = COMMON_OPENINGS.indexOf(d.nameId); return i < 0 ? COMMON_OPENINGS.length : i; };
    const nm = (d) => (names && names[d.nameId]) || "";
    return drills.slice().sort((a, b) => rank(a) - rank(b) ||
      (a.eco < b.eco ? -1 : a.eco > b.eco ? 1 : nm(a).localeCompare(nm(b), "zh")));
  }

  export const ChessDrills = { MIN_PLIES, COMMON_OPENINGS, hash36, drillId, drillLines, orderDrills, forgetRetired, drillAdvice };
