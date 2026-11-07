/**
 * 本周重点 — the diagnosis, turned into this week's work (v10-0-plan T3).
 *
 * 「我的」 and the library's diagnosis page could already say where a player's
 * games go wrong — the motif that catches them, the phase they lose most in,
 * the opening that scores worst — and that was where it ended: a page to
 * read, and nothing to do about it. Aimchess's answer is a training plan per
 * weakness; this is the smallest version of it: two or three items for the
 * week, each one a click from the training it names, each crossed out when
 * the counters say it was done.
 *
 * The week is frozen when it is first composed: the items do not reshuffle
 * under the player as more games are analysed, and the baseline the progress
 * is measured from is the counters at that moment. A new ISO week composes
 * afresh.
 *
 * Pure: the diagnosis (library.js diagnose) and the counters in, items out.
 * No store, no DOM, no i18n.
 * @module focus
 */

/** How much of each item the week asks for. */
export const FOCUS_DOSE = { motif: 10, endgame: 5, opening: 3 };

/** An opening must have this many games behind it to be called weak. */
const OPENING_MIN_GAMES = 3;

/** The ECO family an opening drill shares with a game: "B2" for B20–B29. */
export function familyOf(eco) {
  return String(eco || "").slice(0, 2).toUpperCase();
}

/**
 * The week's items from the diagnosis.
 * @param {object} diag library.js diagnose()
 * @param {object} avail { opDrills: (family) => number } — drills there are to serve
 * @returns {{items: object[], need: number}} `need` is how many more analysed
 *          games the diagnosis wants before it will say anything
 */
export function compose(diag, avail) {
  if (!diag || !diag.enough) return { items: [], need: diag ? Math.max(0, (diag.need || 0) - (diag.have || 0)) : 0 };
  const items = [];
  const motifs = diag.motifs || [];
  if (motifs[0]) items.push({ kind: "motif", motif: motifs[0].motif, n: FOCUS_DOSE.motif });
  if (diag.weakestPhase === "end") items.push({ kind: "endgame", n: FOCUS_DOSE.endgame });
  else if (diag.weakestPhase === "middle" && motifs[1]) items.push({ kind: "motif", motif: motifs[1].motif, n: FOCUS_DOSE.motif });
  const weak = (diag.ecos || [])
    .filter((e) => e.n >= OPENING_MIN_GAMES && e.score != null && e.score < 0.5)
    .sort((a, b) => a.score - b.score || b.n - a.n)
    .find((e) => (avail && avail.opDrills ? avail.opDrills(familyOf(e.eco)) : 0) > 0);
  if (weak) {
    const have = avail.opDrills(familyOf(weak.eco));
    items.push({ kind: "opening", eco: weak.eco, name: weak.name || weak.eco, score: weak.score,
      family: familyOf(weak.eco), n: Math.min(FOCUS_DOSE.opening, have) });
  }
  return { items: items.slice(0, 3), need: 0 };
}

/**
 * The counters progress is measured on.
 * @param {object} c { byMotif: {motif: attempts}, egDone: number, opSolved: (family) => number }
 * @param {object[]} items
 */
export function snapshot(c, items) {
  const base = { byMotif: {}, egDone: c.egDone || 0, op: {} };
  for (const it of items || []) {
    if (it.kind === "motif") base.byMotif[it.motif] = (c.byMotif || {})[it.motif] || 0;
    if (it.kind === "opening") base.op[it.family] = c.opSolved ? c.opSolved(it.family) : 0;
  }
  return base;
}

/** How far into an item the counters are now, 0..n. */
export function progressOf(it, base, c) {
  let d = 0;
  if (it.kind === "motif") d = ((c.byMotif || {})[it.motif] || 0) - (base.byMotif[it.motif] || 0);
  else if (it.kind === "endgame") d = (c.egDone || 0) - (base.egDone || 0);
  else if (it.kind === "opening") d = (c.opSolved ? c.opSolved(it.family) : 0) - (base.op[it.family] || 0);
  return Math.max(0, Math.min(it.n, d));
}

/**
 * This week's focus, composed once a week and kept.
 * @param {object|null} kept the stored focus ({week, items, base}) or null
 * @param {string} week the ISO week now (progress.js weekKey)
 * @param {() => object} diagnose
 * @param {object} avail see compose()
 * @param {object} c see snapshot()
 * @param {number} have analysed games now, so an empty week is re-asked only when it grew
 * @returns {{focus: object, fresh: boolean}} `fresh` when it was composed now
 *          (the caller stores it)
 */
export function weekOf(kept, week, diagnose, avail, c, have) {
  if (kept && kept.week === week && Array.isArray(kept.items)) {
    if (kept.items.length) return { focus: kept, fresh: false };
    // a week that had nothing to say is asked again once there are more
    // analysed games — not on every render
    if (kept.have === have) return { focus: kept, fresh: false };
  }
  const { items, need } = compose(diagnose(), avail);
  return { focus: { week, items, base: snapshot(c, items), need, have }, fresh: true };
}

export const ChessFocus = { FOCUS_DOSE, familyOf, compose, snapshot, progressOf, weekOf };
