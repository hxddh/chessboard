/**
 * Start-up: the store, the db, the engine, the router — and nothing else.
 *
 * URL switches for development and tests:
 *   ?engine=fake     the fake engine instead of Stockfish (&delay=ms: how long it "thinks")
 *   ?engine=maia3    opponents' moves from Maia-3 (a worker), analysis from Stockfish;
 *                    maia3-fake: the same with the fake engine doing the analysis
 *   ?db=memory       nothing persists;  ?dbname=x   a separate IndexedDB
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

const params = new URLSearchParams(location.search);
const store = createStore({ play: initialPlay, settings: SETTINGS_DEFAULT }, { ...playActions, ...settingsActions });
const engineName = params.get("engine") || "";
const analyst = engineName.endsWith("fake") ? fakeBackend({ delayMs: Number(params.get("delay") ?? 30) }) : analystBackend(() => stockfishBackend());
const engine = createEngineService(engineName.startsWith("maia3") ? maia3Backend({ analyst }) : analyst);

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

const router = createRouter({
  routes: {
    "/learn": () => import("./pages/learn.js"),
    "/play": () => import("./pages/play.js"),
    "/me": () => import("./pages/me.js"),
    "/settings": () => import("./pages/settings.js"),
  },
  outlet: document.getElementById("outlet"),
  fallback: "/play",
  context: { store, engine, ready },
});

const links = [...document.querySelectorAll("[data-nav]")];
effect(() => {
  const path = router.route.value.path;
  for (const a of links) a.toggleAttribute("aria-current", a.getAttribute("href") === "#" + path);
});

router.start();
// for the e2e and the console: the app's parts, not its state
window.__app = { store, engine, router, ready };
// in the packaged app with CHESS_SELFTEST=1 only (selftest.js)
startSelftest({ store, engine, router, ready, analyst });
