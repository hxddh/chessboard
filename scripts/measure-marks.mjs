/**
 * The board marks' hue on light and dark squares, per board (v7-7-plan §6).
 *
 *   node scripts/measure-marks.mjs            print
 *   node scripts/measure-marks.mjs --record   …and write docs/measured.json → markHue
 *
 * Metric: CIEDE2000 (scripts/lib/mark-colour.mjs has the definition and why
 * the hue term is the one that is minimised). "before" is the stylesheet as
 * 7.6.0 shipped it (main 75a3560), read out of git, so the recorded pair is
 * reproducible from the repository alone; "after" is the working tree.
 */
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { measureMarks, BOARDS, MARKS } from "./lib/mark-colour.mjs";
import { record, RECORDING } from "./measurements.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BEFORE_REF = "75a3560";

const after = measureMarks(fs.readFileSync(path.join(ROOT, "src/web/styles.css"), "utf8"));
let before = null;
try {
  before = measureMarks(execFileSync("git", ["show", BEFORE_REF + ":src/web/styles.css"],
    { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
} catch { /* a shallow clone without 7.6.0: print what there is */ }

for (const b of BOARDS) {
  console.log(b);
  for (const k of MARKS) {
    const was = before ? before[b].marks[k] : null;
    console.log("  " + k.padEnd(6) + (was ? "dE " + was.dE + " → " : "dE ") + after[b].marks[k].dE +
      "   dH " + (was ? was.dH + " → " : "") + after[b].marks[k].dH);
  }
  console.log("  closest two marks: ΔE00 " + (before ? before[b].sep + " → " : "") + after[b].sep +
    " (" + after[b].sepPair + ")");
}

if (RECORDING) {
  record("markHue", {
    what: "每种棋盘标记叠在浅格与深格上的 CIEDE2000：dE 为整体色差（大半是明度，本就该不同），" +
      "dH 为其中的色相项 ΔH'/(kH·SH)（要小）；sep 为同一格上两种不同标记之间的最小 ΔE00（要大）",
    script: "scripts/measure-marks.mjs --record",
    metric: "CIEDE2000, sRGB → CIELAB D65, kL = kC = kH = 1",
    marks: MARKS,
    beforeRef: before ? BEFORE_REF : null,
    before,
    after,
  });
}
