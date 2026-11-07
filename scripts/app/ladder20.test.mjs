/**
 * The ratings the new-game sheet shows are the 20.0 ladder's record
 * (docs/measured.json `ladder20`, scripts/ladder20.mjs), and every profile
 * still plays with the settings it was measured with — change one and this
 * fails until the ladder is re-run (v20-0-plan §3 P1, ADR 0005).
 */
import fs from "fs";
import { LADDER } from "../../src/app/core/opponents.js";
import { TUNING } from "../../src/app/opponents/mind.js";

export default function (test) {
  test("opponents: the ratings the sheet shows are the ladder's record (docs/measured.json ladder20)", (a) => {
    const rec = JSON.parse(fs.readFileSync(new URL("../../docs/measured.json", import.meta.url), "utf8")).ladder20;
    a.ok(rec && rec.rating, "a ladder20 record");
    const mind = TUNING;
    for (const p of LADDER) {
      a.equal(p.rating, rec.rating[p.id], p.id + "'s rating");
      a.deepEqual(rec.settings[p.id], JSON.parse(JSON.stringify(p.play.maia == null ? { play: p.play, resign: p.resign, mind, sf: 2 } : { play: p.play, resign: p.resign, mind })), p.id + " plays as it was measured (re-run scripts/ladder20.mjs after a change)");
    }
    a.ok(rec.monotone, "monotone");
  });

}
