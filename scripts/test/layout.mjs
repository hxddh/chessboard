/**
 * The sheet breakpoint and when the wide layout is used.
 *
 * Part of scripts/test-chess.mjs, which runs every module here in order.
 */
import fs from "fs";
import path from "path";
import { assert, root, allAppSource } from "./harness.mjs";

export async function run() {
  // --- 7.3: the sheet breakpoint is one string, asked of the browser ---------
  //
  // The narrow-portrait layout exists in CSS (a media query) and the app has to
  // know when it is in force (the onboarding must not end by raising a sheet
  // over the board). Two copies of "560px" in two languages is exactly the kind
  // of pair that drifts, so app.js asks `matchMedia` with the *same query text*
  // — and this asserts the two strings really are the same one.
  {
    const appSrc = allAppSource;
    const cssSrc = fs.readFileSync(path.join(root, "src/web/styles.css"), "utf8");
    const m = /const SHEET_QUERY = "([^"]+)"/.exec(appSrc);
    assert(!!m, "app.js 把那条媒体查询写成一个具名常量");
    if (m) {
      assert(cssSrc.includes("@media " + m[1]),
        "……而样式表里就是同一条查询，一字不差（" + m[1] + "）");
    }
    // 用它的地方只有一处：引导结束时要不要把面板打开
    assert((appSrc.match(/panelCoversBoard\(\)/g) || []).length >= 2,
      "定义它、并且真的有人用它 —— 常量本身不是护栏");
  }

  // --- v8-0-plan A2: when the wide layout is used, as a rule ------------------
  // play-layout.js decides `pv-wide` from the play view's size and the
  // stylesheet's lengths. The rule is "≥ 1280 wide, landscape, and the board no
  // smaller than in the two-column layout" — so here: the five acceptance sizes
  // land where A2 says, a tall 1280 window keeps the old layout (the wide one
  // would shrink its board), and the lengths the function reads are the ones
  // the stylesheet declares.
  {
    const { boardEdges, isWide, WIDE_MIN } = await import("../../src/web/js/play-layout.js");
    const cssSrc = fs.readFileSync(path.join(root, "src/web/styles.css"), "utf8");
    const tok = (n) => { const m = new RegExp(n + ":\\s*(\\d+)px").exec(cssSrc); return m ? Number(m[1]) : NaN; };
    const k = { chrome: tok("--chrome-h"), strip: tok("--strip-h"), pad: tok("--stage-pad"), padY: tok("--stage-pad-y"),
                info: tok("--info-w"), gap: tok("--info-gap"), sideMax: tok("--side-max-wide") };
    assert(Object.values(k).every(Number.isFinite), "A2：宽布局用到的长度样式表里都有（" + JSON.stringify(k) + "）");
    assert(WIDE_MIN === 1280, "A2：宽布局从 1280 起算");
    // M2 (A1 × A2): 30% of the play view, which is the window less the rail
    assert(cssSrc.includes("--side-w: clamp(284px, 0.3 * var(--pv-w), 440px);") && cssSrc.includes("--pv-w: calc(100vw - var(--rail-w));"),
      "A2：两栏布局的面板宽度是 clamp(284px, 30% 下棋视图, 440px)，下棋视图 = 窗口 − 导航栏，boardEdges 按同一条算");
    const at = (w, h) => isWide(w, h, k);
    assert(!at(1024, 768) && at(1280, 800) && at(1440, 900) && at(1920, 1080) && !at(600, 900) && !at(1400, 900),
      "A2：1280 / 1440 / 1920 用宽布局，1024、600 与 1400×900 不用（1400 那里宽布局的棋盘比两栏小）");
    assert(!at(1280, 1024), "A2：1280×1024 不用 —— 那里宽布局会让棋盘变小");
    for (const [w, h] of [[1280, 800], [1366, 768], [1440, 900], [1920, 1080], [2560, 1440]]) {
      const e = boardEdges(w, h, k);
      const two = Math.min(440, Math.max(284, 0.3 * w));
      assert(!at(w, h) || (e.wide >= e.two && e.right >= two && e.right <= Math.max(two, k.sideMax)),
        `A2：${w}×${h} 棋盘 ${e.two} → ${e.wide}，右栏 ${two} → ${e.right}（不窄于两栏布局，至多 ${k.sideMax}）`);
    }
    // M2 (A2 × A1): the two-column panel stretches into what the height-bound
    // board leaves, up to --side-max-wide — one formula, written twice: here in
    // boardEdges (sideTwo) and in styles.css (#app --side-w, ≥ 821px)
    const flat = cssSrc.replace(/\s+/g, " ");
    assert(flat.includes("--side-w: clamp(clamp(284px, 0.3 * var(--pv-w), 440px), var(--pv-w) - 2 * var(--stage-pad) - (var(--pv-h) - var(--chrome-h) - 2 * var(--strip-h) - var(--stage-pad-y)), var(--side-max-wide));"),
      "M2：两栏面板 = clamp(两栏下限, 视图宽 − 边距 − 棋盘, --side-max-wide)，样式表里就是这一条");
    for (const [w, h] of [[960, 768], [1216, 800], [1376, 900], [1136, 900], [1336, 900], [1856, 1080]]) {
      const e = boardEdges(w, h, k);
      const high = h - k.chrome - 2 * k.strip - k.padY;
      const want = Math.min(k.sideMax, Math.max(e.side, w - 2 * k.pad - high));
      assert(e.sideTwo === want && e.two === Math.min(high, w - e.side - 2 * k.pad) && (e.sideTwo === k.sideMax || e.two < high || w - e.sideTwo - 2 * k.pad === e.two),
        `M2：视图 ${w}×${h} 两栏面板 ${e.side} → ${e.sideTwo}，棋盘仍是 ${e.two}（面板只拿棋盘留下的宽度，至多 ${k.sideMax}）`);
    }
  }
}
