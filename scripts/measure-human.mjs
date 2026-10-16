/**
 * 13.0 H (docs/v13-0-plan.md §1): does the opponent play like a person?
 *
 * Measured the way the Maia paper measures it — move matching: in positions
 * from real games between players of one rating band, how often does the
 * opponent play the move the person actually played? Maia is asked for its
 * most likely move; a Stockfish rung plays its move the way it would in a
 * game (engine.js's own candidate rule, scripts/lib/ladder-player.mjs).
 *
 *   node scripts/measure-human.mjs --sample=A.pgn,B.pgn  write the fixture
 *   node scripts/measure-human.mjs [--record]            measure (minutes)
 *
 * The fixture (scripts/fixtures/human-positions.json) is drawn from the
 * Lichess open database (database.lichess.org, CC0): rated games of at
 * least three minutes a side in which both players are inside the band, one
 * position each from plies 10–59, the side to move being one of them. Not
 * part of CI — it needs minutes and the engine; `--record` writes the
 * numbers to docs/measured.json `human`, which test-chess.mjs reads.
 */
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { loadAppModules, ROOT } from "./lib/app-module.mjs";
import { startPlayer } from "./lib/ladder-player.mjs";
import { record } from "./measurements.mjs";

const arg = (name, dflt) => {
  const a = process.argv.find((x) => x.startsWith("--" + name + "="));
  return a ? a.slice(name.length + 3) : dflt;
};
const FIXTURE = path.join(ROOT, "scripts/fixtures/human-positions.json");
export const BANDS = [1100, 1300, 1500, 1700, 1900];
const PER_BAND = Number(arg("per", "400"));

/** mulberry32 */
const rngFrom = (seed) => () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const ctx = loadAppModules(["src/web/js/chess.js", "src/web/js/engine.js", "src/web/js/persona.js", "src/web/js/opponents.js", "src/web/js/human/maia-net.js"]);
const { Chess, ChessEngine, ChessPersona, Opponents, parseNet, movePolicy } = ctx;

// --- the fixture -----------------------------------------------------------------

function sample(files) {
  const games = files.split(",").flatMap((f) => fs.readFileSync(f, "utf8").split(/\n(?=\[Event )/));
  const rng = rngFrom(13);
  const out = Object.fromEntries(BANDS.map((b) => [b, []]));
  for (const g of games) {
    const tag = (k) => { const m = g.match(new RegExp("\\[" + k + ' "([^"]*)"\\]')); return m ? m[1] : ""; };
    const we = Number(tag("WhiteElo")), be = Number(tag("BlackElo"));
    const base = Number(tag("TimeControl").split("+")[0]);
    if (!(base >= 180)) continue;
    const band = BANDS.find((b) => we >= b && we < b + 100 && be >= b && be < b + 100);
    if (!band || out[band].length >= PER_BAND) continue;
    const body = g.split(/\n\n/)[1] || "";
    const sans = body.replace(/\{[^}]*\}/g, " ").replace(/\d+\.(\.\.)?/g, " ").split(/\s+/)
      .filter((t) => t && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t));
    if (sans.length < 12) continue;
    const ply = 10 + Math.floor(rng() * Math.min(50, sans.length - 10));
    const c = new Chess();
    const ucis = [];
    let ok = true;
    for (let i = 0; i <= ply && ok; i++) {
      const m = c.move(sans[i]);
      if (!m) ok = false;
      else ucis.push(m.from + m.to + (m.promotion || ""));
    }
    if (!ok) continue;
    out[band].push({ site: tag("Site").split("/").pop(), moves: ucis.slice(0, ply).join(" "), human: ucis[ply] });
  }
  const doc = {
    _: "Positions for scripts/measure-human.mjs: Lichess open database (CC0), rated games ≥ 3 min, both players in the band, one position per game from plies 10–59. moves = UCI from the start; human = the move played.",
    source: files.split(",").map((f) => path.basename(f)).join(", "),
    bands: out,
  };
  fs.writeFileSync(FIXTURE, JSON.stringify(doc) + "\n");
  console.log("wrote", FIXTURE, BANDS.map((b) => b + ":" + out[b].length).join(" "));
}

// --- the measurement ---------------------------------------------------------------

function replay(moves) {
  const c = new Chess();
  const fens = [c.fen()];
  for (const u of moves ? moves.split(" ") : []) {
    c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    fens.push(c.fen());
  }
  return { c, fens };
}

async function measure() {
  const doc = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  const result = { what: "move matching: how often the opponent plays the move a person of the band played", source: doc.source, maia: {}, rungs: {} };
  // Maia, each band's net on its own band
  for (const band of BANDS) {
    const net = parseNet(zlib.gunzipSync(fs.readFileSync(path.join(ROOT, "third_party/maia/maia-" + band + ".pb.gz"))));
    const rows = doc.bands[band];
    let hit = 0, ms = 0;
    for (const r of rows) {
      const { c, fens } = replay(r.moves);
      const legal = c.moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion || ""));
      const t = performance.now();
      const top = movePolicy(net, fens, legal)[0];
      ms += performance.now() - t;
      if (top && top.uci === r.human) hit++;
    }
    result.maia[band] = { n: rows.length, match: Math.round((hit / rows.length) * 1000) / 10, msPerMove: Math.round(ms / rows.length) };
    console.log("maia-" + band, JSON.stringify(result.maia[band]));
  }
  // the rungs Maia replaces, each on the band nearest its ladder rating
  const ratings = (await import("./measurements.mjs")).read().ladder.rating;
  const player = await startPlayer({ Chess, ChessEngine, ChessPersona });
  const rungs = Object.keys(ratings).filter((id) => ratings[id] >= 1100 && ratings[id] < 2000);
  for (const id of rungs) {
    const band = BANDS.reduce((a, b) => (Math.abs(b + 50 - ratings[id]) < Math.abs(a + 50 - ratings[id]) ? b : a));
    const p = Opponents.PERSONAS.find((x) => x.level === id);
    const row = Object.assign({}, ChessEngine.TIERS[id]);
    const rng = rngFrom(7);
    let hit = 0;
    await player.newGame();
    for (const r of doc.bands[band]) {
      const { c } = replay(r.moves);
      const mv = await player.move(c.fen(), row, rng, p ? p.style : "off");
      if (mv && mv.uci === r.human) hit++;
    }
    result.rungs[id] = { rating: ratings[id], band, n: doc.bands[band].length, match: Math.round((hit / doc.bands[band].length) * 1000) / 10 };
    console.log(id, JSON.stringify(result.rungs[id]));
  }
  if (process.argv.includes("--record")) { record("human", result); console.log("recorded docs/measured.json human"); }
}

if (arg("sample", "")) sample(arg("sample", ""));
else await measure();
