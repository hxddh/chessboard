/**
 * Node tests for the annotated classics (docs/v6-plan.md §Q3.5, the 「读棋」
 * module): every PGN replays under chess.js, ends the way its result says,
 * every note points at a ply that exists, and the English and Japanese
 * tables carry the same note keys with real text in them. The Japanese
 * scanners (kana ratio, stray English, foreign scripts) and the full-width
 * punctuation rule are the ones test-chess.mjs applies to the course — the
 * punctuation one is imported, the others are ported because test-chess.mjs
 * keeps them as file-local functions. Run: node scripts/test-classics.mjs
 */
import path from "path";
import { fileURLToPath } from "url";
import { loadAppModules } from "./lib/app-module.mjs";
import { transform } from "./cjk-punct.mjs";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

let failed = 0;
function assert(cond, msg) {
  if (!cond) { failed++; console.error("FAIL:", msg); }
  else console.log("ok:", msg);
}

const ctx = loadAppModules([
  "src/web/js/chess.js", "src/web/js/classics.js",
  "src/web/js/classics-en.js", "src/web/js/classics-ja.js",
]);
const Chess = ctx.Chess;
const games = ctx.CHESS_CLASSICS;

// ------------------------------------------------------------------ games
assert(Array.isArray(games) && games.length >= 10, "classics loaded (" + (games ? games.length : 0) + ")");
const ids = new Set();
const plies = new Map();
{
  let bad = 0;
  const fail = (...m) => { bad++; console.error("FAIL:", ...m); };
  for (const g of games) {
    if (!g.id || ids.has(g.id)) { fail("classic id missing/duplicate", g.id); continue; }
    ids.add(g.id);
    for (const k of ["white", "black", "event", "eco", "result", "pgn"]) {
      if (typeof g[k] !== "string" || !g[k]) fail(g.id, "missing " + k);
    }
    if (!Number.isInteger(g.year) || g.year < 1800 || g.year > 1950) fail(g.id, "year out of the public-domain window:", g.year);
    if (!/^[A-E]\d\d$/.test(g.eco || "")) fail(g.id, "eco is not an ECO code:", g.eco);
    if (!["1-0", "0-1", "1/2-1/2"].includes(g.result)) fail(g.id, "unknown result:", g.result);
    // the move list must replay from the start position, and the PGN's own
    // result token must agree with the record
    const c = new Chess();
    if (!c.load_pgn(g.pgn, { sloppy: true })) { fail(g.id, "pgn does not load"); continue; }
    const n = c.history().length;
    plies.set(g.id, n);
    if (n < 30) fail(g.id, "too short to be a lesson (" + n + " plies)");
    const tail = g.pgn.trim().split(/\s+/).pop();
    if (tail !== g.result) fail(g.id, "pgn ends with", tail, "but result is", g.result);
    // a game that ends in checkmate is decisive, and decided for the side
    // that delivered it; a decisive game that is not mate is a resignation,
    // which needs the loser to be the side to move (nobody resigns on the
    // opponent's turn)
    if (c.in_checkmate()) {
      const winner = c.turn() === "w" ? "0-1" : "1-0";
      if (g.result !== winner) fail(g.id, "checkmate says", winner, "but result is", g.result);
    } else if (g.result !== "1/2-1/2") {
      const loser = g.result === "1-0" ? "b" : "w";
      if (c.turn() !== loser) fail(g.id, "the winner is on move at the end — the losing side resigns on its own turn");
      if (c.in_stalemate() || c.insufficient_material()) fail(g.id, "decisive result on a drawn position");
    }
    // notes: enough of them, in order, each at a ply that was played
    if (!Array.isArray(g.notes) || g.notes.length < 6 || g.notes.length > 12) {
      fail(g.id, "needs 6–12 notes, has", g.notes ? g.notes.length : 0);
    }
    let last = 0;
    for (const note of g.notes || []) {
      if (!Number.isInteger(note.ply) || note.ply < 1 || note.ply > n) fail(g.id, "note ply out of range:", note.ply, "of", n);
      if (note.ply <= last) fail(g.id, "notes out of order at ply", note.ply);
      last = note.ply;
      if (typeof note.text !== "string" || note.text.length < 8) fail(g.id, "empty note at ply", note.ply);
      // a note that quotes a move number must be talking about the ply it
      // sits on: "17.Rd8#" belongs at ply 33, "19...Qxf3" at ply 38
      const m = /^(\d+)(\.{1,3})/.exec(note.text || "");
      if (m) {
        const want = m[2] === "." ? Number(m[1]) * 2 - 1 : Number(m[1]) * 2;
        if (want !== note.ply) fail(g.id, "note quotes move " + m[1] + m[2] + " (ply " + want + ") but sits on ply " + note.ply);
      }
    }
    // the last note lands on the final ply, so the reader is told how it ended
    if (g.notes && g.notes.length && g.notes[g.notes.length - 1].ply !== n) fail(g.id, "the last note is not on the final move");
  }
  assert(bad === 0, "every classic replays, ends consistently and is annotated in order");
}

// --------------------------------------------------------- translations
const han = /[一-鿿]/;
const kana = /[぀-ヿ]/;
/** test-chess.mjs's rule: English carries no Han; Japanese is not a byte-copy of the Chinese */
const untranslated = (lang, str, source) => {
  if (typeof str !== "string" || !str) return false;
  if (lang === "ja") return str === source;
  return han.test(str);
};
/** Latin runs that are legitimate inside Japanese chess prose — SAN, files, roman numerals */
const NOTATION = /^(?:[KQRBNP]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?|O-O(?:-O)?|[A-Za-z]|I{1,3}|IV|VI{0,3}|ECO)$/;
const notation = (word) => word.split(/[-+]/).filter(Boolean).every((part) => NOTATION.test(part));
const JA_OK = /[　-〿぀-ヿ一-鿿＀-￯ -~‐-‧‰-⁞←-⇿①-⓿■-⛿×≠⌘–—]/;
function eachString(root, where, fn) {
  const walk = (v, p) => {
    if (typeof v === "string") return fn(v, p);
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, p + "[" + i + "]"));
    if (v && typeof v === "object") return Object.entries(v).forEach(([k, x]) => walk(x, p + "." + k));
  };
  walk(root, where);
}
function kanaRatio(root) {
  let total = 0, withKana = 0;
  eachString(root, "", (v) => { if (v.trim()) { total++; if (kana.test(v)) withKana++; } });
  return total ? withKana / total : 1;
}
/** the three corpus-level checks test-chess.mjs runs on every Japanese table */
function checkJapanese(label, table, kanaMin, minStrings) {
  let strings = 0;
  eachString(table, label, (v) => { if (v.trim()) strings++; });
  assert(strings >= minStrings, label + ": found " + strings + " strings, expected at least " + minStrings);
  const ratio = kanaRatio(table);
  assert(ratio >= kanaMin, label + " reads as Japanese (kana in " + Math.round(ratio * 100) + "% of strings, floor " + Math.round(kanaMin * 100) + "%)");
  let latin = 0;
  eachString(table, label, (v, where) => {
    for (const w of v.match(/[A-Za-z][A-Za-z0-9=+#-]*/g) || []) {
      if (notation(w)) continue;
      latin++;
      console.error("FAIL: stray English word in " + where + ": " + w);
    }
  });
  assert(latin === 0, label + " carries no stray English words");
  let alien = 0;
  eachString(table, label, (v, where) => {
    for (const ch of v) {
      if (JA_OK.test(ch)) continue;
      alien++;
      console.error("FAIL: character outside Japanese scripts in " + where + ": " + ch + " (U+" + ch.codePointAt(0).toString(16).toUpperCase() + ")");
    }
  });
  assert(alien === 0, label + " uses only Japanese scripts");
}

for (const lang of ["en", "ja"]) {
  const table = ctx["CHESS_CLASSICS_" + lang.toUpperCase()];
  assert(table && typeof table === "object", "classics-" + lang + ".js exports a table");
  if (!table) continue;
  const byId = new Map(games.map((g) => [g.id, g]));
  const uncovered = games.filter((g) => !table[g.id]).map((g) => g.id);
  assert(uncovered.length === 0, "all " + games.length + " classics have " + lang + " text" + (uncovered.length ? ": " + uncovered.join(", ") : ""));
  let bad = 0;
  const fail = (...m) => { bad++; console.error("FAIL:", ...m); };
  for (const [id, tr] of Object.entries(table)) {
    const g = byId.get(id);
    if (!g) { fail(lang, "translation for unknown classic", id); continue; }
    for (const k of Object.keys(tr)) {
      if (!["white", "black", "event", "notes"].includes(k)) fail(lang, id, "unexpected key in translation:", k);
    }
    for (const k of ["white", "black", "event"]) {
      if (typeof tr[k] !== "string" || !tr[k].trim()) fail(lang, id, "missing " + k);
      else if (untranslated(lang, tr[k], g[k])) fail(lang, id, k + " is untranslated:", tr[k]);
    }
    const want = (g.notes || []).map((n) => String(n.ply)).sort();
    const got = Object.keys(tr.notes || {}).sort();
    if (want.join(",") !== got.join(",")) fail(lang, id, "note plies differ: have", got.join(" "), "want", want.join(" "));
    for (const n of g.notes || []) {
      const t = tr.notes && tr.notes[n.ply];
      if (typeof t !== "string" || t.trim().length < 8) fail(lang, id, "empty note at ply", n.ply);
      else if (untranslated(lang, t, n.text)) fail(lang, id, "untranslated note at ply", n.ply, ":", t);
    }
  }
  assert(bad === 0, lang + " classics match the originals and are translated");
  if (lang === "ja") checkJapanese("ja classics prose", table, 0.9, 100);
}

// ------------------------------------------------------ punctuation rule
// cjk-punct.mjs lists the files it audits and classics is not among them, so
// the same transform is run here on the two CJK sources.
{
  let hits = 0;
  for (const rel of ["src/web/js/classics.js", "src/web/js/classics-ja.js"]) {
    const src = fs.readFileSync(path.join(root, rel), "utf8");
    for (const h of transform(src).hits) {
      hits++;
      console.error("FAIL: " + rel + ":" + h.line + " ASCII punctuation between CJK: " + h.from);
    }
  }
  assert(hits === 0, "classics prose uses full-width punctuation");
}

if (failed) { console.error(failed + " failure(s)"); process.exit(1); }
console.log("all classics tests passed");
