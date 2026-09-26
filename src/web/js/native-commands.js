/**
 * The native menu commands, and the shortcut sheet that describes them.
 *
 * Carved out of app.js (v6-plan Q1.7), the same way report.js was: the tables
 * and the gate live here, and everything this module needs from the app —
 * the document, the store, the dialog port and the nine actions themselves —
 * arrives in the bag handed to `createNativeCommands()`. Nothing here reaches
 * back into app.js.
 *
 * Two of the three things in this file are plain data — `KEY_HELP` and
 * `MENU_ACCEL` — and they are exported as data rather than kept private,
 * because `scripts/test-chess.mjs` cross-checks both against app.zon. It used
 * to do that by regex over app.js's source; it reads the real objects now.
 * @module native-commands
 */

/**
 * The keyboard reference.
 *
 * Built from a table rather than written into the markup, because the same
 * table is what the native menu is checked against: a shortcut that exists
 * in one place and not the other is exactly the state 1.9 shipped in, when
 * the panel silently moved from Tab to P.
 */
/* Which shortcuts exist is a property of the mode you are in. The keydown
   handler has said so from the start — learn and puzzle return early, before
   the replay keys, N, and F are ever reached — but this list did not, and it
   is the only place the app tells you what the keyboard does. In 做题 it
   offered 「Z 悔棋」, 「F 翻转棋盘」 and 「← → 上一手 / 下一手」, none of
   which do anything there, and it named N 「新局」 when in that mode N is
   the next puzzle. Three keys do different jobs in different modes — N, H
   and R — so the row carries the mode it belongs to and the wording for that
   mode, and the sheet is rendered fresh each time it opens. */
const ANY = ["ai", "pvp", "learn", "puzzle"];
const PLAY = ["ai", "pvp"];
/* `cmd` is the app.zon menu command that does this row's job in this row's
   modes. It carries two things at once, and that is the point:

     — the sheet draws the accelerator next to the letter, so the eight
       shortcuts the menu bar has always offered stop being invisible to the
       one screen whose title is 「快捷键」;
     — and the native command is gated by it. Which door you came through
       must not change what the app does, and it did: measured on 2.2.2,
       ⌘N from inside 做题 put 「开始新局将清空当前对局」 over the puzzle
       and threw the game away on OK, while the letter N there is 下一题 and
       never touches it. ⌘F flipped a lesson board that F leaves alone, and
       flipped it through an open dialog, where every letter key stops.

   So the modes live in one table and both doors read it. A command with no
   row for the current mode does not run — the same answer its letter gives. */
export const KEY_HELP = [
  { keys: ["P"], k: "keys.panel", in: ANY, cmd: ["view.panel"] },
  { keys: ["N"], k: "keys.new", in: PLAY, cmd: ["game.new"] },
  { keys: ["N"], k: "keys.next", in: ["puzzle"] },
  { keys: ["R"], k: "keys.retry", in: ["learn", "puzzle"] },
  { keys: ["Z"], k: "keys.undo", in: ["ai", "pvp", "learn"], cmd: ["game.undo"] },
  { keys: ["H"], k: "keys.hint", in: PLAY, cmd: ["game.hint"] },
  { keys: ["H"], k: "keys.lessonHint", in: ["learn"], cmd: ["game.hint"] },
  { keys: ["H"], k: "keys.answer", in: ["puzzle"], cmd: ["game.hint"] },
  { keys: ["F"], k: "keys.flip", in: PLAY, cmd: ["game.flip"] },
  { keys: ["←", "→"], k: "keys.step", in: PLAY, cmd: ["view.prev", "view.next"] },
  { keys: ["Home", "End"], k: "keys.ends", in: PLAY },
  { keys: ["Enter", "↑", "↓", "←", "→", "Esc"], k: "keys.board", in: ANY },
  { keys: ["Q", "R", "B", "N"], k: "keys.promo", in: ANY },
  { keys: ["Tab"], k: "keys.tab", in: ANY },
  { keys: ["Esc"], k: "keys.esc", in: ANY, cmd: ["view.escape"] },
  { keys: ["?"], k: "keys.help", in: ANY, cmd: ["help.keys"] },
];

/**
 * The accelerators app.zon declares, spelled for a reader.
 *
 * A copy, because the page cannot read app.zon — so `scripts/test-chess.mjs`
 * holds the two to being the same list in both directions: an accelerator
 * here that the manifest does not declare, or a menu item there that never
 * reaches this table, fails the build. That check is the whole reason a
 * second copy is allowed to exist at all.
 *
 * ⌘ or Ctrl is not a preference: "primary" IS ⌘ on macOS and Ctrl on
 * Windows, and the app ships on both, so the sheet has to say which machine
 * it is on.
 */
/**
 * Detected here rather than asked of the caller, and guarded because this
 * module is loaded outside a browser by the tests.
 */
const NAV = typeof navigator === "undefined" ? {} : navigator;
const MAC = /mac|iphone|ipad/i.test((NAV.platform || "") + " " + (NAV.userAgent || ""));
const MODS = (mac) => (mac ? { primary: "⌘", shift: "⇧" } : { primary: "Ctrl+", shift: "Shift+" });
export const MENU_ACCEL = {
  "game.new": { key: "N", mods: ["primary"] },
  "game.undo": { key: "Z", mods: ["primary"] },
  "game.hint": { key: "H", mods: ["primary", "shift"] },
  "game.flip": { key: "F", mods: ["primary"] },
  "view.panel": { key: "\\", mods: ["primary"] },
  "view.prev": { key: "[", mods: ["primary"] },
  "view.next": { key: "]", mods: ["primary"] },
  "help.keys": { key: "/", mods: ["primary"] },
};
/**
 * One accelerator, spelled for a reader on `mac`-or-not.
 *
 * The platform is a parameter with a default rather than a closed-over
 * constant so the tests can ask for both spellings without pretending to be
 * a different machine.
 */
export const accelText = (id, mac = MAC) => {
  const a = MENU_ACCEL[id];
  if (!a) return "";
  const MOD = MODS(mac);
  return (a.mods.includes("primary") ? MOD.primary : "") +
         (a.mods.includes("shift") ? MOD.shift : "") + a.key;
};

/** Which modes a native command is the right answer in — read off KEY_HELP. */
export function commandModes(id) {
  const modes = new Set();
  for (const row of KEY_HELP) {
    if (row.cmd && row.cmd.includes(id)) for (const m of row.in) modes.add(m);
  }
  return modes;
}

/**
 * Wire the sheet and the menu to one app.
 *
 * @param {object} d everything this module reads of the app:
 *   `doc` (the document), `t` (i18n), `store`, `Dlg` (the dialog port),
 *   `dialogOpen()`, and the nine actions the menu can fire.
 */
export function createNativeCommands(d) {
  const { doc, t, store, Dlg, dialogOpen } = d;
  const keysModal = doc.getElementById("keys-modal");
  function renderKeyHelp() {
    const list = doc.getElementById("keys-list");
    if (!list) return;
    list.replaceChildren();
    const mode = store.session.mode;
    for (const row of KEY_HELP.filter((r) => r.in.includes(mode))) {
      const dt = doc.createElement("dt");
      for (const key of row.keys) {
        const kbd = doc.createElement("kbd");
        kbd.textContent = key;
        dt.appendChild(kbd);
      }
      // …and the menu's way of saying the same thing. Same action, same row:
      // the accelerator is not a different shortcut, it is the one the menu
      // bar has been offering since 1.10 to a sheet that never mentioned it.
      for (const id of row.cmd || []) {
        const text = accelText(id);
        if (!text) continue;
        const kbd = doc.createElement("kbd");
        kbd.className = "accel";
        kbd.textContent = text;
        dt.appendChild(kbd);
      }
      const dd = doc.createElement("dd");
      dd.textContent = t(row.k);
      list.appendChild(dt);
      list.appendChild(dd);
    }
  }
  function openKeyHelp() {
    if (!keysModal) return;
    renderKeyHelp();
    Dlg.open(keysModal, doc.getElementById("keys-close"));
  }
  function closeKeyHelp() { Dlg.close(keysModal); }
  if (keysModal) {
    doc.getElementById("keys-close").onclick = closeKeyHelp;
    keysModal.onclick = (ev) => { if (ev.target === keysModal) closeKeyHelp(); };
  }


  /** Is the sheet the thing on screen? The one dialog this module owns. */
  function keyHelpOpen() { return !!keysModal && keysModal.classList.contains("show"); }

  /**
   * Native menu commands (app.zon → main.zig → host.js).
   *
   * The menu is the desktop-shaped half of the same actions the letter keys
   * already do; both end up here so there is one implementation and the two
   * can never drift.
   *
   * That paragraph was true of the *actions* and false of everything around
   * them. The keydown handler gates on two things before it reaches any of
   * these — a dialog in front of the game, and the mode you are in — and this
   * map was called straight from the shortcut event, past both. Measured:
   *
   *   ⌘N  in 做题 / 教学   asked 「开始新局将清空当前对局」 over the trainer
   *                        and deleted the main game on OK. The letter N is
   *                        下一题 there and never touches it.
   *   ⌘F  in 做题 / 教学   flipped an authored board. F does nothing there.
   *   ⌘F  with the 快捷键 sheet open — flipped the board behind it. Every
   *                        letter key stops at `if (dialogOpen()) return`.
   *
   * A shortcut you reach from the menu bar being able to throw away a game
   * that the same shortcut on the keyboard refuses to touch is not a
   * difference between two doors; it is one door that is wrong.
   */
  const NATIVE_COMMANDS = {
    "game.new": () => d.requestNewGame(),
    "game.undo": () => d.undo(),
    "game.hint": () => d.requestHint(),
    "game.flip": () => d.setFlipped(!store.game.flipped),
    "view.panel": () => d.togglePanel(),
    "view.prev": () => d.setViewIndex(store.game.viewIndex - 1),
    "view.next": () => d.setViewIndex(store.game.viewIndex + 1),
    "view.escape": () => d.escapeKey(),
    "help.keys": () => openKeyHelp(),
  };
  /**
   * The gate the letter keys pass through, in front of the menu as well.
   *
   * `help.keys` is the one command that is *about* a dialog rather than
   * behind one, so it mirrors what "?" does: it closes the sheet when the
   * sheet is what is up, and stays out of the way of anything else.
   */
  function run(id) {
    if (!NATIVE_COMMANDS[id]) return;
    // Escape is the key that applies WITH a dialog open — it is how dialogs
    // close — so it passes neither gate below
    if (id === "view.escape") { d.escapeKey(); return; }
    if (id === "help.keys") {
      if (keyHelpOpen()) closeKeyHelp();
      else if (!dialogOpen()) openKeyHelp();
      return;
    }
    if (dialogOpen()) return;
    if (!commandModes(id).has(store.session.mode)) return;
    NATIVE_COMMANDS[id]();
  }
  // `keysModal` goes back out because app.js keeps the one block that says
  // how every dialog is dismissed (wireDialogs); this module owns the sheet's
  // behaviour, not the list of dialogs.
  return { accelText, renderKeyHelp, openKeyHelp, closeKeyHelp, keyHelpOpen, run, keysModal };
}
