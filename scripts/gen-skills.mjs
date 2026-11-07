/**
 * The skill graph's positions (v20-0-plan §2 L1), picked and proved.
 *
 *   node scripts/gen-skills.mjs           → src/app/content/practice.js, src/app/content/lessons.js
 *   node scripts/gen-skills.mjs --check   → fails if either file would change
 *
 * For every node of src/app/content/skills.js, 3–5 positions, easy to hard:
 *   1. its 19.0 lessons' tasks (data/v19/lessons*.js): a star task becomes a
 *      move mini-game (src/app/learn/minigame.js proves the stored path and
 *      finds the fewest moves); a move task is held to its goal
 *      (src/app/learn/goals.js) by its own solution;
 *   2. generated positions for what the pools hardly have below 600: the
 *      mini-games ("move the rook to take every pawn"), castling, en passant,
 *      check, the stalemate trap, the basic mates — found by search, every
 *      one proved the same way;
 *   3. a stretch of a 19.0 classic game to guess (data/v19/classics.js), where
 *      the skill names one;
 *   4. puzzles from the existing pools — the 168 hand-written, the 980 mined,
 *      the 40 000 Lichess (CC0) — by theme, motif or line motif
 *      (src/app/core/motif.js lineMotif) and by rating around the skill's level.
 *      Each passes scripts/lib/puzzle-gate.mjs again (legal, canonical SAN,
 *      mates forced and needing their whole budget, material swings real);
 *      a mate-in-two is kept only when its first move is the only one that
 *      forces mate, so the stored line is the answer.
 * Every position records `needs`: the skills its line uses (the men that
 * move, castling, en passant, promotion, capturing, check, mate). A position
 * is only given to a skill whose prerequisites include all of them — so a
 * beginner who has not met the knight never gets a knight puzzle — and
 * scripts/app/skills.test.mjs checks it again on the written file.
 * Ratings are made non-decreasing along each skill's list.
 *
 * Also written: the endgame drills (19.0 endgames.js and the lesson drills),
 * the opening lines (19.0 openings.js, the lines that have an idea), the
 * placement pool, and the lessons' Chinese text (en / ja follow from
 * lessons-en.js / lessons-ja.js by the same ids).
 * @module gen-skills
 */
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

process.removeAllListeners("warning");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const V19 = path.join(ROOT, "data/v19");
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const { Chess } = await imp("src/app/core/chess.js");
const { gate, whiteHasForcedMate } = await imp("scripts/lib/puzzle-gate.mjs");
const { lineMotif } = await imp("src/app/core/motif.js");
const { CHESS_LESSONS } = await imp("data/v19/lessons.js");
const { CHESS_LESSONS_ADV_ZH } = await imp("data/v19/lessons-adv.js");
const { CHESS_PUZZLES } = await imp("data/v19/puzzles.js");
const { MINED_PUZZLES } = await imp("data/v19/puzzles-mined.js");
const { CHESS_ENDGAMES } = await imp("data/v19/endgames.js");
const { CHESS_OPENINGS, CHESS_OPENING_NAMES } = await imp("data/v19/openings.js");
const { CHESS_CLASSICS } = await imp("data/v19/classics.js");
const { CHESS_OPENING_IDEAS_ZH_CN } = await imp("data/v19/openings-ideas-zh.js");
// the same content's English and Japanese, by the same ids (19.0's chunk-lang-en / -ja)
const TR = {
  en: { lessons: { ...(await imp("data/v19/lessons-en.js")).CHESS_LESSONS_EN, ...(await imp("data/v19/lessons-adv-en.js")).CHESS_LESSONS_ADV_EN },
    openings: (await imp("data/v19/openings-en.js")).CHESS_OPENINGS_EN, ideas: (await imp("data/v19/openings-en.js")).CHESS_OPENING_IDEAS_EN,
    classics: (await imp("data/v19/classics-en.js")).CHESS_CLASSICS_EN, n: 1, sep: ", " },
  ja: { lessons: { ...(await imp("data/v19/lessons-ja.js")).CHESS_LESSONS_JA, ...(await imp("data/v19/lessons-adv-ja.js")).CHESS_LESSONS_ADV_JA },
    openings: (await imp("data/v19/openings-ja.js")).CHESS_OPENINGS_JA, ideas: (await imp("data/v19/openings-ja.js")).CHESS_OPENING_IDEAS_JA,
    classics: (await imp("data/v19/classics-ja.js")).CHESS_CLASSICS_JA, n: 2, sep: "、" },
};
const { SKILLS, SKILL, ancestors } = await imp("src/app/content/skills.js");
const MG = await imp("src/app/learn/minigame.js");
const { judge } = await imp("src/app/learn/goals.js");

const CHECK = process.argv.includes("--check");
const OUT_PRACTICE = path.join(ROOT, "src/app/content/practice.js");
const OUT_LESSONS = path.join(ROOT, "src/app/content/lessons.js");
const OUT_WORDS = (lang) => path.join(ROOT, "src/app/content/words." + lang + ".js");
const MAX = 5, MIN = 3;
const problems = [];
const fail = (msg) => problems.push(msg);

// --- sources --------------------------------------------------------------------

const LESSONS = Object.fromEntries([...CHESS_LESSONS, ...CHESS_LESSONS_ADV_ZH].map((l) => [l.id, l]));

function lichess() {
  const out = [];
  for (const f of fs.readdirSync(path.join(V19, "lichess")).sort()) {
    const text = fs.readFileSync(path.join(V19, "lichess", f), "utf8");
    const rows = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1).replace(/,\s*\]$/, "]"));
    for (const [id, fen, line, rating, cat, themes, n] of rows) {
      out.push({ id: "lc:" + id, fen, solution: line.split(" "), rating, cat, themes: themes ? themes.split(" ") : [],
        gain: n, saves: n, src: "lichess" });
    }
  }
  return out;
}
const HAND_RATING = { m1: 500, m2: 900, m3: 1300, win: 450, def: 700, tac: 1000 };
const POOL = [
  ...CHESS_PUZZLES.filter((p) => HAND_RATING[p.cat]).map((p) => ({ ...p, id: "hd:" + p.id, solution: p.solution || p.line,
    rating: HAND_RATING[p.cat] + (p.gain ? Math.min(p.gain, 9) * 10 : 0), themes: [p.cat], src: "hand", hand: p.id })),
  ...MINED_PUZZLES.map((p) => ({ ...p, id: "mn:" + p.id, themes: [p.cat, ...(p.motif ? [p.motif] : [])], src: "mined" })),
  ...lichess(),
];

// --- facts about a line ---------------------------------------------------------

const PIECE_SKILL = { r: "rook", b: "bishop", q: "queen", n: "knight", k: "king", p: "pawn" };

/** Walk a SAN line; what it takes to play it. null if it is not legal and canonical. */
function walk(fen, sans) {
  let g;
  try { g = new Chess(fen); } catch { return null; }
  if (!g.fen()) return null;
  const side = fen.split(" ")[1];
  const needs = new Set(), moves = [];
  for (let i = 0; i < sans.length; i++) {
    const mv = g.move(sans[i]);
    if (!mv || mv.san !== sans[i]) return null;
    moves.push(mv);
    needs.add(PIECE_SKILL[mv.piece]);
    if (/[kq]/.test(mv.flags)) needs.add("castling");
    if (mv.flags.includes("e")) needs.add("en-passant");
    if (mv.promotion) needs.add("promotion");
    if (mv.captured) needs.add("capture");
    if (g.in_check() && mv.color === side) needs.add("check");
  }
  if (g.in_checkmate()) needs.add("mate");
  return { needs, moves, mates: g.in_checkmate(), final: g.fen(), side };
}

/** Does a position's `needs` stay inside what `skill` stands on? */
function fits(skill, needs) {
  const ok = ancestors(skill);
  ok.add(skill);
  return [...needs].every((n) => ok.has(n));
}

// --- items ---------------------------------------------------------------------

const ITEMS = {};
function add(item) {
  if (ITEMS[item.id]) {
    // a position shared by two skills keeps the first; the second gets its own copy
    item = { ...item, id: item.id + "@" + item.skill };
  }
  ITEMS[item.id] = item;
  return item.id;
}

/** A 19.0 lesson's move and star tasks as items. */
function lessonItems(skill, lessonId) {
  const l = LESSONS[lessonId];
  if (!l) { fail(skill + ": no lesson " + lessonId); return []; }
  const out = [];
  l.tasks.forEach((t, i) => {
    const id = "ls:" + lessonId + ":" + i;
    if (t.type === "stars") {
      const from = t.solution[0].slice(0, 2);
      const board = MG.boardOf(t.fen);
      const only = (t.only || board[from] || "").toLowerCase();
      // the mini-game knows no attacks: a king walk past enemy men is not one
      if (only === "k" && Object.entries(board).some(([, p]) => /[qrbn]/.test(p))) return;
      let g = MG.start(t.fen, t.stars, only);
      for (const u of t.solution) { g = g && MG.play(g, u.slice(0, 2), u.slice(2, 4)); }
      if (!g || !g.done) { fail(id + ": the stored star path does not collect every star"); return; }
      const best = MG.solve(t.fen, t.stars, only);
      out.push({ id, kind: "stars", skill, fen: t.fen, only, targets: t.stars, par: best.par, prompt: t.prompt,
        needs: [skill], src: "lesson" });
    } else if (t.type === "move") {
      const task = { goal: t.goal, accept: t.accept, target: t.target };
      const r = judge(t.fen, t.solution[0], task);
      if (!r || !r.ok) { fail(id + ": the solution does not meet its goal"); return; }
      const w = walk(t.fen, [r.san]);
      const needs = new Set(w.needs);
      if (t.goal === "mate") needs.add("mate");
      if (t.goal === "check") needs.add("check");
      out.push({ id, kind: "move", skill, fen: t.fen, goal: t.goal, ...(t.accept ? { accept: t.accept } : {}),
        ...(t.target ? { target: t.target } : {}), answer: r.san, prompt: t.prompt, retry: t.retry || null,
        needs: [...needs].sort(), src: "lesson" });
    } else if (t.type === "drill") {
      // drills are listed with the skill's drills (lesson:<id>), not as positions
    }
  });
  return out;
}

// --- generated positions ----------------------------------------------------------

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const SQS = [];
for (let r = 1; r <= 8; r++) for (const f of "abcdefgh") SQS.push(f + r);

/** Mini-games for one kind of man: more targets and more walls as they get harder. */
function starGames(skill, kind) {
  const rnd = rng(kind.charCodeAt(0) * 7919 + 17);
  const promote = kind === "P";
  const only = kind.toLowerCase();
  const plan = only === "p" && !promote ? [[2, 0], [3, 0], [3, 1], [4, 1]] : [[2, 0], [3, 0], [3, 2], [4, 3], [5, 3]];
  const out = [];
  plan.forEach(([targets, walls], level) => {
    for (let tries = 0; tries < 4000; tries++) {
      const pick = () => SQS[Math.floor(rnd() * 64)];
      const board = {};
      const home = only === "p" ? (promote ? "abcdefgh"[Math.floor(rnd() * 8)] + (6 + Math.floor(rnd() * 2)) : "abcdefgh"[1 + Math.floor(rnd() * 6)] + "2") : pick();
      board[home] = only === "p" ? "P" : only.toUpperCase();
      const tg = [];
      while (tg.length < targets) {
        const s = pick();
        if (board[s] || (/[18]/.test(s[1]) && !promote)) continue;
        board[s] = "p"; tg.push(s);
      }
      for (let i = 0; i < walls; i++) {
        const s = pick();
        if (!board[s] && !/[18]/.test(s[1])) board[s] = "P";
      }
      const fen = MG.fenOf(board);
      const best = MG.solve(fen, tg, promote ? "p" : only, { maxMoves: 12 });
      if (!best || best.par < targets + (level >= 2 ? 1 : 0)) continue;
      if (promote && !best.path.some((u) => u[3] === "8")) continue;
      if (best.par > targets + 4) continue;
      out.push({ id: "gen:" + skill + ":" + level, kind: "stars", skill, fen, only: promote ? "p" : only, targets: tg,
        par: best.par, needs: [skill], src: "gen", rating: SKILL[skill].level - 60 + level * 20 + best.par * 2 });
      break;
    }
  });
  return out;
}

const kingFree = (fen) => { try { const g = new Chess(fen); return !!g.fen() && !g.in_check(); } catch { return false; } };
const legal = (fen) => new Chess().validate_fen(fen).valid;

/** Random positions of `men` (white upper, black lower) where `test(g)` holds. */
function search(seed, men, test, { n, tries = 60000, extra } = {}) {
  const rnd = rng(seed);
  const out = [], seen = new Set();
  for (let t = 0; t < tries && out.length < n; t++) {
    const board = {};
    for (const m of men) {
      let s;
      do { s = SQS[Math.floor(rnd() * 64)]; } while (board[s] || (m.toLowerCase() === "p" && /[18]/.test(s[1])));
      board[s] = m;
    }
    const fen = MG.fenOf(board);
    if (!legal(fen) || seen.has(fen)) continue;
    // White to move, and Black not already in check
    if (!kingFree(fen.replace(" w ", " b "))) continue;
    const g = new Chess(fen);
    const r = test(g, fen, out.length);
    if (r) { seen.add(fen); out.push({ fen, ...r }); }
  }
  return out;
}
const mateMoves = (g) => g.moves().filter((m) => { g.move(m); const x = g.in_checkmate(); g.undo(); return x; });
const stalemates = (g) => g.moves().filter((m) => { g.move(m); const x = g.in_stalemate(); g.undo(); return x; });

function moveItems(skill, list, goal, base, step = 25) {
  return list.map((p, i) => {
    const r = judge(p.fen, p.answer, { goal });
    if (!r || !r.ok) { fail(skill + ": generated answer fails"); return null; }
    const w = walk(p.fen, [r.san]);
    const needs = new Set(w.needs);
    if (goal === "mate") needs.add("mate");
    if (goal === "check") needs.add("check");
    return { id: "gen:" + skill + ":" + i, kind: "move", skill, fen: p.fen, goal, answer: r.san, promptKey: "goal." + goal,
      needs: [...needs].sort(), src: "gen", rating: base + i * step };
  }).filter(Boolean);
}

const GEN = {
  castle(skill) {
    const fens = ["4k3/8/8/8/8/8/8/4K2R w K - 0 1", "r3k3/8/8/8/8/8/8/R3KB1R w KQ - 0 1", "4k3/pppp4/8/8/8/5N2/PPPPBPPP/RNBQK2R w KQ - 0 1"];
    return moveItems(skill, fens.map((fen) => ({ fen, answer: new Chess(fen).moves().find((m) => m.startsWith("O-O")) })), "castle", 280);
  },
  ep(skill) {
    const fens = ["4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1", "4k3/8/8/5pP1/8/8/8/4K3 w - f6 0 1", "6k1/8/8/pP6/8/8/8/6K1 w - a6 0 1"];
    return moveItems(skill, fens.map((fen) => ({ fen, answer: new Chess(fen).moves({ verbose: true }).find((m) => m.flags.includes("e")).san })), "ep", 330);
  },
  check(skill) {
    // fewer checking moves, harder: many → two → one, with a knight last
    const want = [[["K", "Q", "k"], (n) => n >= 5], [["K", "R", "k"], (n) => n === 2], [["K", "B", "k"], (n) => n === 1], [["K", "N", "k"], (n) => n === 1]];
    return want.flatMap(([men, ok], i) => {
      const found = search(101 + i, men, (g) => {
        const checks = g.moves().filter((m) => m.endsWith("+"));
        return ok(checks.length) ? { answer: checks[0] } : null;
      }, { n: 1 });
      return found;
    }).map((p, i, all) => moveItems(skill, [p], "check", 280 + i * 20)[0]).map((x, i) => ({ ...x, id: "gen:" + skill + ":" + i }));
  },
  stalemate(skill) {
    const found = search(202, ["K", "Q", "k"], (g, fen, k) => {
      const m = mateMoves(g), s = stalemates(g);
      return m.length === 1 && s.length >= 1 + k ? { answer: m[0] } : null;
    }, { n: 3 });
    return moveItems(skill, found, "mate", 440);
  },
  ladder(skill) {
    const found = search(303, ["K", "R", "R", "k"], (g) => {
      const m = mateMoves(g);
      return m.length === 1 && g.moves().filter((x) => x.endsWith("+")).length >= 3 ? { answer: m[0] } : null;
    }, { n: 3 });
    return moveItems(skill, found, "mate", 470);
  },
  kqk(skill) {
    const found = search(404, ["K", "Q", "k"], (g, fen, k) => {
      const m = mateMoves(g);
      return m.length === 1 && stalemates(g).length === 0 && g.moves().filter((x) => x.endsWith("+")).length >= 3 + k ? { answer: m[0] } : null;
    }, { n: 3 });
    return moveItems(skill, found, "mate", 560);
  },
  krk(skill) {
    const found = search(505, ["K", "R", "k"], (g) => {
      const m = mateMoves(g);
      return m.length === 1 ? { answer: m[0] } : null;
    }, { n: 3 });
    return moveItems(skill, found, "mate", 650);
  },
  kbbk(skill) {
    const found = search(606, ["K", "B", "B", "k"], (g, fen) => {
      const b = Object.entries(MG.boardOf(fen)).filter(([, p]) => p === "B").map(([s]) => (s.charCodeAt(0) + Number(s[1])) % 2);
      if (b[0] === b[1]) return null;
      const m = mateMoves(g);
      return m.length === 1 ? { answer: m[0] } : null;
    }, { n: 3, tries: 300000 });
    return moveItems(skill, found, "mate", 1200);
  },
};

// --- pool puzzles ------------------------------------------------------------------

const decoded = POOL;
/** A mate-in-n whose first move is not the only one that forces mate is ambiguous as a line. */
function uniqueFirst(p, n) {
  if (n < 2) return true;
  const g = new Chess(p.fen);
  for (const m of g.moves()) {
    if (m === p.solution[0]) continue;
    g.move(m);
    const mate = g.in_checkmate();
    const forced = mate || (!g.game_over() && blackLost(g, n - 1));
    g.undo();
    if (forced) return false;
  }
  return true;
}
function blackLost(g, n) {
  const replies = g.moves();
  if (!replies.length) return false;
  for (const r of replies) {
    g.move(r);
    const lost = whiteHasForcedMate(g, n);
    g.undo();
    if (!lost) return false;
  }
  return true;
}
const MATE_N = { m1: 1, m2: 2, m3: 3 };
const gateCache = new Map();
function passes(p) {
  if (gateCache.has(p.id)) return gateCache.get(p.id);
  let ok = false;
  try {
    ok = gate(Chess, p).ok;
    if (ok && MATE_N[p.cat] === 2) ok = p.fen.split(" ")[1] === "w" ? uniqueFirst(p, 2) : true;
  } catch { ok = false; }
  gateCache.set(p.id, ok);
  return ok;
}

const pieceAt = (fen, sq) => new Chess(fen).get(sq);
function poolItems(skill, spec, have) {
  const s = SKILL[skill];
  const wide = spec.line ? 2 : 1;
  const lo = Math.max(spec.minRating || 0, s.level - 250 * wide), hi = s.level + 350 * wide;
  const want = MAX - have;
  if (want <= 0) return [];
  let cands = decoded.filter((p) => {
    if (spec.hand) return p.hand && spec.hand.includes(p.hand);
    if (p.rating < lo || p.rating > hi) return false;
    if (p.solution.length > (spec.maxPlies || 5)) return false;
    const themeOk = (spec.themes && spec.themes.some((t) => p.themes.includes(t))) || (spec.cats && spec.cats.includes(p.cat) && p.src !== "lichess");
    if (spec.line) return ["tac", "win"].includes(p.cat) && p.solution.length >= 3;
    if (!themeOk) return false;
    if (spec.motif && p.src !== "lichess" && p.motif !== spec.motif && !p.themes.includes(spec.motif)) return false;
    return true;
  });
  cands.sort((a, b) => a.rating - b.rating || (a.id < b.id ? -1 : 1));
  const picked = [];
  // spread over the window: walk it in `want` steps, take the first that proves
  const steps = Math.max(want, 1);
  const used = new Set();
  for (let k = 0; k < steps; k++) {
    const target = lo + ((hi - lo) * (k + 0.5)) / steps;
    const order = cands.map((p, i) => [Math.abs(p.rating - target), i]).sort((a, b) => a[0] - b[0]).map(([, i]) => cands[i]);
    let tried = 0;
    for (const p of order) {
      if (used.has(p.id) || tried > (spec.line ? 3000 : 400)) continue;
      tried++;
      if (ITEMS[p.id] && ITEMS[p.id].skill !== skill) continue;
      const w = walk(p.fen, p.solution);
      if (!w) continue;
      if (spec.piece && w.moves[0].piece !== spec.piece) continue;
      if (spec.mateBy === "q-adjacent") {
        const last = w.moves[w.moves.length - 1];
        const k = new Chess(w.final).board().flat().find((q) => q && q.type === "k" && q.color !== last.color);
        if (!w.mates || last.piece !== "q" || !k) continue;
        const ks = SQS.find((sq) => { const q = pieceAt(w.final, sq); return q && q.type === "k" && q.color !== last.color; });
        if (Math.max(Math.abs(ks.charCodeAt(0) - last.to.charCodeAt(0)), Math.abs(Number(ks[1]) - Number(last.to[1]))) !== 1) continue;
      }
      if (spec.line) {
        let lm = null;
        try { lm = lineMotif(p.fen, p.solution, Chess); } catch { lm = null; }
        if (!lm || lm.motif !== spec.line) continue;
      }
      if (!fits(skill, w.needs)) continue;
      if (!passes(p)) continue;
      used.add(p.id);
      picked.push({ id: p.id, kind: "line", skill, fen: p.fen, line: p.solution, side: w.side, mode: "puzzle",
        rating: p.rating, needs: [...w.needs].sort(), src: p.src, ...(p.themes.length ? { themes: p.themes.filter((t) => !/^m\d$/.test(t)).slice(0, 4) } : {}) });
      break;
    }
  }
  return picked;
}

// --- openings and drills --------------------------------------------------------------

function openingItems(skill, specs) {
  const out = [];
  for (const { prefix, side, n } of specs) {
    const rows = CHESS_OPENINGS.filter(([, id, sans]) => CHESS_OPENING_IDEAS_ZH_CN[id] && (sans + " ").startsWith(prefix + " "))
      .sort((a, b) => a[2].split(" ").length - b[2].split(" ").length || (a[1] < b[1] ? -1 : 1));
    for (const [eco, id, sans] of rows.filter(([, id]) => !ITEMS["op:" + id] && !out.some((x) => x.id === "op:" + id)).slice(0, n)) {
      const line = sans.split(" ").slice(0, 16);
      const w = walk("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", line);
      if (!w) { fail(skill + ": opening " + id + " illegal"); continue; }
      const needs = new Set([...w.needs].filter((x) => x !== "capture" && x !== "check"));
      out.push({ id: "op:" + id, kind: "line", mode: "opening", skill, fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        line, side, eco, name: CHESS_OPENING_NAMES[id] || id, idea: CHESS_OPENING_IDEAS_ZH_CN[id],
        rating: SKILL[skill].level + line.length * 5, needs: [...needs].sort(), src: "opening" });
    }
  }
  return out;
}

/** A stretch of a 19.0 classic game to guess, move by move, from the winner's chair. */
function classicItem(skill, { id, from, plies }) {
  const c = CHESS_CLASSICS.find((x) => x.id === id);
  if (!c) { fail(skill + ": no classic " + id); return null; }
  const sans = c.pgn.replace(/\d+\.(\.\.)?/g, " ").replace(/\s(1-0|0-1|1\/2-1\/2)\s*$/, "").trim().split(/\s+/);
  const g = new Chess();
  for (const san of sans.slice(0, from)) if (!g.move(san)) { fail(skill + ": classic " + id + " illegal"); return null; }
  const line = sans.slice(from, from + plies);
  const w = walk(g.fen(), line);
  if (!w) { fail(skill + ": classic " + id + " line illegal"); return null; }
  if (!fits(skill, w.needs)) { fail(skill + ": classic " + id + " needs " + [...w.needs].join(",")); return null; }
  const note = (c.notes || []).find((n) => n.ply >= from && n.ply < from + plies);
  return { id: "cl:" + id + ":" + from, kind: "line", mode: "classic", skill, fen: g.fen(), line, side: w.side,
    name: c.white + " — " + c.black + "，" + c.event + " " + c.year, idea: note ? note.text : null,
    rating: SKILL[skill].level + 100, needs: [...w.needs].sort(), src: "classic" };
}

const EG = Object.fromEntries(CHESS_ENDGAMES.ITEMS.map((e) => [e.id, e]));
function drillItem(skill, ref) {
  const it = drillOf(skill, ref);
  if (it && (!legal(it.fen) || it.fen.split(" ")[1] !== "w" || !new Chess(it.fen).moves().length)) { fail(it.id + ": not a playable position"); return null; }
  return it;
}
function drillOf(skill, ref) {
  if (ref.startsWith("lesson:")) {
    const l = LESSONS[ref.slice(7)];
    const t = l && l.tasks.find((x) => x.type === "drill");
    if (!t) { fail(skill + ": no drill in " + ref); return null; }
    return { id: "dr:" + ref, kind: "drill", skill, fen: t.fen, goal: t.winOn === "promote" ? "promote" : "win", prompt: t.prompt,
      rating: SKILL[skill].level, src: "lesson" };
  }
  const e = EG[ref];
  if (!e) { fail(skill + ": no endgame " + ref); return null; }
  return { id: "dr:" + ref, kind: "drill", skill, fen: e.fen, goal: e.goal, name: e.n[0], prompt: e.tip[0], rating: SKILL[skill].level + 50, src: "endgame" };
}

// --- per skill -------------------------------------------------------------------------

const PRACTICE = {}, DRILLS = {}, LESSON_TEXT = {}, skipped = [];
for (const s of SKILLS) {
  const fromLessons = s.lessons.flatMap((id) => lessonItems(s.id, id));
  for (const id of s.lessons) {
    const l = LESSONS[id];
    if (l) LESSON_TEXT[id] = { title: l.title, text: l.text };
  }
  let list = [];
  if (s.stars) list.push(...starGames(s.id, s.stars));
  if (s.gen) list.push(...GEN[s.gen](s.id));
  const lessonFirst = fromLessons.filter((x) => fits(s.id, x.needs));
  // a task that uses what the skill does not yet stand on is left out (it teaches something later)
  for (const x of fromLessons) if (!fits(s.id, x.needs)) skipped.push(x.id + " (" + x.needs.join(",") + ")");
  // lessons first (the teaching order), then generated, then pool; at most five
  const cap = list.length ? 2 : s.pool || s.lines ? 3 : MAX;
  list = [...lessonFirst.slice(0, cap), ...list].slice(0, MAX);
  if (s.lines) list.push(...openingItems(s.id, s.lines).slice(0, MAX - list.length));
  if (s.classic) { const c = classicItem(s.id, s.classic); if (c && list.length < MAX) list.push(c); }
  if (s.pool) list.push(...poolItems(s.id, s.pool, list.length));
  list = list.slice(0, MAX);
  // ratings: the lesson tasks below the rest, then non-decreasing
  let r = Math.max(50, SKILL[s.id].level - 150);
  for (const x of list) {
    const set = x.rating == null;
    x.rating = Math.round(Math.max(set ? r : x.rating, r));
    r = x.rating + (set ? 15 : 0);
  }
  if (list.length < MIN) fail(s.id + ": only " + list.length + " positions");
  PRACTICE[s.id] = list.map(add);
  DRILLS[s.id] = (s.drills || []).map((d) => drillItem(s.id, d)).filter(Boolean).map(add);
}

// --- placement: six answers, steps 300 … 50 (19.0's 定级); a pool every 100 points ---------
const PLACEMENT = [];
{
  const taken = new Set(Object.keys(ITEMS));
  for (let r = 600; r <= 2400; r += 100) {
    const cands = decoded.filter((p) => p.src === "lichess" && Math.abs(p.rating - r) <= 40 && p.solution.length <= 3 && !taken.has(p.id) &&
      ["m1", "m2", "tac", "win"].includes(p.cat))
      .sort((a, b) => Math.abs(a.rating - r) - Math.abs(b.rating - r) || (a.id < b.id ? -1 : 1));
    let k = 0;
    for (const p of cands) {
      if (k >= 3) break;
      const w = walk(p.fen, p.solution);
      if (!w || !passes(p)) continue;
      taken.add(p.id); k++;
      PLACEMENT.push(add({ id: p.id, kind: "line", skill: null, fen: p.fen, line: p.solution, side: w.side, mode: "puzzle",
        rating: p.rating, needs: [...w.needs].sort(), src: "lichess", placement: true }));
    }
  }
}

// --- the words in English and Japanese (content/words.<lang>.js) ---------------------------
// Every item's prompt / retry / name / idea and every lesson's title and text,
// from 19.0's translations by the same ids; a missing one is a problem, so the
// app never shows Chinese inside an English or Japanese page.
const WORDS = {};
for (const [lang, T] of Object.entries(TR)) {
  const items = {}, lessons = {};
  const need = (what, v) => { if (v == null || v === "") fail(lang + ": no translation for " + what); return v; };
  for (const it of Object.values(ITEMS)) {
    const base = it.id.split("@")[0], w = {};
    if (it.src === "lesson" && base.startsWith("ls:")) {
      const [, lid, i] = base.split(":");
      const t = ((T.lessons[lid] || {}).tasks || [])[Number(i)] || {};
      w.prompt = need(base + " prompt", t.prompt);
      if (it.retry) w.retry = need(base + " retry", t.retry);
    } else if (base.startsWith("dr:lesson:")) {
      const lid = base.slice(10), l = LESSONS[lid];
      const i = l.tasks.findIndex((x) => x.type === "drill");
      w.prompt = need(base + " prompt", (((T.lessons[lid] || {}).tasks || [])[i] || {}).prompt);
    } else if (it.src === "endgame") {
      const e = EG[base.slice(3)];
      w.name = need(base + " name", e.n[T.n]);
      w.prompt = need(base + " tip", e.tip[T.n]);
    } else if (it.src === "opening") {
      const id = base.slice(3);
      w.name = need(base + " name", T.openings[id]);
      w.idea = need(base + " idea", T.ideas[id]);
    } else if (it.src === "classic") {
      const [, id, from] = base.split(":");
      const c = CHESS_CLASSICS.find((x) => x.id === id), tc = T.classics[id] || {};
      w.name = need(base + " name", tc.white && tc.white + " — " + tc.black + T.sep + tc.event + " " + c.year);
      const note = (c.notes || []).find((n) => n.ply >= Number(from) && n.ply < Number(from) + it.line.length);
      if (it.idea) w.idea = need(base + " idea", note && tc.notes && tc.notes[note.ply]);
    }
    for (const k of ["prompt", "retry", "name", "idea"]) if (it[k] && !w[k]) fail(lang + ": " + it.id + " has a " + k + " with no translation");
    if (Object.keys(w).length) items[it.id] = w;
  }
  for (const id of Object.keys(LESSON_TEXT)) {
    const l = T.lessons[id] || {};
    lessons[id] = { title: need("lesson " + id + " title", l.title), text: need("lesson " + id + " text", l.text) };
    if (l.text && l.text.length !== LESSON_TEXT[id].text.length) fail(lang + ": lesson " + id + " has " + l.text.length + " paragraphs, zh " + LESSON_TEXT[id].text.length);
  }
  WORDS[lang] = { items, lessons };
}

// --- write ------------------------------------------------------------------------------

if (problems.length) {
  console.error(problems.join("\n"));
  console.error("\ngen-skills: " + problems.length + " problems");
  process.exit(1);
}
const counts = {
  skills: SKILLS.length,
  positions: Object.values(PRACTICE).reduce((n, l) => n + l.length, 0),
  drills: Object.values(DRILLS).reduce((n, l) => n + l.length, 0),
  placement: PLACEMENT.length,
  items: Object.keys(ITEMS).length,
};
const bySrc = {};
for (const it of Object.values(ITEMS)) bySrc[it.src] = (bySrc[it.src] || 0) + 1;

const HEAD = (what) => [
  "/**",
  " * " + what + " — generated by scripts/gen-skills.mjs from the skill graph",
  " * (content/skills.js) and the 19.0 content, do not edit.",
  " *",
  " * Lichess puzzles: https://database.lichess.org/#puzzles, CC0 1.0; ids are",
  " * the Lichess ids (lichess.org/training/<id>) after \"lc:\".",
  " * " + JSON.stringify(counts),
  " * by source: " + JSON.stringify(bySrc),
  " * @module content/" + (what.startsWith("Lessons") ? "lessons" : "practice"),
  " */",
];
const practiceText = [
  ...HEAD("Positions, drills and the placement pool"),
  "export const ITEMS = {",
  ...Object.values(ITEMS).map((it) => "  " + JSON.stringify(it.id) + ": " + JSON.stringify(it) + ","),
  "};",
  "/** skill → its positions, easy to hard */",
  "export const PRACTICE = " + JSON.stringify(PRACTICE, null, 0).replace(/\],/g, "],\n  ") + ";",
  "/** skill → its endgame drills */",
  "export const DRILLS = " + JSON.stringify(DRILLS) + ";",
  "/** the placement's pool, by rating */",
  "export const PLACEMENT = " + JSON.stringify(PLACEMENT) + ";",
  "",
].join("\n");
const lessonsText = [
  ...HEAD("Lessons' text (zh), from data/v19/lessons*.js by id"),
  "export const LESSONS = {",
  ...Object.entries(LESSON_TEXT).map(([id, l]) => "  " + JSON.stringify(id) + ": " + JSON.stringify(l) + ","),
  "};",
  "",
].join("\n");

const NAMES = { en: "English", ja: "Japanese" };
const wordsText = (lang) => [
  "/**",
  " * The content's words in " + NAMES[lang] + " — generated by scripts/gen-skills.mjs from 19.0's",
  " * translations by the same ids (data/v19/lessons-" + lang + ".js, lessons-adv-" + lang + ".js,",
  " * openings-" + lang + ".js, classics-" + lang + ".js, endgames.js), do not edit. Loaded with the",
  " * language (text/lang.js); content/practice.js and lessons.js keep the Chinese.",
  " * @module content/words." + lang,
  " */",
  "/** item id → { prompt, retry, name, idea } (whichever the item has) */",
  "export const ITEMS = {",
  ...Object.entries(WORDS[lang].items).map(([id, w]) => "  " + JSON.stringify(id) + ": " + JSON.stringify(w) + ","),
  "};",
  "/** lesson id → { title, text } */",
  "export const LESSONS = {",
  ...Object.entries(WORDS[lang].lessons).map(([id, l]) => "  " + JSON.stringify(id) + ": " + JSON.stringify(l) + ","),
  "};",
  "",
].join("\n");

if (CHECK) {
  const same = (f, t) => fs.existsSync(f) && fs.readFileSync(f, "utf8") === t;
  if (!same(OUT_PRACTICE, practiceText) || !same(OUT_LESSONS, lessonsText) || Object.keys(WORDS).some((l) => !same(OUT_WORDS(l), wordsText(l)))) {
    console.error("gen-skills --check: src/app/content is out of date; run node scripts/gen-skills.mjs");
    process.exit(1);
  }
  console.log("gen-skills --check: up to date " + JSON.stringify(counts));
} else {
  fs.writeFileSync(OUT_PRACTICE, practiceText);
  fs.writeFileSync(OUT_LESSONS, lessonsText);
  for (const l of Object.keys(WORDS)) fs.writeFileSync(OUT_WORDS(l), wordsText(l));
  console.log("gen-skills: " + JSON.stringify(counts) + " " + JSON.stringify(bySrc) +
    " · practice.js " + (practiceText.length / 1024).toFixed(0) + " KB · lessons.js " + (lessonsText.length / 1024).toFixed(0) + " KB" +
    " · " + skipped.length + " lesson tasks beyond their skill left out");
}
