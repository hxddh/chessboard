/**
 * The design system (type, spacing, heights, colour tokens, motion) and the
 * board's look: the palettes and the marks drawn on it.
 *
 * Part of scripts/test-chess.mjs, which runs every module here in order.
 */
import fs from "fs";
import path from "path";
import { measureMarks, markChroma, markLook, boardDistinct, LAST_CHROMA_CEILING, CHROMA_CEILING, SEP_FLOOR_BOARD as SEP_FLOOR_BY_BOARD, BOARDS as MARK_BOARDS, MARKS, LOOK_MARKS, LOOK_CHROMA_CEILING, LOOK_DE_CEILING, BOARD_DISTINCT_FLOOR } from "../lib/mark-colour.mjs";
import { assert, root, ctx, allAppSource } from "./harness.mjs";

export async function run() {
  // The design system. Every one of these numbers was measured on 1.11 and every
  // one of them was a symptom of the same thing: no scale, so each new rule
  // picked whatever value looked right that day. 12 font sizes including 10.5,
  // 11.5 and 12.5px; 17 distinct paddings from 1px to 22px; 10 radii while three
  // radius tokens already existed unused; 25 hard-coded hex colours outside the
  // theme blocks. None of it is a bug. All of it is why the app looked assembled
  // rather than designed.
  {
    const css = fs.readFileSync(path.join(root, "src/web/styles.css"), "utf8");
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");

    // spacing: an 8-step scale, and nothing between the steps
    // 9.0 V1 (设计语言 v2): the 8pt rhythm — 4 · 8 · 12 in a group · 16 in a
    // card · 24 between blocks · 32 · 40 · 48, and 2 for a hairline's
    // neighbour. 6 and 20 left the scale (they were 8.x's in-betweens); the
    // page margins (32 / 40) joined it.
    const SPACE = new Set(["0px", "2px", "4px", "8px", "12px", "16px", "24px", "32px", "40px", "48px"]);
    const strays = [];
    for (const m of stripped.matchAll(/\b(padding|margin|gap|row-gap|column-gap)(?:-\w+)?\s*:\s*([^;{}]+);/g)) {
      if (/var\(|calc/.test(m[2])) continue;
      for (const tok of m[2].trim().split(/\s+/)) {
        if (/^\d+(\.\d+)?px$/.test(tok) && !SPACE.has(tok)) strays.push(m[1] + ": " + tok);
      }
    }
    assert(strays.length === 0,
      "spacing stays on the 8-step scale" + (strays.length ? " — off it: " + [...new Set(strays)].slice(0, 6).join(", ") : ""));

    // motion: three durations and one curve, the same shape the type scale and
    // the leading scale already have. 1.13 was running seven durations and three
    // easings across 21 transitions, plus a fourth number written in board.js.
    {
      const bare = [];
      const eases = new Set();
      const durs = new Set();
      for (const m of stripped.matchAll(/\btransition\s*:\s*([^;{}]+);/g)) {
        for (const v of m[1].match(/(?<![\w-])\.?\d*\.?\d+m?s/g) || []) bare.push(v);
        for (const v of m[1].match(/var\(--dur-\w+\)/g) || []) durs.add(v);
        for (const v of m[1].match(/(?<![\w-])(ease-in-out|ease-in|ease-out|linear|ease|cubic-bezier\([^)]*\))/g) || []) eases.add(v);
        for (const v of m[1].match(/var\(--ease\)/g) || []) eases.add("var(--ease)");
      }
      assert(bare.length === 0,
        "no transition writes a duration in place" + (bare.length ? " — " + [...new Set(bare)].join(", ") : ""));
      assert(durs.size <= 3, "transitions use at most three duration tokens (" + [...durs].join(", ") + ")");
      assert(eases.size === 1 && eases.has("var(--ease)"),
        "one easing curve, everywhere (" + [...eases].join(", ") + ")");
      const board = fs.readFileSync(path.join(root, "src/web/js/board.js"), "utf8");
      assert(/getPropertyValue\("--dur-base"\)/.test(board),
        "the board's slide reads --dur-base rather than a number of its own");
      assert(!/dur:\s*\d/.test(board), "no hard-coded animation duration left in board.js");

      // 7.7 §9: a press and a keyboard focus look the same on every button. Both
      // are declared once for all of them rather than per family — per-family is
      // how the tabs, the move list and the toast's own buttons went without a
      // pressed state while the action grid had one.
      assert(/:where\(button\):active\s*\{[^}]*transform/.test(stripped),
        "every button has a pressed state (:where(button):active)");
      assert(/(^|\})\s*:focus-visible\s*\{[^}]*outline:\s*2px solid/.test(stripped),
        "…and every focusable thing the one focus ring");
      const ringOff = [...stripped.matchAll(/([^{}]*button[^{}]*:focus[^{}]*)\{([^{}]*)\}/g)]
        .filter((m) => /outline\s*:\s*(none|0)\b/.test(m[2])).map((m) => m[1].trim());
      assert(ringOff.length === 0,
        "no button rule takes the ring away" + (ringOff.length ? " — " + ringOff.join(" ;; ") : ""));

      // …and nothing waits for a transition the stylesheet does not declare.
      // app.js carried a transitionend handler for #board-wrap's width/height
      // for several versions, with a comment explaining that the panel toggle
      // animates them over 280ms. The stylesheet says the opposite, in its own
      // comment, and has since 1.13: the board snaps to its new size on purpose
      // (+84% at 1000x1000 — watching that grow is worse than finding it grown).
      // So the branch never ran. The comment was simply older than the CSS, and
      // this repo's comments are the most valuable thing in it precisely because
      // they record measurements — which makes a stale one expensive. Defect 11.
      const appSrcT = allAppSource;
      const transitioned = new Set();
      for (const m of stripped.matchAll(/#board-wrap[^{}]*\{([^{}]*)\}/g)) {
        for (const t of (m[1].match(/transition:\s*([^;]+);/) || [, ""])[1].split(","))
          transitioned.add(t.trim().split(/\s+/)[0]);
      }
      for (const prop of ["width", "height"]) {
        const waits = new RegExp('propertyName === "' + prop + '"').test(appSrcT);
        assert(!waits || transitioned.has(prop),
          "nothing waits for a #board-wrap " + prop + " transition the stylesheet never declares");
      }
    }

    // vertical rhythm: one control height, one label height, and gaps that are
    // multiples of 8. Declared spacing was already on the scale before this; the
    // *rendered* gaps were 8 / 12.5 / 39.9 / 80.8, because a block's height was
    // whatever its text happened to occupy.
    {
      const heights = [...stripped.matchAll(/min-height:\s*([^;{}]+);/g)].map((m) => m[1].trim());
      const stray = heights.filter((v) => /^\d/.test(v) && v !== "0" && v !== "0px");
      assert(stray.length === 0,
        "every control height comes from a token" + (stray.length ? " — off it: " + [...new Set(stray)].join(", ") : ""));
      for (const tokName of ["--row-h", "--row-h-sm", "--label-h"])
        assert(new RegExp(tokName + ":\\s*\\d+px").test(stripped), tokName + " is defined");
      // 9.0 S5: a settings category is a button too — its height is the
      // buttons' token in the narrow row (the two-heights guard below)
      const catH = /\.set-cat \{[^}]*height: 36px/.test(stripped) || /\.set-cat\s*\{[^}]*min-height:\s*var\(--ctl-h\)/.test(stripped);
      assert(catH, "the narrow settings row's categories are a control's height");
    }

    // The chrome is one strip, so everything standing in it is one height and one
    // baseline. It used to run three (36 / 32 / 27.4) and two baselines, because
    // the mode row sized itself from --row-h, the buttons were a literal 32, and
    // the status pill had no height at all — it was 4px of padding around
    // whatever the text measured. Nothing in the bar shared a unit, which is why
    // it could not be aligned, only nudged.
    {
      // 7.7 (v7-7-plan §2): the status pill left the bar — whose move it is is
      // the lit player strip now, and the sentence is .sr-only. 7.9 §1a: 悔棋
      // and 提示 left it too, for the opponent's strip, so the bar holds ☰
      // alone, at the small control height. 9.0 V3: ☰ is the strip's last
      // control now, and the icon button is the small control height wherever
      // it stands.
      assert(/\n    \.icon-btn \{[^}]*height:\s*var\(--ctl-h-sm\)/.test(stripped),
        "the icon button (☰ among them) is the small control height");
      assert(/\.ps-tools \.tool-btn \{[^}]*height:\s*var\(--ctl-h-sm\)/.test(stripped),
        "…and so are the two tools on the opponent's strip (7.9 §1a)");
      const chrome = /\n    \.chrome \{([\s\S]*?)\n    \}/.exec(stripped);
      assert(chrome, ".chrome is styled");
      const pad = /padding:\s*([^;]+);/.exec(chrome[1]);
      assert(pad && pad[1].trim().split(/\s+/).length === 2,
        "the bar's left and right insets are the same (" + (pad ? pad[1].trim() : "?") + ")");
    }

    // the replay bar was the heaviest object in a panel of text links: a filled,
    // bordered slab of 10800px², nine times the area of anything else in it.
    // 7.7 took it down to a hairline and four bare glyphs; 7.9 §1c gave it back
    // an edge — one outlined bar in four cells, Lichess's shape — but still no
    // fill: the weight is the outline, not a slab.
    {
      const bar = /\.replay-bar\s*\{([^}]*)\}/.exec(stripped);
      assert(!!bar, ".replay-bar is styled");
      assert(/background:\s*transparent/.test(bar[1]), "the replay bar carries no fill");
      assert(/\bborder:\s*1px/.test(bar[1]) && /border-radius:\s*var\(--radius-/.test(bar[1]),
        "…and is one rounded container (7.9 §1c)");
      assert(/repeat\(4,\s*minmax\(0,\s*1fr\)\)/.test(bar[1]), "…of four equal cells");
      const cell = /\.replay-bar button\s*\{([^}]*)\}/.exec(stripped);
      assert(cell && /transition:[^;]*var\(--dur-quick\) var\(--ease\)/.test(cell[1]),
        "…whose hover and press use --dur-quick and the one curve");
      assert(/\.replay-bar button:hover:not\(:disabled\)/.test(stripped),
        "…and a disabled cell answers no hover");
    }

    // 7.9 §1e: two control heights, and no third — the same kind of guard as
    // the type scale and the one easing curve. 7.8.0 measured 36px buttons (18
    // of them) beside 28px ones (悔棋/提示 over the board, 重来/下一课, 重做/
    // 下一题), and on the puzzle page the two sat one under the other. Every
    // rule that sizes a button takes its height from --ctl-h or --ctl-h-sm.
    // What counts as a button is the selector's last compound: `button`, a
    // `*-btn` class, or one of the button classes that do not say so in their
    // name. A pseudo-element is not the button (#theme-seg's swatch), and the
    // promotion picker is squares of the board, sized as 12.5% of it.
    {
      const tok = (n) => new RegExp(n + ":\\s*(\\d+)px").exec(stripped);
      const big = tok("--ctl-h"), small = tok("--ctl-h-sm");
      assert(big && big[1] === "36" && small && small[1] === "32",
        "two control-height tokens: --ctl-h 36px and --ctl-h-sm 32px (" +
        (big ? big[1] : "?") + " / " + (small ? small[1] : "?") + ")");
      assert(!/--chrome-ctl-h/.test(stripped), "…and the chrome's 28px token is gone");
      const BUTTON = /(^|[\s>+~(,])(button|\.[\w-]+-btn|\.tool-ic|\.tool-txt|\.go-close|\.daily-head)(?![\w-])/;
      const EXEMPT = /\.promo-row|::/;
      const off = [];
      for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const sels = m[1].split(",").map((x) => x.trim()).filter(Boolean);
        const last = (sel) => sel.split(/\s*[\s>+~]\s*(?![^(]*\))/).pop();
        if (!sels.some((sel) => !EXEMPT.test(sel) && BUTTON.test(" " + last(sel)))) continue;
        for (const d of m[2].matchAll(/(?<![\w-])(height|min-height)\s*:\s*([^;]+);/g)) {
          const v = d[2].trim();
          if (!/^(var\(--ctl-h(-sm)?\)|auto)$/.test(v)) off.push(m[1].trim().replace(/\s+/g, " ") + " { " + d[1] + ": " + v + " }");
        }
      }
      assert(off.length === 0,
        "every button height comes from --ctl-h or --ctl-h-sm" + (off.length ? " — off it: " + off.join(" ;; ") : ""));
    }

    // type: six steps, and no half pixels
    // 6.0: the same seven steps, in rem (16px root) so the text-size setting
    // scales the whole sheet together (v6-plan Q3.6)
    // 7.9 §2a: the panel moved up a step — 12px (0.75rem) left the scale and
    // 14px (0.875rem) took its place. Still seven.
    // 9.0 V1 (设计语言 v2): four roles, not seven sizes — 30 a result figure
    // (and a page's title) · 16 a card's or a block's title · 14 the body and
    // every button · 12 what is said beside it — plus 13 for the two heading
    // levels (section 600, field label 400) and 11 for coordinates and badges
    // only. 15 and 19 had no role and left; 12 came back as the aside.
    // 10.1 F4: 18 for a card's, a dialog's and a lesson's title — the step
    // between 16 and 30 a heading had to make up for with weight
    const TYPE = new Set(["0.6875rem", "0.75rem", "0.8125rem", "0.875rem", "1rem", "1.125rem", "1.875rem"]);
    const badType = [...stripped.matchAll(/font-size:\s*([^;{}]+);/g)]
      .map((m) => m[1].trim())
      .filter((v) => /^\d/.test(v) && !TYPE.has(v));
    assert(badType.length === 0,
      "type stays on the scale" + (badType.length ? " — off it: " + [...new Set(badType)].join(", ") : ""));
    // design-constraints.md: 字号 7 档、行高 3 档、时长 3 档 —— 不要新增档位.
    // The membership sets above are the scale, so widening one is how a step
    // gets added: this makes that edit fail here rather than pass quietly.
    assert(TYPE.size === 7, "the type scale still has seven steps (" + TYPE.size + ")");
    // 10.1 F4: 11px is for the coordinates, the move list's ?! and the numbers
    // on charts and in a step's dot — never for a word of Chinese or Japanese
    {
      const SMALL_OK = new Set(['#app[data-coords="in"] .coords', ".curve-y", ".curve-x", ".mvtag", ".daily-dot", ".xp-bar"]);
      const small = [...stripped.matchAll(/([^{}]+)\{([^{}]*font-size:\s*0\.6875rem[^{}]*)\}/g)]
        .map((m) => m[1].trim().replace(/\s+/g, " ")).filter((sel) => !SMALL_OK.has(sel));
      assert(small.length === 0, "11px only for coordinates, marks and chart numbers" + (small.length ? " — also: " + small.join(" | ") : ""));
    }

    // The bundle targets Safari 15 (scripts/bundle.mjs), and container queries
    // arrived in Safari 16: a rule inside @container is simply not there on
    // 15, so 7.9 §1d's tool labels never showed (Codex, #84). Width-dependent
    // rules key on a class the page sets instead.
    assert(!/@container\b|\bcontainer(?:-type|-name)?\s*:/.test(stripped),
      "styles.css uses no container queries — the bundle targets Safari 15");

    // 9.0 V1 — 设计语言 v2 (docs/design-constraints.md §0, design/v9-m0/v9.css).
    // Measured on 8.4.0: nine button looks, six card looks, five heading
    // styles, four segment implementations, dashed boxes inside solid cards.
    {
      // no dashed frame: a dashed box reads as a placeholder waiting for
      // content, and every one of them was an empty state or a box in a box
      assert(!/\bdashed\b/.test(stripped), "no dashed border or rule anywhere (9.0 V1)");
      // one heading voice in every language: 13/600 muted, never in capitals
      // with tracking — 「STATS」 beside 「统计」 was two systems for one level
      assert(!/text-transform:\s*uppercase/.test(stripped), "no heading is set in capitals (9.0 V1)");
      const tracked = [...stripped.matchAll(/letter-spacing:\s*([^;]+);/g)].map((m) => m[1].trim()).filter((v) => !/^0(px)?$/.test(v));
      assert(tracked.length <= 1,
        "no tracking but the frame's coordinates (" + tracked.join(", ") + ")");
      for (const sel of [".side-h", ".act-k"]) {
        const r = new RegExp("\\n\\s*" + sel.replace(/[.]/g, "\\.") + " \\{([\\s\\S]*?)\\}").exec(stripped);
        assert(r && /font-size:\s*0\.8125rem/.test(r[1]) && /font-weight:\s*600/.test(r[1]) && /color:\s*var\(--muted\)/.test(r[1]),
          sel + " is the section heading: 13/600 in the muted ink");
      }
      // one accent, three uses: the primary button, the current move, the
      // selected state (and the focus ring, which is the selected state of the
      // keyboard). Every rule that paints with it says which in its selector;
      // the register is the four that do not, and it only shrinks.
      const ACCENT_OK = /primary|current|\.active|selected|pressed|expanded|focus|is-active|:hover|aria-current/;
      const ACCENT_KNOWN = new Map([
        [":root", "declares --accent-soft and --accent-line"],
        [".think-dot", "the engine is thinking: the board's one live dot"],
        [".range", "the volume slider's thumb (accent-color)"],
        [".xp-mine", "「我的」 — your own book's move, the selected tint"],
      ]);
      const stray = [];
      for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!/var\(--accent(-soft|-line)?\)/.test(m[2])) continue;
        const sel = m[1].trim().replace(/\s+/g, " ");
        if (sel.startsWith("@") || ACCENT_OK.test(sel) || ACCENT_KNOWN.has(sel)) continue;
        stray.push(sel);
      }
      assert(stray.length === 0,
        "the accent paints only a primary button, the current move or a selected state" + (stray.length ? " — also: " + stray.join(" ;; ") : ""));
      // four button kinds, each spelt once per family
      for (const k of [".act-btn.primary {", ".tool-btn.primary {", ".act-btn.danger {", ".tool-btn.danger {"])
        assert(stripped.split(k).length === 2, "one declaration of " + k.slice(0, -2));
      // two surfaces: a card is opaque — no film of white over another card
      for (const theme of ["wood", "night", "day", "notebook"]) {
        const v = new RegExp("--" + theme + "-card:\\s*([^;]+);").exec(stripped);
        assert(v && /^#[0-9a-f]{6}$/i.test(v[1].trim()), theme + ": a card is the raised surface, opaque (" + (v && v[1]) + ")");
        const p = new RegExp("--" + theme + "-panel:\\s*([^;]+);").exec(stripped);
        // 10.1 S1: three steps, not two — the page, the panel (a dialog, the
        // side panel) and a card one step brighter than the panel, so a card
        // is told from what it sits on by its fill and its edge can go quiet
        const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255); };
        assert(p && /^#[0-9a-f]{6}$/i.test(p[1].trim()) && lum(v[1].trim()) > lum(p[1].trim()) && lum(v[1].trim()) - lum(p[1].trim()) <= 16,
          theme + ": …a step brighter than the panel, and only a step (" + (p && p[1].trim()) + " → " + v[1].trim() + ")");
        const a = new RegExp("--" + theme + "-accent:\\s*([^;]+);").exec(stripped);
        // 10.0 M0: one accent, and no second name for it — --primary-from/-to
        // and --on-primary were declared in all four themes and read by nothing
        assert(a && !new RegExp("--" + theme + "-(primary-from|primary-to|on-primary):").test(stripped),
          theme + ": one accent, with no second set of names for it (" + (a && a[1]) + ")");
      }
    }

    // 9.0 V2: the bundled face — Inter (OFL), the Latin variable subset, first
    // in the stack and ahead of the CJK faces, and shipped with its licence.
    {
      const face = /@font-face\s*\{([^}]*)\}/.exec(stripped);
      assert(face && /font-family:\s*"Inter Var"/.test(face[1]) && /url\("fonts\/inter-latin-wght-normal\.woff2"\)/.test(face[1]) &&
        /font-display:\s*swap/.test(face[1]) && /unicode-range:/.test(face[1]),
        "Inter is declared once, from fonts/, swap, Latin only");
      const woff = path.join(root, "src/web/fonts/inter-latin-wght-normal.woff2");
      assert(fs.existsSync(woff) && fs.statSync(woff).size <= 60 * 1024,
        "…the file is there and small (" + (fs.existsSync(woff) ? fs.statSync(woff).size : 0) + " bytes ≤ 60 KB)");
      assert(fs.existsSync(path.join(root, "src/web/fonts/Inter-OFL.txt")) &&
        /SIL Open Font License/.test(fs.readFileSync(path.join(root, "src/web/fonts/Inter-OFL.txt"), "utf8")),
        "…with its SIL OFL beside it");
      const ui = /--font-ui:\s*([^;]+);/.exec(stripped);
      // 10.1 F1/F2: the CJK punctuation face first (Chinese, Japanese), then
      // -apple-system (WebKit only: SF on the Mac, skipped on Windows), then Inter
      assert(ui && /^"CJK Punct SC",\s*-apple-system,\s*"Inter Var",\s*"PingFang SC"/.test(ui[1].trim()),
        "the interface stack opens CJK punctuation → -apple-system → Inter → PingFang SC (" + (ui && ui[1].slice(0, 60)) + ")");
      const ja = /html:lang\(ja\)\s*\{\s*--font-ui:\s*([^;]+);/.exec(stripped);
      assert(ja && /^"CJK Punct JA",\s*-apple-system,\s*"Inter Var",\s*"Hiragino Kaku Gothic ProN"/.test(ja[1].trim()),
        "…and the Japanese one: its punctuation face → -apple-system → Inter → the Japanese faces");
      const en = /html:lang\(en\)\s*\{[^}]*--font-ui:\s*([^;]+);/.exec(stripped);
      assert(en && /^-apple-system,\s*"Inter Var"/.test(en[1].trim()) && !/CJK Punct/.test(en[1]),
        "…and the English one has no CJK punctuation face: there the Latin forms are right");
      // the punctuation faces carry the punctuation and nothing else
      const punct = [...stripped.matchAll(/@font-face\s*\{([^}]*font-family:\s*"CJK Punct (?:SC|JA)"[^}]*)\}/g)].map((m) => m[1]);
      assert(punct.length === 4 && punct.every((f) => /unicode-range:\s*U\+00B7, U\+2013-2014, U\+2018-2019, U\+201C-201D, U\+2026;/.test(f) &&
        /src:\s*local\(/.test(f) && !/url\(/.test(f)),
        "four punctuation faces (two languages × two weights), local() only, · – — ‘ ’ “ ” … and nothing else (" + punct.length + ")");
      assert(/text-autospace:\s*ideograph-alpha/.test(stripped), "text-autospace is on where it is supported");
      const sync = fs.readFileSync(path.join(root, "scripts/sync-dist.mjs"), "utf8");
      assert(/"src\/web\/fonts\/inter-latin-wght-normal\.woff2", "fonts\/inter-latin-wght-normal\.woff2"/.test(sync) &&
        /"src\/web\/fonts\/Inter-OFL\.txt", "licenses\/Inter-OFL\.txt"/.test(sync),
        "sync-dist.mjs packages the font and its licence (macOS and Windows both build frontend/dist with it)");
    }

    // 7.9 §2b: numbers are the interface face with tabular figures. The mono
    // stack made every counter, the accuracy figure and the clock look like
    // terminal output beside the prose; this keeps it from coming back through
    // the token, and keeps every user of the token tabular.
    {
      const fn = /--font-num:\s*([^;]+);/.exec(stripped);
      assert(!!fn, "--font-num is declared");
      const monoNames = /SF Mono|Menlo|Consolas|ui-monospace|monospace/i;
      const stackOf = (v) => v.replace(/var\(--font-ui\)/, ((/--font-ui:\s*([^;]+);/.exec(stripped)) || [, ""])[1]);
      assert(fn && !monoNames.test(stackOf(fn[1])),
        "--font-num names no monospace family (" + (fn ? fn[1].trim() : "") + ")");
      const users = [...stripped.matchAll(/\{([^{}]*font-family: var\(--font-num\)[^{}]*)\}/g)].map((m) => m[1]);
      assert(users.length > 0 && users.every((b) => /font-variant-numeric: tabular-nums/.test(b)),
        "…and every rule that sets it asks for tabular figures (" + users.length + " rules)");
    }
    assert(SPACE.size === 10, "the spacing scale still has ten steps (" + SPACE.size + ")");

    // leading: three steps, declared as tokens. 1.12 collapsed font-size and
    // left line-height running seven values including the UA's `normal`, which
    // differs per font — so a Chinese line and a Latin line in the same list sat
    // at different rhythms.
    {
      const lhs = [...stripped.matchAll(/line-height:\s*([^;{}]+);/g)].map((m) => m[1].trim());
      const raw = lhs.filter((v) => !/^var\(--lh-(tight|body|prose)\)$/.test(v));
      assert(raw.length === 0,
        "leading comes from the three tokens" + (raw.length ? " — raw: " + [...new Set(raw)].join(", ") : ""));
      assert(/--lh-tight:/.test(stripped) && /--lh-body:/.test(stripped) && /--lh-prose:/.test(stripped),
        "the three leading steps are declared");
      // and body must set one, or `normal` leaks into every unstyled run
      assert(/html, body \{[\s\S]*?line-height: var\(--lh-body\)/.test(stripped),
        "the document has a default leading");
    }

    // weight: three, not five. 650 and 700 were doing 600's job under other names.
    // 9.0 V1: two — 400 and 600. 500 was a third emphasis between them (a
    // button's label, a setting's name, a toast) and the CJK faces have no
    // honest 500 on Windows. The bundled face's @font-face declares the
    // range it carries (100 900), which is not a weight anything is set in.
    {
      const ws = [...stripped.replace(/@font-face\s*\{[^}]*\}/g, "").matchAll(/font-weight:\s*(\d+)/g)].map((m) => m[1]);
      const bad = ws.filter((w) => !["400", "600"].includes(w));
      assert(bad.length === 0,
        "two weights only" + (bad.length ? " — also found: " + [...new Set(bad)].join(", ") : ""));
      // 10.1 F3: and the second one is rare. 8.4–10.0 set 72 rules in 600 —
      // every button, tab, tag and label — so nothing stood out and a Chinese
      // panel read as bold throughout. 600 is for titles, section heads, the
      // numbers that matter and the current item; this only shrinks.
      const strong = ws.filter((w) => w === "600").length;
      assert(strong <= 30, "600 is the exception, not the voice: " + strong + " rules (≤ 30)");
      assert(/\n\s*b, strong, h1, h2, h3, h4 \{ font-weight: 600; \}/.test(stripped),
        "…and <b>, <strong> and headings take it too, not the browser's 700");
    }

    // 11.0 W: the Mac's inset window shell is the app's own native code,
    // built and called on macOS only, and the page leaves its top 28 pt only
    // when the shell says it is on
    {
      const m = fs.readFileSync(path.join(root, "src/native/mac_chrome.m"), "utf8");
      assert(/NSWindowStyleMaskFullSizeContentView/.test(m) && /titlebarAppearsTransparent = YES/.test(m) &&
        /performWindowDragWithEvent/.test(m) && /AppleActionOnDoubleClick/.test(m) &&
        /NSWindowDidEnterFullScreenNotification/.test(m) && /NSWindowDidExitFullScreenNotification/.test(m),
        "mac_chrome.m: transparent full-size titlebar, a strip that drags and double-clicks as the system does, out of the way in full screen");
      assert(/if \(ChessFindWebView\(content\) == nil\) return;\s*objc_setAssociatedObject\(window, &ChessConfiguredKey/.test(m),
        "mac_chrome.m: the inset shell turns on only over a WKWebView, the page it can tell about full screen (not under CEF)");
      const bz = fs.readFileSync(path.join(root, "build.zig"), "utf8");
      const mac = /if \(platform == \.macos\) \{([\s\S]*?)\n    \} else/.exec(bz);
      assert(mac && /addCSourceFile\(\.\{ \.file = b\.path\("src\/native\/mac_chrome\.m"\)/.test(mac[1]) && (bz.match(/addCSourceFile\(\.\{ \.file = b\.path\("src\/native\/mac_chrome\.m"\)/g) || []).length === 1,
        "build.zig compiles mac_chrome.m in the macOS branch and nowhere else");
      const mz = fs.readFileSync(path.join(root, "src/main.zig"), "utf8");
      assert(/if \(comptime runner\.mac_shell\) chess_mac_chrome_init\(\);[\s\S]*runner\.runWithOptions/.test(mz) &&
        /if \(comptime runner\.mac_shell\) code = chess_mac_chrome_set/.test(fs.readFileSync(path.join(root, "src/chrome.zig"), "utf8")) &&
        /pub const mac_shell = std\.mem\.eql\(u8, build_options\.platform, "macos"\);/.test(fs.readFileSync(path.join(root, "src/runner.zig"), "utf8")),
        "main.zig sets the shell up on the macOS platform (not the null backend on a Mac host), before the runner opens its window");
      assert(/\.name = "chess\.setChrome"/.test(fs.readFileSync(path.join(root, "src/bridge.zig"), "utf8")),
        "chess.setChrome is an app command");
      assert(/html\[data-chrome="inset"\] \{ --titlebar-h: 28px; \}/.test(stripped) &&
        /#app \{ margin-top: var\(--titlebar-h\); height: calc\(100% - var\(--titlebar-h\)\); \}/.test(stripped),
        "the page starts below the strip only when the shell answers inset");
    }

    // 11.0 M: the motion list, each on a token, and each stopped by the
    // reduced-motion rule — the slide, the capture (fading and sinking), the
    // check's pulse, the badges and the won king's glow on the canvas; the
    // result card rising in and the page crossfade in the stylesheet
    {
      const bj = fs.readFileSync(path.join(root, "src/web/js/board.js"), "utf8");
      assert(/if \(_reduceMotion\) \{ _anim = null; return; \}/.test(bj) && /_fx\.pulse = check && !_reduceMotion/.test(bj) &&
        /_fx\.badge = badge && !_reduceMotion/.test(bj),
        "11.0 M: the slide, the check pulse and the badges start only without reduced motion");
      assert(/ctx\.globalAlpha = 1 - t;\s*ctx\.translate\(cx, cy\);\s*ctx\.scale\(k, k\);/.test(bj),
        "11.0 M: the captured man fades and sinks under the arriving one");
      assert(/r\.kind !== "win"[\s\S]{0,400}fxAt\(_fx\.badge, durMs\("--dur-slow"\), now\)/.test(bj),
        "11.0 M: a won game's king glows in on --dur-slow, with the result badges");
      assert(/\.go-card \{[^}]*animation: result-in var\(--dur-slow\) var\(--ease\);/.test(stripped) &&
        /\.page:not\(\[hidden\]\) \{ animation: pane-in var\(--dur-base\) var\(--ease\); \}/.test(stripped),
        "11.0 M: the result card rises in and the pages cross-fade, on the duration tokens");
      assert(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation-duration: \.01ms !important;/.test(stripped),
        "11.0 M: …and every keyframe stops under reduced motion");
    }

    // The action rows, and the two ways this has been got wrong. As
    // flex + space-between + wrap they laid out differently in every group —
    // 3 items spread edge to edge, 4 packed tight at widths 40–64, a 5th
    // orphaned on its own line. As three equal columns the rhythm was fixed and
    // the labels broke instead: a 1fr column is the same width whatever is in
    // it, so 清除全部存档 was cut to 清除有 while PGN sat in a column twice the
    // width of its word. What is guarded now is the middle: sized by content,
    // wrapping, shrinkable — and still no space-between, which is the thing
    // that made each row its own rhythm.
    {
      const row = /\.link-row \{([\s\S]*?)\}/.exec(stripped);
      assert(row, "found the action row rule");
      // 2.2 turned this row into the same count-decided grid the segment rows
      // use. The rule it replaced said "wrap, never fix a column count", and
      // that was right for a row of text links of different widths — it is the
      // wrong rule for a row of boxes, where a wrapping flex line lets whatever
      // landed on the last line share it and come out double width. A box twice
      // its neighbours' width is this UI's word for "the primary action", and
      // that word now belongs to .primary alone.
      assert(/display:\s*grid/.test(row[1]), "action rows are a grid, so every action is the same width");
      assert(/auto-fill/.test(row[1]),
        "…laid out by the actions that are actually there, not by counting children " +
        "(判和/重下 come and go, and a display:none child still counts in :has(:nth-child))");
      assert(!/auto-fit/.test(row[1]),
        "…and auto-FILL, so the last action left in a row keeps one action's width " +
        "instead of stretching across the panel and competing with the filled one");
      assert(/grid-auto-rows:\s*1fr/.test(row[1]), "…and every row of it is the same height");
      assert(!/space-between/.test(row[1]), "no space-between — that is what made every row different");

      // ONE control family. The segment buttons and the action buttons share a
      // single declaration block; if someone splits them again, this fails.
      // 9.0 V1: what they share — type, one line, the press — is still that
      // one block; the box is no longer shared: a segment is a place in a
      // tray (.theme-row is the box), an action is a secondary button.
      assert(/\.theme-row button,\s*\.act-btn \{/.test(stripped),
        "the segment control and the action button are declared together, not twice");
      const box = /\.theme-row button,\s*\.act-btn \{([\s\S]*?)\}/.exec(stripped);
      assert(box && /white-space:\s*nowrap/.test(box[1]) && /font-size:\s*0\.875rem/.test(box[1]) && /font-weight:\s*400/.test(box[1]),
        "…one line, 14/400, for both (9.0 V1: a label never wraps — a row that cannot hold it steps its columns down; 10.1 F3: a control's label is regular, as the system's are)");
      assert(!/overflow-wrap:\s*break-word|hyphens:\s*auto/.test((/\.theme-row button,\s*\.act-btn \{[^}]*\}\s*(\.theme-row button,\s*\.act-btn \{[^}]*\})?/.exec(stripped) || [""])[0]),
        "…and no rule left that breaks a label over two lines");
      const tray = /\n    \.theme-row \{([^}]*)\}/.exec(stripped);
      // 10.1 C1: the tray is recessed (a tint of the ink, no line) and the
      // chosen segment is raised out of it — the system's segmented control
      assert(tray && /background:\s*var\(--seg-tray\)/.test(tray[1]) && !/box-shadow/.test(tray[1]),
        "the segment's tray is recessed: a tint, no hairline (10.1 C1)");
      const on = /\n    \.theme-row button\.active \{([^}]*)\}/.exec(stripped);
      assert(on && /background:\s*var\(--seg-on\)/.test(on[1]) && /box-shadow:\s*0 1px 2px/.test(on[1]) && !/--accent/.test(on[1]),
        "…and the chosen segment is raised out of it, not outlined in the accent");
      const act = /\n    \.act-btn \{([^}]*)\}/.exec(stripped);
      assert(act && /border:\s*1px solid var\(--btn-edge\)/.test(act[1]) && /background:\s*var\(--btn-lift\)/.test(act[1]) &&
        /box-shadow:\s*var\(--control-shadow\)/.test(act[1]),
        "…and an action is the secondary button — lifted, an ink hairline, a one-pixel shadow (10.1 C)");
      // 10.1 (Codex on #115): the macOS floor (11.0) may have no color-mix();
      // a custom property holding one is invalid there and the control that
      // reads it loses its fill and edge. Each such token is a plain value
      // first and mixed only under @supports.
      {
        const sup = /@supports \(color: color-mix\(in srgb, red 50%, blue\)\) \{([\s\S]*?)\r?\n    \}\r?\n/.exec(stripped);
        const outside = sup ? stripped.replace(sup[0], "") : stripped;
        const bad = ["--card-border", "--card-edge", "--btn-lift", "--btn-lift-hover", "--btn-edge", "--seg-tray", "--seg-on", "--ring-track"]
          .filter((k) => new RegExp(k + ":\\s*color-mix").test(outside) || !(sup && new RegExp(k + ":\\s*color-mix").test(sup[1])));
        assert(sup && bad.length === 0, "the 10.1 control tokens are plain values, mixed only under @supports" + (bad.length ? " — " + bad.join(", ") : ""));
      }

      // P3's acceptance criterion, at the level of the rule rather than the
      // screen: dimming a control that cannot be used is not a milder way of
      // obeying "no visible disabled controls", it is the thing being rejected
      const off = /\.act-btn:disabled \{([^}]*)\}/.exec(stripped);
      assert(off && /display:\s*none/.test(off[1]),
        "a disabled action is not rendered at all");
      assert(off && !/opacity/.test(off[1]), "…not dimmed into a hole in the row");

      // one row, one shape: danger is a colour, not a different control. Now
      // that every neighbour is a box too, the box is no longer what marks it.
      const dRule = /\.act-btn\.danger \{([^}]*)\}/.exec(stripped);
      assert(dRule, "found the danger rule");
      assert(/color:\s*var\(--danger\)/.test(dRule[1]), "danger says it in colour");

      // At most one filled action exists as a rule at all — the count is a
      // runtime property (see test-layout-e2e), but the weight must be declared
      // exactly once so there is only one way to spell "the thing to press".
      assert((stripped.match(/\.act-btn\.primary \{/g) || []).length === 1,
        "there is exactly one declaration of the primary weight");

      // The same rule for wrapped segments, and for the same reason. With
      // `flex: 1 1 30%` the items on a last line share it between them, so a
      // row of four became three normal buttons and one running the full width
      // of the panel — and a full-width filled button is this UI's word for
      // "the primary action here". 满强度 and 爱进攻 read as buttons you were
      // being pushed toward, purely because 4 % 3 == 1.
      //
      // This used to be checked by measuring button widths in a browser, in
      // three languages (test-layout-e2e.mjs). A pixel assertion answers "did
      // it come out equal this time"; the invariant is "the columns are shared",
      // and that is a property of one declaration. P2.8.
      const wrapRow = /\.theme-row\.wrap \{([\s\S]*?)\}/.exec(stripped);
      assert(wrapRow, "found the wrapped-segment rule");
      assert(/display:\s*grid/.test(wrapRow[1]), "wrapped segments are a grid");
      assert(/grid-template-columns:\s*repeat\(auto-fit/.test(wrapRow[1]),
        "…with shared columns, so every button is one size");
      assert(!/flex:\s*1 1 \d+%/.test(stripped),
        "no `flex: 1 1 N%` anywhere — that is the shape that made the fourth button a primary");
    }

    // The segment has one implementation and one modifier. `.mode-nav` was a
    // second idiom kept alive for a single row — an underline, a panel-era
    // `margin-top: 12px` and a group border drawn for a tab row that was no
    // longer underneath it. It rode 6px below the chrome's centre line and 2.5px
    // past its bottom edge for a whole release, and no rule in this file could
    // notice, because it was the only user of every declaration it carried.
    // Mode is a plain `.theme-row.wrap` segment — on the settings page until
    // v8-0-plan A1, in the new-game dialog since (人机 / 双人; the rail has
    // 谜题 and 学习).
    {
      const markup = fs.readFileSync(path.join(root, "src/web/index.html"), "utf8");
      assert(!/mode-nav/.test(stripped), "no `.mode-nav` idiom is left in the stylesheet");
      assert(!/class="[^"]*mode-nav/.test(markup), "…and nothing in the markup asks for one");
      const seg = /<div class="([^"]*)" id="mode-seg"/.exec(markup);
      assert(seg && /\btheme-row\b/.test(seg[1]) && /\bwrap\b/.test(seg[1]),
        "the mode segment is styled by the same rule as every other segment (" + (seg ? seg[1] : "missing") + ")");
    }

    // The settings page, read in order. Claims about the order and the
    // naming rather than about any one control, so they are cheapest to make
    // against the markup.
    {
      const markup = fs.readFileSync(path.join(root, "src/web/index.html"), "utf8");
      // the three dictionaries, wherever they live (v8-0-plan F5 split them)
      const i18nSrc = ["i18n.js", "i18n-en.js", "i18n-ja.js"]
        .map((f) => fs.readFileSync(path.join(root, "src/web/js", f), "utf8")).join("\n");
      // 9.0 S5: one place — six categories, in the list's order, each naming a
      // pane that exists; no second settings surface in the panel or a window
      const cats = [...markup.matchAll(/role="tab" class="set-cat" id="cat-([a-z]+)" data-cat="\1"[^>]*aria-controls="set-\1"/g)].map((m) => m[1]);
      assert(cats.join() === "general,board,sound,game,data,advanced",
        "S5: the settings page runs 通用 → 棋盘 → 声音 → 对局 → 数据 → 高级 (" + cats.join(" → ") + ")");
      assert(cats.every((c) => markup.includes('<div class="set-pane" id="set-' + c + '"')),
        "S5: every category points at a pane that exists");
      assert(!/id="pane-setup"|id="prefs-modal"|id="tab-setup"/.test(markup),
        "S5: no 设置 tab in the panel and no preferences window — the page is the one place");
      // the language is the first thing on the first category (task i)
      const general = markup.slice(markup.indexOf('id="set-general"'), markup.indexOf('id="set-board"'));
      assert(general.indexOf('id="lang-seg"') > 0 && general.indexOf('id="lang-seg"') < general.indexOf('id="text-seg"'),
        "S5: the language is the first row of 通用");
      // the deletions are the last group of 数据: 2.1 had them in the middle
      // of a page, the only red on it
      const data = markup.slice(markup.indexOf('id="set-data"'), markup.indexOf('id="set-advanced"'));
      const dHeads = [...data.matchAll(/data-i18n="((?:side|lib)\.[a-zA-Z]+)"[^>]*>/g)].map((m) => m[1])
        .filter((k) => ["lib.sync", "side.learning", "side.allData", "side.danger"].includes(k));
      assert(dHeads[dHeads.length - 1] === "side.danger",
        "S5: 数据 ends on 清除数据 (" + dHeads.join(" → ") + ")");
      // the next game's choices are the new-game dialog's, and only there
      const ng = markup.slice(markup.indexOf('id="newgame-modal"'), markup.indexOf('id="confirm-modal"'));
      // 10.0 M0: the rung is the opponent card (row-opponent); the two rows of
      // rung names that repeated the cards are gone
      assert(["row-opponent", "row-persona", "row-color", "row-clock"].every((id) => ng.includes('id="' + id + '"')) &&
        !ng.includes('data-diff="'),
        "S5: opponent, style, side and clock live in the new-game dialog — the rung is chosen on the cards only");

      // The heading is a promise about what is inside. 「外观」 once held the
      // language and the sound; since A1 each has its own group, and the rows
      // left on the settings page are about the board in front of you.
      for (const [lang, look, disp] of [["zh-CN", "外观", "显示"], ["en", "Appearance", "Display"], ["ja", "外観", "表示"]])
        assert(new RegExp('"prefs\\.look":\\s*"' + look + '"').test(i18nSrc) && new RegExp('"side\\.display":\\s*"' + disp + '"').test(i18nSrc),
          lang + ": the appearance group and the board-view group are named for what they hold (" + look + " / " + disp + ")");

      // A hint that counts the controls above it is a hint that goes wrong the
      // first time one of them is not rendered — and 「清除统计与历史」 is not,
      // until there is a game to clear. Measured: the line said three, the page
      // showed two.
      for (const m of i18nSrc.matchAll(/"hint\.danger":\s*"([^"]*)"/g))
        assert(!/三|three|3|２|二/i.test(m[1]),
          "the deletion hint does not name a count — «" + m[1] + "»");
    }

    // One implementation of which way round the board faces.
    //
    // Three doors lead to it: the settings segment, the F key and the native
    // View menu. The comment over NATIVE_COMMANDS says both halves "end up here
    // so there is one implementation and the two can never drift" — and they had
    // drifted, in exactly this action: the button announced the new view in a
    // toast, the key and the menu changed it in silence.
    {
      const app = allAppSource;
      const writes = [...app.matchAll(/store\.game\.flipped\s*=(?!=)/g)].length;
      // the assignments that remain are: the initial state, two authored-view
      // resets (lesson, puzzle), the loaded-record restore, the editor reset,
      // and setFlipped itself. 名局猜着 (v8-2-plan T3) faces the side being
      // guessed through its board model, as a puzzle does: writing the flag
      // turned the play board's saved setting over for good (M2 review)
      assert(/function setFlipped\(/.test(app), "setFlipped is the one place the view turns");
      // Two of the three doors are still spelled in app.js; the third is the
      // native View menu, which moved to native-commands.js in 6.1 and is
      // checked by firing it (see the native-menu block above, "ai mode").
      // One of the three doors is still spelled in app.js; the F key moved to
      // a11y.js and the native View menu to native-commands.js in 6.1, and both
      // are checked by pressing them (see the keyboard blocks above).
      for (const caller of [/setFlipped\(b\.dataset\.orient === "b"\)/])
        assert(caller.test(app), "…and it is what the three doors call — " + caller.source.slice(0, 26));
      assert(writes <= 8, "no door writes store.game.flipped for itself (" + writes + " assignments)");
    }

    // Naming a side, and naming the other one, are one character apart when
    // written out — and eight places wrote them out. The exported review image
    // had both of its inverted: the column holding White's accuracy, mistakes
    // and blunders was headed 黑方, and the turning point named the wrong player
    // as the one who played it, while the identical report in the panel named
    // them right. A picture you hand to somebody else, with the two players
    // swapped, in the one part of this app whose whole purpose is to be handed
    // to somebody else. Nobody had run docs/manual-check.md F6.
    {
      const app = allAppSource;
      assert(/const sideName = \(s\) => t\(s === "w" \? "side\.white" : "side\.black"\);/.test(app),
        "sideName is the one place a side is named");
      assert(/const otherSideName = \(s\) => t\(s === "w" \? "side\.black" : "side\.white"\);/.test(app),
        "…and otherSideName the one place its opponent is");
      // no third spelling anywhere else in the file. Comments are not code: the
      // paragraph above sideName quotes the shape it replaced, and a scan that
      // reads comments reports the explanation as the defect — the same way the
      // Chinese-label scan once reported a note about a heading as a heading.
      const code = app.replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
      const inline = code.split("\n")
        .filter((l) => /\?[^\n]*"side\.(white|black)"/.test(l))
        .filter((l) => !/const (sideName|otherSideName) = /.test(l))
        .map((l) => l.trim());
      for (const x of inline) console.error("FAIL: a side named by hand: " + x);
      assert(inline.length === 0,
        "every side is named through one of the two, so the two cannot be swapped by eye");
    }

    // Every group heading in the panel is a heading. Three of them were a
    // <span class="side-h"> because they live inside a <summary> — same size,
    // same weight, same colour, and invisible to anything navigating by heading.
    {
      const markup = fs.readFileSync(path.join(root, "src/web/index.html"), "utf8");
      const spans = [...markup.matchAll(/<span class="side-h"[^>]*>([^<]*)</g)].map((m) => m[1]);
      assert(spans.length === 0,
        "no group heading is a <span> (" + spans.join(", ") + ")");
    }

    // the board is set into its frame: concentric radii want 16 - 17 < 0
    {
      const canvasRule = /\n    canvas \{([\s\S]*?)\n    \}/.exec(stripped);
      assert(canvasRule && /border-radius:\s*0/.test(canvasRule[1]),
        "the board's corners are square, not rounder-than-concentric");
      assert(/#board-wrap::after/.test(stripped) && /--board-edge/.test(stripped),
        "a hairline finishes the join between squares and frame");
    }

    // coordinates: an integer step, not a value computed from a length. The
    // clamp() they used resolved to 12.24px with 0.4896px of tracking, which is
    // also how they slipped past the type-scale check.
    {
      const co = /\.coords \{([\s\S]*?)\n    \}/.exec(stripped);
      assert(co, "found the coordinate rule");
      assert(!/clamp\(/.test(co[1]), "coordinates are not sized by a computed length");
      // 6.0: the scale is in rem now (see TYPE above); a step is still a step
      assert(/font-size:\s*[\d.]+rem/.test(co[1]), "coordinates sit on the type scale");
    }

    // radius: the tokens exist; use them
    // 0 is a decision, not a stray value: the board is square-cornered on
    // purpose (concentric radii — see styles.css)
    const OK_RADIUS = /^(0|var\(--radius-(sm|md|lg)\)|999px|50%|3px|var\(--radius-sm\) var\(--radius-sm\) 0 0|calc\()/;
    const badRadius = [...stripped.matchAll(/border-radius:\s*([^;{}]+);/g)]
      .map((m) => m[1].trim())
      .filter((v) => !OK_RADIUS.test(v));
    assert(badRadius.length === 0,
      "radii come from the tokens" + (badRadius.length ? " — raw: " + [...new Set(badRadius)].join(", ") : ""));

    // colour: the danger red used to be one salmon that ignored all four themes
    // scoped past the theme blocks: that is where the literal belongs, once
    const body = stripped.slice(stripped.indexOf("* { box-sizing"));
    assert(!/#e0(7a6a|5252)/.test(body), "nothing outside the themes writes the danger red literally");
    assert(!/linear-gradient\(180deg, #f0d2a8/.test(body),
      "the primary button's colour comes from the theme too");
    // --- every var() names a token that exists -------------------------------
    // The rule design-constraints.md states as "格子颜色归主题 token, canvas 去读"
    // generalised: a token reference that resolves to nothing is not a
    // compile error in CSS, it is a property that silently does not apply. So
    // .mlmove {color: var(--fg)} has been reading a token that does not exist
    // since it was written — 56 tokens are defined and none of them is --fg (the
    // themes call it --text) — and it looks correct only because the colour it
    // fails to set is the colour it would have inherited anyway. Defect 9,
    // fixed in P0.5. v10-0-plan E5: the register it emptied is gone — zero is the rule.
    {
      const defined = new Set([...stripped.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
      const dangling = [...new Set([...stripped.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]))]
        .filter((v) => !defined.has(v));
      for (const v of dangling) console.error("  var(" + v + ") names no token");
      assert(dangling.length === 0,
        "no var() names a missing token" + (dangling.length ? " — " + dangling.join(", ") : ""));
    }

    // --- no new bare colour outside the theme blocks --------------------------
    // A colour written in place is a colour that cannot answer "what does this
    // look like in the other three themes". The ones below are the ones that
    // already shipped, listed rather than tolerated: this is the register P2
    // empties. Defect 8 — the eval bar's two hard-coded sides and the two
    // hard-coded blunder golds — was the last four, and left in P2.3. Anything not on this list fails, so the count only goes down.
    {
      // 9.0 V1 emptied it: #fff (the switch's knob, a hover mix) and #000 (a
      // toast's darkening mix, a mask's opaque stop) became tokens, and
      // #4a90d9 was a var(--accent) fallback that was never reached.
      // (#9a3412 / #1e3a5f, the notebook theme's ♔ ♚ side marks, left with
      // the match bar (7.7) — the strips draw each side as a disc in
      // --side-white / --side-black)
      // v10-0-plan E5: the register 9.0 V1 emptied is gone — zero is the rule
      const found = [...new Set((body.match(/#[0-9a-fA-F]{3,8}\b/g) || []).map((c) => c.toLowerCase()))];
      for (const c of found) console.error("  bare colour outside the themes: " + c);
      assert(found.length === 0,
        "no colour is written in place outside the themes" + (found.length ? " — " + found.join(", ") : ""));
    }

    // A theme answers for the interface; a board palette answers for the board.
    // They were one block until 1.25, which is why every theme restated thirteen
    // square colours and neither could move without the other.
    for (const theme of ["wood", "night", "day", "notebook"]) {
      const sel = theme === "wood" ? ":root, \\[data-theme=\"wood\"\\]" : "\\[data-theme=\"" + theme + "\"\\]";
      const blk = new RegExp(sel + "\\s*\\{([\\s\\S]*?)\\n    \\}").exec(stripped);
      assert(blk, theme + " theme block found");
      // layer 2, the whole of what a theme declares
      for (const v of ["--surface", "--surface-raised", "--ink", "--ink-muted",
                       "--accent", "--danger", "--control", "--line"]) {
        assert(blk[1].includes(v + ":"), theme + " declares the " + v + " role");
      }
      // …and nothing from layer 3: a theme that names a component variable is a
      // theme that has to be edited when a component is added
      for (const v of ["--panel:", "--btn:", "--card:", "--text:"]) {
        assert(!blk[1].includes("\n      " + v), theme + " does not restate " + v.slice(0, -1));
      }
      // …nor any square colour
      assert(!/--sq-/.test(blk[1]), theme + " leaves the board to the board palette");
    }
    for (const board of MARK_BOARDS) {
      const sel = board === "wood" ? ":root, \\[data-board=\"wood\"\\]" : "\\[data-board=\"" + board + "\"\\]";
      const blk = new RegExp(sel + "\\s*\\{([\\s\\S]*?)\\n    \\}").exec(stripped);
      assert(blk, board + " board palette found");
      for (const v of ["--sq-light", "--sq-dark", "--sq-sel", "--sq-last", "--sq-check",
                       "--sq-dot", "--sq-ring", "--coord-ink", "--board-frame"]) {
        assert(blk[1].includes(v + ":"), board + " board defines " + v);
      }
    }
    // layer 3 is declared once, for all four
    {
      const comp = /\n    :root \{([\s\S]*?)\n    \}/.exec(stripped.slice(stripped.indexOf('[data-theme="notebook"]')));
      assert(comp && /--panel: var\(--surface-raised\)/.test(comp[1]),
        "component variables are declared once, in terms of the roles");
    }
  }

  // The board is what a player looks at essentially the whole time, and until
  // 1.11 all four themes painted it identically — the squares were constants in
  // board.js, so a theme could change the frame and nothing inside it.
  {
    const boardSrc = fs.readFileSync(path.join(root, "src/web/js/board.js"), "utf8");
    assert(/--sq-light/.test(boardSrc) && /getComputedStyle/.test(boardSrc),
      "the board reads its colours from the theme");
    assert(!/const LIGHT = "#/.test(boardSrc) && !/const DARK = "#/.test(boardSrc),
      "no square colour is hard-coded in the renderer any more");

    // design-constraints.md: 每处格子平涂必须走 cellRect() 取整. A fractional
    // fillRect boundary lands between device pixels and the two squares either
    // side of it get antialiased edges — a visible seam at some board sizes,
    // and only at some, which is why it survives being looked at. The lesson
    // success flash was the one site that bypassed it (defect 10, fixed in
    // P0.5). v10-0-plan E5: no register — zero is the rule.
    {
      const raw = [...boardSrc.matchAll(/ctx\.fillRect\(([^)]*)\)/g)]
        .map((m) => m[1].trim())
        .filter((a) => !a.startsWith("...cellRect("));
      for (const a of raw) console.error("  fillRect(" + a + ") does not go through cellRect()");
      assert(raw.length === 0, "every square fill goes through cellRect() (" + raw.length + " raw)");
    }

    // design-constraints.md said 棋子精灵只缓存一个尺寸 round(step), because
    // changing size re-rasterises twelve pieces. That reasoning is about *board*
    // sizes, which change with the window. P4.3 caches a second, fixed size —
    // round(step × LIFT) — because the alternative was scaling the board sprite
    // up 12% at draw time, which made the one piece under the pointer the only
    // stretched bitmap on the board (缺陷 18). Two, and not a third.
    assert(/size !== Math\.round\(_spriteSize \* LIFT\)/.test(boardSrc),
      "the sprite cache holds the board size and the lifted size");
    assert(!/drawImage\(sprite,[^)]*,\s*Math\.round\(sz\),\s*Math\.round\(sz\)\)/.test(boardSrc),
      "…and nothing is scaled up at draw time any more");
    // …and every piece stands on something
    assert(/function paintContactShadow\(/.test(boardSrc), "pieces have a contact shadow");
    assert(/P\.pieceShadow/.test(boardSrc), "…in a colour the board palette chooses");
    assert(/invalidatePaint/.test(boardSrc) &&
      /invalidatePaint\(\)/.test(allAppSource),
      "switching theme re-reads them");

    // and the pieces have to stay legible on every one of them. The cburnett
    // vectors are pure black and white with a black outline, so what has to
    // carry is that outline against both square colours.
    const css2 = fs.readFileSync(path.join(root, "src/web/styles.css"), "utf8");
    const lum = (hex) => {
      const n = hex.replace("#", "");
      const ch = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
      return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
    };
    const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    // the square colours moved to the board palettes in 1.25 — the question is
    // still "can you see a black outline on this square", which is a property of
    // the board, not of the interface around it
    for (const theme of MARK_BOARDS) {
      const sel = theme === "wood" ? /:root, \[data-board="wood"\]\s*\{([\s\S]*?)\n    \}/
        : new RegExp('\\[data-board="' + theme + '"\\]\\s*\\{([\\s\\S]*?)\\n    \\}');
      const blk = sel.exec(css2)[1];
      for (const which of ["--sq-light", "--sq-dark"]) {
        const hex = new RegExp(which + ":\\s*(#[0-9a-fA-F]{6})").exec(blk)[1];
        const r = ratio(0, lum(hex));
        assert(r >= 4.5, theme + " " + which + " keeps the piece outline legible (" + r.toFixed(2) + ":1)");
      }
    }

    // 7.7 §6: a mark is one colour, whichever square it lands on. On 7.6.0 the
    // wood last-move green composited to lime over the light square and olive
    // over the dark one, and the selection was a second, different yellow. The
    // measure is the hue term of CIEDE2000 between the two composites
    // (scripts/lib/mark-colour.mjs); 7.6.0 ran to 5.7 on four marks, 7.7 to 4.6.
    // The ceiling sits under every one of the old values, so re-tinting a mark
    // back towards olive fails here rather than on somebody's screen. And the
    // marks must stay apart from each other: a last-move tint that matches the
    // selection on the same square is two marks saying one thing.
    {
      const HUE_CEILING = 5.0;
      const SEP_FLOOR = 10;
      const now = measureMarks(css2);
      for (const b of MARK_BOARDS) {
        for (const k of MARKS) {
          const v = now[b].marks[k];
          assert(v.dH <= HUE_CEILING,
            b + " " + k + ": the same hue on the light and the dark square (ΔE00 hue term " + v.dH + " ≤ " + HUE_CEILING + ")");
        }
        assert(now[b].sep >= SEP_FLOOR,
          b + ": every two marks stay apart on the same square (closest ΔE00 " + now[b].sep + ", " + now[b].sepPair + ")");
        // 7.9 §3: quieter marks, not closer ones — no board below what 7.8.0 had
        assert(now[b].sep >= SEP_FLOOR_BY_BOARD[b],
          b + ": the marks at least as far apart as 7.8.0 (closest ΔE00 " + now[b].sep + " ≥ " + SEP_FLOOR_BY_BOARD[b] + ")");
      }
      // …and what docs/measured.json says is what ships: a retune without a
      // re-record is a stale number, and a stale number is worse than none
      const recorded = JSON.parse(fs.readFileSync(path.join(root, "docs/measured.json"), "utf8")).markHue;
      assert(!!recorded && JSON.stringify(recorded.after) === JSON.stringify(now),
        "docs/measured.json markHue.after is these palettes (re-run scripts/measure-marks.mjs --record)");
    }
    // 7.8 §6: …and not louder than it needs to be. The hue term kept the wood
    // last-move tint one colour on both squares; over the light square that
    // colour was a bright lime (C* 54.1 on 7.7.0). The ceiling is set against
    // Lichess's default board measured the same way (C* 52.4 — see
    // LAST_CHROMA_CEILING) and sits under it, so a last move reads as a tint,
    // not as a highlighter pen. Recorded as markChroma beside markHue.
    // 7.9 §3: every mark has a ceiling — the selection had run to 57, louder
    // than the last move it sits one step above, and the notebook hint to 68.
    // Last and selection ≤ 47, check and hint ≤ 52 (CHROMA_CEILING).
    {
      const now = markChroma(css2);
      for (const b of MARK_BOARDS) {
        assert(now[b].last <= LAST_CHROMA_CEILING,
          b + " last move: a soft tint over the light square (C* " + now[b].last + " ≤ " + LAST_CHROMA_CEILING + ")");
        for (const k of MARKS) {
          assert(now[b][k] <= CHROMA_CEILING[k],
            b + " " + k + ": under its chroma ceiling over the light square (C* " + now[b][k] + " ≤ " + CHROMA_CEILING[k] + ")");
        }
      }
      const recorded = JSON.parse(fs.readFileSync(path.join(root, "docs/measured.json"), "utf8")).markChroma;
      assert(!!recorded && JSON.stringify(recorded.after) === JSON.stringify(now) &&
        JSON.stringify(recorded.ceiling) === JSON.stringify(CHROMA_CEILING),
        "docs/measured.json markChroma.after is these palettes (re-run scripts/measure-marks.mjs --record)");
    }
    // v8-0-plan A3: the same mark on both squares, on every board. The two
    // checks above look at the light square (chroma) and at the hue term;
    // this one looks at the whole mark on both: its chroma over the light AND
    // the dark square under one ceiling, and the ΔE00 between the two
    // composites under another — a mark that is a tint on one square and a
    // stain on the other fails here. 7.9.0's wood check was C* 55.1 over the
    // dark square (ceiling 52), which the light-square check never saw. The
    // engine arrow is measured with them. And the boards must be boards: the
    // closest two dark squares ΔE00 ≥ 10 (7.9.0: 木 and 日, 6.4).
    {
      const look = markLook(css2);
      for (const b of MARK_BOARDS) {
        for (const k of Object.keys(LOOK_MARKS)) {
          const v = look[b][k];
          assert(!!v && Math.max(v.cl, v.cd) <= LOOK_CHROMA_CEILING[k],
            b + " " + k + ": under its chroma ceiling over both squares (C* " + (v && v.cl) + " / " + (v && v.cd) + " ≤ " + LOOK_CHROMA_CEILING[k] + ")");
          assert(!!v && v.dE <= LOOK_DE_CEILING,
            b + " " + k + ": the same mark on the light and the dark square (ΔE00 " + (v && v.dE) + " ≤ " + LOOK_DE_CEILING + ")");
        }
      }
      const apart = boardDistinct(css2);
      assert(apart.min >= BOARD_DISTINCT_FLOOR,
        "every two boards are two boards (closest dark squares ΔE00 " + apart.min + ", " + apart.pair + " ≥ " + BOARD_DISTINCT_FLOOR + ")");
      // the list measured is the list offered
      const lookSrc = fs.readFileSync(path.join(root, "src/web/js/look.js"), "utf8");
      const offered = [...lookSrc.matchAll(/\{ id: "(\w+)", warm: (?:true|false) \}/g)].map((m) => m[1]);
      assert(offered.join(",") === MARK_BOARDS.join(","),
        "the boards measured are the boards look.js offers (" + offered.join(",") + ")");
      const recorded = JSON.parse(fs.readFileSync(path.join(root, "docs/measured.json"), "utf8")).boardLook;
      assert(!!recorded && JSON.stringify(recorded.after) === JSON.stringify({ marks: look, distinct: apart }) &&
        JSON.stringify(recorded.ceiling) === JSON.stringify({ chroma: LOOK_CHROMA_CEILING, dE: LOOK_DE_CEILING, distinct: BOARD_DISTINCT_FLOOR }),
        "docs/measured.json boardLook.after is these palettes (re-run scripts/measure-marks.mjs --record)");
    }
  }
}
