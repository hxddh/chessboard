/**
 * Start-up: the store, the db, the engine, the router — and nothing else.
 *
 * URL switches for development and tests:
 *   (default)        opponents' moves from Maia-3 (a worker), analysis from Stockfish
 *   ?engine=fake     the fake engine alone (&delay=ms: how long it "thinks"); maia3-fake: Maia-3
 *                    for the opponents, the fake engine for analysis; stockfish: Stockfish alone
 *   ?db=memory       nothing persists;  ?dbname=x   a separate IndexedDB
 *   ?lang=en         start in a language (the e2e); otherwise the one chosen, else the system's
 *   ?autoreview=0    no background review of imported games; &autoreviewDelay=ms before it starts (4000)
 * @module main
 */
import { createRouter } from "./lib/router.js";
import { effect, signal } from "./lib/signal.js";
import { createStore } from "./state/store.js";
import { playActions, initialPlay } from "./state/play.js";
import { settingsActions, SETTINGS_DEFAULT, shellFor, coachOn } from "./state/settings.js";
import { DEFAULT_OPPONENT } from "./core/opponents.js";
import { persist, restore } from "./state/persist.js";
import { createDb, newId } from "./services/db.js";
import { analystBackend, openDbBackend, startSelftest } from "./services/native.js";
import { createEngineService, fakeBackend, stockfishBackend } from "./services/engine.js";
import { maia3Backend } from "./services/maia3/backend.js";
import { LANGS, LANG_TAGS, systemLang, setLang, getLang, loadWords } from "./text/lang.js";
import { playText } from "./text/play.js";

const params = new URLSearchParams(location.search);
// the language until the saved settings are read: the one last shown on this
// device (a hint only — the settings event is the record), else the system's
const HINT = "app.lang";
const hint = () => { try { return localStorage.getItem(HINT); } catch { return null; } };
const bootLang = [params.get("lang"), hint()].find((l) => LANGS.includes(l)) || systemLang();
const store = createStore({ play: initialPlay, settings: { ...SETTINGS_DEFAULT, lang: bootLang } }, { ...playActions, ...settingsActions });
const engineName = params.get("engine") || "";
const analyst = engineName.endsWith("fake") ? fakeBackend({ delayMs: Number(params.get("delay") ?? 30) }) : analystBackend(() => stockfishBackend());
const engine = createEngineService(engineName === "fake" || engineName === "stockfish" ? analyst : maia3Backend({ analyst }));

// the db opens while the first page paints; pages that need it wait on `ready`
// (in the app: the native SQLite store when the shell has it, services/native.js)
const ready = openDbBackend(params).then((backend) => createDb(backend))
  .then(async (db) => {
    persist(store, db);
    // a first run: a game against the default opponent, White, no clock
    await restore(store, db, newId, (s) => ({ mode: "engine", engineColor: "b", opponent: DEFAULT_OPPONENT, coach: coachOn(s) }));
    addEventListener("pagehide", () => db.flush());
    return db;
  });

const darkQuery = matchMedia("(prefers-color-scheme: dark)");
const prefersDark = signal(darkQuery.matches);
darkQuery.addEventListener("change", () => { prefersDark.value = darkQuery.matches; });
const look = store.select((s) => s.settings);
effect(() => {
  const s = look.value;
  document.documentElement.dataset.theme = shellFor(s.appearance, s.boardTheme, prefersDark.value);
});

// imported games reviewed in the background (library/autoreview.js), loaded
// after the first page and never while 下 or 学 has the engine
const background = { wake() {}, version: signal(0), bg: null };
const ENGINE_PAGES = new Set(["/play", "/learn"]);

// the menu bar's commands (services/shell.js): what the page on screen answers,
// registered while it is mounted — handle(name, fn) → its own removal
const handlers = new Map();
const commands = {
  handle(name, fn) { handlers.set(name, fn); return () => { if (handlers.get(name) === fn) handlers.delete(name); }; },
  get: (name) => handlers.get(name),
};

const router = createRouter({
  failText: (msg) => playText()("app.loadFailed", msg),
  routes: {
    // 学 shows the content: its words in the language come first (nothing to fetch in Chinese)
    "/learn": () => Promise.all([import("./pages/learn.js"), loadWords()]).then(([m]) => m),
    "/play": () => import("./pages/play.js"),
    "/me": () => import("./pages/me.js"),
    "/settings": () => import("./pages/settings.js"),
  },
  outlet: document.getElementById("outlet"),
  fallback: "/play",
  context: { store, engine, ready, background, commands },
});

const links = [...document.querySelectorAll("[data-nav]")];
effect(() => {
  const path = router.route.value.path;
  for (const a of links) a.toggleAttribute("aria-current", a.getAttribute("href") === "#" + path);
});

// the language: its words fetched before the first page mounts (only when it is
// not Chinese), and on a change the shell relabelled and the page mounted again
function chrome() {
  const t = playText();
  document.documentElement.lang = LANG_TAGS[getLang()];
  document.title = t("app.title");
  document.querySelector(".nav").setAttribute("aria-label", t("nav.aria"));
  for (const a of links) a.textContent = t("nav." + a.getAttribute("href").slice(2));
}
const langOf = store.select((s) => s.settings.lang);
let started = false, firstPage;
const pageShown = new Promise((r) => { firstPage = r; });
effect(() => {
  const want = langOf.value;
  // the first page waits for the interface only; a change brings the content's words as well
  setLang(want, { words: started }).catch(() => setLang("zh")).then(() => {
    if (want !== langOf.peek()) return;   // a later choice is on its way
    try { localStorage.setItem(HINT, getLang()); } catch { /* a hint only */ }
    chrome();
    if (!started) { started = true; router.start().then(firstPage, firstPage); } else router.remount();
  });
});
if (params.get("autoreview") !== "0") {
  ready.then((db) => new Promise((r) => setTimeout(r, Number(params.get("autoreviewDelay") ?? 4000))).then(() => import("./library/autoreview.js")).then((m) => {
    background.bg = m.startAutoReview({ engine, db, budget: Number(params.get("review")) || undefined,
      busy: () => ENGINE_PAGES.has(router.route.peek().path),
      onDone: () => { background.version.value++; } });
    background.wake = () => background.bg.wake();
  })).catch((e) => console.warn("autoreview:", e && e.message));
}

// in the shell: the menu bar and the files the OS hands over (services/shell.js),
// after the first page — a browser never loads it
const inShell = typeof globalThis.zero === "object" && globalThis.zero !== null && typeof globalThis.zero.invoke === "function";
const shell = inShell ? pageShown.then(() => import("./services/shell.js")).then((m) => m.startShell({ store, router, commands }))
  .catch((e) => { console.warn("shell:", e && e.message); return null; }) : Promise.resolve(null);

// for the e2e and the console: the app's parts, not its state
window.__app = { store, engine, router, ready, background, commands, shell };
// in the packaged app with CHESS_SELFTEST=1 only (selftest.js)
startSelftest({ store, engine, router, ready, analyst });
