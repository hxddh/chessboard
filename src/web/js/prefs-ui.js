/**
 * 偏好设置窗口：外观、语言、声音与数据。
 *
 * v8-0-plan A1: the settings page keeps what belongs to a game — the
 * opponent, the side, the clock, the board's orientation, the engine — and
 * what belongs to the app moves here: how it looks, what language it speaks,
 * how it sounds, and the data it keeps. Opened by ⌘, on macOS and Ctrl+,
 * elsewhere (shell.js), and from the rail's last entry (design review #10).
 *
 * The rows are the settings page's own markup, moved into the window in
 * index.html with their ids, so their handlers (settings-ui.js) came along
 * untouched.
 * @module prefs-ui
 */
import { ChessDialog } from "./dialog.js";

/**
 * @param {object} d everything this module borrows from app.js
 */
export function createPrefsUI(d) {
  const { doc } = d;
  const Dlg = ChessDialog;
  const modal = doc.getElementById("prefs-modal");

  /**
   * The appearance half of the window, behind one call.
   *
   * Today it is the theme, the follow-the-system switch, the text size, the
   * piece set and the coordinates — the settings page's rows as they were,
   * which index.html already places in #prefs-look (#look-rows). M2-look's
   * appearance module (appearance × board, v8-0-plan A3) replaces the body
   * of this function with its own mount(host, deps) and the markup with
   * nothing; no other line here changes.
   */
  function mountAppearance(host) {
    const rows = doc.getElementById("look-rows");
    if (host && rows && rows.parentNode !== host) host.appendChild(rows);
  }

  function open() {
    if (!modal || modal.classList.contains("show")) return;
    Dlg.open(modal);
  }
  function close() {
    if (modal) Dlg.close(modal);
  }

  function wire() {
    mountAppearance(doc.getElementById("prefs-look"));
    if (!modal) return;
    const x = doc.getElementById("prefs-close");
    if (x) x.onclick = close;
    modal.addEventListener("click", (ev) => { if (ev.target === modal) close(); });
  }

  return { open, close, wire, mountAppearance };
}
