/**
 * 关于：版本、许可、数据位置，和检查更新。
 *
 * 13.0 E: moved out of app.js (its line ceiling), not rewritten — the
 * bodies are the ones app.js had. Everything arrives in the bag.
 * @module about-ui
 */

/**
 * Wire the about dialog once.
 * @param {object} d everything this module borrows from app.js
 * @returns {HTMLElement|null} the dialog (app.js registers it with Dlg's Escape)
 */
export function wireAbout(d) {
  const { doc, t, tf, Dlg, Host, APP_VERSION, copyText, dialogOpen } = d;
  const document = doc;
  const aboutModal = document.getElementById("about-modal");
  /**
   * A link the shell will not follow: app.zon denies external navigation on
   * purpose (a chess app has no business opening the browser on its own), so
   * the URL goes to the clipboard and the toast says so.
   */
  function offerLink(url) { copyText(url, t("msg.link.copied")); }
  async function openAbout() {
    if (!aboutModal) return;
    document.getElementById("about-version").textContent = APP_VERSION || "—";
    document.getElementById("about-license").textContent = t("about.licenseText");
    document.getElementById("about-credits").textContent = t("about.creditsText");
    document.getElementById("about-update").textContent = "";
    const dataEl = document.getElementById("about-data");
    dataEl.textContent = t("about.dataUnknown");
    Dlg.open(aboutModal, document.getElementById("about-close"));
    try {
      const p = await Host.appdataPath();
      if (p) dataEl.textContent = p;
    } catch (_) { /* the default line already says there is no file */ }
  }
  /** "v6.0.0" vs "6.0.1": numeric, segment by segment. */
  function newerVersion(tag, mine) {
    const num = (v) => String(v || "").replace(/^v/, "").split(".").map((x) => parseInt(x, 10) || 0);
    const a = num(tag), b = num(mine);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
    }
    return false;
  }
  async function checkUpdate() {
    const out = document.getElementById("about-update");
    if (!out) return;
    out.textContent = "…";
    let r = null;
    try { r = await Host.checkUpdate(); } catch (_) { r = null; }
    if (!r || r.error || !r.tag) { out.textContent = t(r && r.error === "busy" ? "msg.update.busy" : "msg.update.failed"); return; }
    if (newerVersion(r.tag, APP_VERSION)) {
      out.textContent = tf("msg.update.available", [r.tag]);
      offerLink(r.url || "https://github.com/hxddh/chessboard/releases/latest");
    } else out.textContent = t("msg.update.latest");
  }
  if (aboutModal) {
    document.getElementById("about-open").onclick = () => { if (!dialogOpen()) openAbout(); };
    document.getElementById("about-close").onclick = () => Dlg.close(aboutModal);
    document.getElementById("about-check").onclick = () => { checkUpdate(); };
    document.getElementById("about-source").onclick = (ev) => offerLink(ev.currentTarget.dataset.url);
    aboutModal.onclick = (ev) => { if (ev.target === aboutModal) Dlg.close(aboutModal); };
  }
  return aboutModal;
}
