/**
 * One file for the numbers that came out of a measurement.
 *
 * The repo's most valuable habit is writing what was measured into the comment
 * beside the code it justifies. Its weakness is that the same number then gets
 * retyped somewhere else. The handicap tiers' score rate is the clearest case:
 * README said 56% / 27% over 32 games, engine.js's comment said 66% / 25% with
 * no game count (the 24 games it does name are from the *previous* calibration,
 * `worstBias` 0.6), and the script that produces the number printed it to a
 * terminal and forgot it. Two numbers, one measurement, no way to tell which
 * run either came from. Defect 12.
 *
 * So the scripts write here, and prose points at this file rather than
 * restating it. scripts/test-chess.mjs then checks that every number README
 * and engine.js quote is the number in this file — a stale quote is a failing
 * test rather than a thing someone eventually notices.
 *
 *   node scripts/test-novice.mjs --record     score rate vs a novice bot
 *   node scripts/test-strength.mjs --record   ACPL per tier
 *
 * Without --record a run only prints, so measuring something on a branch does
 * not silently rewrite the recorded figures.
 *
 * @module measurements
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FILE = path.join(HERE, "..", "docs", "measured.json");

/** Everything recorded so far, or an empty shell. */
export function read() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); }
  catch { return {}; }
}

/**
 * Merge one section in and write the file back.
 *
 * Section-at-a-time because the two scripts cost minutes each and are run
 * separately; recording one must not blank the other.
 */
export function record(section, value) {
  const all = read();
  all[section] = value;
  const ordered = {};
  ordered._ = "Measured figures. Written by scripts/*.mjs --record, read by " +
    "README.md, src/web/js/engine.js and scripts/test-chess.mjs. " +
    "Do not hand-edit: a number here that no run produced is worse than no number.";
  for (const k of Object.keys(all).filter((k) => k !== "_").sort()) ordered[k] = all[k];
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(ordered, null, 2) + "\n");
  console.log("recorded → docs/measured.json [" + section + "]");
}

/** `--record` on the command line. */
export const RECORDING = process.argv.includes("--record");
