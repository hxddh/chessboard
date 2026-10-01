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
 *   rep-seed     a two-line book in the header (chess.v1.repertoire), the
 *                way 8.0–8.1 kept it, written through persist.js (R17)
 *   rep-index    the next launch's own boot moves it into chessboard.replines
 *                and makes records with cards in chessboard.repertoire
 *                (rep-page.js, v8-2-plan T4); the page waits for both and
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
 *                the library's 我的开局书 (B1–B5's command path)
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

/** The longest gap between animation frames from now until stop(). */
function frameGaps() {
  let last = performance.now(), max = 0, n = 0, on = true;
  const tick = (t) => { if (!on) return; max = Math.max(max, t - last); last = t; n++; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  return () => { on = false; return { maxMs: Math.round(max), frames: n }; };
}

/** What chessboard.repertoire and chessboard.replines hold now. */
async function repState(now) {
  const db = await openRepDb(globalThis.indexedDB);
  if (!db) throw new Error("openRepDb answered null: no IndexedDB, or a database refused");
  const records = await db.all(), lines = await db.lines(), cards = await db.cards();
  return {
    records: records.map((r) => r.id).sort(),
    lines: lines.map((r) => r.k).sort(),
    cards: cards.length,
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
      if (!say || say.key !== "sync.none") throw new Error("nothing new read as " + JSON.stringify(say));
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
      // the header says the games and the summary are in IndexedDB (library-sum.js bootPrefetch's test)
      const h = await until(() => { const raw = localStorage.getItem(HEADER_KEY); return raw && /"db":2[,}]/.test(raw) && /"sum":"/.test(raw) ? JSON.parse(raw) : null; }, 30000, 250);
      if (!h) throw new Error("the library's header never said db 2 with a summary");
      await d.Persist.flushMirror();
      // the summary's own write, then a margin for the WebView to commit it
      await sleep(3000);
      return { n: Number(h.n) || 0 };
    });
  },
  async "prefetch-read"(d, c) {
    await c("prefetch", async () => {
      const pre = d.atBoot.pre;
      if (!pre) throw new Error("chunk-boot.js did not ask for the summary (no header with db 2 and a summary)");
      const got = await d.within(pre, 15000, "the prefetch's answer");
      if (!got || got.n < 0) throw new Error("the prefetch answered without a summary");
      return { n: got.n, ms: Math.round(got.ms) };
    });
  },
  async menus(d, c, report) {
    const shown = (sel) => !!document.querySelector(sel);
    const escape = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    // whatever a launch opened (the first-run guide) is closed first: a
    // native command waits while any dialog is up (native-commands.js run)
    await c("clear", async () => {
      for (let i = 0; i < 10 && shown(".modal-bg.show"); i++) {
        const later = document.querySelector(".modal-bg.show #pick-cancel");
        if (later) later.click(); else escape();
        await sleep(300);
      }
      if (shown(".modal-bg.show")) throw new Error("a dialog would not close");
      return {};
    });
    const got = [];
    d.Host.onAppLifecycle({ shortcut: (detail) => {
      try { const x = typeof detail === "string" ? JSON.parse(detail) : detail; got.push(x && (x.command || x.id)); } catch (_) { got.push(null); }
    } });
    await report("armed");
    await c("game.new", async () => {
      if (!await until(() => got.includes("game.new"), 30000, 100)) throw new Error("no shortcut event for game.new; saw " + JSON.stringify(got));
      if (!await until(() => shown("#newgame-modal.show"), 5000, 100)) throw new Error("新对局 did not open");
      escape();
      if (!await until(() => !shown(".modal-bg.show"), 5000, 100)) throw new Error("新对局 would not close");
      return {};
    });
    await report("next");
    await c("view.repertoire", async () => {
      if (!await until(() => got.includes("view.repertoire"), 30000, 100)) throw new Error("no shortcut event for view.repertoire; saw " + JSON.stringify(got));
      const ok = await until(() => {
        const s = JSON.parse(d.Persist.get("settings") || "{}");
        const sec = document.getElementById("sec-rep");
        return s.view === "library" && sec && sec.offsetParent !== null;
      }, 5000, 100);
      if (!ok) throw new Error("the library's 我的开局书 is not what is shown");
      return {};
    });
  },
};

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
  }
  await report("done");
}
