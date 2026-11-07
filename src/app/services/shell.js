/**
 * The app inside the shell (20.0 E3, v20-0-plan §10): the menu bar and the
 * files the OS hands over. Loaded by main.js only in the shell, after the
 * first page: a browser's first paint never carries it.
 *
 *   the menu     a menu command arrives as the "shortcut" window event
 *                (main.zig); `run` does it on the page that has it — each page
 *                registers what it answers in `commands` while it is mounted —
 *                or opens the page first (新对局 → 下, 导入 PGN → 我), and the
 *                places (学 下 我 设置) are a navigation. ⌘Z in a text field is
 *                the field's undo, not 悔棋. The bar follows the language:
 *                chess.setMenuLanguage at start and on every change.
 *   open files   a .pgn double-clicked, dropped on the window or the Dock
 *                icon, or passed by a second launch: the shell queues it and
 *                says "open:files"; here each waiting file is read
 *                (chess.openedFile, services/files.js) and imported on 我 ·
 *                棋谱库 like one picked there (`file.open`). Files that came
 *                before the page did are read at start.
 *
 *   startShell({ store, router, commands, zero })   → { run, drain }
 * @module services/shell
 */
import { effect } from "../lib/signal.js";
import { nextOpenedFile, FileError } from "./files.js";

/** Menu commands that are a place. */
const PLACES = { "go.learn": "/learn", "go.play": "/play", "go.me": "/me", "go.settings": "/settings" };
/** Commands answered on one page: that page is opened first when another is on screen. */
const HOME = { "game.new": "/play", "file.import": "/me", "file.open": "/me" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Is the keyboard in a text field (⌘Z is then its undo)? */
function typing(doc = globalThis.document) {
  const el = doc && doc.activeElement;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === "TEXTAREA") return true;
  return el.tagName === "INPUT" && /^(text|search|url|email|password|number|tel)$/i.test(el.type || "text");
}

/**
 * @param {object} o
 * @param {object} o.store
 * @param {object} o.router
 * @param {{ get(name: string): Function | undefined }} o.commands  what the mounted pages answer
 * @param {object} [o.zero]   the shell's bridge (window.zero)
 */
export function startShell({ store, router, commands, zero = globalThis.zero }) {
  const invoke = (cmd, payload) => zero.invoke(cmd, payload);
  const on = typeof zero.on === "function" ? (name, fn) => zero.on(name, fn) : () => {};

  async function handler(name) {
    for (let i = 0; i < 200; i++) {
      const fn = commands.get(name);
      if (fn) return fn;
      await sleep(50);
    }
    return null;
  }

  /** Do one menu command. Resolves when it has been handed to its page. */
  async function run(name, arg) {
    if (name === "view.escape") {
      // the declared Escape (app.zon .shortcuts): the page's own Escape handlers
      const target = document.activeElement || document.body;
      target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
      return;
    }
    if (name === "game.undo" && typing()) { document.execCommand("undo"); return; }
    if (PLACES[name]) { await router.go(PLACES[name]); return; }
    const home = HOME[name];
    // 我 shows the list (not one game) for an import; 下 is where a new game starts
    const r = router.route.peek();
    if (home && (r.path !== home || r.rest.length)) await router.go(home);
    const fn = home ? await handler(name) : commands.get(name);
    if (fn) await fn(arg);
  }

  // --- files the OS hands over ------------------------------------------------------------
  let draining = null, again = false;
  async function drainOnce() {
    for (;;) {
      let file;
      try {
        file = await nextOpenedFile(invoke);
      } catch (e) {
        // a file that could not be read is said on 我; a shell that does not answer is not a file
        if (!(e instanceof FileError)) return;
        file = { name: e.file, error: e.code };
      }
      if (!file) return;
      await run("file.open", file);
    }
  }
  /** Read and import every waiting file (one drain at a time; a call meanwhile runs another after it). */
  function drain() {
    if (draining) { again = true; return draining; }
    draining = (async () => {
      do { again = false; await drainOnce(); } while (again);
    })().catch((e) => console.warn("open files:", e && e.message)).finally(() => { draining = null; });
    return draining;
  }

  on("shortcut", (d) => {
    const name = d && (d.command || d.id);
    if (typeof name === "string" && name) run(name).catch((e) => console.warn("menu " + name + ":", e && e.message));
  });
  on("open:files", () => { drain(); });
  drain();

  // --- the menu bar's language --------------------------------------------------------------
  const lang = store.select((s) => s.settings.lang);
  let said = null;
  effect(() => {
    const l = lang.value;
    if (l === said) return;
    said = l;
    Promise.resolve().then(() => invoke("chess.setMenuLanguage", { lang: l })).catch(() => {});
  });

  return { run, drain };
}
