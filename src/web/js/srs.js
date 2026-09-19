/**
 * Review scheduling for the puzzle queue.
 *
 * Until 1.7 the queue was a set: miss a puzzle and it went in, solve it once
 * and it came straight back out. One correct answer right after seeing the
 * solution proves very little, so puzzles graduated the moment they were least
 * likely to have stuck.
 *
 * The replacement is deliberately the smallest thing that fixes that: a puzzle
 * needs `GRADUATE` clean solves in a row to leave, a miss resets the streak,
 * and the queue is ordered so a puzzle just answered goes to the back rather
 * than being asked again immediately.
 *
 * ## Two axes (6.0)
 *
 * Graduation stays **count-based** (design-constraints §6): this is a local,
 * offline app people open irregularly, and a schedule that graduated by the
 * calendar would either dump everything at once after a fortnight away or
 * hide the queue entirely during a long session. "Two clean solves in a row"
 * is something the player can always finish today, whatever the date says.
 *
 * What the calendar *adds* is the second axis, kept separate so the first
 * keeps its meaning: every entry now carries `due` (ms epoch) and `ivl`
 * (days). A miss is due at once. A clean solve pushes the next ask out along
 * a fixed ladder — 1 → 3 → 7 → 21 days, SM-2 with the ease factor removed,
 * because with one puzzle per idea there is nothing for an ease factor to
 * learn from. So the streak still says whether the puzzle *owes* the queue
 * (`isDue`), and the date says whether today is the day to ask
 * (`dueQueue`). A puzzle that has graduated by count but still has rungs on
 * the ladder is no longer owed — the picker's rung 1 leaves it alone — yet
 * it comes back for retention checks at 3, 7 and 21 days; a miss at any of
 * those puts it back in the queue with the streak reset, and a clean solve
 * on the last rung retires it.
 *
 * The daily cap is the other thing a time axis makes possible: fourteen days
 * away leave fourteen days of dues, and `dueQueue` serves at most `cap`
 * today and spreads the rest forward a day per batch, so the load on the
 * first day back is bounded rather than the whole backlog at once.
 *
 * Callers that do not pass `now` get the pre-6.0 behaviour exactly: count
 * axis only, `null` on graduation. Stored 1.7 entries have no `due`, which
 * reads as 0: overdue, asked first, then rescheduled — no migration.
 * @module srs
 */
  /** consecutive clean solves needed before a puzzle leaves the review queue */
  const GRADUATE = 2;
  /** next-ask interval in days after the s-th consecutive clean solve */
  const LADDER = [1, 3, 7, 21];
  const DAY = 86400000;

  /**
   * Normalise a stored entry. 1.6 and earlier stored `true`, so anything
   * truthy that is not an object means "missed once, never re-solved".
   * Entries older than 6.0 have no `due`/`ivl`; both read as 0, which means
   * "overdue since forever" — the honest reading of a debt with no date.
   */
  function entry(v) {
    if (!v) return null;
    if (typeof v === "object") {
      const s = Number(v.s);
      const seen = Number(v.n);
      const due = Number(v.due);
      const ivl = Number(v.ivl);
      return {
        s: Number.isFinite(s) && s > 0 ? Math.floor(s) : 0,
        n: Number.isFinite(seen) && seen > 0 ? Math.floor(seen) : 0,
        due: Number.isFinite(due) && due > 0 ? due : 0,
        ivl: Number.isFinite(ivl) && ivl > 0 ? ivl : 0,
      };
    }
    return { s: 0, n: 0, due: 0, ivl: 0 };
  }

  /**
   * A miss puts the puzzle in the queue, resets any progress towards leaving
   * and makes it due at once.
   * @param {*} v stored entry
   * @param {number} [now] ms epoch; omitted = due immediately (0)
   */
  function onMiss(v, now) {
    const e = entry(v) || { s: 0, n: 0 };
    return { s: 0, n: e.n + 1, due: Number.isFinite(now) ? now : 0, ivl: 0 };
  }

  /**
   * A clean solve advances the streak.
   *
   * Without `now`: pre-6.0 behaviour, `null` once the streak reaches
   * GRADUATE. With `now`: the same streak, plus the next date on the ladder;
   * `null` only after a clean solve on the ladder's last rung.
   * @returns {object|null} the new entry, or null once it has graduated
   */
  function onSolve(v, now) {
    const e = entry(v);
    if (!e) return null; // not in the queue at all
    const s = e.s + 1;
    if (!Number.isFinite(now)) return s >= GRADUATE ? null : { s, n: e.n + 1, due: e.due, ivl: e.ivl };
    if (s > LADDER.length) return null; // walked the whole ladder: retired
    const ivl = LADDER[s - 1];
    return { s, n: e.n + 1, due: now + ivl * DAY, ivl };
  }

  /**
   * True when this puzzle still owes the queue some correct answers — the
   * count axis. An entry past GRADUATE is on the retention ladder, not owed.
   */
  function isDue(v, now) {
    const e = entry(v);
    if (!e || e.s >= GRADUATE) return false;
    // with a clock: a puzzle scheduled for tomorrow is not served today, even
    // though it still owes a solve (6.0 review: the smart pick read only the
    // count axis and re-served a once-solved puzzle at once)
    return !(Number.isFinite(now) && e.due > now);
  }

  /** True when the entry exists and its date has come — either axis. */
  function dueBy(v, now) {
    const e = entry(v);
    return !!e && e.due <= now;
  }

  /**
   * Queue order: least-learned first, so the puzzle just answered correctly
   * drops behind the ones still at streak 0.
   * @param {string[]} ids
   * @param {object} state map of id → stored entry
   */
  function order(ids, state) {
    return ids.slice().sort((a, b) => {
      const ea = entry(state[a]) || { s: 0, n: 0 };
      const eb = entry(state[b]) || { s: 0, n: 0 };
      return ea.s - eb.s || eb.n - ea.n;
    });
  }

  /** how far a puzzle is towards graduating, for display */
  function progress(v) {
    const e = entry(v);
    return e ? [Math.min(e.s, GRADUATE), GRADUATE] : [GRADUATE, GRADUATE];
  }

  /** ids whose date has come, most overdue first (ties: least-learned first) */
  function dueIds(state, now) {
    const ids = Object.keys(state || {}).filter((id) => {
      const e = entry(state[id]);
      return e && e.due <= now;
    });
    return ids.sort((a, b) => {
      const ea = entry(state[a]), eb = entry(state[b]);
      return ea.due - eb.due || ea.s - eb.s || eb.n - ea.n;
    });
  }

  /** how many puzzles are due today — what 今天的训练 should read, not the queue length */
  function dueCount(state, now) {
    return dueIds(state, now).length;
  }

  /**
   * Today's review batch: at most `cap` ids, most overdue first.
   *
   * When more than `cap` are due, the rest are **rescheduled in place** —
   * the (cap+1)-th to 2cap-th to tomorrow, the next cap to the day after,
   * and so on — so a backlog drains at `cap` a day instead of all at once.
   * Mutates `state` (the stored map), matching how the rest of puzzleState
   * is updated; the caller persists it as usual.
   *
   * @param {object} state map of id → stored entry
   * @param {number} now ms epoch
   * @param {number} cap daily maximum (≥ 1)
   * @returns {string[]} ids to ask today
   */
  function dueQueue(state, now, cap) {
    const n = Math.max(1, Math.floor(cap) || 1);
    const ids = dueIds(state, now);
    const today = ids.slice(0, n);
    for (let i = n; i < ids.length; i++) {
      const e = entry(state[ids[i]]);
      const days = Math.floor((i - n) / n) + 1;
      state[ids[i]] = { s: e.s, n: e.n, ivl: e.ivl, due: now + days * DAY };
    }
    return today;
  }

  export const ChessSrs = { GRADUATE, LADDER, DAY, entry, onMiss, onSolve, isDue, dueBy, order, progress, dueCount, dueQueue };
