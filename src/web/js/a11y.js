/**
 * The keyboard, and what the board says out loud.
 *
 * Carved out of app.js (v6-plan Q1.7), on report.js's pattern: everything
 * this module reads of the app arrives in the bag handed to `createA11y()`,
 * and nothing here reaches back into app.js.
 *
 * Two handlers and one live region, and the reason they belong in one file is
 * that they are one contract seen from two sides. `#board-live` is the only
 * place this app speaks to a screen reader, and what it says is written by
 * the cursor keys; the cursor keys exist only because the canvas is a real
 * focusable control rather than a picture. Separate them and the
 * announcement stops following the thing it announces.
 *
 * `escapeKey()` deliberately stays in app.js. It is a list of everything on
 * screen that can be dismissed, in the order it is dismissed in — a statement
 * about the app, not about the keyboard. Both handlers here call it through
 * the bag, and so does the native `view.escape` shortcut: one routine, three
 * doors.
 * @module a11y
 */
import { ChessEditor } from "./editor.js";

/**
 * @param {object} d what this module reads of the app: `doc`, `t`, `store`,
 *   `draw()`, the game readers (`viewGame`, `sanHistory`, `statusText`),
 *   `onSquareClick`, the dialog predicates (`dialogOpen`, `promoOpen`,
 *   `confirmOpen`, `keyHelpOpen`) and the action each key stands for.
 */
export function createA11y(d) {
  const { t, store, draw, doc } = d;

  const FILE_CHARS = "abcdefgh";

  function announce(msg) {
    const el = doc.getElementById("board-live");
    if (el) el.textContent = msg;
  }

  /** describe a square for screen readers: "e4 · 白兵" / "e4 · 空格" */
  function describeSquare(sq) {
    const g = store.session.editor ? null : (store.session.mode === "learn" && store.session.learn ? store.session.learn.g : store.session.mode === "puzzle" && store.session.puzzle ? store.session.puzzle.g : d.viewGame());
    let piece = null;
    if (g) piece = g.get(sq);
    else if (store.session.editor) {
      const { r, c } = ChessEditor.indexOf(sq);
      piece = store.session.editor.board[r][c];
    }
    if (!piece) return sq + " · " + t("live.empty");
    return sq + " · " + t(piece.color === "w" ? "vs.white" : "vs.black") + t("piece." + piece.type);
  }

  function moveCursor(df, dr) {
    if (!store.ui.keyboardCursor) store.ui.keyboardCursor = store.game.flipped ? "e5" : "e4";
    let f = FILE_CHARS.indexOf(store.ui.keyboardCursor[0]);
    let r = Number(store.ui.keyboardCursor[1]);
    // arrows follow what the player sees, so they invert with the board
    const sign = store.game.flipped ? -1 : 1;
    f = Math.max(0, Math.min(7, f + df * sign));
    r = Math.max(1, Math.min(8, r + dr * sign));
    store.ui.keyboardCursor = FILE_CHARS[f] + r;
    announce(describeSquare(store.ui.keyboardCursor));
    draw();
  }

  /**
   * 7.7 §1c: the cursor follows `:focus-visible`, not `:focus`.
   *
   * Clicking a square focuses the canvas — that is what lets the keys work
   * straight after — and focus was the only thing the cursor asked about, so
   * a game played with the mouse carried a white double frame on e4 from the
   * first click to the last. The browser already knows which kind of focus
   * this is: a Tab lands with `:focus-visible`, a click without. The first
   * key on the board turns it on, as a key does for `:focus-visible`; the
   * next press of the pointer turns it off again.
   */
  function focusIsVisible(el) {
    try { return !!el && el.matches(":focus-visible"); } catch { return true; }
  }

  function onBoardFocus(ev) {
    store.ui.boardFocused = true;
    store.ui.cursorShown = focusIsVisible(ev && ev.target);
    if (!store.ui.keyboardCursor) store.ui.keyboardCursor = store.game.flipped ? "e5" : "e4";
    announce(t("live.focused") + " · " + describeSquare(store.ui.keyboardCursor));
    draw();
  }
  function onBoardBlur() { store.ui.boardFocused = false; draw(); }

  /** The board's own keys, live only while the canvas holds focus. */
  function onBoardKeyDown(ev) {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    // A dialog outranks the board. The promotion chooser is the case that
    // matters: it can only be opened by a move made on the board, so the board
    // always holds focus when it appears — and the board used to swallow the
    // Escape that was supposed to dismiss it, which meant Escape never once
    // worked on the one dialog every player meets. Same fault as the FEN field
    // in 1.10; that one got fixed and this one was missed.
    if (d.dialogOpen()) return;
    // arrows/Home/End also drive replay from the window handler — while the
    // board itself is focused they belong to the cursor, so stop them here.
    //
    // Escape is the exception, and it is the same fault as the dialog above,
    // one layer out: the board took every Escape and did something with it
    // only when a piece was selected. Everything else Escape is for — the
    // fault toast that does not leave on its own, the editor's exit, closing
    // the panel — lives on the window handler and could not be reached, and
    // the board is exactly where focus sits the moment you touch a piece.
    // Measured on 2.1.6: with the board focused, three Escapes in a row left
    // the toast up and the editor open. So it is ours only when there is
    // something here to cancel.
    const escIsOurs = ev.key !== "Escape" || !!store.game.selection;
    if (escIsOurs &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Enter", " ", "Escape"].includes(ev.key)) {
      ev.stopPropagation();
      // a key on the board is keyboard use: from here on the cursor is drawn
      if (ev.key !== "Escape") store.ui.cursorShown = true;
    }
    switch (ev.key) {
      case "ArrowLeft": ev.preventDefault(); moveCursor(-1, 0); return;
      case "ArrowRight": ev.preventDefault(); moveCursor(1, 0); return;
      case "ArrowUp": ev.preventDefault(); moveCursor(0, 1); return;
      case "ArrowDown": ev.preventDefault(); moveCursor(0, -1); return;
      case "Home": ev.preventDefault(); store.ui.keyboardCursor = store.game.flipped ? "h1" : "a8"; announce(describeSquare(store.ui.keyboardCursor)); draw(); return;
      case "End": ev.preventDefault(); store.ui.keyboardCursor = store.game.flipped ? "a8" : "h1"; announce(describeSquare(store.ui.keyboardCursor)); draw(); return;
      case "Enter":
      case " ": {
        ev.preventDefault();
        if (!store.ui.keyboardCursor) return;
        const before = store.game.selection ? store.game.selection.sq : null;
        d.onSquareClick(store.ui.keyboardCursor);
        if (store.game.selection && store.game.selection.sq === store.ui.keyboardCursor && before !== store.ui.keyboardCursor) {
          announce(t("live.selected") + " " + describeSquare(store.ui.keyboardCursor) + " · " + store.game.selection.targets.length + " " + t("live.targets"));
        } else if (!store.game.selection && before) {
          announce(d.statusText());
        }
        return;
      }
      case "Escape":
        if (store.game.selection) { ev.preventDefault(); d.escapeKey(); }
        return;
      default:
    }
  }

  /** Is this element one that turns keystrokes into text? */
  function isEditable(el) {
    if (!el || el === doc.body) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
  }

  /**
   * The window's keys: everything that is not the board cursor.
   *
   * Registered by app.js, which owns the window.
   */
  function onKeyDown(ev) {
    if (ev.key === "Escape") { d.escapeKey(); return; }
    if (d.promoOpen()) {
      const pk = ev.key.toLowerCase();
      if (["q", "r", "b", "n"].includes(pk)) { ev.preventDefault(); d.finishPromotion(pk); }
      return;
    }
    if (d.confirmOpen()) {
      if (ev.key === "Enter") { ev.preventDefault(); d.finishConfirm(true); }
      return;
    }
    // "?" comes before the dialog guard below, because it is the one shortcut
    // whose whole job is opening and closing a dialog — but only its own: with
    // anything else on screen it stays out of the way like everything else.
    if ((ev.key === "?" || (ev.key === "/" && ev.shiftKey)) && !ev.metaKey && !ev.ctrlKey) {
      const sheetUp = d.keyHelpOpen();
      if (sheetUp || !d.dialogOpen()) {
        ev.preventDefault();
        if (sheetUp) d.closeKeyHelp(); else d.openKeyHelp();
        return;
      }
    }
    // Everything below acts on the game. A dialog is in front of the game, so
    // none of it applies while one is open — see dialogOpen(). Escape is
    // handled above precisely because it is the one key that does apply.
    if (d.dialogOpen()) return;
    // a letter typed into any text field is text, not a shortcut — the FEN
    // box used to be the only field and guarded itself; the guard belongs
    // here so the next field cannot forget it (v6-plan D8)
    if (isEditable(ev.target)) return;
    const k = ev.key.toLowerCase();
    // Tab is not ours to take. Binding it to the panel meant focus could never
    // move anywhere by keyboard — the app had a full keyboard board cursor and
    // no way to reach any other control. The panel is on P instead.
    if (k === "p" && !ev.metaKey && !ev.ctrlKey && !ev.altKey) { ev.preventDefault(); d.togglePanel(); return; }
    if (store.session.mode === "learn" && !store.session.study) {
      // replay / game shortcuts act on the main game — inert during lessons;
      // R retries the task, Z/H work in engine drills
      if (!store.session.learn || ev.metaKey || ev.ctrlKey) return;
      if (k === "r") { d.startLearnTask(); d.toast(t("lm.restarted")); }
      else if (k === "z") d.learnUndo();
      else if (k === "h") d.learnHint();
      return;
    }
    if (store.session.mode === "puzzle") {
      if (!store.session.puzzle || ev.metaKey || ev.ctrlKey) return;
      if (k === "r") { d.startPuzzleAt(store.session.puzzle.cat, store.session.puzzle.idx); d.toast(t("pz.restarted")); }
      else if (k === "n") d.nextPuzzle();
      else if (k === "h") d.showPuzzleAnswer();
      return;
    }
    if (ev.key === "ArrowLeft") { ev.preventDefault(); d.setViewIndex(store.game.viewIndex - 1); }
    else if (ev.key === "ArrowRight") { ev.preventDefault(); d.setViewIndex(store.game.viewIndex + 1); }
    else if (ev.key === "Home") { ev.preventDefault(); d.setViewIndex(0); }
    else if (ev.key === "End") { ev.preventDefault(); d.setViewIndex(d.sanHistory().length); }
    else if (k === "z" && !ev.metaKey && !ev.ctrlKey) d.undo();
    else if (k === "n" && !ev.metaKey && !ev.ctrlKey) d.requestNewGame();
    else if (k === "h" && !ev.metaKey && !ev.ctrlKey) d.requestHint();
    else if (k === "f" && !ev.metaKey && !ev.ctrlKey) d.setFlipped(!store.game.flipped);
  }

  /**
   * Make the canvas a control: focusable, named, and wired to the three
   * handlers above. app.js owns the element; this owns what it does.
   */
  function attachBoard(canvas) {
    canvas.setAttribute("tabindex", "0");
    canvas.setAttribute("role", "application");
    canvas.setAttribute("data-i18n-aria", "aria.boardKeys");
    canvas.setAttribute("aria-label", t("aria.boardKeys"));
    canvas.addEventListener("focus", onBoardFocus);
    canvas.addEventListener("blur", onBoardBlur);
    canvas.addEventListener("keydown", onBoardKeyDown);
    // pointerdown comes before the focus it causes, so a click that focuses
    // the board and a click on a board that already has focus both land here
    canvas.addEventListener("pointerdown", () => {
      if (!store.ui.cursorShown) return;
      store.ui.cursorShown = false;
      draw();
    });
  }

  return { announce, describeSquare, moveCursor, isEditable,
           onBoardFocus, onBoardBlur, onBoardKeyDown, onKeyDown, attachBoard };
}
