/**
 * The board marks' hue on light and dark squares, per board (v7-7-plan §6),
 * and their chroma over the light square (v7-8-plan §6).
 *
 *   node scripts/measure-marks.mjs            print
 *   node scripts/measure-marks.mjs --record   …and write docs/measured.json → markHue, markChroma
 *
 * Metric: CIEDE2000 (scripts/lib/mark-colour.mjs has the definition and why
 * the hue term is the one that is minimised). "before" is the stylesheet as
 * 7.6.0 shipped it (main 75a3560), read out of git, so the recorded pair is
 * reproducible from the repository alone; "after" is the working tree. The
 * chroma column's "before" is 7.7.0 (721fe05), the palette 7.8 retunes.
 */
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { measureMarks, markChroma, chroma, over, BOARDS, MARKS, LICHESS_LAST, LAST_CHROMA_CEILING } from "./lib/mark-colour.mjs";
import { record, RECORDING } from "./measurements.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BEFORE_REF = "75a3560";
const CHROMA_REF = "721fe05";

const cssNow = fs.readFileSync(path.join(ROOT, "src/web/styles.css"), "utf8");
const cssAt = (ref) => execFileSync("git", ["show", ref + ":src/web/styles.css"],
  { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const after = measureMarks(cssNow);
let before = null;
try { before = measureMarks(cssAt(BEFORE_REF)); } catch { /* a shallow clone without 7.6.0: print what there is */ }
const chromaAfter = markChroma(cssNow);
let chromaBefore = null;
try { chromaBefore = markChroma(cssAt(CHROMA_REF)); } catch { /* likewise without 7.7.0 */ }
const lichessC = chroma(over(LICHESS_LAST.mark, LICHESS_LAST.light));

for (const b of BOARDS) {
  console.log(b);
  for (const k of MARKS) {
    const was = before ? before[b].marks[k] : null;
    console.log("  " + k.padEnd(6) + (was ? "dE " + was.dE + " → " : "dE ") + after[b].marks[k].dE +
      "   dH " + (was ? was.dH + " → " : "") + after[b].marks[k].dH +
      "   C* on light " + (chromaBefore ? chromaBefore[b][k] + " → " : "") + chromaAfter[b][k]);
  }
  console.log("  closest two marks: ΔE00 " + (before ? before[b].sep + " → " : "") + after[b].sep +
    " (" + after[b].sepPair + ")");
}
console.log("reference: Lichess's default board, last move over its light square, C* " + lichessC +
  " — the last-move ceiling here is " + LAST_CHROMA_CEILING);

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
  record("markChroma", {
    what: "每种棋盘标记叠在浅格上的 CIELAB 色度 C*（越大越艳）。上一步标记的上限以 Lichess 默认棋盘的上一步高亮" +
      "（rgba(155,199,0,.41) 叠在 #f0d9b5 上）为参照，取其约九成，不照抄数值",
    script: "scripts/measure-marks.mjs --record",
    metric: "C* = √(a*² + b*²)，sRGB → CIELAB D65；标记按 source-over 叠在 --sq-light 上",
    marks: MARKS,
    reference: { lichessLastOnLight: lichessC },
    ceiling: { last: LAST_CHROMA_CEILING },
    beforeRef: chromaBefore ? CHROMA_REF : null,
    before: chromaBefore,
    after: chromaAfter,
  });
}
