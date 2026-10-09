/**
 * 设置页：外观的选择器、联网同步的开关，以及切到某一类时要做的事。
 *
 * 9.0 S5: the preferences window and the panel's 设置 tab are one page now
 * (index.html #page-settings, shown by shell.js like 首页 and 我的). The rows
 * are index.html's own markup with their ids, wired by settings-ui.js where
 * they stand; this module owns the two things that are built or loaded: the
 * look pickers (v8-0-plan A3, appearance-ui.js) and the sync switch's chunk.
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
  // the pickers once mounted: a handle, not app state (their state is store.ui)
  const mounted = { look: null };
  // v8-0-plan C2: 允许联网同步 is the settings page's switch, and 从网站同步 on the
  // library page the button behind it. All the bundle holds is the switch's
  // look and a loader: turning it, the dialog, the stored "sync" key's rules
  // and the claim are chunk-sync.js (sync-ui.js) — the first-paint budget
  // has no room for more. The key is persist.js's, off unless `on` is true.
  const net = d.netSync;
  const loaded = { sync: null };
  function paintSync() {
    const b = doc.getElementById("opt-netsync");
    if (b && net) b.setAttribute("aria-pressed", String((net.Persist.read("sync").value || {}).on === true));
  }
  // the bundle's own dialog stack and bridge go with it: a chunk importing
  // them would get second copies
  const withSync = (fn) => loadChunk("chunk-sync.js", "createSyncUI").then((make) => {
    loaded.sync = loaded.sync || make(Object.assign({ doc, t, Dlg, Host: ChessHost, paint: paintSync }, net));
    fn(loaded.sync);
  }, () => {});

  /**
   * The look pickers, behind one call: 棋盘 / 边框 / 棋子 built into `host`
   * (v8-0-plan A3, appearance-ui.js). Light or dark is 通用's, not the
   * board's, so its row moves there once built.
   */
  function mountAppearance(host) {
    if (!host || mounted.look) return;
    mounted.look = mountLook(host, { t, getLook, setLook, pieceSvgs });
    const row = doc.getElementById("row-appearance"), app = doc.getElementById("set-look-app");
    if (row && app) app.appendChild(row);
  }
  /** Mark the current look in the pickers (settings-ui.js paintSettings). */
  function syncLook() {
    if (mounted.look) mounted.look.sync();
  }

  /**
   * A category came into view (shell.js showCat). The board previews were
   * drawn while their pane was hidden, at their fallback size; now that the
   * row has a box, draw them at it. 数据 shows the sync switch as stored.
   */
  function onCat(cat) {
    if (cat === "board" && mounted.look) requestAnimationFrame(() => mounted.look.repaint());
    if (cat === "data") paintSync();
  }

  function wire() {
    mountAppearance(doc.getElementById("prefs-look"));
    paintSync();
    const sw = doc.getElementById("opt-netsync"), go = doc.getElementById("lib-sync");
    if (net && sw) sw.onclick = () => withSync((s) => s.toggle());
    if (net && go) go.onclick = () => withSync((s) => s.open());
  }

  return { onCat, wire, mountAppearance, syncLook };
}
