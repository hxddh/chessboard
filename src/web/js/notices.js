/**
 * What the app tells you, by how much it matters (moved out of app.js, 15.0 E):
 *
 *   banners  what stays broken for the session — storage that will not keep
 *            anything, a record set aside as unreadable, an uncaught fault,
 *            an engine that did not start
 *   toasts   three tiers (and an achievement's own): a receipt, a correction,
 *            a fault that waits for its ✕ — placed by toast-place.js
 *   confirm  the in-page question, or the platform's own alert for the three
 *            answers that cannot be taken back
 *
 * Made before storage is read (app.js), so `store` and `appEl` are asked for
 * when a notice is shown, not when this is made.
 * @module notices
 */
import { placeToastAt } from "./toast-place.js";

/** How long each tier stays up, in ms; a fault stays until closed. ach: an unlocked badge, with its picture (v8-0-plan A5) */
export const TOAST_MS = { ok: 2200, fix: 4200, fault: 0, ach: 6500 };

/**
 * @param {object} d what this borrows from app.js
 */
export function createNotices(d) {
  const { doc, t, tf, Icons, Host, Dlg, store, appEl, saveGame, retryEngine } = d;

  /**
   * A storage failure is permanent for the session, so its notice is too.
   *
   * It keeps a banner of its own even now that toasts have a fault tier
   * (P2.6). The tier is right for "the engine did not start" — bad, dismissible,
   * over. This one is different in kind: every later autosave will fail too, so
   * the statement "nothing you do is being kept" stays true for the rest of the
   * session, and a notice the user has clicked away would be a lie by the time
   * they close the app. The toast fires as well, once, because a banner that
   * appears silently at the top of the screen is easy not to notice.
   */
  function showStorageFault() {
    let el = doc.getElementById("storage-fault");
    if (!el) {
      el = doc.createElement("div");
      el.id = "storage-fault";
      el.className = "storage-fault";
      el.setAttribute("role", "alert");
      doc.body.appendChild(el);
    }
    el.textContent = t("msg.storage.failed");
    el.hidden = false;
  }

  /**
   * 6.0: a value that could not be read is not a new install. The banner
   * says which record was set aside, and that the copy is kept (v6-plan D2).
   */
  function showCorruptFault(names) {
    // its own element: a write failure later in the session must not paint
    // over the one message that says where the old data went
    let el = doc.getElementById("profile-fault");
    if (!el) {
      el = doc.createElement("div");
      el.id = "profile-fault";
      el.className = "storage-fault";
      el.setAttribute("role", "alert");
      doc.body.appendChild(el);
    }
    el.textContent = tf("msg.storage.corrupt", [names.join(", ")]);
    el.hidden = false;
  }

  /**
   * 5.1: an uncaught exception used to be silence — the handler died, the
   * button did nothing, and nothing anywhere said so. Every such error now
   * lands here: the banner says the app hit a fault and that the game was
   * saved, and offers the diagnostic text for copying. Same banner family as
   * the storage fault, because it is the same kind of statement: something
   * about this session is broken and stays broken until a restart.
   */
  function showAppFault(err) {
    const detail = err && (err.stack || err.message) ? String(err.stack || err.message) : String(err);
    try { saveGame(); } catch (_) { /* the save may be what failed */ }
    let el = doc.getElementById("app-fault");
    if (!el) {
      el = doc.createElement("div");
      el.id = "app-fault";
      el.className = "storage-fault app-fault";
      el.setAttribute("role", "alert");
      doc.body.appendChild(el);
    }
    el.replaceChildren();
    const text = doc.createElement("span");
    text.textContent = t("msg.fault.happened");
    const copy = doc.createElement("button");
    copy.type = "button";
    copy.className = "toast-action";
    copy.textContent = t("msg.fault.copy");
    copy.onclick = () => Host.writeClipboard(detail.slice(0, 4000)).then(() => toast(t("msg.fault.copied")), () => toast(t("msg.copy.failed"), "fault"));
    const close = doc.createElement("button");
    close.type = "button";
    close.className = "toast-action";
    close.textContent = t("act.close");
    close.onclick = () => { el.hidden = true; };
    el.append(text, copy, close);
    el.hidden = false;
  }
  /**
   * 7.4: the engine did not start. Until then a boot failure was silent:
   * init() rejected, the worker was torn down, and the pill sat on
   * 「引擎思考中…」 for good (v7-4-plan §1). Same banner family as the fault
   * above, because it is the same kind of statement — a feature is gone until
   * something changes — with a way forward added: 重试.
   */
  function showEngineFault(err) {
    const detail = [
      "engine boot failed: " + (err && (err.stack || err.message) ? String(err.stack || err.message) : String(err)),
      "version: " + (typeof __CHESS_VERSION__ === "string" ? __CHESS_VERSION__ : "?"),
      "WebAssembly: " + (typeof WebAssembly === "object" ? "yes" : "no"),
      "userAgent: " + navigator.userAgent,
      "time: " + new Date().toISOString(),
    ].join("\n");
    let el = doc.getElementById("engine-fault");
    if (!el) {
      el = doc.createElement("div");
      el.id = "engine-fault";
      el.className = "storage-fault app-fault";
      el.setAttribute("role", "alert");
      doc.body.appendChild(el);
    }
    el.replaceChildren();
    const text = doc.createElement("span");
    text.textContent = text.title = t("msg.engine.bootFailed");
    const retry = doc.createElement("button");
    retry.type = "button";
    retry.className = "toast-action";
    retry.textContent = t("act.retry");
    retry.onclick = () => retryEngine();
    const copy = doc.createElement("button");
    copy.type = "button";
    copy.className = "toast-action";
    copy.textContent = t("msg.fault.copy");
    copy.onclick = () => Host.writeClipboard(detail.slice(0, 4000)).then(() => toast(t("msg.fault.copied")), () => toast(t("msg.copy.failed"), "fault"));
    const close = doc.createElement("button");
    close.type = "button";
    close.className = "toast-action";
    close.textContent = t("act.close");
    close.onclick = () => { el.hidden = true; };
    el.append(text, retry, copy, close);
    el.hidden = false;
  }
  doc.defaultView.addEventListener("error", (ev) => { if (ev && ev.error) showAppFault(ev.error); });
  doc.defaultView.addEventListener("unhandledrejection", (ev) => { showAppFault(ev && ev.reason); });

  /**
   * Three tiers, because 110 toasts were saying three different kinds of thing
   * in one voice.
   *
   * "已复制 PGN", "你违背了开局原则" and "引擎启动失败" shared a background, a
   * size and a 2.2-second life. The first is a receipt you may ignore; the
   * second is the app correcting you, which is the whole point of the teaching
   * modes and deserves to be read; the third means a feature is gone until you
   * restart, and 2.2 seconds later there was no evidence it had ever happened.
   * 缺陷 20.
   *
   *   ok      a receipt — it happened, carry on. Short.
   *   fix     the app is correcting you. Longer, because it is a sentence with
   *           something to learn in it, and accented so it does not read as
   *           another receipt.
   *   fault   something is broken. Does NOT dismiss itself: a fault that
   *           disappears is a fault nobody was told about. It gets a close
   *           button instead, which is also what makes it safe to keep.
   *
   * @param {string} msg
   * @param {"ok"|"fix"|"fault"} [tier]
   */

  const placeToast = (node) => placeToastAt(node, appEl()); // where a toast stands (toast-place.js)
  // a fault toast stays up, and the board it is placed against can move
  doc.defaultView.addEventListener("resize", () => {
    const el = doc.getElementById("toast");
    if (el && el.classList.contains("show")) placeToast(el);
  });
  function dismissToast() {
    const el = doc.getElementById("toast");
    if (!el) return false;
    if (!el.classList.contains("show")) return false;
    el.classList.remove("show"); el.style.pointerEvents = "";
    if (store().ui.toastTimer) { clearTimeout(store().ui.toastTimer); store().ui.toastTimer = null; }
    return true;
  }

  /**
   * @param {string} msg
   * @param {string} [tier]
   * @param {{label: string, onClick: () => void}} [action] a way forward, for
   *   the faults where naming the problem is not enough — see the engine's
   *   failure to move, which otherwise leaves the game stopped on its turn
   *   with nothing but destructive exits offered.
   */
  function toast(msg, tier, action) {
    const el = doc.getElementById("toast");
    if (!el) return;
    const kind = TOAST_MS[tier] === undefined ? "ok" : tier;
    const ms = TOAST_MS[kind];
    // The live region has to be told how loudly to speak *before* the text
    // lands in it. Until 2.1.1 it was told nothing at all: no role, no
    // aria-live, on the element that carries all 110 of this app's messages —
    // including 「引擎启动失败」. The board beside it has had a live region
    // since the keyboard move work, and the storage banner sets role=alert
    // explicitly; only the tier in between was silent.
    el.setAttribute("role", ms ? "status" : "alert");
    el.setAttribute("aria-live", ms ? "polite" : "assertive");
    el.replaceChildren();
    const text = doc.createElement("span");
    text.textContent = msg;
    el.append(...(action && action.icon ? [Icons.icon(action.icon, "toast-ic")] : []), text);
    // A fault does not leave on its own, which is right — a fault that
    // disappears is a fault nobody was told about. What was wrong is the way
    // out: the docblock above says it "gets a close button", and it never had
    // one. It had a click handler on a div that is not focusable, so the only
    // exit was a mouse landing somewhere the pointer shape was the only hint
    // about — and Esc, which closes every other transient thing in this app,
    // did nothing. Meanwhile it sits over the board's back rank.
    if (!ms || (action && action.label)) {   // M3 评审 P2-2: an ordinary toast may carry a way back (撤销)
      // The way forward comes before the way out: a fault the app knows how to
      // retry should offer that, not just a ✕.
      if (action && action.label) {
        const act = doc.createElement("button");
        act.type = "button";
        act.className = "toast-action";
        act.textContent = action.label;
        act.onclick = () => { dismissToast(); action.onClick(); };
        el.appendChild(act);
      }
      const close = doc.createElement("button");
      close.type = "button";
      close.className = "toast-close";
      close.appendChild(Icons.icon("x"));
      close.setAttribute("aria-label", t("act.close"));
      close.onclick = dismissToast;
      el.appendChild(close);
    }
    el.classList.remove("t-ok", "t-fix", "t-fault", "t-ach");
    el.classList.add("t-" + kind);
    placeToast(el);
    el.classList.add("show");
    if (store().ui.toastTimer) clearTimeout(store().ui.toastTimer);
    store().ui.toastTimer = null;
    if (ms) store().ui.toastTimer = setTimeout(() => { el.classList.remove("show"); el.style.pointerEvents = ""; }, action && action.label ? 4 * ms : ms);
    el.onclick = ms ? null : dismissToast;
    el.style.cursor = ms ? "" : "pointer"; el.style.pointerEvents = ms && action && action.label ? "auto" : "";
  }

  /**
   * In-app confirm. Resolves true (ok) / false (cancel), and "alt" when the
   * optional third button (buttons.alt) was offered and chosen.
   *
   * `buttons.danger` sends the question to the platform's own alert instead,
   * when this build has one. Three questions carry it — 清除全部存档,
   * 清除统计与历史, 重置课程进度 — and they are the three whose answer cannot
   * be taken back: no undo, no autosave behind them, nothing to restore from.
   * Everything else stays in the page, because a system alert for 「提和?」
   * would be the platform shouting about an ordinary move.
   *
   * A build with no such dialog falls through to the same box as before. The
   * fallback is not an error path — every platform feature here is optional
   * by construction, and `Host.showMessage` answering null is how it says so.
   */
  async function confirmNative(message, title, buttons) {
    const okLabel = (buttons && buttons.ok) || t("act.ok");
    const cancelLabel = (buttons && buttons.cancel) || t("act.cancel");
    const altLabel = buttons && buttons.alt;
    if (buttons && buttons.danger) {
      const answer = await Host.showMessage({
        style: "critical",
        title: title || t("aria.confirm"),
        message: title || t("aria.confirm"),
        informativeText: message,
        primaryButton: okLabel,
        secondaryButton: cancelLabel,
        tertiaryButton: altLabel || undefined,
      });
      if (answer === "primary") return true;
      if (answer === "tertiary") return altLabel ? "alt" : false;
      if (answer === "secondary") return false;
      // null: no native dialog on this build — ask in the page instead
    }
    const modal = doc.getElementById("confirm-modal");
    const titleEl = doc.getElementById("confirm-title");
    const msgEl = doc.getElementById("confirm-message");
    const okBtn = doc.getElementById("confirm-ok");
    const cancelBtn = doc.getElementById("confirm-cancel");
    const altBtn = doc.getElementById("confirm-alt");
    if (!modal || !okBtn || !cancelBtn) {
      try { return Promise.resolve(!!doc.defaultView.confirm(message)); }
      catch (_) { return Promise.resolve(true); }
    }
    if (titleEl) titleEl.textContent = title || t("aria.confirm");
    if (msgEl) msgEl.textContent = message;
    okBtn.textContent = okLabel;
    cancelBtn.textContent = cancelLabel;
    // 7.7 (v7-7-plan §4): an answer that cannot be taken back is red, not
    // the accent. The accent fill is this UI's word for "the thing to press
    // here"; on 认输 and on the deletions it was saying the opposite of what
    // the question means. The native alert has its own critical style; this
    // is the in-page box saying the same.
    const destructive = !!(buttons && (buttons.destructive || buttons.danger));
    okBtn.classList.toggle("danger", destructive);
    okBtn.classList.toggle("primary", !destructive);
    if (altBtn) {
      altBtn.hidden = !altLabel;
      if (altLabel) altBtn.textContent = altLabel;
      altBtn.classList.toggle("danger", destructive);
    }
    Dlg.open(modal, okBtn);
    return new Promise((resolve) => { store().ui.confirmResolver = resolve; });
  }
  function finishConfirm(val) {
    const modal = doc.getElementById("confirm-modal");
    Dlg.close(modal);
    if (store().ui.confirmResolver) { store().ui.confirmResolver(val); store().ui.confirmResolver = null; }
  }

  return { showStorageFault, showCorruptFault, showAppFault, showEngineFault, dismissToast, toast, confirmNative, finishConfirm };
}
