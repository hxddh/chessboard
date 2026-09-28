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
import { ChessHost } from "./host.js";
import { loadChunk } from "./chunk.js";

/**
 * @param {object} d everything this module borrows from app.js
 */
export function createPrefsUI(d) {
  const { doc, t, getLook, setLook, pieceSvgs } = d;
  const Dlg = ChessDialog;
  const modal = doc.getElementById("prefs-modal");
  // the pickers once mounted: a handle, not app state (their state is store.ui)
  const mounted = { look: null };
  // v8-0-plan C2: 允许联网同步 is this window's switch, and 从网站同步 on the
  // library page the button behind it. All the bundle holds is the switch's
  // look and a loader: turning it, the dialog, the stored "sync" key's rules
  // and the claim are chunk-sync.js (sync-ui.js) — the first-paint budget
  // has no room for more. The key is persist.js's, off unless `on` is true.
  const net = d.netSync;
  let sync = null;
  function paintSync() {
    const b = doc.getElementById("opt-netsync");
    if (b && net) b.setAttribute("aria-pressed", String((net.Persist.read("sync").value || {}).on === true));
  }
  // the bundle's own dialog stack and bridge go with it: a chunk importing
  // them would get second copies
  const withSync = (fn) => loadChunk("chunk-sync.js", "createSyncUI").then((make) => {
    sync = sync || make(Object.assign({ doc, t, Dlg, Host: ChessHost, paint: paintSync }, net));
    fn(sync);
  }, () => {});

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
    paintSync();
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
    paintSync();
    const sw = doc.getElementById("opt-netsync"), go = doc.getElementById("lib-sync");
    if (net && sw) sw.onclick = () => withSync((s) => s.toggle());
    if (net && go) go.onclick = () => withSync((s) => s.open());
    if (!modal) return;
    const x = doc.getElementById("prefs-close");
    if (x) x.onclick = close;
    modal.addEventListener("click", (ev) => { if (ev.target === modal) close(); });
  }

  return { open, close, wire, mountAppearance, syncLook };
}
