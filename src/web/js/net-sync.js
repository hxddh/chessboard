/**
 * 允许联网同步 —— the switch, and the button that loads the dialog behind it
 * (v8-0-plan C2).
 *
 * The only part of the sync in the first-paint bundle: the preferences
 * window's switch has to show the stored state the moment the window opens,
 * and 从网站同步 on the library page has to answer a click. The dialog, the
 * rules for reading what is stored, its wording and the claim are
 * chunk-sync.js (sync-ui.js), loaded on that first click.
 *
 * The state is its own profile key ("sync", persist.js) rather than a field in
 * settings: saveSettings() writes the settings object whole from app.js's own
 * fields, and the user name typed here is personal data that 清除全部存档 has
 * to take with it — which a key in KEYS gets for free.
 * @module net-sync
 */
import { loadChunk } from "./chunk.js";
import { ChessDialog } from "./dialog.js";
import { ChessHost } from "./host.js";

/**
 * @param {object} d doc, t, tf, toast, Persist, store, and lib (library-ui.js)
 */
export function createNetSync(d) {
  const { doc, Persist } = d;
  let ui = null;
  const stored = () => Persist.read("sync").value || {};
  // off unless it is really `true`: a damaged value never turns it on
  const isOn = () => stored().on === true;
  const save = (patch) => Persist.setJson("sync", Object.assign({}, stored(), patch, { v: 1 }));

  /** The preferences window's switch, from the stored state. */
  function paint() {
    const b = doc.getElementById("opt-netsync");
    if (b) b.setAttribute("aria-pressed", String(isOn()));
  }
  function setOn(on) { save({ on }); paint(); }

  function open() {
    loadChunk("chunk-sync.js", "createSyncUI").then((make) => {
      // the bundle's own dialog stack and bridge: a chunk importing them
      // would get second copies
      ui = ui || make(Object.assign({ Dlg: ChessDialog, Host: ChessHost, stored, save, setOn }, d));
      ui.open();
    }, () => d.toast(d.tf("sync.failed", ["chunk"]), "fault"));
  }

  function wire() {
    paint();
    const b = doc.getElementById("opt-netsync");
    if (b) b.onclick = () => setOn(!isOn());
    const go = doc.getElementById("lib-sync");
    if (go) go.onclick = open;
  }

  return { wire, paint };
}
