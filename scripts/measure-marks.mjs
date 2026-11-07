/**
 * The board marks' hue on light and dark squares, per board (v7-7-plan §6),
 * and their chroma over the light square (v7-8-plan §6).
 *
 *   node scripts/measure-marks.mjs            print
 *   node scripts/measure-marks.mjs --record   …and write docs/measured.json → markHue, markChroma, boardLook
 *
 * Metric: CIEDE2000 (scripts/lib/mark-colour.mjs has the definition and why
 * the hue term is the one that is minimised). "before" is the stylesheet as
 * 7.8.0 shipped it (main e94abfe), read out of git, so the recorded pair is
 * reproducible from the repository alone; "after" is the working tree. 7.7
 * recorded 7.6.0 (75a3560) as "before", 7.8 the chroma against 7.7.0
 * (721fe05); 7.9 §3 retunes 7.8.0's palette, so both sections compare to it.
 *
 * 7.9 §3: the run also asserts — exit 1, and nothing recorded — that every
 * mark sits under its chroma ceiling (CHROMA_CEILING) and that no board's
 * closest two marks came closer than 7.8.0 had them (SEP_FLOOR).
 * scripts/test-chess.mjs asserts the same against the same constants.
 *
 * v8-0-plan A3: the boards are js/look.js's five, not 7.x's four themes, so
 * a "before" is read with 7.x's board names (OLD_BOARDS) and an "after" with
 * the new ones. And a third section, boardLook: each mark's chroma over BOTH
 * squares and the ΔE00 between the two (LOOK_CHROMA_CEILING,
 * LOOK_DE_CEILING), and how far apart the boards are (BOARD_DISTINCT_FLOOR),
 * against 7.9.0 as M1 left it (107838a).
 */
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { measureMarks, markChroma, markLook, boardDistinct, chroma, over, BOARDS, MARKS, LICHESS_LAST, CHROMA_CEILING,
  SEP_FLOOR_BOARD, LOOK_MARKS, LOOK_CHROMA_CEILING, LOOK_DE_CEILING, BOARD_DISTINCT_FLOOR } from "./lib/mark-colour.mjs";
import { record, RECORDING } from "./measurements.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BEFORE_REF = "e94abfe";
const CHROMA_REF = "e94abfe";
const LOOK_REF = "107838a";
const OLD_BOARDS = ["wood", "night", "day", "notebook"];

const cssNow = fs.readFileSync(path.join(ROOT, "src/web/styles.css"), "utf8");
const cssAt = (ref) => execFileSync("git", ["show", ref + ":src/web/styles.css"],
  { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const after = measureMarks(cssNow);
let before = null;
try { before = measureMarks(cssAt(BEFORE_REF), OLD_BOARDS); } catch { /* a shallow clone without 7.8.0: print what there is */ }
const chromaAfter = markChroma(cssNow);
let chromaBefore = null;
try { chromaBefore = markChroma(cssAt(CHROMA_REF), OLD_BOARDS); } catch { /* likewise */ }
const lookAfter = markLook(cssNow);
const distinctAfter = boardDistinct(cssNow);
let lookBefore = null, distinctBefore = null;
try {
  const css79 = cssAt(LOOK_REF);
  lookBefore = markLook(css79, OLD_BOARDS);
  distinctBefore = boardDistinct(css79, OLD_BOARDS);
} catch { /* likewise */ }
const lichessC = chroma(over(LICHESS_LAST.mark, LICHESS_LAST.light));

for (const b of BOARDS) {
  console.log(b);
  for (const k of MARKS) {
    console.log("  " + k.padEnd(6) + "dE " + after[b].marks[k].dE +
      "   dH " + after[b].marks[k].dH +
      "   C* on light " + chromaAfter[b][k] + " (≤ " + CHROMA_CEILING[k] + ")");
  }
  for (const k of Object.keys(LOOK_MARKS)) {
    const v = lookAfter[b][k];
    console.log("  " + k.padEnd(6) + "C* light/dark " + v.cl + " / " + v.cd + " (≤ " + LOOK_CHROMA_CEILING[k] +
      ")   ΔE00 light↔dark " + v.dE + " (≤ " + LOOK_DE_CEILING + ")");
  }
  console.log("  closest two marks: ΔE00 " + after[b].sep + " (" + after[b].sepPair + "; ≥ " + SEP_FLOOR_BOARD[b] + ")");
}
if (before) {
  console.log("7.8.0 (" + BEFORE_REF + "), for the record:");
  for (const b of OLD_BOARDS) console.log("  " + b + " closest two marks ΔE00 " + before[b].sep + ", C* on light " + JSON.stringify(chromaBefore ? chromaBefore[b] : null));
}
console.log("boards apart (dark squares, closest pair): " + (distinctBefore ? distinctBefore.min + " (" + distinctBefore.pair + ", 7.9.0) → " : "") +
  distinctAfter.min + " (" + distinctAfter.pair + "; ≥ " + BOARD_DISTINCT_FLOOR + ")");
console.log("reference: Lichess's default board, last move over its light square, C* " + lichessC +
  " — the ceilings here are last " + CHROMA_CEILING.last + ", sel " + CHROMA_CEILING.sel +
  ", check " + CHROMA_CEILING.check + ", hint " + CHROMA_CEILING.hint);

// 7.9 §3: all four ceilings, and the separation floor; v8-0-plan A3: both
// squares, the light↔dark ΔE00, and the boards apart
const failures = [];
for (const b of BOARDS) {
  for (const k of MARKS) {
    if (!(chromaAfter[b][k] <= CHROMA_CEILING[k])) failures.push(b + " " + k + ": C* " + chromaAfter[b][k] + " > " + CHROMA_CEILING[k]);
  }
  for (const k of Object.keys(LOOK_MARKS)) {
    const v = lookAfter[b][k];
    if (!(Math.max(v.cl, v.cd) <= LOOK_CHROMA_CEILING[k])) failures.push(b + " " + k + ": C* " + v.cl + " / " + v.cd + " > " + LOOK_CHROMA_CEILING[k]);
    if (!(v.dE <= LOOK_DE_CEILING)) failures.push(b + " " + k + ": ΔE00 light↔dark " + v.dE + " > " + LOOK_DE_CEILING);
  }
  if (!(after[b].sep >= SEP_FLOOR_BOARD[b])) failures.push(b + ": closest two marks ΔE00 " + after[b].sep + " < " + SEP_FLOOR_BOARD[b] + " (" + after[b].sepPair + ")");
}
if (!(distinctAfter.min >= BOARD_DISTINCT_FLOOR)) failures.push("boards " + distinctAfter.pair + " only ΔE00 " + distinctAfter.min + " apart");
if (failures.length) {
  for (const f of failures) console.error("FAIL " + f);
  process.exit(1);
}
console.log("ok: every mark under its ceilings on both squares, the same mark on both, the boards apart");

if (RECORDING) {
  record("markHue", {
    what: "每种棋盘标记叠在浅格与深格上的 CIEDE2000：dE 为整体色差（大半是明度，本就该不同），" +
      "dH 为其中的色相项 ΔH'/(kH·SH)（要小）；sep 为同一格上两种不同标记之间的最小 ΔE00（要大；7.9 §3：不得低于 7.8.0 的值，见 sepFloor）。" +
      "8.0 A3 起棋盘按 js/look.js 的五块计（before 仍是 7.8.0 的四套主题）",
    script: "scripts/measure-marks.mjs --record",
    metric: "CIEDE2000, sRGB → CIELAB D65, kL = kC = kH = 1",
    marks: MARKS,
    sepFloor: SEP_FLOOR_BOARD,
    beforeRef: before ? BEFORE_REF : null,
    before,
    after,
  });
  record("markChroma", {
    what: "每种棋盘标记叠在浅格上的 CIELAB 色度 C*（越大越艳）。上一步标记的上限以 Lichess 默认棋盘的上一步高亮" +
      "（rgba(155,199,0,.41) 叠在 #f0d9b5 上）为参照，取其约九成，不照抄数值；7.9 §3 给四种标记都定了上限：" +
      "上一步、选中 ≤ 47，将军、提示 ≤ 52（参照值本身取整）",
    script: "scripts/measure-marks.mjs --record",
    metric: "C* = √(a*² + b*²)，sRGB → CIELAB D65；标记按 source-over 叠在 --sq-light 上",
    marks: MARKS,
    reference: { lichessLastOnLight: lichessC },
    ceiling: CHROMA_CEILING,
    beforeRef: chromaBefore ? CHROMA_REF : null,
    before: chromaBefore,
    after: chromaAfter,
  });
  record("boardLook", {
    what: "8.0 A3：每块棋盘、每种标记（上一步、选中、将军、提示、引擎箭头）叠在浅格（cl）与深格（cd）上的色度 C*，" +
      "两者都不得超过上限；同一标记浅格与深格两个叠色之间的 ΔE00（dE）不得超过上限 —— 同一个标记在两种格子上要读成同一个标记。" +
      "distinct：每两块棋盘深格之间的 ΔE00，最近的一对不得低于下限（7.9.0 的「日」与「木」只差 6.4）",
    script: "scripts/measure-marks.mjs --record",
    metric: "CIEDE2000 与 C*，sRGB → CIELAB D65；标记按 source-over 叠在 --sq-light / --sq-dark 上",
    marks: Object.keys(LOOK_MARKS),
    ceiling: { chroma: LOOK_CHROMA_CEILING, dE: LOOK_DE_CEILING, distinct: BOARD_DISTINCT_FLOOR },
    beforeRef: lookBefore ? LOOK_REF : null,
    before: lookBefore ? { marks: lookBefore, distinct: distinctBefore } : null,
    after: { marks: lookAfter, distinct: distinctAfter },
  });
}
