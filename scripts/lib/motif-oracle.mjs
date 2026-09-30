/**
 * The rubric for v8-1-plan T6's motif sampling (scripts/sample-motifs.mjs).
 *
 * A motif claim in a coach sentence is correct when, and only when:
 *
 *   1. the move it is about is sound by the DEEP search (ten times the app's
 *      nodes): the refutation is the deep best, or within 80 cp of it; a
 *      better move is the deep best, or at least 50 cp better than the move
 *      played (scripts/lib/coach-oracle.mjs, B3's thresholds);
 *   2. the motif's geometry holds on the board after that move — asked of
 *      board facts written here, independently of motif.js;
 *   3. the deep line realises it: that move followed by the deep search's
 *      own line from the position after it takes the man the motif is about
 *      (or mates), and wins what it has to win.
 *
 * Each motif's rule is in RUBRIC, in the words the audit table prints.
 * The whole sentence is judged too (coach-oracle.mjs) and recorded beside
 * it, but the error rate is the motif's.
 *
 * @module motif-oracle
 */
import { oracle as sentenceOracle } from "./coach-oracle.mjs";

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const rankOf = (t) => (t === "k" ? 100 : VALUE[t]);
const other = (c) => (c === "w" ? "b" : "w");
const FILES = "abcdefgh";
const xy = (sq) => [sq.charCodeAt(0) - 97, Number(sq[1]) - 1];
const sqOf = (f, r) => FILES[f] + (r + 1);
const on = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;

/** Every key the app can name — motif.js LINE_MOTIF_KEYS, in its order. */
export const MOTIF_ORDER = ["hanging", "perpetual", "double", "discovered", "discoveredAttack", "fork",
  "zwischenzug", "desperado", "removeDefender", "overload", "deflection", "decoy", "pin", "skewer",
  "xray", "trapped", "mateThreat", "promotion", "backRank"];

const SOUND = "所说的那步棋经深搜成立（反击：深搜首选，或与首选差 ≤ 80cp；更好的着：深搜首选，或比所走好 ≥ 50cp）；";
/** The rule each verdict applies, as the audit prints it. "深搜线" = that move + the deep line after it. */
export const RUBRIC = {
  hanging: SOUND + "这步吃掉 ≥ 3 分的子，对方合法地吃不回（说「没保护」时）或是以小吃大（说「换不回来」时），且不是背后的闪将让它吃不回；深搜线净得 ≥ 2。「没理会威胁」另要求走之前同一步已能白吃。",
  perpetual: SOUND + "失着前深搜对走棋方 ≥ +150，失着后深搜在 ±30 之内；深搜线里攻方每一步都是将军，至少两步。",
  double: SOUND + "这步之后王同时被两个子将军；深搜线得子 ≥ 1 或将死。",
  discovered: SOUND + "这步之后是将军，将军的子不是走动的那个，而是走动的子让开了线；走动的子本身不将军（否则是双将）；深搜线得子 ≥ 1 或将死。",
  discoveredAttack: SOUND + "走动的子让开了一条线，线后的长兵器由此新打到对方 ≥ 3 分的子；深搜线里攻方随后吃到了被新打到的子或走动的子所打的子，净得 ≥ 1。",
  fork: SOUND + "走到的子同时打到两个目标（王、或 ≥ 3 分的子），这步本身不是白吃一子（吃回失着刚吃掉的不算）；深搜线里随后在原格吃到了被打到的子之一（多半是这个子自己，也可以是捉双让出来的别的子），净得 ≥ 1。只说「同时攻击 X 和 Y」时：确实打到这两个，它自己吃不掉，且至少一个非王目标没有保护或比它值钱。",
  zwischenzug: SOUND + "失着是吃子，对方本可以立刻吃回，却先走一步将军或吃子；深搜线里随后仍在原格吃回，扣掉失着吃到的，净得 ≥ 1。",
  desperado: SOUND + "吃子的子在走之前已经保不住（被攻击且无保护，或被更便宜的子攻击），而正是失着造成的；它吃的不是攻击它的子，随后在那里被吃掉；扣掉失着吃到的，净得 ≥ 1。",
  removeDefender: SOUND + "这步吃掉的子原本保护着另一个 ≥ 3 分的子；对方吃回后那个子已无保护，攻方下一步吃掉它；净得 ≥ 1。",
  overload: SOUND + "这步是吃子；对方吃回用的子原本还保护着另一个 ≥ 3 分的子，被引开后那个子无保护，攻方下一步吃掉它；净得 ≥ 1。",
  deflection: SOUND + "这步不是吃子（弃子）；对方吃它用的子原本保护着另一个 ≥ 3 分的子，被引开后那个子无保护，攻方下一步吃掉它；净得 ≥ 1。",
  decoy: SOUND + "这步不是吃子（弃子），对方的王或后吃了它；攻方下一步打到了站在那里的王或后；深搜线得子 ≥ 1 或将死。",
  pin: SOUND + "深搜线里被吃的子在这步之后站在攻方长兵器与对方更值钱的子（或王）之间的线上，并在原地被吃；这步不是白吃一子；净得 ≥ 1。",
  skewer: SOUND + "走到的长兵器线上前面是更值钱的子（或王），后面是 ≥ 3 分的子；前面的子让开，长兵器吃掉后面的子；净得 ≥ 1。",
  xray: SOUND + "吃子、被吃回、再由原先被挡在后面的长兵器在同一格吃回（走之前它打不到那一格）；净得 ≥ 1。",
  trapped: SOUND + "这步是不吃子、不将军的一步；它打到的某个 ≥ 3 分的子原地和每一个去处都会被得子地吃掉；深搜线里吃到了这种子，净得 ≥ 1。",
  mateThreat: SOUND + "这步不将军；这步之后（让攻方再走一步）有一步杀，这步之前没有；深搜线得子 ≥ 1 或将死。「没理会威胁」：走之前同一步就是杀，且失着之后深搜确为杀。",
  promotion: SOUND + "深搜线前六步内攻方升变，净得 ≥ 3 或将死。",
  backRank: SOUND + "深搜确认是杀，深搜线的最后一步由车或后在对方底线上将死，王在底线，王前面一排的格子都被自己的子占着、其中至少两个兵。",
};

/**
 * Human readings that overrule the oracle — filled after reading the cases
 * it marks wrong and a spot check of the ones it passes (the audit says
 * which). Each: { id, verdict, reason }.
 */
export const HUMAN = [];

function play(g, m) {
  let mv = null;
  try { mv = g.move(m); } catch (_) { mv = null; }
  return mv;
}
function withTurn(fen, c) { const p = fen.split(" "); p[1] = c; p[3] = "-"; return p.join(" "); }

/** The line as move records and the FEN after each, to the first move that will not play. */
function walk(Chess, fen, sans) {
  const g = new Chess(fen);
  const ms = [], fens = [];
  for (const s of sans) {
    const m = play(g, s);
    if (!m) break;
    ms.push(m); fens.push(g.fen());
    if (g.in_checkmate()) { ms.mate = true; break; }
  }
  return { ms, fens };
}
/** coach-oracle's count: walk at least four plies, then to the end of the exchange */
function netAlong(ms, side) {
  let s = 0, n = 0;
  for (const m of ms) {
    const sign = m.color === side ? 1 : -1;
    if (m.captured) s += sign * VALUE[m.captured];
    if (m.promotion) s += sign * (VALUE[m.promotion] - 1);
    n++;
    if (n >= 4 && !m.captured && n % 2 === 0) break;
  }
  if (ms.mate) s += ms[ms.length - 1].color === side ? 100 : -100;
  return s;
}

/** square → piece */
function gridOf(Chess, fen) {
  const g = new Chess(fen);
  const m = {};
  const b = g.board();
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) if (b[r][f]) m[sqOf(f, 7 - r)] = b[r][f];
  return m;
}
const DIRS = { b: [[1, 1], [1, -1], [-1, 1], [-1, -1]], r: [[1, 0], [-1, 0], [0, 1], [0, -1]] };
const JUMPS = { n: [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]],
  k: [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] };
/** squares attacked from `sq` (pseudo-legal, the man's own colour ignored) */
function attacked(grid, sq) {
  const p = grid[sq];
  if (!p) return [];
  const [f0, r0] = xy(sq);
  const out = [];
  if (p.type === "p") {
    const d = p.color === "w" ? 1 : -1;
    for (const df of [-1, 1]) if (on(f0 + df, r0 + d)) out.push(sqOf(f0 + df, r0 + d));
    return out;
  }
  if (JUMPS[p.type]) {
    for (const [df, dr] of JUMPS[p.type]) if (on(f0 + df, r0 + dr)) out.push(sqOf(f0 + df, r0 + dr));
    return out;
  }
  const dirs = p.type === "q" ? DIRS.b.concat(DIRS.r) : DIRS[p.type];
  for (const [df, dr] of dirs) {
    for (let i = 1; i < 8; i++) {
      const f = f0 + df * i, r = r0 + dr * i;
      if (!on(f, r)) break;
      out.push(sqOf(f, r));
      if (grid[sqOf(f, r)]) break;
    }
  }
  return out;
}
/** squares of `color` men attacking `sq` */
function attackersOf(grid, sq, color) {
  return Object.keys(grid).filter((s) => grid[s].color === color && attacked(grid, s).includes(sq));
}
/** is x strictly between a and b on a line */
function between(a, b, x) {
  const [af, ar] = xy(a), [bf, br] = xy(b), [xf, xr] = xy(x);
  const df = Math.sign(bf - af), dr = Math.sign(br - ar);
  const n = Math.max(Math.abs(bf - af), Math.abs(br - ar));
  if (bf - af !== df * n || br - ar !== dr * n) return false;
  for (let i = 1; i < n; i++) if (af + df * i === xf && ar + dr * i === xr) return true;
  return false;
}
/** Could `color` legally move onto `sq` if an enemy man stood there? */
function defended(Chess, fen, sq, color) {
  let g;
  try { g = new Chess(withTurn(fen, color)); } catch (_) { return false; }
  if (!g) return false;
  g.remove(sq);
  g.put({ type: "n", color: other(color) }, sq);
  return (g.moves({ verbose: true }) || []).some((m) => m.to === sq);
}
/** legal captures by `color` onto `sq` in `fen` */
function takes(Chess, fen, sq, color) {
  let g;
  try { g = new Chess(withTurn(fen, color)); } catch (_) { return []; }
  return (g.moves({ verbose: true }) || []).filter((m) => m.to === sq && m.captured);
}
function mateInOne(Chess, fen) {
  let g;
  try { g = new Chess(fen); } catch (_) { return false; }
  for (const m of g.moves({ verbose: true }) || []) { g.move(m); const x = g.in_checkmate(); g.undo(); if (x) return true; }
  return false;
}
function kingSq(grid, color) { return Object.keys(grid).find((s) => grid[s].type === "k" && grid[s].color === color) || null; }
/** an attacker move at an even ply ≥ 2 inside the first `w` plies that satisfies f */
const later = (c, f, w = 8) => c.ms.slice(0, w).some((x, i) => i > 0 && i % 2 === 0 && f(x, i));

// --- one rule per motif ----------------------------------------------------------
// c: { Chess, fen, ms, fens, A, V, net, mate, g0, g1, key, played, d, side }
const RULES = {
  hanging(c) {
    const m0 = c.ms[0];
    if (!m0.captured || VALUE[m0.captured] < 3) return [false, `${m0.san} 不吃 ≥ 3 分的子`];
    const g1 = c.g1;
    const k = kingSq(g1, c.V);
    if (k && attackersOf(g1, k, c.A).some((s) => s !== m0.to)) return [false, `${m0.san} 之后是背后的将军，吃不回是因为被将，不是没保护`];
    const free = !takes(c.Chess, c.fens[0], m0.to, c.V).length;
    const cheap = m0.piece !== "k" && VALUE[m0.piece] < VALUE[m0.captured];
    const saysFree = /^ex\.(threat|better)?[Hh]anging$/.test(c.key || "");
    if (saysFree && !free) return [false, `说「没保护」，其实能吃回 ${m0.to}`];
    if (!saysFree && !cheap && !free) return [false, `${m0.san} 既不是白吃也不是以小吃大`];
    if (c.net < 2 && !c.mate) return [false, `深搜线净得 ${c.net}，不够`];
    return [true, `${m0.san} ${free ? "吃不回" : "以小吃大"}，深搜净得 ${c.net}`];
  },
  perpetual(c) {
    const b = c.d.before.scalar, a = c.d.after.scalar;
    const sign = c.V === "w" ? 1 : -1;               // V is the side that made the mistake
    if (b == null || a == null || sign * b < 150) return [false, `失着前深搜 ${b}，并不占优`];
    if (Math.abs(a) > 30) return [false, `失着后深搜 ${a}，不是和棋`];
    const mine = c.ms.slice(0, 8).filter((m) => m.color === c.A);
    if (mine.length < 2 || !mine.every((m) => /[+#]$/.test(m.san))) return [false, "深搜线上攻方不是步步将军"];
    return [true, `失着前 ${b}，之后 ${a}，深搜线步步将军`];
  },
  double(c) {
    const k = kingSq(c.g1, c.V);
    const n = k ? attackersOf(c.g1, k, c.A).length : 0;
    if (n < 2) return [false, `${c.ms[0].san} 之后只有 ${n} 个子将军`];
    return c.net >= 1 || c.mate ? [true, `双将，深搜${c.mate ? "将死" : "净得 " + c.net}`] : [false, `双将，但深搜线只净得 ${c.net}`];
  },
  discovered(c) {
    const m0 = c.ms[0];
    const k = kingSq(c.g1, c.V);
    const checkers = k ? attackersOf(c.g1, k, c.A) : [];
    if (!checkers.length) return [false, "不是将军"];
    if (checkers.includes(m0.to)) return [false, checkers.length > 1 ? "走动的子也在将军：是双将" : "将军的是走动的子本身"];
    if (!checkers.some((s) => between(s, k, m0.from))) return [false, "将军的线不是这步让开的"];
    return c.net >= 1 || c.mate ? [true, `闪将，深搜${c.mate ? "将死" : "净得 " + c.net}`] : [false, `闪将，但深搜线只净得 ${c.net}`];
  },
  discoveredAttack(c) {
    const m0 = c.ms[0];
    const uncovered = [];
    for (const s of Object.keys(c.g1)) {
      const p = c.g1[s];
      if (p.color !== c.A || s === m0.to || !"brq".includes(p.type)) continue;
      const was = new Set(attacked(c.g0, s));
      for (const t of attacked(c.g1, s)) {
        const q = c.g1[t];
        if (!was.has(t) && q && q.color === c.V && q.type !== "k" && VALUE[q.type] >= 3 && between(s, t, m0.from)) uncovered.push(t);
      }
    }
    if (!uncovered.length) return [false, "这步没有让开打到 ≥ 3 分的子的线"];
    const direct = attacked(c.g1, m0.to).filter((t) => c.g1[t] && c.g1[t].color === c.V && (c.g1[t].type === "k" || VALUE[c.g1[t].type] >= 3));
    const targets = new Set(uncovered.concat(direct));
    if (!later(c, (x) => x.captured && targets.has(x.to))) return [false, "深搜线没吃到被打到的子"];
    return c.net >= 1 ? [true, `闪击 ${uncovered.join("、")}，深搜吃到，净得 ${c.net}`] : [false, `闪击成立，但深搜只净得 ${c.net}`];
  },
  fork(c) {
    const m0 = c.ms[0];
    const hits = attacked(c.g1, m0.to).filter((t) => c.g1[t] && c.g1[t].color === c.V && (c.g1[t].type === "k" || VALUE[c.g1[t].type] >= 3));
    if (hits.length < 2) return [false, `${m0.san} 之后只打到 ${hits.length} 个目标`];
    if (firstFree(c)) return [false, `${m0.san} 本身就是白吃一子，要说的是挂着的子`];
    if (c.key === "ex.forkHits") {
      const types = hits.map((t) => c.g1[t].type);
      const named = c.ex.refute.hits.slice(0, 2);
      if (!named.every((t) => types.includes(t))) return [false, "打不到所说的两个子"];
      if (takes(c.Chess, c.fens[0], m0.to, c.V).length) return [false, `${m0.san} 自己能被吃掉`];
      const worth = hits.some((t) => c.g1[t].type !== "k" && (VALUE[c.g1[t].type] > VALUE[m0.piece] || !defended(c.Chess, c.fens[0], t, c.V)));
      return worth ? [true, `${m0.san} 同时打到 ${named.join("、")}，吃不掉它，目标值得吃`] : [false, "被打到的子有保护、也不比它值钱"];
    }
    // one of the men it hit is taken on its square: by the forker, or by a
    // man the fork left free to take it (…Kd7 Qd5+ Ke8 Qxd8+ Rxd8 Nxb5)
    const hitMen = hits.filter((t) => c.g1[t].type !== "k");
    if (!later(c, (x) => x.captured && hitMen.includes(x.to))) return [false, "深搜线上没吃到被捉双的子"];
    return c.net >= 1 ? [true, `捉双 ${hits.join("、")}，深搜吃到，净得 ${c.net}`] : [false, `捉双吃到了，但深搜只净得 ${c.net}`];
  },
  zwischenzug(c) {
    const p = c.played, m0 = c.ms[0];
    if (!p || !p.captured) return [false, "失着不是吃子"];
    if (m0.to === p.to) return [false, "对方直接吃回，不是中间着"];
    if (!/[+#]$/.test(m0.san) && !m0.captured) return [false, "这步既不将军也不吃子"];
    if (!takes(c.Chess, c.fen, p.to, c.A).length) return [false, "本来就吃不回，谈不上先走一步"];
    if (!later(c, (x) => x.to === p.to && x.captured)) return [false, "深搜线上没有回头吃回"];
    return c.net >= 1 || c.mate ? [true, `中间着后吃回，扣掉失着所得净得 ${c.net}`] : [false, `扣掉失着所得只净得 ${c.net}`];
  },
  desperado(c) {
    const p = c.played, m0 = c.ms[0];
    if (!p || !m0.captured) return [false, "不是吃子"];
    const by = attackersOf(c.g0, m0.from, c.V);
    if (!by.length) return [false, `${m0.from} 的子没有被攻击`];
    const doomed = !defended(c.Chess, c.fen, m0.from, c.A) || by.some((s) => c.g0[s].type !== "k" && VALUE[c.g0[s].type] < VALUE[m0.piece]);
    if (!doomed) return [false, `${m0.from} 的子并不是保不住`];
    if (!(p.captured || attacked(c.g0, p.to).includes(m0.from))) return [false, "不是失着让它保不住的"];
    if (by.includes(m0.to)) return [false, "吃的是攻击它的子：只是交换"];
    const m1 = c.ms[1];
    if (!m1 || m1.to !== m0.to || !m1.captured) return [false, "深搜线上它没有随后被吃"];
    return c.net >= 1 ? [true, `保不住的子先吃一子，扣掉失着所得净得 ${c.net}`] : [false, `扣掉失着所得净得 ${c.net}`];
  },
  removeDefender(c) {
    const [m0, m1, m2] = c.ms;
    if (!m0.captured || !m1 || !m2 || !m2.captured || VALUE[m2.captured] < 3 || m2.to === m0.to) return [false, "深搜线不是「吃保护者，再吃被保护的」"];
    if (!attacked(c.g0, m0.to).includes(m2.to)) return [false, `${m0.to} 的子并不保护 ${m2.to}`];
    if (!defended(c.Chess, c.fen, m2.to, c.V)) return [false, `${m2.to} 本来就没保护`];
    if (defended(c.Chess, c.fens[1], m2.to, c.V)) return [false, `${m2.to} 在对方吃回之后仍有保护`];
    return c.net >= 1 ? [true, `消除 ${m0.to} 的保护者后吃掉 ${m2.to}，净得 ${c.net}`] : [false, `只净得 ${c.net}`];
  },
  overload(c) { return lured(c, "overload"); },
  deflection(c) { return lured(c, "deflection"); },
  decoy(c) {
    const [m0, m1, m2] = c.ms;
    if (!m0 || m0.captured) return [false, "这步是吃子，不是引入的弃子"];
    if (!m1 || m1.to !== m0.to || !m1.captured || !"kq".includes(m1.piece)) return [false, "对方的王或后没有吃它"];
    if (!m2) return [false, "线太短"];
    const g2 = gridOf(c.Chess, c.fens[2]);
    if (!attacked(g2, m2.to).includes(m0.to) && !/[+#]$/.test(m2.san)) return [false, "引过去之后没有打到它"];
    return c.net >= 1 || c.mate ? [true, `把${m1.piece === "k" ? "王" : "后"}引到 ${m0.to} 后打到它，深搜${c.mate ? "将死" : "净得 " + c.net}`] : [false, `只净得 ${c.net}`];
  },
  pin(c) {
    const m0 = c.ms[0];
    if (firstFree(c)) return [false, `${m0.san} 白吃一子——是挂着的子，不是牵制`];
    // the man the line takes on its own square, standing in front of a bigger one
    let why = "深搜线上没吃到被牵制的子";
    for (let i = 2; i < Math.min(8, c.ms.length); i += 2) {
      const x = c.ms[i];
      if (x.color !== c.A || !x.captured) continue;
      const q = x.to;
      const P = c.g1[q];
      if (!P || P.color !== c.V) continue;
      const [qf, qr] = xy(q);
      for (const s of Object.keys(c.g1)) {
        const S = c.g1[s];
        if (S.color !== c.A || !"brq".includes(S.type) || !attacked(c.g1, s).includes(q)) continue;
        const [sf, sr] = xy(s);
        const df = Math.sign(qf - sf), dr = Math.sign(qr - sr);
        if ((df && dr && S.type === "r") || (!(df && dr) && S.type === "b")) continue;
        for (let k = 1; k < 8; k++) {
          const f = qf + df * k, r = qr + dr * k;
          if (!on(f, r)) break;
          const B = c.g1[sqOf(f, r)];
          if (!B) continue;
          if (B.color === c.V && rankOf(B.type) > rankOf(P.type)) {
            return c.net >= 1 ? [true, `${q} 的子被 ${s} 钉在 ${sqOf(f, r)} 前面，深搜线在原地吃掉，净得 ${c.net}`] : [false, `牵制成立，但只净得 ${c.net}`];
          }
          break;
        }
      }
      why = `深搜线吃的 ${q} 并没有被钉住`;
    }
    return [false, why];
  },
  skewer(c) {
    const [m0, m1, m2] = c.ms;
    const S = c.g1[m0.to];
    if (!S || !"brq".includes(S.type)) return [false, "走到的不是长兵器"];
    if (!m1 || !m2) return [false, "线太短"];
    const [sf, sr] = xy(m0.to), [ff, fr] = xy(m1.from);
    const df = Math.sign(ff - sf), dr = Math.sign(fr - sr);
    const F = c.g1[m1.from];
    if (!F || F.color !== c.V || !attacked(c.g1, m0.to).includes(m1.from)) return [false, "对方让开的子不在它的线上"];
    let back = null;
    for (let k = 1; k < 8; k++) {
      const f = ff + df * k, r = fr + dr * k;
      if (!on(f, r)) break;
      if (c.g1[sqOf(f, r)]) { back = sqOf(f, r); break; }
    }
    const B = back && c.g1[back];
    if (!B || B.color !== c.V || VALUE[B.type] < 3 || !(rankOf(F.type) > rankOf(B.type))) return [false, "线上前面的子不比后面的值钱，或后面没有 ≥ 3 分的子"];
    if (m2.from !== m0.to || m2.to !== back || !m2.captured) return [false, "长兵器没有吃到后面的子"];
    return c.net >= 1 ? [true, `串击：${m1.from} 让开，吃 ${back}，净得 ${c.net}`] : [false, `只净得 ${c.net}`];
  },
  xray(c) {
    const [m0, m1, m2] = c.ms;
    if (!m0.captured || !m1 || m1.to !== m0.to || !m1.captured || !m2 || m2.to !== m0.to || !m2.captured) return [false, "深搜线不是同一格上的吃、吃回、再吃回"];
    if (!c.g0[m2.from] || !"brq".includes(c.g0[m2.from].type) || !between(m2.from, m0.to, m0.from)) return [false, "再吃回的子不在它背后的线上"];
    if (attacked(c.g0, m2.from).includes(m0.to)) return [false, "它本来就打得到那一格，不是 X 光"];
    return c.net >= 1 ? [true, `${m2.from} 隔着 ${m0.from} 支援，净得 ${c.net}`] : [false, `只净得 ${c.net}`];
  },
  trapped(c) {
    const m0 = c.ms[0];
    if (m0.captured || /[+#]$/.test(m0.san)) return [false, "这步吃子或将军"];
    const lost = (fen, sq, type) => {
      const t = takes(c.Chess, fen, sq, c.A);
      if (!t.length) return false;
      return t.some((x) => x.piece !== "k" && VALUE[x.piece] < VALUE[type]) || !defended(c.Chess, fen, sq, c.V);
    };
    for (const t of attacked(c.g1, m0.to)) {
      const P = c.g1[t];
      if (!P || P.color !== c.V || P.type === "k" || VALUE[P.type] < 3) continue;
      if (!lost(c.fens[0], t, P.type)) continue;
      const g = new c.Chess(withTurn(c.fens[0], c.V));
      const moves = g.moves({ square: t, verbose: true }) || [];
      if (!moves.length) continue;
      const all = moves.every((mv) => {
        if (mv.captured && VALUE[mv.captured] >= VALUE[P.type]) return false;
        g.move(mv); const bad = lost(g.fen(), mv.to, P.type); g.undo();
        return bad;
      });
      if (!all) continue;
      if (!later(c, (x) => x.captured === P.type)) return [false, `${t} 的子被困，但深搜线没吃到它`];
      return c.net >= 1 ? [true, `${t} 的子无处可逃，深搜吃到，净得 ${c.net}`] : [false, `只净得 ${c.net}`];
    }
    return [false, "没有哪个被打到的子是走投无路的"];
  },
  mateThreat(c) {
    const m0 = c.ms[0];
    if (/[+#]$/.test(m0.san)) return [false, "这步本身将军"];
    if (!mateInOne(c.Chess, withTurn(c.fens[0], c.A))) return [false, "这步之后并没有一步杀的威胁"];
    if (mateInOne(c.Chess, withTurn(c.fen, c.A))) return [false, "威胁在这步之前就有"];
    return c.net >= 1 || c.mate ? [true, `威胁一步杀，深搜${c.mate ? "将死" : "净得 " + c.net}`] : [false, `只净得 ${c.net}`];
  },
  promotion(c) {
    if (!c.ms.slice(0, 6).some((m, i) => i % 2 === 0 && m.promotion)) return [false, "深搜线前六步里攻方没有升变"];
    return c.net >= 3 || c.mate ? [true, `升变，深搜${c.mate ? "将死" : "净得 " + c.net}`] : [false, `升变了，但只净得 ${c.net}`];
  },
  backRank(c) {
    if (!c.mate) return [false, "深搜线不以将死结束"];
    const last = c.ms[c.ms.length - 1];
    if (last.color !== c.A || !"rq".includes(last.piece)) return [false, "将死的不是车或后"];
    const g = gridOf(c.Chess, c.fens[c.fens.length - 1]);
    const k = kingSq(g, c.V);
    const home = c.V === "w" ? 0 : 7, up = c.V === "w" ? 1 : -1;
    if (!k || xy(k)[1] !== home || xy(last.to)[1] !== home) return [false, "不是在底线上将死"];
    let pawns = 0;
    for (const df of [-1, 0, 1]) {
      const f = xy(k)[0] + df;
      if (!on(f, home + up)) continue;
      const q = g[sqOf(f, home + up)];
      if (!q || q.color !== c.V) return [false, "王前面一排有空格或对方的子"];
      if (q.type === "p") pawns++;
    }
    return pawns >= 2 ? [true, "底线杀：王被自己的兵堵住"] : [false, "王前面不是自己的兵"];
  },
};

/**
 * The move itself takes a man nothing can take back, and that capture alone
 * — net of what the mistake had just taken — wins ≥ 2: then the lesson is
 * the loose man, not the fork or pin that comes with it (B3's audit rule).
 * Taking back what the mistake took is not that: 34…Rxc7 Qxf5+ gets the
 * rook back, and what wins is the knight the check also hits.
 */
function firstFree(c) {
  const m0 = c.ms[0];
  return !!m0.captured && VALUE[m0.captured] >= 3 && !takes(c.Chess, c.fens[0], m0.to, c.V).length &&
    VALUE[m0.captured] - (c.credit || 0) >= 2;
}

function lured(c, name) {
  const [m0, m1, m2] = c.ms;
  if (!m1 || !m2 || m1.to !== m0.to || !m1.captured) return [false, "对方没有在那一格吃回"];
  if (name === "overload" && !m0.captured) return [false, "这步不是吃子：是引离，不是过载"];
  if (name === "deflection" && m0.captured) return [false, "这步是吃子：是过载，不是引离"];
  if (!m2.captured || m2.to === m0.to || VALUE[m2.captured] < 3) return [false, "攻方下一步没吃到别处 ≥ 3 分的子"];
  if (!attacked(c.g0, m1.from).includes(m2.to)) return [false, `${m1.from} 的子原本并不保护 ${m2.to}`];
  if (!defended(c.Chess, c.fen, m2.to, c.V)) return [false, `${m2.to} 本来就没保护`];
  if (defended(c.Chess, c.fens[1], m2.to, c.V)) return [false, `${m2.to} 之后仍有保护`];
  return c.net >= 1 ? [true, `${m1.from} 的子被引到 ${m0.to}，${m2.to} 失去保护被吃，净得 ${c.net}`] : [false, `只净得 ${c.net}`];
}

const mover = (fen) => fen.split(" ")[1];
const cpFor = (s, side) => (s == null ? null : side === "w" ? s : -s);

/** Which claim in the sentence carries the motif. */
function sideOf(key) {
  if (/^ex\.threat/.test(key)) return "threat";
  if (/^ex\.(better|mate1Motif|mateNMotif)/.test(key)) return "better";
  return "refute";
}

/**
 * @param {object} r  a sampled row: fen, played, ex, key, motif
 * @param {object} d  deep searches: after, before, reply, best ({scalar, pv SAN})
 * @returns {{verdict: "ok"|"wrong", reason: string, sentence: string}}
 */
export function judgeCase(r, d, Chess) {
  const ex = r.ex;
  const side = mover(r.fen), them = other(side);
  const g = new Chess(r.fen);
  const played = g.move(r.played);
  const afterFen = g.fen();
  const credit = played ? (played.captured ? VALUE[played.captured] : 0) + (played.promotion ? VALUE[played.promotion] - 1 : 0) : 0;
  const whole = sentenceOracle(Object.assign({}, r, { ex }), d, Chess);
  const sentence = whole.verdict + "：" + whole.reason;
  const out = (ok, why) => ({ verdict: ok ? "ok" : "wrong", reason: why, sentence });
  const at = sideOf(r.key || "");
  const dAfter = cpFor(d.after.scalar, side);

  // 1. sound
  let fen, line, A, cr;
  if (at === "better") {
    const b = ex.better;
    const bx = d.best ? cpFor(d.best.scalar, side) : null;
    const sound = d.before.pv[0] === b.san || (bx != null && dAfter != null && bx - dAfter >= 50);
    if (!sound) return out(false, `深搜不认 ${b.san}（${bx} 对所走 ${dAfter}）`);
    fen = r.fen; line = [b.san].concat(d.best ? d.best.pv : []); A = side; cr = 0;
  } else {
    const san = at === "threat" ? ex.threat.san : ex.refute.san;
    const rx = d.reply ? cpFor(d.reply.scalar, side) : null;
    const sound = d.after.pv[0] === san || (rx != null && dAfter != null && rx - dAfter <= 80);
    if (!sound) return out(false, `深搜不认 ${san}（之后 ${rx}，最佳 ${dAfter}）`);
    fen = afterFen; line = [san].concat(d.reply ? d.reply.pv : []); A = them; cr = credit;
  }

  // the threat sentences: the same reply already worked before the mistake
  if (at === "threat") {
    const t0 = new Chess(afterFen).move(ex.threat.san);
    const gN = new Chess(withTurn(r.fen, them));
    const m = t0 ? play(gN, { from: t0.from, to: t0.to, promotion: "q" }) : null;
    if (!m) return out(false, "走之前这步棋并不成立");
    if (r.motif === "mateThreat") {
      const deepMate = d.after.scalar != null && Math.abs(d.after.scalar) >= 9000 && cpFor(d.after.scalar, them) > 0;
      return gN.in_checkmate() && deepMate ? out(true, "走之前同一步就是杀，失着后深搜确为杀") : out(false, gN.in_checkmate() ? "深搜不认这是杀" : "走之前并无一步杀");
    }
  }

  // 2 + 3. geometry, and the deep line realising it
  const w = walk(Chess, fen, line);
  if (!w.ms.length) return out(false, "线走不通");
  const c = { Chess, fen, ms: w.ms, fens: w.fens, A, V: other(A), mate: !!w.ms.mate && w.ms[w.ms.length - 1].color === A,
    credit: cr, net: netAlong(w.ms, A) - cr, g0: gridOf(Chess, fen), g1: gridOf(Chess, w.fens[0]), key: r.key, ex, played, d };
  if (at === "threat" && r.motif === "hanging") {
    // …and it was a free (or cheap) capture before, as it is now
    const t0 = new Chess(afterFen).move(ex.threat.san);
    const gN = new Chess(withTurn(r.fen, them));
    const m = play(gN, { from: t0.from, to: t0.to, promotion: "q" });
    const pre = !!m.captured && VALUE[m.captured] >= 3 && (!takes(Chess, gN.fen(), m.to, side).length || VALUE[m.piece] < VALUE[m.captured]);
    if (!pre) return out(false, "走之前并不能白吃");
  }
  const rule = RULES[r.motif];
  if (!rule) return out(false, "没有这个母题的规则");
  const [ok, why] = rule(c);
  return out(ok, why);
}
