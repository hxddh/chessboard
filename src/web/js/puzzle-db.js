/**
 * The imported Lichess puzzles, band by band (v8-0-plan B1).
 *
 * Tens of thousands of puzzles are megabytes of text, and the first paint
 * needs none of them. So the bundle carries only the index (puzzles-lc-
 * index.js: per band a count and a rating range, per theme a count per
 * band) and each 200-point band is a chunk of its own, loaded the first time
 * something asks for it — rush mode walks up the bands, a theme page asks
 * for the bands its counts say hold that theme, the rating picker asks for
 * the band around the player.
 *
 * Rows are compact (scripts/import-puzzles.mjs encodeRow) and decoded here
 * into the shape every other puzzle has, plus `themes` and `side`. A decoded
 * puzzle's id is "lc-" + the Lichess id, a namespace no hand-written or mined
 * id uses, so progress stored under the old ids is untouched.
 *
 * @module puzzle-db
 */
import { LC_INDEX } from "./puzzles-lc-index.js";
import { loadChunk, chunkReady } from "./chunk.js";

  /** motif.js's keys: a `tac` puzzle is labelled with the first it carries
      (the importer puts the verified label first; "discoveredAttack", 闪击,
      is a theme, not one of these) */
  const MOTIFS = ["fork", "pin", "skewer", "discovered", "double"];

  const bandName = (band) => String(band).padStart(4, "0");
  /** The chunk that holds a band — scripts/bundle.mjs builds the same names. */
  export function bandChunk(band) {
    return { file: "chunk-lc-" + bandName(band) + ".js", global: "LC_BAND_" + bandName(band) };
  }

  /**
   * One stored row → a puzzle.
   * @param {Array} row [id, fen, "san …", rating, cat, "theme …", n]
   */
  export function decodeRow(row) {
    const [id, fen, line, rating, cat, themes, n] = row;
    const p = { id: "lc-" + id, cat, fen, solution: line.split(" "), rating, themes: themes ? themes.split(" ") : [], src: "lichess" };
    if (cat === "tac") { const m = p.themes.find((t) => MOTIFS.includes(t)); if (m) p.motif = m; }
    if (cat === "tac" || cat === "win") p.gain = n;
    if (cat === "def") p.saves = n;
    // the chair the solver sits in: app.js turns the board on `side` (puzzleModel)
    if (fen.split(" ")[1] === "b") p.side = "b";
    return p;
  }

  const decoded = new Map();
  /** A band's puzzles, or null until its chunk is here. */
  function band(b) {
    if (decoded.has(b)) return decoded.get(b);
    const c = bandChunk(b);
    if (!chunkReady(c.global)) return null;
    const list = globalThis[c.global].map(decodeRow);
    decoded.set(b, list);
    return list;
  }
  /** @returns {Promise<object[]>} */
  function ensureBand(b) {
    const c = bandChunk(b);
    return loadChunk(c.file, c.global).then(() => band(b));
  }
  /** The band a rating falls in, clamped to the bands there are (null: none). */
  function bandFor(rating) {
    const bands = LC_INDEX.bands;
    if (!bands.length) return null;
    const b = Math.floor((Number(rating) || 0) / 200) * 200;
    if (b <= bands[0].band) return bands[0].band;
    if (b >= bands[bands.length - 1].band) return bands[bands.length - 1].band;
    return (bands.find((x) => x.band === b) || bands.find((x) => x.band > b)).band;
  }
  /** The bands holding theme `id`, with counts. */
  function bandsWith(id) {
    const t = LC_INDEX.themes[id];
    if (!t) return [];
    return LC_INDEX.bands.map((x, i) => ({ band: x.band, n: t.bands[i] })).filter((x) => x.n > 0);
  }

  export const ChessPuzzleDb = {
    index: LC_INDEX,
    total: () => LC_INDEX.total,
    themeIds: () => Object.keys(LC_INDEX.themes),
    bandFor, bandsWith, band, ensureBand, bandChunk, decodeRow,
  };
