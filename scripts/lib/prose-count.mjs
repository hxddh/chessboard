/**
 * v11-0-plan U1: how many characters of explanation a screen shows.
 *
 * "Explanation" is visible running text that is not a control, a heading, a
 * number or the notation: the sentences that tell a person what a thing is
 * or what to do. Counted per text node, after trimming, and only when the
 * node is a phrase (four characters or more) — a label beside a value, 「课」
 * under a ring, a piece letter, is the interface, not prose about it.
 *
 * Runs in the page (pass it to page.evaluate). Returns {chars, samples}.
 */
export const PROSE_COUNT = (rootSel) => {
  const root = document.querySelector(rootSel) || document.body;
  const SKIP = "button, h1, h2, h3, h4, summary, .num, .move-list, .mlmove, label, input, select, option, .sr-only, [aria-hidden='true'], .rail, .ps-name, .ps-level, .coords";
  const shown = (el) => {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      if (e.hidden) return false;
      const cs = getComputedStyle(e);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      if (e.tagName === "DETAILS" && !e.open && e !== el.closest("details")) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  let chars = 0;
  const samples = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const text = n.nodeValue.replace(/\s+/g, " ").trim();
    if (text.length < 4) continue;
    const el = n.parentElement;
    if (!el || el.closest(SKIP)) continue;
    // a closed fold shows its summary only
    const fold = el.closest("details");
    if (fold && !fold.open && !el.closest("summary")) continue;
    if (!shown(el)) continue;
    chars += text.length;
    samples.push(text);
  }
  return { chars, samples };
};
