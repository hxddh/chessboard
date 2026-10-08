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
  // v8-4-plan T2: the thirty of the chunk, same rules plus an era and an intro
  "src/web/js/classics-more.js", "src/web/js/classics-more-en.js", "src/web/js/classics-more-ja.js",
]);
const Chess = ctx.Chess;
const TEN = ctx.CHESS_CLASSICS;
const MORE = ctx.CHESS_CLASSICS_MORE_ZH;
const games = [...TEN, ...MORE.games];
const more = new Set(MORE.games.map((g) => g.id));

// ------------------------------------------------------------------ games
assert(TEN.length === 10 && MORE.games.length === 30 && games.length === 40,
  "40 classics: 10 in the bundle, 30 in the chunk (" + TEN.length + " + " + MORE.games.length + ")");
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
    // notes: enough of them, in order, each at a ply that was played. The
    // ten are the 读棋 module's long reads (6–12); the thirty of v8-4-plan T2
    // are shorter, 3–6, with an intro paragraph and an era in the catalog
    const [lo, hi] = more.has(g.id) ? [3, 6] : [6, 12];
    if (!Array.isArray(g.notes) || g.notes.length < lo || g.notes.length > hi) {
      fail(g.id, "needs " + lo + "–" + hi + " notes, has", g.notes ? g.notes.length : 0);
    }
    if (more.has(g.id)) {
      if (!MORE.groups.some((gr) => gr.id === g.g)) fail(g.id, "era group unknown:", g.g);
      if (typeof g.intro !== "string" || g.intro.length < 20) fail(g.id, "needs an intro paragraph");
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
        // …and the move it quotes is the one played there (v8-4-plan T2)
        const san = /^\d+\.{1,3}\s?((?:O-O(?:-O)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?)[+#]?)/.exec(note.text);
        if (san && san[1] !== c.history()[note.ply - 1]) fail(g.id, "note at ply " + note.ply + " quotes " + san[1] + " but the move there is " + c.history()[note.ply - 1]);
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
  const ten = ctx["CHESS_CLASSICS_" + lang.toUpperCase()];
  const thirty = ctx["CHESS_CLASSICS_MORE_" + lang.toUpperCase()];
  assert(ten && typeof ten === "object" && thirty && typeof thirty === "object", "classics-" + lang + ".js and classics-more-" + lang + ".js export tables");
  if (!ten || !thirty) continue;
  const table = Object.assign({}, ten, thirty);
  const byId = new Map(games.map((g) => [g.id, g]));
  const uncovered = games.filter((g) => !table[g.id]).map((g) => g.id);
  assert(uncovered.length === 0, "all " + games.length + " classics have " + lang + " text" + (uncovered.length ? ": " + uncovered.join(", ") : ""));
  let bad = 0;
  const fail = (...m) => { bad++; console.error("FAIL:", ...m); };
  for (const [id, tr] of Object.entries(table)) {
    const g = byId.get(id);
    if (!g) { fail(lang, "translation for unknown classic", id); continue; }
    for (const k of Object.keys(tr)) {
      if (!["white", "black", "event", "notes"].concat(more.has(id) ? ["intro"] : []).includes(k)) fail(lang, id, "unexpected key in translation:", k);
    }
    if (more.has(id) !== Object.prototype.hasOwnProperty.call(thirty, id)) fail(lang, id, "translation sits in the wrong file for its game");
    for (const k of more.has(id) ? ["white", "black", "event", "intro"] : ["white", "black", "event"]) {
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
      // a translated note quotes the same move as the original
      const SAN = /^(\d+\.{1,3}\s?(?:O-O(?:-O)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?)[+#]?)/;
      const mo = SAN.exec(n.text), mt = typeof t === "string" ? SAN.exec(t) : null;
      if (more.has(id) && mo && (!mt || mt[1] !== mo[1])) fail(lang, id, "note at ply", n.ply, "quotes", mt && mt[1], "not", mo[1]);
    }
  }
  assert(bad === 0, lang + " classics match the originals and are translated");
  if (lang === "ja") checkJapanese("ja classics prose", table, 0.9, 300);
  // the era names, in the order the chunk lists them
  const at = lang === "en" ? 1 : 2;
  const names = MORE.groups.map((gr) => gr.n[at]);
  assert(names.every((x, i) => typeof x === "string" && x.trim() && !untranslated(lang, x, MORE.groups[i].n[0])), lang + " era names: " + names.join(" / "));
  if (lang === "ja") checkJapanese("ja era names", names, 0.5, 4);
}

// ------------------------------------------- engine record (v8-4-plan T2)
// docs/classics-verified.json is scripts/verify-classics.mjs's run: every
// master move of the forty against Stockfish's first choice. It is held to
// the games as they are now — a game edited after its check fails here until
// the script is run again — and every move it flags as a blunder-sized drop
// in one of the thirty is either spoken of in a note on that ply or listed in
// NOT_NOTED with the reason it is left unremarked.
/** flagged plies of the thirty left without a note of their own, and why */
const NOT_NOTED = {
  // the swings of a mutual attack (depth 18: 22...Rc7 0.00 against 22...Qc4
  // +3.6, 24.Rhd1 −2.6, 24...Rc3 −0.9, 27...Kh7 0.00); the move that lost it,
  // 28.Kxa3 (Qf5+ draws), has the note (ply 55), with 19.exf7+ (ply 37)
  "pillsbury-lasker-1896:44": "22...Rc7 — one of the swings; see ply 55",
  "pillsbury-lasker-1896:47": "24.Rhd1 — one of the swings; see ply 55",
  "pillsbury-lasker-1896:48": "24...Rc3 — one of the swings; see ply 55",
  "pillsbury-lasker-1896:54": "27...Kh7 — one of the swings; see ply 55",
  // one note per mistake pair: the reply is the one remarked on
  "pillsbury-lasker-1904:37": "19.f4 — answered by 19...exf4?, whose note (ply 38) covers the exchange",
  "torre-lasker-1925:44": "22...h6 — the weakening that 24...Qb5? (ply 48) turns into a loss",
};
{
  const rec = JSON.parse(fs.readFileSync(path.join(root, "docs/classics-verified.json"), "utf8"));
  assert(rec.depth >= 16 && rec.flag === 20, "the record is a depth ≥ 16 search, flagging drops of 20 win-% points (" + rec.depth + " / " + rec.flag + ")");
  const byId = new Map(rec.games.map((r) => [r.id, r]));
  const stale = [];
  for (const g of games) {
    const r = byId.get(g.id);
    const c = new Chess();
    c.load_pgn(g.pgn, { sloppy: true });
    if (!r || r.moves !== c.history().join(" ") || r.plies !== c.history().length) stale.push(g.id);
  }
  assert(rec.games.length === 40 && stale.length === 0, "the engine record covers all 40 games, each with its current move list (re-run verify-classics after editing a game)" + (stale.length ? ": " + stale.join(", ") : ""));
  const flagged = rec.games.reduce((a, r) => a + r.flagged.length, 0);
  assert(rec.summary && rec.summary.games === 40 && rec.summary.flagged === flagged, "the record's summary adds up (" + flagged + " flagged plies)");
  const unnoted = [];
  for (const g of MORE.games) {
    for (const f of (byId.get(g.id) || { flagged: [] }).flagged) {
      if (!g.notes.some((n) => n.ply === f.ply) && !NOT_NOTED[g.id + ":" + f.ply]) unnoted.push(g.id + " ply " + f.ply + " " + f.san);
    }
  }
  assert(unnoted.length === 0, "each flagged master move of the thirty has a note on its ply or a reason to stay unremarked" + (unnoted.length ? ": " + unnoted.join("; ") : ""));
}

// ------------------------------------------------------ punctuation rule
// cjk-punct.mjs lists the files it audits and classics is not among them, so
// the same transform is run here on the two CJK sources.
{
  let hits = 0;
  for (const rel of ["src/web/js/classics.js", "src/web/js/classics-ja.js", "src/web/js/classics-more.js", "src/web/js/classics-more-ja.js"]) {
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
