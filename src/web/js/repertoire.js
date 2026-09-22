/**
 * 我的开局书 —— the player's own repertoire, as lines.
 *
 * The app has had an opening trainer since 6.0, drilled from the 195 vendored
 * ECO lines. That book teaches opening *principles* through the openings
 * everybody plays. It cannot teach the one thing a player past the beginning
 * actually needs: **their own** repertoire — the four or five things they
 * intend to play, and the answers they intend to give.
 *
 * So this is the second book, and it is imported rather than authored: a PGN
 * with variations (what every repertoire tool and every coach hands out) comes
 * in, every root-to-leaf path through it becomes a line, and the lines become
 * drills on exactly the rails the ECO book already runs on —
 * `opening-tree.js` builds the tree, `drills.js` mints the ids, `srs.js`
 * schedules the review. Nothing here is a second implementation of any of
 * that; what is here is the part that did not exist: turning a file of
 * variations into that shape, and saying what the book does not cover.
 *
 * Two books, not one, because the same person's White repertoire and Black
 * repertoire are two different bodies of work — and because a drill has to
 * know which chair you sit in before it can ask you anything.
 *
 * Pure: text and rows in, rows out. No storage, no DOM, no engine.
 * @module repertoire
 */
import { ChessDrills } from "./drills.js";  // hash36: one id scheme in this app

/** Lines per side. A repertoire this size is already more than anyone drills. */
const MAX_LINES = 400;
/** Plies deep enough to be a line rather than a first move. */
const MIN_PLIES = 2;
/** Longest path this will follow — a whole annotated game is not a line. */
const MAX_PLIES = 40;

/** SAN text, one space between moves — the id must not depend on whitespace. */
function normalize(sans) {
  return (Array.isArray(sans) ? sans : String(sans || "").split(/\s+/))
    .map((s) => String(s || "").trim()).filter(Boolean).join(" ");
}

/**
 * Every root-to-leaf path through one parsed game.
 *
 * A repertoire PGN is a tree written as a mainline with variations, and the
 * variations are the whole point: they are the answers to the replies. The
 * importer for a *game* (library.js) deliberately keeps the mainline only —
 * "a game's variations are the annotator's opinion, and what this library
 * measures is what the player actually played". Here the opposite is true,
 * and for the same reason: what this book holds is what the player intends
 * to play, which is all of it.
 *
 * Depth-first, so the mainline comes out first and the book reads in the
 * order it was written.
 * @param {object} root a pgn-parser node with `children`
 * @returns {string[][]} paths in SAN
 */
function pathsOf(root) {
  const out = [];
  const walk = (node, acc) => {
    const kids = (node && node.children) || [];
    if (!kids.length || acc.length >= MAX_PLIES) {
      if (acc.length) out.push(acc.slice());
      return;
    }
    for (const kid of kids) {
      acc.push(kid.san);
      walk(kid, acc);
      acc.pop();
    }
  };
  walk(root, []);
  return out;
}

/**
 * The lines in a parsed PGN file, deepest-first within each game.
 * @param {object[]} games parsed games, each with a `root`
 * @returns {string[]} each line as normalised SAN text
 */
function linesFrom(games) {
  const out = [];
  for (const g of games || []) {
    if (!g || !g.root) continue;
    for (const path of pathsOf(g.root)) {
      if (path.length < MIN_PLIES) continue;
      out.push(normalize(path));
    }
  }
  return out;
}

/**
 * Merge lines into a side's book.
 *
 * Two rules, both of which fall out of what a repertoire is rather than out
 * of convenience:
 *
 * **A line already in the book is not added twice** — re-importing a file
 * after editing one variation must leave the rest of the book, and the
 * progress attached to it, exactly where it was. Identity is the moves, so
 * this survives a renamed file, a re-exported PGN, a different move-number
 * style.
 *
 * **A line that is a prefix of one already there adds nothing.** The deeper
 * line already contains every question the shorter one would ask, and both
 * in the book would mean drilling the same first eight plies twice under two
 * ids. The converse also holds: a new line that *extends* one in the book
 * replaces it.
 *
 * @param {object[]} lines the book's current entries
 * @param {string[]} fresh normalised SAN texts
 * @param {(sans: string) => {eco: string, name: string}|null} nameOf
 * @returns {{lines: object[], added: number, dup: number, dropped: string[]}}
 *          `dropped` is every id that left the book — the cap's casualties
 *          AND the shorter lines a deeper one replaced. The caller owes each
 *          of them the same cleanup, so they come back in one list.
 */
function addLines(lines, fresh, nameOf) {
  const out = (lines || []).slice();
  const replaced = [];
  let added = 0, dup = 0;
  for (const sans of fresh || []) {
    if (!sans) continue;
    // already here, or contained in something deeper
    if (out.some((l) => l.sans === sans || (l.sans + " ").startsWith(sans + " "))) { dup++; continue; }
    // …or it is itself the deeper version of something here. The shorter
    // line's id leaves the book, so it is reported in `dropped` like any
    // other departure — whatever is hanging off that id has to go with it.
    for (let i = out.length - 1; i >= 0; i--) {
      if ((sans + " ").startsWith(out[i].sans + " ")) replaced.push(out.splice(i, 1)[0].id);
    }
    const named = (nameOf && nameOf(sans)) || null;
    out.push({
      // `rep-`, never `op-`: a repertoire line is very often exactly a line
      // the built-in book also holds, and `drillId` derives its id from the
      // ECO code and the moves — so the two would share an id, and solving
      // one would silently mark the other solved. Derived from the moves
      // ALONE, not from the name: the ECO code arrives later (fillNames),
      // and an id that changed when a name turned up would take the progress
      // hanging off it with it — the very failure drills.js is a monument to.
      id: "rep-" + ChessDrills.hash36(sans),
      sans,
      eco: named ? named.eco : "",
      name: named ? named.name : "",
    });
    added++;
  }
  const dropped = replaced.slice();
  // oldest out first, the same rule the library uses when it fills up
  while (out.length > MAX_LINES) dropped.push(out.shift().id);
  return { lines: out, added, dup, dropped };
}

/** The book as `opening-tree.js` rows: [eco, id, sanSequence]. */
function rowsOf(lines) {
  return (lines || []).map((l) => [l.eco || "REP", l.id, l.sans]);
}

/**
 * The ECO codes this book covers.
 *
 * A line's code is the code of its deepest named position, which is what
 * `ChessEco.openingForGame` answers — the same call the library uses to name
 * a game. So "covered" means the same thing on both sides of the comparison
 * that `gaps()` makes, which is the only way that comparison means anything.
 */
function coveredEcos(lines) {
  const out = new Set();
  for (const l of lines || []) if (l && l.eco) out.add(l.eco);
  return out;
}

/**
 * Openings this player actually plays that the book says nothing about.
 *
 * The reason this is worth more in 7.2 than the same list would have been in
 * 7.0: before 7.1 the app could compute a set difference against the built-in
 * book and say "you have no preparation here", which is a sentence about a
 * list. `diagnose().ecos` is a sentence about the player — how many games,
 * won and lost — so the gap can be ordered by what it has actually cost
 * them, and the worst gap goes first.
 *
 * Sorted by losses, then by games: the opening you keep losing in and have
 * nothing written down about is the one to write down first.
 *
 * @param {object[]} ecos `Library.diagnose().ecos` rows
 * @param {Set<string>} covered from `coveredEcos`
 * @param {number} minGames ignore an opening met once — that is not a gap yet
 */
function gaps(ecos, covered, minGames) {
  const floor = Number.isFinite(minGames) ? minGames : 2;
  return (ecos || [])
    .filter((e) => e && e.eco && e.n >= floor && !covered.has(e.eco))
    .sort((a, b) => b.loss - a.loss || b.n - a.n)
    .slice(0, 8);
}

export const ChessRepertoire = {
  MAX_LINES, MIN_PLIES, MAX_PLIES,
  normalize, pathsOf, linesFrom, addLines, rowsOf, coveredEcos, gaps,
};
