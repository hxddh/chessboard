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
 * untouched. The look pickers are A3's module (appearance-ui.js), mounted
 * here and nowhere else.
 * @module prefs-ui
 */
import { ChessDialog } from "./dialog.js";
import { mount as mountLook } from "./appearance-ui.js";

/**
 * @param {object} d everything this module borrows from app.js
 */
export function createPrefsUI(d) {
  const { doc, t, getLook, setLook, pieceSvgs } = d;
  const Dlg = ChessDialog;
  const modal = doc.getElementById("prefs-modal");
  // the pickers once mounted: a handle, not app state (their state is store.ui)
  const mounted = { look: null };

  /**
   * The appearance half of the window, behind one call: 外观 / 棋盘 / 边框 /
   * 棋子 (v8-0-plan A3, appearance-ui.js) built into `host`. The text size
   * and coordinate rows after it are index.html's own markup.
   */
  function mountAppearance(host) {
    if (host && !mounted.look) mounted.look = mountLook(host, { t, getLook, setLook, pieceSvgs });
  }
  /** Mark the current look in the pickers (settings-ui.js paintSettings). */
  function syncLook() {
    if (mounted.look) mounted.look.sync();
  }

  function open() {
    if (!modal || modal.classList.contains("show")) return;
    Dlg.open(modal);
    // the board previews were drawn while the window was hidden, at their
    // fallback size; now that the row has a box, draw them at it
    if (mounted.look) requestAnimationFrame(() => mounted.look.repaint());
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

  return { open, close, wire, mountAppearance, syncLook };
}
