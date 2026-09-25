/**
 * A click with time between the press and the release, and a record of
 * whether the thing pressed stayed where it was.
 *
 * 7.5 found this the hard way on WebKit: a panel above the 分析 button was
 * rebuilt between mouse-down and mouse-up, the button moved 16px, and the
 * click was simply lost — no event, no error, nothing to see. Chromium let
 * the same click through, so an ordinary `page.click` (press and release in
 * the same frame, on the engine that forgives) can never catch it. This holds
 * the button down across several frames and watches it every frame:
 *
 *   - `drift`: the largest distance, in px, the pressed element's centre moved
 *     from where it was at mouse-down, over every frame until mouse-up;
 *   - `replaced`: the element under the pointer at mouse-down was taken out
 *     of the document (or swapped for another node) before mouse-up;
 *   - `clicked`: a `click` event reached that same element.
 *
 * The first two are what make WebKit drop a click; asserting them is what
 * lets a Chromium run stand guard for both engines (v7-6-plan §2).
 */

/**
 * @param {import("playwright-core").Page} page
 * @param {string} selector  the element to press (its centre is used)
 * @param {{ hold?: number, before?: () => Promise<void> }} [opts]
 *   hold: ms between down and up (default 450 — longer than a frame, long
 *   enough to straddle a few re-renders; a real press is 80–150ms, a slow one
 *   more); before: called with the button down, just before the release
 * @returns {Promise<{ drift: number, replaced: boolean, clicked: boolean,
 *   down: object|null, up: object|null }>}
 */
export async function heldClick(page, selector, opts = {}) {
  const hold = opts.hold == null ? 450 : opts.hold;
  const loc = page.locator(selector).first();
  await loc.scrollIntoViewIfNeeded();
  // a node that is being re-rendered can be between copies at the instant
  // it is measured; that is what this is here to catch, not to trip on
  let box = null;
  for (let i = 0; i < 5 && !box; i++) {
    box = await loc.boundingBox().catch(() => null);
    if (!box) await page.waitForTimeout(50);
  }
  if (!box) throw new Error("heldClick: " + selector + " has no box");
  await page.evaluate((sel) => {
    const rec = { el: null, down: null, up: null, drift: 0, replaced: false, clicked: false, raf: 0 };
    const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
    // centres, not corners: a pressed button is often drawn scaled down a
    // little (:active), which moves its corners but never its centre
    const far = (a, b) => Math.max(Math.abs(a.x + a.w / 2 - b.x - b.w / 2), Math.abs(a.y + a.h / 2 - b.y - b.h / 2));
    const watch = () => {
      if (!rec.el || rec.up) return;
      if (!rec.el.isConnected) rec.replaced = true;
      else rec.drift = Math.max(rec.drift, far(rect(rec.el), rec.down));
      rec.raf = requestAnimationFrame(watch);
    };
    const onDown = (e) => {
      rec.el = e.target instanceof Element ? e.target.closest(sel) : null;
      if (!rec.el) return;
      rec.down = rect(rec.el);
      rec.raf = requestAnimationFrame(watch);
    };
    const onUp = (e) => {
      if (!rec.el) return;
      cancelAnimationFrame(rec.raf);
      if (!rec.el.isConnected) rec.replaced = true;
      else {
        rec.up = rect(rec.el);
        rec.drift = Math.max(rec.drift, far(rec.up, rec.down));
        // the release landed on another node: the browser's click goes to
        // the common ancestor, which is where a delegated handler misses it
        if (!(e.target instanceof Node) || !rec.el.contains(e.target)) rec.replaced = true;
      }
      rec.up = rec.up || {};
    };
    const onClick = (e) => { if (rec.el && e.target instanceof Node && rec.el.contains(e.target)) rec.clicked = true; };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("mouseup", onUp, true);
    document.addEventListener("click", onClick, true);
    window.__heldClick = { rec, off: () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("mouseup", onUp, true);
      document.removeEventListener("click", onClick, true);
    } };
  }, selector);
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(hold);
  if (opts.before) await opts.before();
  await page.mouse.up();
  await page.waitForTimeout(30);
  return page.evaluate(() => {
    const h = window.__heldClick;
    h.off();
    delete window.__heldClick;
    const { drift, replaced, clicked, down, up } = h.rec;
    return { drift: Math.round(drift * 10) / 10, replaced, clicked, down, up };
  });
}
