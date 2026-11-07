/**
 * The endgame drills against the tablebase record (docs/endgames-verified.json:
 * 19.0's verify-endgames run — Syzygy 3–4-piece WDL/DTZ, Stockfish 16 at depth
 * 30/40 for the rest, the Lichess tablebase as a second opinion). That run
 * needs python-chess, Stockfish and the Syzygy files, so 20.0 does not repeat
 * it; what it proved stays true as long as the positions and goals stay the
 * ones it proved, and this holds them to it on every PR (ADR 0005: no check
 * only at release):
 *
 *   - every drill from the endgame content (src: "endgame") is a recorded
 *     position, same FEN, and its goal is the recorded verdict;
 *   - the app's own solver (core/facts-kpk.js, the drills' 「你让出了对王」)
 *     agrees with the tablebase on every king-and-pawn record, and every move
 *     the tablebase calls best keeps that result.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ITEMS } from "../../src/app/content/practice.js";
import { kpk } from "../../src/app/core/facts-kpk.js";
import { Chess } from "../../src/app/core/chessjs.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RECORD = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/endgames-verified.json"), "utf8"));
const byId = new Map(RECORD.items.map((r) => [r.id, r]));
const isKpk = (fen) => { const men = fen.split(" ")[0].replace(/[^a-zA-Z]/g, ""); return men.length === 3 && /p/i.test(men); };

export default (test) => {
  test("endgames: the record is the tablebase run (Syzygy, 90 positions)", (a) => {
    a.ok(/syzygy/i.test(RECORD.tools.syzygy || "") && RECORD.items.length >= 90, RECORD.items.length + " items");
  });
  test("endgames: every endgame drill is a recorded position with the recorded verdict", (a) => {
    const drills = Object.values(ITEMS).filter((i) => i.src === "endgame");
    a.ok(drills.length >= 20, drills.length + " drills");
    const off = [];
    for (const d of drills) {
      const r = byId.get(d.id.replace(/^dr:/, ""));
      if (!r) off.push(d.id + ": no record");
      else if (r.fen !== d.fen) off.push(d.id + ": " + d.fen + " ≠ recorded " + r.fen);
      else if (r.verdict !== d.goal) off.push(d.id + ": goal " + d.goal + ", tablebase " + r.verdict);
    }
    a.deepEqual(off, []);
  });
  test("endgames: core/facts-kpk.js agrees with the tablebase, best moves included", (a) => {
    const kp = RECORD.items.filter((r) => isKpk(r.fen));
    a.ok(kp.length >= 9, kp.length + " king-and-pawn records");
    const off = [];
    for (const r of kp) {
      const v = kpk(r.fen);
      if (!v || v.result !== r.verdict) { off.push(r.id + ": kpk says " + (v && v.result) + ", tablebase " + r.verdict); continue; }
      if (r.method === "tb" && r.wdl != null && (r.wdl > 0) !== (r.verdict === "win")) off.push(r.id + ": wdl " + r.wdl + " vs " + r.verdict);
      for (const san of r.good || []) {
        const g = new Chess(r.fen);
        if (!g.move(san)) { off.push(r.id + ": " + san + " is not legal"); continue; }
        const after = kpk(g.fen());
        // a best move may take the last enemy man or promote: then it is no longer this ending
        if (after && after.result !== r.verdict) off.push(r.id + ": after " + san + " kpk says " + after.result);
      }
    }
    a.deepEqual(off, []);
  });
};
