/**
 * Modal plumbing — the part six dialogs all needed and none of them had.
 *
 * Up to 1.9 every dialog was just `classList.add("show")`. That was fine while
 * Tab toggled the side panel, because keyboard focus could never move at all.
 * 1.9 gave Tab back to the browser, and the omission became reachable: Tab
 * walked straight out of the open dialog and into the page behind it (measured
 * on the shipped build: out of the FEN dialog after 4 presses, out of the save
 * slots and the confirm box after 1), while a screen reader was never told a
 * dialog had opened at all — none of the six carried `aria-modal`.
 *
 * Three things belong to every dialog, so they live here once:
 *
 * - **Tab stays inside.** Wrapping at both ends, so Shift+Tab from the first
 *   control lands on the last.
 * - **Focus comes back.** Closing returns focus to whatever opened the dialog,
 *   not to a now-hidden input. Chromium happily leaves `document.activeElement`
 *   on an element inside a display:none subtree, which strands the keyboard.
 * - **`aria-modal="true"` while open**, removed on close so the hidden dialog
 *   does not keep claiming the page is behind a modal.
 *
 * Escape is deliberately *not* handled here: the app already resolves it in
 * one place, in the right order (promotion before slots before history…),
 * because the answer depends on which dialogs are stacked.
 * @module dialog
 */
(function (global) {
  const FOCUSABLE = [
    "a[href]", "button:not([disabled])", "input:not([disabled])",
    "select:not([disabled])", "textarea:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
  ].join(",");

  /** dialog element → the element that had focus when it opened */
  const openers = new WeakMap();

  /** Tabbable descendants, in document order, skipping anything not rendered. */
  function focusables(el) {
    return Array.prototype.filter.call(el.querySelectorAll(FOCUSABLE), (n) => {
      if (n.hidden || n.getAttribute("aria-hidden") === "true") return false;
      // offsetParent is null for display:none — and also for position:fixed,
      // which the dialog backdrop itself uses, so check the box as well
      return n.offsetParent !== null || n.getBoundingClientRect().width > 0;
    });
  }

  /** The visible dialog nearest the top of the stack, or null. */
  function topmost(root) {
    const open = (root || document).querySelectorAll(".modal-bg.show");
    return open.length ? open[open.length - 1] : null;
  }

  /**
   * @param {Element} el the `.modal-bg` wrapper
   * @param {Element} [initial] control to focus; defaults to the first tabbable
   */
  function open(el, initial) {
    if (!el) return;
    const active = document.activeElement;
    // don't record <body> as the opener — restoring to it is the same as
    // restoring to nothing, and it would mask a genuinely missing opener
    if (active && active !== document.body) openers.set(el, active);
    el.setAttribute("aria-modal", "true");
    el.classList.add("show");
    const target = initial || focusables(el)[0];
    if (target) target.focus();
  }

  /** Hide `el` and hand focus back to whatever opened it. */
  function close(el) {
    if (!el) return;
    const wasInside = el.contains(document.activeElement);
    el.classList.remove("show");
    el.removeAttribute("aria-modal");
    const back = openers.get(el);
    openers.delete(el);
    // only steal focus back if it is currently stranded inside the dialog we
    // just hid; if the user has already clicked elsewhere, leave them there
    if (!wasInside) return;
    if (back && back.isConnected && back.offsetParent !== null) back.focus();
    else if (document.body) document.body.focus();
  }

  /**
   * Keep Tab inside the topmost dialog. Call from a keydown listener.
   * @returns {boolean} true if the event was consumed
   */
  function handleTab(ev, root) {
    if (ev.key !== "Tab" || ev.altKey || ev.ctrlKey || ev.metaKey) return false;
    const el = topmost(root);
    if (!el) return false;
    const items = focusables(el);
    if (!items.length) { ev.preventDefault(); return true; }
    const first = items[0], last = items[items.length - 1];
    const here = document.activeElement;
    if (!el.contains(here)) {
      // focus escaped some other way (a click on the backdrop, say) — pull it
      // back to the near end rather than letting Tab walk the page behind
      ev.preventDefault();
      (ev.shiftKey ? last : first).focus();
      return true;
    }
    if (ev.shiftKey && here === first) { ev.preventDefault(); last.focus(); return true; }
    if (!ev.shiftKey && here === last) { ev.preventDefault(); first.focus(); return true; }
    return false;
  }

  global.ChessDialog = { open, close, handleTab, focusables, topmost, FOCUSABLE };
})(typeof window !== "undefined" ? window : globalThis);
