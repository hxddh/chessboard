/**
 * The automation build's page-side scenarios (v8-2-plan V1 step 2, §9 M1
 * "第 2 步设计"). The SDK's automation server drives the app from outside —
 * menus, menu commands, chess.* over the bridge, the main loop's pulse — but
 * cannot run script in the WebView or read its DOM. What only the page can
 * do is here: scripts/automation-scenarios.mjs launches the automation build
 * with CHESS_SELFTEST=1 and CHESS_SELFTEST_SCENARIO=<name>, main.zig hands
 * the name to the page (chess.selftestMode), and the page runs that scenario
 * and reports through chess.selftestReport — which in scenario mode writes
 * the file and does not exit, so a scenario can report more than once (each
 * report replaces the last) and the driver ends the process.
 *
 * Each scenario is one launch; the ones about a restart are two or three
 * launches on one profile, compared by the driver:
 *
 *   rep-seed     a two-line book in the header (chess.repertoire), the way
 *                a learning file leaves it, written through persist.js (R17)
 *   rep-index    the next launch's own boot moves it into chessboard.book —
 *                its lines, and records with cards (rep-page.js, v8-2-plan
 *                T4); the page waits for both and
 *                reports what is there — records, lines, cards, due today
 *   rep-read     one more launch: the same records and lines, read back
 *   sync         against the fake server (CHESS_SYNC_BASE,
 *                scripts/fake-sync-server.mjs): 100 Lichess games streamed
 *                slowly while 已取到 k 局 is polled and the frames are timed
 *                (R6), an incremental request and one with nothing new
 *                (R6a), Chess.com with its Chess960 games left out (R7), no
 *                answer (R8), no such user (R9), 429 (R11); the games go
 *                into the library. The driver times the main loop meanwhile
 *   prefetch-seed  300 games into the library, until its header says the
 *                games and their summary are in IndexedDB (R18)
 *   prefetch-read  the next launch: did chunk-boot.js's prefetch ask, answer
 *                with the whole library, and when (selftest-boot.js `pre`)
 *   menus        the native menu commands reach the page and do what the
 *                menu says: game.new opens 新对局, view.repertoire goes to
 *                训练 · 开局's 我的开局书 (B1–B5's command path; 19.0 S1)
 *   pages        21.0 G1: 今天, 下棋, 训练's five segments, 我的, 设置, a
 *                review of a short game, then 今天 / 下棋 / 设置 in dark —
 *                each judged as drawn (the stylesheet applies, the rail and
 *                the buttons have boxes and are visible, nothing in the main
 *                column has no width, the board canvas holds pixels) and held
 *                on screen while the driver screenshots the real window; then
 *                no uncaught error, seen or in the errlog key
 *
 * The page reports facts and judges only what is not a timing; the timing
 * thresholds live with the driver. Checks say `pass`, never `ok`.
 *
 * In chunk-selftest.js with selftest-run.js — never in bundle.js.
 * @module selftest-scenarios
 */
import { openRepDb } from "./rep-db.js";
import { syncMessage, syncPrefs } from "./sync-ui.js";
import { HEADER_KEY } from "./library-sum.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll `fn` until it answers truthy, every `every` ms, at most `ms`; its last answer. */
async function until(fn, ms, every = 250) {
  const end = performance.now() + ms;
  for (;;) {
    let v = null;
    try { v = await fn(); } catch (_) { v = null; }
    if (v || performance.now() > end) return v;
    await sleep(every);
  }
}

/** FNV-1a, base 36 — drills.js hash36, for a line id like the app's. */
function hash36(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}
const line = (sans) => ({ id: "rep-" + hash36(sans), sans, eco: "", name: "" });
/** The book rep-seed writes: a line a side. */
export const SEED_BOOK = { v: 1, w: [line("e4 e5 Nf3 Nc6 Bb5")], b: [line("d4 Nf6 c4 e6")] };

/**
 * The longest gap between animation frames from now until stop(), and (12.0
 * R) when it ended, in ms from the start — so a long one can be placed
 * against what the scenario was doing then (the answer arrived at `ms`).
 */
function frameGaps() {
  const t0 = performance.now();
  let last = t0, max = 0, at = 0, n = 0, on = true;
  const long = [];
  const tick = (t) => {
    if (!on) return;
    if (t - last > 250) long.push([Math.round(last - t0), Math.round(t - t0)]);
    if (t - last > max) { max = t - last; at = t - t0; }
    last = t; n++; requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // 12.0 R: what else was going on — how long after the page loaded this
  // started, and the scripts and requests that arrived inside the longest gap
  return () => {
    on = false;
    const from = t0 + at - max - 50, to = t0 + at;
    const res = (performance.getEntriesByType ? performance.getEntriesByType("resource") : [])
      .filter((e) => e.responseEnd >= from && e.startTime <= to)
      .map((e) => String(e.name).split("/").pop() + "@" + Math.round(e.responseEnd - t0));
    return { maxMs: Math.round(max), at: Math.round(at), frames: n, sinceLoad: Math.round(t0), long, res };
  };
}

/**
 * Until the page has drawn a full second without a frame gap over 120 ms
 * (15 s at most). 14.0: R6 times the frames *while the games stream in*; a
 * lighter launch let the scenario start 1.27 s after the load, and the
 * window caught the launch's own script compile (882 ms on macOS) — the
 * same overlap 12.0 R found with the engine boot. Starting after the page
 * settles keeps the measurement on the sync; the threshold is unchanged.
 */
function settled() {
  return new Promise((resolve) => {
    const t0 = performance.now();
    let last = t0, calm = t0;
    const tick = (t) => {
      if (t - last > 120) calm = t;
      last = t;
      if (t - calm >= 1000 || t - t0 > 15000) resolve(Math.round(t - t0));
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** What chessboard.book holds now. */
async function repState(now) {
  const db = await openRepDb(globalThis.indexedDB);
  if (!db) throw new Error("openRepDb answered null: no IndexedDB, or the database refused");
  const records = await db.all(), lines = await db.lines();
  return {
    records: records.map((r) => r.id).sort(),
    lines: lines.map((r) => r.k).sort(),
    cards: records.filter((r) => r && r.card).length,
    due: records.filter((r) => r && r.card && (Number(r.card.due) || 0) <= now).length,
  };
}

/** n distinct short games, one PGN text. */
export function seedPgn(n) {
  const lines = ["1. e4 e5 2. Nf3 Nc6 3. Bb5 a6", "1. d4 d5 2. c4 e6 3. Nc3 Nf6", "1. c4 e5 2. Nc3 Nf6 3. g3 d5", "1. e4 c5 2. Nf3 d6 3. d4 cxd4"];
  const out = [];
  for (let i = 0; i < n; i++) {
    const day = String(1 + (i % 28)).padStart(2, "0");
    out.push("[Event \"selftest\"]\n[Site \"selftest-" + i + "\"]\n[Date \"2026.08." + day + "\"]\n[White \"seed_" + i + "\"]\n[Black \"opp\"]\n[Result \"1-0\"]\n\n" + lines[i % lines.length] + " 1-0");
  }
  return out.join("\n\n");
}

const pressEscape = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

/** Close whatever dialog a launch opened (the first-run guide); a check's body. */
async function clearDialogs() {
  const shown = (sel) => !!document.querySelector(sel);
  for (let i = 0; i < 10 && shown(".modal-bg.show"); i++) {
    const later = document.querySelector(".modal-bg.show #pick-cancel");
    if (later) later.click(); else pressEscape();
    await sleep(300);
  }
  if (shown(".modal-bg.show")) throw new Error("a dialog would not close");
  return {};
}

/**
 * 21.0 G1: the pages the `pages` scenario walks, in order, each held on
 * screen for the driver's screenshot. `view` is the rail's data-view, `seg`
 * 训练's segment, `board` that the board canvas must show pixels, `review`
 * that a short game is pasted into 分析一局 and reviewed first, `dark` that
 * the appearance is switched to dark first (and stays so for what follows).
 */
export const PAGE_STEPS = [
  { name: "home", view: "home" },
  { name: "play", view: "play", board: true },
  { name: "train-course", view: "train", seg: "course", board: true },
  { name: "train-puzzle", view: "train", seg: "puzzle", board: true },
  { name: "train-opening", view: "train", seg: "opening", board: true },
  { name: "train-endgame", view: "train", seg: "endgame", board: true },
  { name: "train-classic", view: "train", seg: "classic", board: true },
  { name: "me", view: "me" },
  { name: "settings", view: "settings" },
  { name: "review", view: "play", review: true, board: true },
  { name: "dark-home", view: "home", dark: true },
  { name: "dark-play", view: "play", board: true },
  { name: "dark-settings", view: "settings" },
];
/** How long each page stays put after its "shot:<name>" report — the driver's window to capture it. */
export const SHOT_DWELL_MS = 5000;
/** The short game the review step pastes (Fool's mate: four plies, a fast pass with the real engine). */
const REVIEW_PGN = "[Event \"selftest\"]\n[White \"a\"]\n[Black \"b\"]\n[Result \"0-1\"]\n\n1. f3 e5 2. g4 Qh4# 0-1";

/** The rendered box of `el`, or null when it takes no space (display: none, detached, under a hidden parent). */
function boxOf(el) {
  if (!el || !el.getClientRects().length) return null;
  const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
  return { w: Math.round(r.width), h: Math.round(r.height), vis: cs.visibility, op: Number(cs.opacity) };
}
const isTransparent = (c) => !c || c === "transparent" || /^rgba\(.*,\s*0\)$/.test(c);
const label = (el) => (el.id ? "#" + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : ""));

/**
 * What a page with no stylesheet would compute: an empty frame's body and
 * button, styled by nothing but the browser. A style of ours that did not
 * apply reads the same as these. (A frame that computes nothing answers
 * empty strings, and the comparisons with them pass: weaker, never red.)
 */
export function uaDefaults() {
  const f = document.createElement("iframe");
  f.setAttribute("aria-hidden", "true");
  f.hidden = true; // [hidden] is display: none; the frame still computes its styles
  document.body.appendChild(f);
  try {
    const doc = f.contentDocument;
    const b = doc.createElement("button");
    b.textContent = "x";
    doc.body.appendChild(b);
    const w = f.contentWindow;
    return { font: w.getComputedStyle(doc.body).fontFamily, btnBg: w.getComputedStyle(b).backgroundColor, btnColor: w.getComputedStyle(b).color };
  } finally { f.remove(); }
}

/**
 * The board canvas as pixels: a 16×16 grid of samples, how many are not
 * transparent and how many colours (quantised) they hold. A canvas the
 * renderer never drew on is all transparent; a board has at least its two
 * square colours. `tainted` when the canvas will not be read (then the
 * driver's screenshot is the only witness, and this check says so).
 */
function boardPixels(cv) {
  const out = { w: cv.width, h: cv.height };
  let data = null;
  try {
    const g = cv.getContext("2d");
    if (!g) return Object.assign(out, { err: "no 2d context" });
    data = g.getImageData(0, 0, cv.width, cv.height).data;
  } catch (err) { return Object.assign(out, { tainted: String((err && err.name) || err) }); }
  let opaque = 0, n = 0;
  const colours = new Set();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const px = Math.min(cv.width - 1, Math.floor((x + 0.5) * cv.width / 16)), py = Math.min(cv.height - 1, Math.floor((y + 0.5) * cv.height / 16));
    const i = (py * cv.width + px) * 4;
    n++;
    if (data[i + 3] > 200) { opaque++; colours.add((data[i] >> 4) + "," + (data[i + 1] >> 4) + "," + (data[i + 2] >> 4)); }
  }
  return Object.assign(out, { samples: n, opaque, colours: colours.size });
}

/**
 * The regions a page is made of, by view: a page of its own (今天, 我的,
 * 设置) is its `main.page`; 下棋 and 训练 are the board and the panel.
 */
function regionsOf(view) {
  const page = document.getElementById("page-" + view);
  if (page) return { need: [page], maybe: [] };
  return { need: [document.getElementById("board-wrap")], maybe: [document.getElementById("side")] };
}

/**
 * 21.0 G1: is the page really drawn — not "do the elements exist", which is
 * all 20.0's native checks asked while its UI was broken on real machines.
 * Throws with every finding; returns the facts otherwise.
 */
export function judgePage(step, ua) {
  const bad = [];
  const facts = {};
  // the stylesheet arrived and applies
  const sheet = [...document.styleSheets].find((s) => /styles\.css(\?|$)/.test(s.href || ""));
  let rules = 0;
  try { rules = sheet ? sheet.cssRules.length : 0; } catch (_) { rules = 0; } // ours is same-origin: unreadable is not loaded
  const root = getComputedStyle(document.documentElement), body = getComputedStyle(document.body);
  facts.css = { rules, bg: body.backgroundColor, font: body.fontFamily, vars: ["--bg", "--text", "--font-ui"].map((v) => !!root.getPropertyValue(v).trim()) };
  if (rules < 200) bad.push("styles.css has " + rules + " rules (not loaded?)");
  if (facts.css.vars.includes(false)) bad.push("custom properties missing: " + JSON.stringify(facts.css.vars));
  if (isTransparent(body.backgroundColor)) bad.push("body has no background (" + body.backgroundColor + ")");
  if (body.fontFamily === ua.font) bad.push("body font is the browser default (" + body.fontFamily + ")");
  // the rail: five buttons, each with a box, visible, and styled
  const rail = document.getElementById("rail");
  const railBox = boxOf(rail);
  const btns = rail ? [...rail.querySelectorAll(".rail-btn")] : [];
  facts.rail = { box: railBox, display: rail ? getComputedStyle(rail).display : null, n: btns.length };
  if (!railBox || railBox.w < 20 || railBox.h < 20 || railBox.vis !== "visible" || railBox.op === 0) bad.push("rail not visible: " + JSON.stringify(railBox));
  if (facts.rail.display === "block" || facts.rail.display === "inline") bad.push("rail is display:" + facts.rail.display + " (its layout rule did not apply)");
  if (btns.length !== 5) bad.push("rail has " + btns.length + " buttons");
  for (const b of btns) {
    const bx = boxOf(b), cs = getComputedStyle(b);
    if (!bx || bx.w < 16 || bx.h < 16 || bx.vis !== "visible" || bx.op === 0) bad.push("rail button " + b.dataset.view + " " + JSON.stringify(bx));
    if (cs.backgroundColor === ua.btnBg && cs.color === ua.btnColor) bad.push("rail button " + b.dataset.view + " has the browser's button style (" + cs.backgroundColor + ")");
  }
  // the page's regions, and nothing in their main column squashed to no width
  const { need, maybe } = regionsOf(step.view);
  facts.regions = {};
  const zero = [];
  for (const el of need.concat(maybe)) {
    if (!el) continue;
    const bx = boxOf(el);
    facts.regions[label(el)] = bx;
    if (need.includes(el) && (!bx || bx.w < 200 || bx.h < 150 || bx.vis !== "visible")) bad.push(label(el) + " is not on screen: " + JSON.stringify(bx));
    if (!bx) continue;
    const inner = el.querySelector(":scope > .page-inner") || el;
    for (const k of inner.children) {
      if (!k.getClientRects().length || k.classList.contains("sr-only")) continue;
      const cs = getComputedStyle(k);
      if (/^inline|^contents$/.test(cs.display) || cs.position === "fixed") continue;
      if (k.getBoundingClientRect().width < 1) zero.push(label(k));
    }
  }
  if (zero.length) bad.push("zero width in the main column: " + zero.join(", "));
  // the buttons on the page: a box each, and at least one
  const scope = need.concat(maybe).filter(Boolean);
  const buttons = scope.flatMap((el) => [...el.querySelectorAll("button")]).filter((b) => b.getClientRects().length && getComputedStyle(b).visibility === "visible");
  const flat = buttons.filter((b) => { const r = b.getBoundingClientRect(); return r.width < 1 || r.height < 1; });
  facts.buttons = { n: buttons.length, flat: flat.length };
  if (!buttons.length) bad.push("no visible button on the page");
  if (flat.length) bad.push("buttons with no size: " + flat.slice(0, 8).map(label).join(", "));
  // the board: on screen, and pixels on it
  if (step.board) {
    const cv = document.getElementById("board");
    const bx = boxOf(cv);
    facts.board = Object.assign({ box: bx }, cv ? boardPixels(cv) : {});
    if (!bx || bx.w < 160 || bx.h < 160 || bx.vis !== "visible") bad.push("board canvas not on screen: " + JSON.stringify(bx));
    if (!facts.board.tainted && !(facts.board.opaque >= facts.board.samples * 0.9 && facts.board.colours >= 2)) bad.push("board canvas is blank: " + JSON.stringify(facts.board));
  }
  if (bad.length) throw Object.assign(new Error(bad.join("; ")), { out: facts });
  return facts;
}

const SCENARIOS = {
  async "rep-seed"(d, c) {
    // R5 on the way: the first launch of a fresh profile — 允许联网同步 is off
    await c("syncOff", async () => {
      const on = syncPrefs(d.Persist.read("sync").value).on;
      if (on) throw new Error("允许联网同步 is on in a fresh profile");
      return {};
    });
    await c("seed", async () => {
      // after the repertoire's chunk has booted on the empty book, so its
      // boot cannot write the empty one over this
      await until(() => globalThis.CHESS_REP, 20000);
      await sleep(1000);
      if (!d.Persist.setJson("repertoire", SEED_BOOK)) throw new Error("persist.js refused the write");
      await d.Persist.flushMirror();
      return { lines: SEED_BOOK.w.length + SEED_BOOK.b.length };
    });
  },
  async "rep-index"(d, c) {
    await c("indexed", async () => {
      const want = SEED_BOOK.w.length + SEED_BOOK.b.length;
      const s = await until(async () => { const x = await repState(Date.now()); return x.lines.length >= want && x.records.length && x.cards ? x : null; }, 30000, 500);
      if (!s) throw new Error("the boot did not index the seeded book into IndexedDB in 30 s: " + JSON.stringify(await repState(Date.now())));
      if (!s.due) throw new Error("no card due today among " + s.records.length + " records");
      return s;
    });
  },
  async "rep-read"(d, c) {
    await c("readBack", async () => {
      const s = await repState(Date.now());
      if (!s.records.length || !s.lines.length) throw new Error("nothing came back: " + JSON.stringify(s));
      return s;
    });
  },
  async sync(d, c) {
    const H = d.Host;
    const ask = (p) => d.within(H.fetchGames(p), 90000, "chess.fetchGames " + p.site + " " + p.user);
    let first = null;
    // R6: 100 games, slowly; 已取到 k 局 polled as sync-ui.js polls it, the frames timed
    await c("lichess", async () => {
      await settled();
      const seen = [];
      let polling = true;
      const poll = (async () => {
        while (polling) {
          const p = await H.fetchProgress();
          if (p && p.busy) seen.push(p.count);
          await sleep(100);
        }
      })();
      const stop = frameGaps();
      const t0 = performance.now();
      const r = await ask({ site: "lichess", user: "slow_tester", max: 100 });
      const ms = Math.round(performance.now() - t0);
      const frames = stop();
      polling = false;
      await poll;
      if (!r || r.error) throw new Error("answered " + JSON.stringify(r));
      first = r;
      const rising = seen.every((k, i) => i === 0 || k >= seen[i - 1]);
      const out = { count: r.count, ms, frames, progress: { asks: seen.length, distinct: new Set(seen).size, last: seen[seen.length - 1] || 0, rising } };
      if (r.count !== 100) throw Object.assign(new Error("count " + r.count + ", not 100"), { out });
      if (!rising || out.progress.distinct < 3) throw Object.assign(new Error("已取到 k 局 did not count up: " + seen.join(",")), { out });
      return out;
    });
    await c("libraryImport", async () => {
      if (!first) throw new Error("no games to import");
      const r = await d.within(d.importPgnToLibrary(first.pgn, "selftest"), 60000, "import into the library");
      if (!r || r.added !== first.count) throw new Error("import answered " + JSON.stringify(r));
      return r;
    });
    // R6a: since= — three games at or after it come back; none after the newest
    await c("incremental", async () => {
      if (!first || !first.last) throw new Error("the first answer carried no last");
      const since = first.last - 2 * 3600 * 1000;
      const r = await ask({ site: "lichess", user: "slow_tester", max: 20, since });
      if (!r || r.count !== 3) throw new Error("since=last−2h answered " + JSON.stringify(r && { count: r.count, error: r.error }));
      const none = await ask({ site: "lichess", user: "slow_tester", max: 20, since: first.last + 1000 });
      const say = syncMessage(none, true);
      // the dialog's own line for an incremental sync that found nothing
      const nothing = syncMessage({ pgn: "", count: 0 }, true);
      if (!none || none.count !== 0 || !say || say.key !== nothing.key) throw new Error("nothing new answered " + JSON.stringify(none) + ", read as " + JSON.stringify(say));
      return { count: r.count, none: say.key };
    });
    // R7: standard chess only
    await c("chesscom", async () => {
      const r = await ask({ site: "chesscom", user: "cc_tester", max: 20 });
      if (!r || r.error) throw new Error("answered " + JSON.stringify(r));
      if (r.count !== 9 || /Variant "Chess960"/i.test(r.pgn)) throw new Error("count " + r.count + " (want the month's 9 standard games, no Chess960)");
      const imp = await d.within(d.importPgnToLibrary(r.pgn, "selftest"), 60000, "import into the library");
      return { count: r.count, added: imp && imp.added };
    });
    // R8, R9, R11: each in its own words
    const want = [
      ["lichess", "offline_user", "sync.offline"], ["lichess", "missing_user", "sync.notFound"],
      ["chesscom", "missing_user", "sync.notFound"], ["lichess", "limited_user", "sync.rate"],
    ];
    for (const [site, user, key] of want) {
      await c("error:" + site + ":" + user, async () => {
        const r = await ask({ site, user, max: 20 });
        const say = syncMessage(r, false);
        if (!say || say.key !== key) throw new Error("answered " + JSON.stringify(r) + ", read as " + JSON.stringify(say) + ", want " + key);
        return { error: r.error, key };
      });
    }
  },
  async "prefetch-seed"(d, c) {
    await c("seeded", async () => {
      const r = await d.within(d.importPgnToLibrary(seedPgn(300), "selftest"), 90000, "import 300 games");
      if (!r || r.added !== 300) throw new Error("import answered " + JSON.stringify(r));
      // the header names the summary in IndexedDB (library-sum.js bootPrefetch's test)
      const h = await until(() => { const raw = localStorage.getItem(HEADER_KEY); return raw && /"sum":"/.test(raw) ? JSON.parse(raw) : null; }, 30000, 250);
      if (!h) throw new Error("the library's header never named a summary");
      await d.Persist.flushMirror();
      return { n: Number(h.n) || 0 };
    });
  },
  async "prefetch-read"(d, c) {
    await c("prefetch", async () => {
      const pre = d.atBoot.pre;
      if (!pre) throw new Error("chunk-boot.js did not ask for the summary (no header with a summary)");
      const got = await d.within(pre, 15000, "the prefetch's answer");
      if (!got || got.n < 0) throw new Error("the prefetch answered without a summary");
      return { n: got.n, ms: Math.round(got.ms) };
    });
  },
  async menus(d, c, report) {
    const shown = (sel) => !!document.querySelector(sel);
    // whatever a launch opened (the first-run guide) is closed first: a
    // native command waits while any dialog is up (native-commands.js run)
    await c("clear", clearDialogs);
    const got = [];
    d.Host.onAppLifecycle({ shortcut: (detail) => {
      try { const x = typeof detail === "string" ? JSON.parse(detail) : detail; got.push(x && (x.command || x.id)); } catch (_) { got.push(null); }
    } });
    await report("armed");
    await c("game.new", async () => {
      if (!await until(() => got.includes("game.new"), 30000, 100)) throw new Error("no shortcut event for game.new; saw " + JSON.stringify(got));
      if (!await until(() => shown("#newgame-modal.show"), 5000, 100)) throw new Error("新对局 did not open");
      pressEscape();
      if (!await until(() => !shown(".modal-bg.show"), 5000, 100)) throw new Error("新对局 would not close");
      return {};
    });
    await report("next");
    await c("view.repertoire", async () => {
      if (!await until(() => got.includes("view.repertoire"), 30000, 100)) throw new Error("no shortcut event for view.repertoire; saw " + JSON.stringify(got));
      const ok = await until(() => {
        const s = JSON.parse(d.Persist.get("settings") || "{}");
        const sec = document.getElementById("sec-rep");
        // 19.0 S1: under 训练 · 开局 (it was the 棋谱 page's)
        return s.view === "train" && sec && sec.offsetParent !== null;
      }, 5000, 100);
      if (!ok) throw new Error("训练 · 开局's 我的开局书 is not what is shown");
      return {};
    });
  },
  /**
   * 21.0 G1: every main page, each judged as drawn (judgePage) and then held
   * for SHOT_DWELL_MS after a "shot:<name>" report, while the driver takes a
   * screenshot of the real window (automation-scenarios.mjs --shots). Ends
   * with the page's uncaught errors: those seen meanwhile, and the errlog
   * appdata key (errlog.js), which holds the boot's too.
   */
  async pages(d, c, report) {
    const errors = [];
    const onErr = (ev) => errors.push(String((ev && ev.error && (ev.error.stack || ev.error.message)) || (ev && ev.message) || "error"));
    const onRej = (ev) => errors.push("rejection: " + d.errText(ev && ev.reason));
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    await c("clear", clearDialogs);
    const ua = uaDefaults();
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const click = (sel) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error("no " + sel);
      el.click();
    };
    const lightBg = { v: null };
    for (const step of PAGE_STEPS) {
      await c("page:" + step.name, async () => {
        if (step.dark) {
          click("#rail .rail-btn[data-view=\"settings\"]");
          await sleep(300);
          click("#cat-general");
          await sleep(300);
          lightBg.v = getComputedStyle(document.body).backgroundColor;
          click("button[data-appearance=\"dark\"]");
          await sleep(500);
          const now = getComputedStyle(document.body).backgroundColor;
          if (now === lightBg.v) throw new Error("the dark appearance left the background at " + now);
        }
        if (step.review) {
          click("#rail .rail-btn[data-view=\"home\"]");
          await sleep(500);
          click("#today-analyse");
          if (!await until(() => document.querySelector("#analyse-modal.show"), 5000, 100)) throw new Error("分析一局 did not open");
          document.getElementById("an-text").value = REVIEW_PGN;
          click("#an-go");
          // the real engine's pass over four plies (scripted in the browser check)
          if (!await until(() => { const r = document.getElementById("report-card"); return r && !r.hidden && boxOf(r); }, 90000, 250)) {
            throw new Error("the review's report card did not appear in 90 s");
          }
        }
        click("#rail .rail-btn[data-view=\"" + step.view + "\"]");
        if (step.seg) {
          await sleep(300);
          click("#train-seg button[data-seg=\"" + step.seg + "\"]");
        }
        await until(() => regionsOf(step.view).need.every((el) => boxOf(el)), 10000, 100);
        if (step.board) await until(() => { const p = boardPixels(document.getElementById("board")); return p.tainted || p.colours >= 2; }, 5000, 200);
        await sleep(800);
        await frame();
        const facts = judgePage(step, ua);
        if (step.dark) facts.lightBg = lightBg.v;
        return facts;
      });
      await report("shot:" + step.name);
      await sleep(SHOT_DWELL_MS);
      // the page is about to change: a shot finished after this is of the wrong page
      await report("left:" + step.name);
    }
    // back to the appearance the profile had
    try { click("#rail .rail-btn[data-view=\"settings\"]"); click("#cat-general"); click("button[data-appearance=\"system\"]"); } catch (_) { /* reported by the steps already */ }
    await c("errors", async () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
      let logged = [];
      try {
        const r = await d.within(d.Host.appdataReadKey("errlog"), 10000, "errlog");
        const list = r && typeof r.text === "string" ? JSON.parse(r.text) : null;
        logged = list && Array.isArray(list.entries) ? list.entries.map((e) => e.kind + ": " + e.msg) : [];
      } catch (err) { logged = ["errlog unreadable: " + d.errText(err)]; }
      if (errors.length || logged.length) throw Object.assign(new Error("uncaught errors: " + errors.concat(logged).slice(0, 10).join(" | ")), { out: { seen: errors, logged } });
      return { seen: 0, logged: 0 };
    });
  },
};

/**
 * The scenarios whose writes the next launch reads. A WebView commits
 * storage to disk on a timer of its own and the driver ends the process once
 * "done" is reported, so these wait first — selftest-run.js MARKER_SETTLE_MS,
 * for the same reason.
 */
const WRITES = new Set(["rep-seed", "rep-index", "sync", "prefetch-seed"]);
const SETTLE_MS = 6000;

/** The scenario names, in the order the driver runs them. */
export const SCENARIO_NAMES = Object.keys(SCENARIOS);

/**
 * @param {string} name
 * @param {object} d selftest-run.js's bag plus within / errText / nonce
 */
export async function runScenario(name, d) {
  const t0 = performance.now();
  const rep = { ok: false, scenario: name, stage: "start", version: typeof __CHESS_VERSION__ === "string" ? __CHESS_VERSION__ : "?", checks: {} };
  const report = (stage) => {
    rep.stage = stage;
    const failed = Object.keys(rep.checks).filter((k) => !rep.checks[k].pass);
    rep.ok = stage === "done" && failed.length === 0 && Object.keys(rep.checks).length > 0;
    rep.err = failed.length ? failed.map((k) => k + ": " + rep.checks[k].err).join("; ") : undefined;
    rep.ms = Math.round(performance.now() - t0);
    return d.Host.selftestReport(rep);
  };
  const check = async (key, fn) => {
    try { rep.checks[key] = Object.assign({ pass: true }, await fn()); }
    catch (err) { rep.checks[key] = Object.assign({ pass: false, err: d.errText(err) }, err && err.out); }
  };
  const run = Object.prototype.hasOwnProperty.call(SCENARIOS, name) ? SCENARIOS[name] : null;
  if (!run) rep.checks.scenario = { pass: false, err: "no scenario " + JSON.stringify(name) + " (" + SCENARIO_NAMES.join(", ") + ")" };
  else {
    await report("running");
    try { await run(d, check, report); } catch (err) { rep.checks.scenario = { pass: false, err: d.errText(err) }; }
    if (WRITES.has(name)) await sleep(SETTLE_MS);
  }
  await report("done");
}
