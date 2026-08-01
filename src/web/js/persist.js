/**
 * The one door to stored state.
 *
 * Eight keys — save / settings / stats / learn / puzzles / achv / slots /
 * panelOpen — each with its own version convention (`v:1` here, `idv` there,
 * srs tolerating 1.6's `true`, drills carrying a frozen id map), no single
 * "which version is this profile, and how does it come forward", and a
 * "clear the save" path that had to remember all eight by hand. 缺陷 33.
 *
 * And underneath it, the failure nobody was listening for. `host.js`
 * deliberately returns true/false from storageSet() and catches its own
 * exception; all eleven call sites in app.js dropped that value on the floor,
 * every one of them inside an empty `catch (_) {}`. So a full or blocked quota
 * looked exactly like success: the app went on showing lesson progress, puzzle
 * progress, statistics and achievements for the rest of the session, and lost
 * every bit of it at the next launch. 缺陷 3.
 *
 * That is the worst shape a persistence bug can take — not "your progress is
 * gone", but "your progress is fine" followed by "what progress?". So a write
 * failure is latched and announced once, loudly, and the app stops pretending.
 *
 * @module persist
 */

/** Every key this app owns. "Clear my data" means exactly this list. */
export const KEYS = {
  save: "chess.v1.save",
  settings: "chess.v1.settings",
  stats: "chess.v1.stats",
  learn: "chess.v1.learn",
  puzzles: "chess.v1.puzzles",
  achievements: "chess.v1.achv",
  slots: "chess.v1.slots",
  panelOpen: "chess.panelOpen",
};

/** Where the profile's schema version lives — the one number, not eight. */
export const SCHEMA_KEY = "chess.schema";

/**
 * The current schema version, and how to get here from each earlier one.
 *
 * A migration takes the whole bag of raw strings and returns it changed. Whole
 * bag rather than one key at a time, because the interesting migrations are
 * the cross-key ones: a stats record that needs an id the save file also
 * refers to cannot be fixed by looking at either key alone.
 *
 * Migrations must be **frozen data or pure rewrites of what is stored** — never
 * a derivation from the current code's idea of the content. design-constraints
 * §6: a derived map is only correct for someone who did not skip a version.
 */
export const SCHEMA = 1;

/** @type {Array<{to: number, note: string, up: (bag: object) => object}>} */
export const MIGRATIONS = [
  // v0 → v1 is the arrival of this file: everything written before it had no
  // schema number at all, and each key carried its own convention. Nothing is
  // rewritten — the per-key readers still understand their own history — this
  // only records that the profile has been seen by a versioned reader.
  { to: 1, note: "adopt a single schema version", up: (bag) => bag },
];

/**
 * @param {object} host        the storage port (host.js)
 * @param {(info: object) => void} onWriteFailure called once, on the first
 *   failed write; the app turns this into a fault-level message
 */
export function createPersist(host, onWriteFailure) {
  let bag = null;
  let broken = null;   // {key} of the first write that failed

  /**
   * Read every key, once.
   *
   * One pass at startup instead of eight scattered reads, so migrations see a
   * whole profile and the rest of the app never has to wonder whether some
   * other key has been touched since.
   */
  function load() {
    bag = {};
    for (const [name, key] of Object.entries(KEYS)) bag[name] = host.storageGet(key);
    const at = Number(host.storageGet(SCHEMA_KEY) || 0) || 0;
    if (at < SCHEMA) {
      for (const m of MIGRATIONS) if (m.to > at) bag = m.up(bag) || bag;
      // recorded even if nothing moved: the next migration needs to know how
      // far this profile has come, and "no version" cannot say that
      host.storageSet(SCHEMA_KEY, String(SCHEMA));
    }
    return bag;
  }

  /** Whatever was read at startup, for a key. */
  function get(name) {
    if (!bag) load();
    return bag[name];
  }

  /**
   * Write one key, and mean it.
   *
   * Returns false when the write did not happen — which is the whole point of
   * this function existing. The first failure latches, so the app can stop
   * showing progress it is no longer keeping, and announces itself once rather
   * than on every autosave.
   */
  function set(name, value) {
    const key = KEYS[name];
    if (!key) throw new Error("unknown storage key: " + name);
    const ok = host.storageSet(key, value);
    if (!bag) bag = {};
    if (ok) { bag[name] = value; return true; }
    if (!broken) {
      broken = { key: name };
      try { onWriteFailure && onWriteFailure(broken); } catch (_) { /* never mask the write failure */ }
    }
    return false;
  }

  /** JSON in one step, since every caller but panelOpen was doing it. */
  function setJson(name, value) { return set(name, JSON.stringify(value)); }

  function remove(name) {
    const key = KEYS[name];
    if (!key) throw new Error("unknown storage key: " + name);
    host.storageRemove(key);
    if (bag) bag[name] = null;
  }

  /**
   * Forget everything this app stored.
   *
   * From the key list, so "clear the save" cannot fall behind the set of keys
   * that exist — which is exactly what it had to do by hand before.
   */
  function clearAll() {
    for (const name of Object.keys(KEYS)) remove(name);
    host.storageRemove(SCHEMA_KEY);
  }

  /** Has a write failed in this session? Then what is on screen is not saved. */
  function isBroken() { return !!broken; }

  return { load, get, set, setJson, remove, clearAll, isBroken, KEYS, SCHEMA };
}
