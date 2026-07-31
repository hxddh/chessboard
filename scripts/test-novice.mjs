/**
 * How strong are the handicap tiers against somebody who actually cannot play?
 *
 * ACPL alone could not answer this. Through 1.18 the 新手 tier measured a
 * respectable-looking 150–180 ACPL — and lost 81% to a bot whose entire skill
 * was "do not drop a piece to an immediate recapture", because `worstBias` 0.6
 * meant six moves in ten were the worst of ten candidates. The tier was not
 * weak, it was self-destructive, and the rung above it was Elo 1320.
 *
 * So measure the thing itself: play the tier against two stand-ins for a human
 * who cannot play, and report the score. Seeded, so a run is repeatable.
 *
 * Opt-in — slow and needs the vendored engine:
 *   node scripts/test-novice.mjs [--tier beginner|casual] [--games N]
 */
//
// All we had was an indirect argument from ACPL (150–180 for the tier, versus
// roughly 250–350 for a real novice). That says "stronger than a beginner"
// without saying whether a beginner ever wins. So play it out.
//
// The tier is replicated here exactly as engine.js does it — MultiPV 10 at
// depth 2, Skill 0, and `worstBias` 0.6 meaning it deliberately plays the WORST
// of the candidates six times out of ten, except that it never throws away a
// mate it already found.
//
// Two stand-ins for a human novice, neither flattering:
//   random  — any legal move at all
//   careful — a random move, but not one that drops a piece to an immediate
//             recapture; that is about as much as a raw beginner sees
import fs from 'fs'; import path from 'path'; import vm from 'vm';
import { createRequire } from 'module';
import { compileModuleSync } from "./bundle.mjs";
import { record, RECORDING } from "./measurements.mjs";
const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const ctx = { console }; ctx.globalThis = ctx; ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(compileModuleSync(path.join(ROOT, 'src/web/js/chess.js')), ctx, { filename: "module" });
const Chess = ctx.Chess;

const L = [];
const engine = {
  wasmBinary: new Uint8Array(fs.readFileSync(path.join(ROOT, 'third_party/stockfish/stockfish-18-lite-single.wasm'))),
  listener: (l) => { for (const x of L.slice()) x(l); },
};
const factory = require(path.join(ROOT, 'third_party/stockfish/stockfish-18-lite-single.js'));
await (factory.length >= 1 ? factory(engine) : factory()(engine));
await new Promise((r) => { const t = () => (engine._isReady && !engine._isReady() ? setTimeout(t, 10) : r()); t(); });
const send = (c) => engine.ccall('command', null, ['string'], [c], { async: /^go\b/.test(c) });
const wf = (p, ms = 60000) => new Promise((res, rej) => {
  const T = setTimeout(() => { d(); rej(new Error('timeout')); }, ms);
  const h = (l) => { if (p(l)) { clearTimeout(T); d(); res(l); } };
  const d = () => { const i = L.indexOf(h); if (i >= 0) L.splice(i, 1); };
  L.push(h);
});
const uw = wf((l) => l === 'uciok', 30000); send('uci'); await uw;
const ready = async () => { const w = wf((l) => l === 'readyok', 20000); send('isready'); await w; };

// the 新手 tier, as engine.js configures it
const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : dflt;
};
// The tier definition AND the rule that picks among its candidates are
// engine.js's, not a copy: the tier row used to be scraped out of the source
// text with a regex and the sampling re-typed below, so this script measured
// its own transcription of the thing it was measuring.
const engCtx = { console }; engCtx.globalThis = engCtx; engCtx.window = engCtx; vm.createContext(engCtx);
vm.runInContext(compileModuleSync(path.join(ROOT, 'src/web/js/engine.js')), engCtx, { filename: "module" });
const TIER_NAME = arg('tier', 'beginner');
const TIER = engCtx.ChessEngine.TIERS[TIER_NAME];
if (!TIER) { console.error('engine.js 里没有 ' + TIER_NAME + ' 这一档'); process.exit(1); }
const pickCandidate = engCtx.ChessEngine.pickCandidate;
if (TIER.elo != null) { console.log(TIER_NAME + ' 是按 Elo 限强的档位,这个脚本只量手工削弱的档'); process.exit(0); }
console.log(TIER_NAME + ' 档参数(读自 engine.js):', JSON.stringify(TIER));
let configured = false;
async function beginnerMove(fen) {
  await ready();
  if (!configured) {
    send('setoption name UCI_LimitStrength value false');
    send('setoption name Skill Level value ' + TIER.skill);
    send('setoption name MultiPV value ' + TIER.multipv);
    configured = true;
  }
  send('position fen ' + fen);
  const lines = new Map();
  const collect = (l) => {
    const mp = /\bmultipv (\d+)\b/.exec(l);
    const s = l.match(/\bscore (cp|mate) (-?\d+)\b/);
    const pv = /\bpv ((?:[a-h][1-8][a-h][1-8][qrbn]?\s*)+)/.exec(l);
    if (mp && s && pv) lines.set(Number(mp[1]), {
      score: s[1] === 'mate' ? (Number(s[2]) > 0 ? 1e5 - Number(s[2]) : -1e5 - Number(s[2])) : Number(s[2]),
      uci: pv[1].trim().split(/\s+/)[0],
    });
  };
  L.push(collect);
  const done = wf((l) => /^bestmove/.test(l), 60000);
  send('go depth ' + TIER.depth);
  const bm = await done;
  L.splice(L.indexOf(collect), 1);
  const list = [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  if (!list.length) { const u = bm.split(/\s+/)[1]; return u && u !== '(none)' ? u : null; }
  return pickCandidate(list, TIER, rnd) || list[0].uci;
}

const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
/** material for the side to move, after the opponent's best single capture */
function afterBestRecapture(g) {
  let worst = 0;
  for (const m of g.moves({ verbose: true })) {
    if (!m.captured) continue;
    const gain = VAL[m.captured] || 0;
    if (gain > worst) worst = gain;
  }
  return worst;
}
function noviceMove(g, careful) {
  const moves = g.moves({ verbose: true });
  if (!moves.length) return null;
  if (!careful) return moves[Math.floor(rnd() * moves.length)];
  // shuffle, then take the first move that does not hand back more than it took
  const order = moves.slice().sort(() => rnd() - 0.5);
  for (const m of order) {
    const probe = new Chess(g.fen());
    probe.move({ from: m.from, to: m.to, promotion: m.promotion || 'q' });
    const loses = afterBestRecapture(probe);
    const took = VAL[m.captured] || 0;
    if (loses - took <= 0) return m;
  }
  return order[0];
}

let seed = 20260726;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

async function playGame(careful, noviceIsWhite) {
  const g = new Chess();
  for (let ply = 0; ply < 300 && !g.game_over(); ply++) {
    const noviceTurn = (g.turn() === 'w') === noviceIsWhite;
    if (noviceTurn) {
      const m = noviceMove(g, careful);
      if (!m) break;
      g.move({ from: m.from, to: m.to, promotion: m.promotion || 'q' });
    } else {
      const u = await beginnerMove(g.fen());
      if (!u) break;
      if (!g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || 'q' })) break;
    }
  }
  if (g.in_checkmate()) return (g.turn() === 'w') === noviceIsWhite ? 'loss' : 'win';
  return 'draw';
}

const N = Number(arg('games', process.env.GAMES || 20));
const measured = {};
for (const careful of (process.env.ONLY_CAREFUL ? [true] : [false, true])) {
  const label = careful ? '不一步送子的随机手' : '纯随机手';
  const tally = { win: 0, draw: 0, loss: 0 };
  for (let i = 0; i < N; i++) {
    const r = await playGame(careful, i % 2 === 0);
    tally[r]++;
    process.stdout.write(`\r  ${label}: ${i + 1}/${N}  胜${tally.win} 和${tally.draw} 负${tally.loss}   `);
  }
  const score = Number(((tally.win + tally.draw / 2) / N * 100).toFixed(0));
  console.log(`\n  ${label} 对 ${TIER_NAME} 档 ${N} 盘: 胜 ${tally.win} · 和 ${tally.draw} · 负 ${tally.loss}  → 得分率 ${score}%`);
  measured[careful ? 'careful' : 'random'] = { games: N, ...tally, scorePct: score };
}

// --record writes docs/measured.json, which README and engine.js quote. The
// tier settings go in beside the result: a score rate is only meaningful next
// to the parameters that produced it, and `worstBias` 0.6 vs 0.2 is exactly
// the pair of runs that got mixed up before this file existed.
if (RECORDING) {
  const prev = (await import('./measurements.mjs')).read().noviceScore || { tiers: {} };
  record('noviceScore', {
    what: '一个只会「不一步送子」的随机机器人对下削弱档,得分率 = (胜 + 和/2) / 盘数',
    script: 'scripts/test-novice.mjs --record --tier <id> --games <n>',
    tiers: { ...(prev.tiers || {}), [TIER_NAME]: { settings: TIER, ...measured } },
  });
}
process.exit(0);
