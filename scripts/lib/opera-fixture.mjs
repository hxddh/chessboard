/**
 * Morphy's Opera game (Paris 1858) with a fixed engine story, for the review
 * view's browser checks (v8-0-plan A4): long enough for key moments on both
 * sides, marks of every weight, and one engine-confirmed sacrifice (16.Qb8+,
 * graded 妙着 by review-grade.js) — and the same numbers every run.
 *
 * The engine is scripted through the app's test seam (window.__chess), keyed
 * by position, the way test-review-e2e.mjs scripts it: the pass asks some
 * positions twice (the deepening), and must get the same answer both times.
 * @module opera-fixture
 */
import { Chess } from "../../src/web/js/chess.js";

export const OPERA = ("e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 " +
  "Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#").split(" ");

/** White-view centipawns at each position 0..32 (33 is mate: the pass scores it). */
const CP = [30, 35, 30, 35, 60, 55, 130, 110, 260, 250, 250, 240, 470, 330, 520, 320, 300, 290,
  1250, 1200, 1250, 1230, 1250, 1300, 1400, 1500, 1500, 1500, 3000, 3000, 3000, 3000, 3000];
/** The engine's choice where the move played was not it. */
const ALT = { 5: "e5d4", 7: "b8c6", 11: "d8d7", 12: "c1g5", 13: "d8d7", 14: "b3b7", 17: "b8d7" };

/** fen → { cpW, best, pv, second } for every position before a move. */
export function operaTable() {
  const table = {};
  const g = new Chess();
  for (let i = 0; i < OPERA.length; i++) {
    const fen = g.fen();
    const mv = g.move(OPERA[i]);
    const played = mv.from + mv.to;
    const best = ALT[i] || played;
    const probe = new Chess(fen);
    const b = probe.move({ from: best.slice(0, 2), to: best.slice(2, 4), promotion: "q" });
    const pv = [best];
    if (b && best === played) {
      const g2 = new Chess(g.fen());
      for (const s of OPERA.slice(i + 1, i + 4)) { const m = g2.move(s); if (!m) break; pv.push(m.from + m.to); }
    } else if (b) {
      const m2 = probe.moves({ verbose: true })[0];
      if (m2) pv.push(m2.from + m2.to);
    }
    // the second line is close everywhere but at 16.Qb8+, where every
    // other move is far worse: that is what makes the sacrifice the only move
    table[fen] = { cpW: CP[i], best, pv, second: i === 30 ? 300 : CP[i] - (i % 2 === 0 ? 30 : -30) };
  }
  return table;
}

/** The centre of `sq` on the page, White at the bottom. */
async function sqXY(page, sq) {
  return page.evaluate((s) => {
    const r = document.getElementById("board").getBoundingClientRect();
    return { x: r.left + (s.charCodeAt(0) - 97 + 0.5) * (r.width / 8), y: r.top + (8 - Number(s[1]) + 0.5) * (r.height / 8) };
  }, sq);
}

/** Play the whole game with the mouse, in a two-player game. */
export async function playOpera(page, upTo = OPERA.length) {
  const g = new Chess();
  for (const s of OPERA.slice(0, upTo)) {
    const m = g.move(s);
    for (const sq of [m.from, m.to]) {
      const p = await sqXY(page, sq);
      await page.mouse.click(p.x, p.y);
      await page.waitForTimeout(40);
    }
  }
  await page.waitForTimeout(300);
}

/** Script the engine with the table (analyse calls answer from it). */
export async function scriptOpera(page) {
  await page.evaluate((tb) => {
    window.__chess.engine.isReady = () => true;
    window.__chess.engine.analyze = async (fen) => {
      const e = tb[fen];
      const turn = fen.split(" ")[1];
      if (!e) return { cp: 0, mate: null, turn, best: null, pv: [] };
      const s = (w) => (turn === "w" ? w : -w);
      return { cp: s(e.cpW), mate: null, turn, best: e.best, pv: e.pv,
        lines: [{ cp: s(e.cpW), mate: null, pv: e.pv, depth: 18 }, { cp: s(e.second), mate: null, pv: [], depth: 18 }] };
    };
  }, operaTable());
}

/** Script the engine with the table and run 分析; resolves once the report is up. */
export async function analyseOpera(page) {
  await scriptOpera(page);
  await page.click("#an-run");
  await page.waitForFunction(() => !document.getElementById("report-card").hidden, null, { timeout: 20000 });
  await page.waitForTimeout(400);
}
