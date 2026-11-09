/**
 * 21.0 G1 / G5, and the release's checksums — the static half of the real
 * machine gate (docs/review-19.0-and-v21-plan.md §4.3, §5 G).
 *
 *   G5  the bundle's engine floor matches the oldest system the app claims:
 *       scripts/bundle.mjs targets chrome100 / safari15 (or older) while
 *       build.zig links for macOS 11.0, and styles.css uses nothing Safari 15
 *       lacks unless an @supports guard says so; no module Worker. 20.0
 *       raised the target to es2022, used color-mix() unguarded and built a
 *       module Worker, and CI's macOS 26 / Windows 2025 never noticed.
 *   G1  the automation jobs walk the pages (the `pages` scenario), take the
 *       screenshots and upload them as webview-shots-<os>, whatever the result.
 *   SHA256SUMS.txt  release.yml writes one for the three packages and
 *       attaches it beside them.
 *
 * Part of scripts/test-chess.mjs, which runs every module here in order.
 */
import fs from "fs";
import path from "path";
import { assert, root, WEB_JS, GENERATED_JS } from "./harness.mjs";

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");

/**
 * The oldest Safari whose WebKit each macOS floor can be counted on to have
 * — the bundle's safari target may not be newer. 11.0 → 15: Big Sur shipped
 * Safari 14 and was offered 15 as an update; bundle.mjs's comment (v8-1-plan
 * §5) says why 15 is the floor 19.0 chose and not 14. Raising the floor is a
 * row here, a target there, and the minimum in build.zig, together (G5).
 */
export const SAFARI_FLOOR = { "11.0": 15 };
/** WebView2 is evergreen; the target is the oldest Chromium the bundle may assume. */
export const CHROME_MAX = 100;

/**
 * CSS a Safari 15 WebKit does not have, and the word an @supports guard's
 * condition must name for it. `custom`: only judged in a custom property's
 * value (where an unknown function is not dropped at parse time but turns
 * the property invalid at computed time, so every var() of it is unset —
 * the 10.1 note in styles.css); `selector`: in a rule's selector; `at`: an
 * at-rule's prelude; `value`: in any declaration's value.
 */
const FEATURES = [
  { id: "color-mix", re: /color-mix\(/, where: ["value", "custom"], guard: "color-mix" },
  { id: "light-dark", re: /light-dark\(/, where: ["value", "custom"], guard: "light-dark" },
  { id: ":has", re: /:has\(/, where: ["selector"], guard: ":has" },
  { id: "@container", re: /^@container\b/, where: ["at"], guard: "container" },
];

/**
 * The 19.0 sheet's unguarded uses that Safari < 15.4 / < 16.2 drops whole at
 * parse time — a `color-mix()` declaration (the rule's other declarations
 * and the cascade stand) or a `:has()` rule (the layout it refines falls
 * back to the rule without it). Degrades, never breaks; kept as they shipped
 * and listed here so no new one joins them unseen. Shrink it when one goes;
 * a new use needs an @supports guard instead.
 */
export const PARSE_TIME_DROPS = {
  "color-mix:value": 23,
  ":has:selector": 22,
};

/**
 * Walk a stylesheet: every rule with its selector (or at-rule prelude), the
 * at-rules around it, and its declarations. Comments and strings are read
 * past. A `{` inside a style rule is CSS nesting (Safari 16.5) and is
 * reported as such.
 * @param {string} css
 * @returns {{rules: {prelude: string, outer: string[], decls: string[]}[], nested: string[]}}
 */
export function walkCss(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const rules = [], nested = [];
  const stack = [];
  let buf = "";
  const isStyle = (p) => p && !p.startsWith("@") && !/^(from|to|\d+(\.\d+)?%)(\s*,\s*(from|to|\d+(\.\d+)?%))*$/.test(p);
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\"" || ch === "'") {
      const end = src.indexOf(ch, i + 1);
      buf += src.slice(i, end < 0 ? src.length : end + 1);
      i = end < 0 ? src.length : end;
      continue;
    }
    if (ch === "{") {
      // the prelude is what follows the last declaration in this block
      const at = buf.lastIndexOf(";");
      const prelude = buf.slice(at + 1).trim().replace(/\s+/g, " ");
      const top = stack[stack.length - 1];
      if (top && isStyle(top.prelude)) nested.push(top.prelude + " { " + prelude);
      if (top) top.body += buf.slice(0, at + 1);
      const rule = { prelude, outer: stack.map((s) => s.prelude), body: "" };
      stack.push(rule);
      buf = "";
    } else if (ch === "}") {
      const rule = stack.pop();
      if (!rule) { buf = ""; continue; }
      rule.body += buf;
      buf = "";
      rules.push({ prelude: rule.prelude, outer: rule.outer, decls: rule.body.split(";").map((d) => d.trim()).filter(Boolean) });
    } else buf += ch;
  }
  return { rules, nested };
}

/**
 * The uses of FEATURES in `css` no @supports around them names.
 * @returns {{id: string, where: string, at: string}[]}
 */
export function unguarded(css) {
  const { rules, nested } = walkCss(css);
  const out = nested.map((n) => ({ id: "nesting", where: "selector", at: n }));
  for (const r of rules) {
    const guards = r.outer.filter((p) => p.startsWith("@supports")).join(" ");
    for (const f of FEATURES) {
      if (guards.includes(f.guard) || (r.prelude.startsWith("@supports") && r.prelude.includes(f.guard))) continue;
      if (f.where.includes("at") && f.re.test(r.prelude)) out.push({ id: f.id, where: "at", at: r.prelude });
      if (f.where.includes("selector") && !r.prelude.startsWith("@") && f.re.test(r.prelude)) out.push({ id: f.id, where: "selector", at: r.prelude });
      for (const d of r.decls) {
        const custom = /^--[\w-]+\s*:/.test(d);
        if ((custom && f.where.includes("custom")) || (!custom && f.where.includes("value"))) {
          if (f.re.test(d)) out.push({ id: f.id, where: custom ? "custom" : "value", at: r.prelude + " { " + d });
        }
      }
    }
  }
  return out;
}

/** Every hand-written script under src/web/js (the generated bundle, chunks and engine sources left out). */
function webSources(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...webSources(p));
    else if (e.name.endsWith(".js") && !GENERATED_JS.test(e.name) && !/^maia-1.*\.js$/.test(e.name)) out.push(p);
  }
  return out;
}

export async function run() {
  // --- G5: the bundle's floor, the system's floor ---------------------------
  {
    const bundle = read("scripts/bundle.mjs");
    const targets = [...bundle.matchAll(/\btarget:\s*\[([^\]]*)\]/g)].map((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
    const zig = read("build.zig");
    const mins = [...new Set([...zig.matchAll(/-mmacosx-version-min=([\d.]+)/g)].map((m) => m[1]))];
    assert(targets.length >= 3 && targets.every((t) => JSON.stringify(t) === JSON.stringify(targets[0])),
      "G5: every esbuild call in bundle.mjs names the same target (" + targets.map((t) => t.join("+")).join(" / ") + ")");
    const t = targets[0] || [];
    const chrome = t.map((x) => /^chrome(\d+)$/.exec(x)).filter(Boolean).map((m) => +m[1]);
    const safari = t.map((x) => /^safari(\d+)$/.exec(x)).filter(Boolean).map((m) => +m[1]);
    assert(chrome.length === 1 && safari.length === 1 && chrome.length + safari.length === t.length,
      "G5: the target is one Chromium and one Safari floor, nothing else (no esNNNN that would let newer syntax through) (" + t.join(", ") + ")");
    assert(mins.length === 1 && mins[0] in SAFARI_FLOOR,
      "G5: build.zig links every macOS source for one minimum, one this check knows the WebKit of (" + mins.join(", ") + ")");
    assert(safari[0] <= SAFARI_FLOOR[mins[0]] && chrome[0] <= CHROME_MAX,
      "G5: the bundle assumes no newer engine than the system floor gives: safari" + safari[0] + " ≤ safari" + SAFARI_FLOOR[mins[0]] +
      " (macOS " + mins[0] + "), chrome" + chrome[0] + " ≤ chrome" + CHROME_MAX);
  }

  // --- G5: styles.css on Safari 15 ------------------------------------------
  {
    // the scanner itself, on what it must catch and what it must let by
    const flagged = (css) => unguarded(css).map((u) => u.id + ":" + u.where);
    assert(flagged(".a { color: red; & .b { color: blue } }").join() === "nesting:selector", "G5 scanner: nesting is caught");
    assert(flagged(":root { --x: color-mix(in srgb, red 50%, blue); }").join() === "color-mix:custom", "G5 scanner: a custom property holding color-mix() is caught");
    assert(flagged("@supports (color: color-mix(in srgb, red 50%, blue)) { :root { --x: color-mix(in srgb, red 50%, blue); } }").length === 0, "G5 scanner: …and let by under its @supports");
    assert(flagged(".a:has(> b) { color: red }").join() === ":has:selector" && flagged("@supports selector(:has(a)) { .a:has(> b) { color: red } }").length === 0,
      "G5 scanner: :has() is caught, and let by under @supports selector(:has(…))");
    assert(flagged("@container (min-width: 1px) { .a { color: red } }").join() === "@container:at" && flagged(".a { color: light-dark(red, blue) }").join() === "light-dark:value",
      "G5 scanner: @container and light-dark() are caught");
    assert(flagged("@media (min-width: 1px) { .a { color: red } } @keyframes k { from { opacity: 0 } to { opacity: 1 } } .u { background: url(\"a{b}.svg\") }").length === 0,
      "G5 scanner: @media, @keyframes and a brace in a string are not nesting");

    const found = unguarded(read("src/web/styles.css"));
    const bad = found.filter((u) => !((u.id + ":" + u.where) in PARSE_TIME_DROPS));
    assert(bad.length === 0, "G5: styles.css uses nothing Safari 15 lacks outside an @supports guard — no nesting, @container, light-dark(), " +
      "custom property holding color-mix() (" + (bad.length ? bad.slice(0, 6).map((b) => b.id + " in " + b.at.slice(0, 90)).join(" | ") : "none") + ")");
    const drops = {};
    for (const k of Object.keys(PARSE_TIME_DROPS)) drops[k] = found.filter((u) => u.id + ":" + u.where === k).length;
    const over = Object.keys(drops).filter((k) => drops[k] > PARSE_TIME_DROPS[k]);
    assert(over.length === 0, "G5: no new unguarded color-mix() declaration or :has() rule (" + JSON.stringify(drops) + " of the 19.0 sheet's " +
      JSON.stringify(PARSE_TIME_DROPS) + "; each is dropped whole on Safari 15, and a new one goes under @supports)" +
      (over.length ? " — new: " + found.filter((u) => over.includes(u.id + ":" + u.where)).map((u) => u.at.slice(0, 80)).join(" | ") : ""));
    assert(Object.keys(drops).every((k) => drops[k] === PARSE_TIME_DROPS[k]),
      "G5: PARSE_TIME_DROPS is the sheet's count, not a ceiling left high (" + JSON.stringify(drops) + ")");
  }

  // --- G5: no module Worker -------------------------------------------------
  {
    const offenders = [];
    for (const f of webSources(WEB_JS)) {
      const text = fs.readFileSync(f, "utf8");
      for (const m of text.matchAll(/new\s+(?:Shared)?Worker\s*\(([^;]*)/g)) {
        if (/type\s*:\s*["'`]module["'`]/.test(m[1])) offenders.push(path.relative(root, f));
      }
      if (/\btype\s*:\s*["'`]module["'`]/.test(text) && /Worker/.test(text) && !offenders.includes(path.relative(root, f))) offenders.push(path.relative(root, f) + " (an options object with type: \"module\")");
    }
    assert(offenders.length === 0, "G5: every Worker is a classic one — zero:// loads no module, and Safari 15 has no module Worker (" + (offenders.join(", ") || "none") + ")");
  }

  // --- G1: the automation jobs walk the pages and keep the screenshots ------
  {
    const { SCENARIO_NAMES, PAGE_STEPS } = await import("../../src/web/js/selftest-scenarios.js");
    assert(SCENARIO_NAMES.includes("pages"), "G1: the page side has a `pages` scenario");
    const views = new Set(PAGE_STEPS.map((s) => s.view));
    const segs = PAGE_STEPS.filter((s) => s.view === "train").map((s) => s.seg).sort();
    assert(["home", "play", "train", "me", "settings"].every((v) => views.has(v)) && segs.join() === "classic,course,endgame,opening,puzzle" &&
      PAGE_STEPS.some((s) => s.review) && PAGE_STEPS.some((s) => s.dark),
      "G1: the walk covers 今天, 下棋, 训练's five segments, 我的, 设置, a review and the dark appearance (" + PAGE_STEPS.map((s) => s.name).join(", ") + ")");
    const driver = read("scripts/automation-scenarios.mjs");
    assert(/await scenario\("pages",/.test(driver) && /captureWindow\(app\.child\.pid, file\)/.test(driver) && /check\("G1:shot:" \+ name, s && s\.bytes > 1000 && !s\.late/.test(driver),
      "G1: automation-scenarios.mjs runs `pages`, screenshots each page from outside, and fails a missing, empty or late shot");
    assert(/screencapture/.test(driver) && /CopyFromScreen/.test(driver), "G1: the screenshots are the OS's — screencapture on macOS, CopyFromScreen on Windows");
    for (const [wf, os] of [[".github/workflows/build-macos.yml", "macos"], [".github/workflows/build-windows.yml", "windows"]]) {
      const text = read(wf);
      const job = text.slice(text.indexOf("\n  automation:\n"));
      assert(/node scripts\/automation-scenarios\.mjs "\$AUTO_EXE"[^\n]* --shots webview-shots\n/.test(job), wf + ": the scenarios step writes the screenshots to webview-shots/");
      const up = /- uses: actions\/upload-artifact@v7\n {8}if: always\(\)\n {8}with:\n {10}name: (webview-shots-\w+)\n {10}path: webview-shots\/\n/.exec(job);
      assert(up && up[1] === "webview-shots-" + os, wf + ": the screenshots are uploaded as webview-shots-" + os + ", pass or fail (" + (up && up[1]) + ")");
    }
  }

  // --- 21.0: SHA256SUMS.txt beside the three packages -----------------------
  {
    const rel = read(".github/workflows/release.yml").split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
    const step = (name) => rel.indexOf("- name: " + name + "\n");
    const at = step("checksums");
    const body = at < 0 ? "" : rel.slice(at, rel.indexOf("\n      - ", at + 1));
    assert(at > step("both packages are here") && at < rel.indexOf("gh release create"),
      "release.yml: the checksums step comes after the packages are checked in dist/ and before the release is drafted");
    assert(/working-directory: dist\n/.test(body) &&
      /sha256sum Chessboard-macOS-arm64\.zip Chessboard-macOS-arm64\.dmg Chessboard-Windows-x64\.zip > SHA256SUMS\.txt\n/.test(body) &&
      /sha256sum -c SHA256SUMS\.txt/.test(body),
      "release.yml: SHA256SUMS.txt holds the three packages by their bare names (checkable in a download folder), and is checked once written");
    assert(/\*SHA256SUMS\.txt\*\) ;; \*\) echo "missing SHA256SUMS\.txt"; exit 1;;/.test(rel), "release.yml: the drafted release is checked for SHA256SUMS.txt");
  }
}
