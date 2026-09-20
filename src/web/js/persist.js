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
  mines: "chess.v1.mines",
  progress: "chess.v1.progress",
  achievements: "chess.v1.achv",
  slots: "chess.v1.slots",
  panelOpen: "chess.panelOpen",
  // 6.0: where a value that failed to parse is kept, instead of being thrown
  // away and overwritten by the next autosave (v6-plan D2)
  quarantine: "chess.v1.quarantine",
};

/** Where the profile's schema version lives — the one number, not eight. */
export const SCHEMA_KEY = "chess.schema";
/** When the cache last changed — what recover() compares against the file. */
export const STAMP_KEY = "chess.writtenAt";

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
   * Was this profile empty the first time anyone looked?
   *
   * Recorded inside load(), from the snapshot taken before a single write has
   * happened, because "is this a new user" is a question about the storage the
   * app *found* — not about the storage it has since written to.
   *
   * app.js used to answer it by reading four keys at the end of its init:
   *
   *   const firstRun = !get("settings") && !get("save") &&
   *     !get("learn") && !get("puzzles");
   *
   * and by then the puzzle store had already written an empty record of its
   * own, four thousand lines earlier. `set()` updates this bag, so that read
   * came back non-null and `firstRun` was false for every user who ever
   * installed the app. It gated two things: the first-run guide, and
   * `detectLang()`. Measured on the shipped 2.1.4, with clean storage, on four
   * system languages — en-US, ja-JP, zh-CN, de-DE — the interface came up in
   * Chinese all four times and the guide never appeared. Both of those are
   * what docs/manual-check.md A3 names as the failure.
   *
   * A snapshot cannot be broken by what any later module does at import time,
   * which the four reads could and did.
   */
  let foundEmpty = null;

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
    // before any migration, and long before anything writes: the profile as
    // it was found. panelOpen is excluded — it is a window preference, not
    // evidence that somebody has played.
    foundEmpty = Object.entries(bag)
      .every(([name, v]) => name === "panelOpen" || v == null);
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

  /** True when nothing of this app's was in storage at startup. */
  function wasEmpty() {
    if (!bag) load();
    return foundEmpty;
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
    // 6.1: after recover() rewrote storage from the file, the page is still
    // running on its pre-restore state and is about to reload onto the new
    // one. Anything it writes in between (beforeunload's saveGame, a clock
    // tick, the theme media query) would overwrite what was just restored
    // and re-stamp it newer, so the restored copy loses to the stale one.
    // Nothing may write again until the reload.
    if (frozen) return true;
    const ok = host.storageSet(key, value);
    if (!bag) bag = {};
    if (ok) {
      bag[name] = value;
      // 6.1: the stamp decides who wins in recover(). A cache that takes new
      // values under a frozen stamp reads as older than it is, and the file
      // then overwrites it — so a refused stamp is a refused write.
      if (!host.storageSet(STAMP_KEY, String(Date.now()))) { fail(name); return false; }
      scheduleMirror();
      return true;
    }
    fail(name);
    return false;
  }

  /**
   * 6.1: stop writing, for good, until the page reloads. Used after a restore
   * from the mirror, where any further write is by definition stale.
   */
  function freeze() { frozen = true; if (mirrorTimer) { clearTimeout(mirrorTimer); mirrorTimer = null; } }

  function fail(name) {
    if (broken) return;
    broken = { key: name };
    try { onWriteFailure && onWriteFailure(broken); } catch (_) { /* never mask the write failure */ }
  }

  // ------------------------------------------------------------------------
  // 6.0: the native mirror (v6-plan Q1.1).
  //
  // localStorage is the WebView's, not ours: its path is decided by the
  // engine, it is cleared by "remove website data", it has a quota, and a
  // change of app id or scheme leaves it behind. The profile is therefore
  // also written — whole, as one JSON document — to a file the shell owns in
  // the user's application-data directory (host.appdataWrite, atomic with a
  // .bak). localStorage stays the synchronous cache the app boots from; the
  // file is what survives. The two are reconciled once, at startup, by
  // recover(): when the cache is empty or older than the file, the file wins
  // and the page reloads onto it — the one moment the async read is allowed
  // to change what the app is standing on.
  // ------------------------------------------------------------------------
  const MIRROR_DELAY = 400; // ms; every autosave in a burst becomes one write
  let mirrorTimer = null;
  let mirrorEnabled = typeof host.appdataWrite === "function";
  // 6.1: no write reaches the file before recover() has reconciled the two
  // copies; with no reader there is nothing to reconcile, so the gate is open
  // from the start.
  let reconciled = typeof host.appdataRead !== "function";
  let mirrorPending = false;
  // 6.1: set when the file turned out to be unreadable. The banner tells the
  // user their file was left alone so they can try to recover it — that has to
  // be true. Before this flag existed recover()'s own finally released the
  // mirror and the boot path's queued write replaced the damaged file within
  // MIRROR_DELAY: the one copy of the thing they were told was kept, gone a
  // fraction of a second after they were told. Found by the recovery e2e.
  let mirrorBlocked = false;
  // 6.1: set once a restore has rewritten storage — see set()
  let frozen = false;
  function mirrorDoc() {
    const keys = {};
    for (const name of Object.keys(KEYS)) if (bag && bag[name] != null) keys[name] = bag[name];
    // the same revision stamp the cache carries (set() wrote it before
    // scheduling this): a mirror stamped a few hundred ms later than the
    // cache would read as "the file knows more" on the next launch, and
    // recover() would rewrite storage and reload after every ordinary session
    let at = Number(host.storageGet(STAMP_KEY) || 0) || 0;
    if (!at) { at = Date.now(); host.storageSet(STAMP_KEY, String(at)); }
    return { app: "chessboard", schema: SCHEMA, writtenAt: at, keys };
  }
  function scheduleMirror() {
    if (!mirrorEnabled || frozen || mirrorBlocked) return;
    // 6.1: the boot path writes before it reads. loadSettings/saveSettings
    // and the first saveGame all run through set(), which arms this timer,
    // while recover()'s bridge round trip is still in flight. When the cache
    // was cleared but the file is intact — the one case this mirror exists
    // for — a flush that lands first writes an empty profile over the good
    // file, stamped newer, and recover() then "restores" the page from what
    // it just destroyed. Nothing may reach the file until recover() has said
    // which side wins.
    if (!reconciled) { mirrorPending = true; return; }
    if (mirrorTimer) clearTimeout(mirrorTimer);
    mirrorTimer = setTimeout(flushMirror, MIRROR_DELAY);
  }
  /**
   * The file is there and unreadable: keep it exactly as it is for the rest of
   * this session. The cache is what the app runs on, and it is still the cache
   * on the next launch, so nothing the player does is lost by not mirroring —
   * what would be lost is the damaged file itself, which is the only thing a
   * recovery could be attempted from.
   */
  function blockMirror() {
    mirrorBlocked = true;
    mirrorPending = false;
    if (mirrorTimer) { clearTimeout(mirrorTimer); mirrorTimer = null; }
    fail("appdataCorrupt");
  }

  /** recover() is done (or was never possible): let the mirror run. */
  function releaseMirror() {
    reconciled = true;
    if (mirrorPending) { mirrorPending = false; scheduleMirror(); }
  }
  /** Write the whole profile to the native file now. @returns {Promise<boolean>} */
  async function flushMirror() {
    mirrorTimer = null;
    if (!mirrorEnabled || mirrorBlocked) return false;
    try {
      const ok = await host.appdataWrite(JSON.stringify(mirrorDoc()));
      // null: the shell has no such file (no data dir, an older build) —
      // the mirror simply does not exist here, which is not a failed write
      if (ok == null) { mirrorEnabled = false; return false; }
      if (ok === false) fail("appdata");
      return ok !== false;
    } catch (_) {
      // an absent bridge (a browser, a test) is not a failure of the profile;
      // a bridge that is there and refuses is
      if (host.hasZero && host.hasZero()) fail("appdata");
      else mirrorEnabled = false;
      return false;
    }
  }
  /** Is a document one of ours, in a shape we can restore from? */
  function isProfileDoc(doc) {
    return !!doc && doc.app === "chessboard" && doc.keys && typeof doc.keys === "object";
  }
  /**
   * Adopt the native file when it knows more than the cache does.
   * @returns {Promise<"kept"|"restored"|"none">} "restored" means storage
   *   was rewritten from the file and the caller should reload the page
   */
  async function recover() {
    // 6.1: whatever happens below, the mirror gate opens exactly once on the
    // way out — a recover() that returns early must not leave the file
    // unwritable for the rest of the session.
    try { return await recoverInner(); }
    finally { if (!frozen) releaseMirror(); else reconciled = true; }
  }
  async function recoverInner() {
    if (typeof host.appdataRead !== "function") return "none";
    let text = null, empty = false;
    // host.js answers {text,bak} | {missing:true} | {empty:true} | null; a
    // plain string is also accepted so a test host can be a one-liner
    try {
      const r = await host.appdataRead();
      if (typeof r === "string") text = r;
      else if (r && typeof r.text === "string") text = r.text;
      else if (r && r.empty) empty = true;
    } catch (_) { return "none"; }
    // 6.1: a file that exists and holds nothing is damage, not a fresh
    // install — an interrupted write leaves exactly that. Say so, and do not
    // let the cache quietly overwrite it as if nothing had happened.
    if (empty) { blockMirror(); return "corrupt"; }
    if (!text) { if (bag && !foundEmpty) scheduleMirror(); return "none"; }
    let doc = null;
    try { doc = JSON.parse(text); } catch (_) { doc = null; }
    // 6.1: unreadable file. Before 6.1 this returned "none" in silence, left
    // the broken file in place and never told anyone. Report it, and keep the
    // cache: overwriting the file is the caller's decision, not this one's.
    if (!doc || !isProfileDoc(doc)) { blockMirror(); return "corrupt"; }
    const cacheAt = Number(host.storageGet(STAMP_KEY) || 0) || 0;
    const fileAt = Number(doc.writtenAt) || 0;
    // the cache wins whenever it has anything and is not provably older: a
    // file must not undo what the player did in a session the file missed
    if (!foundEmpty && (!cacheAt || fileAt <= cacheAt)) { scheduleMirror(); return "kept"; }
    if (!restoreAll(doc)) return "corrupt";
    // 6.1: storage now holds the file's profile but the page still holds the
    // old one. Freeze until the caller reloads onto it.
    freeze();
    return "restored";
  }

  /** Every key, as one document — the whole profile, for export. */
  function exportAll() { return mirrorDoc(); }
  /** Replace storage with a document from exportAll() / the mirror. */
  function restoreAll(doc) {
    if (!isProfileDoc(doc)) throw new Error("not a chessboard profile");
    // 6.1: every one of these was fired and forgotten. A restore is the
    // largest write the app ever makes, so it is the most likely to hit the
    // quota; a half-written profile was then re-read and mirrored back over
    // the complete file. Now a refused write latches the failure and the
    // caller is told, so nothing downstream treats the result as a profile.
    let ok = true;
    for (const name of Object.keys(KEYS)) {
      // the quarantine is evidence about this cache, not part of the profile
      // being restored into it (6.1) — see read()
      if (name === "quarantine") continue;
      const v = doc.keys[name];
      if (typeof v === "string") { if (!host.storageSet(KEYS[name], v)) ok = false; }
      else host.storageRemove(KEYS[name]);
    }
    if (!host.storageSet(SCHEMA_KEY, String(doc.schema || SCHEMA))) ok = false;
    if (!host.storageSet(STAMP_KEY, String(Number(doc.writtenAt) || Date.now()))) ok = false;
    bag = null;
    load();
    if (!ok) fail("restore");
    return ok;
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
    // 6.1: the quarantine is evidence about values this cache could not read.
    // Clearing the profile must not also destroy it.
    for (const name of Object.keys(KEYS)) if (name !== "quarantine") remove(name);
    host.storageRemove(SCHEMA_KEY);
    host.storageRemove(STAMP_KEY);
    scheduleMirror();
  }

  /** Has a write failed in this session? Then what is on screen is not saved. */
  function isBroken() { return !!broken; }

  /**
   * Read a key and vouch for its shape, or say what went wrong.
   *
   * Every reader in app.js used to be `try { JSON.parse(...) } catch (_) {}`
   * followed by a fresh default — so a corrupt value looked exactly like a new
   * install, and the next autosave wrote the fresh default over whatever the
   * corrupt value still contained. A read that fails is now told apart from a
   * read that finds nothing, the raw value is moved to the quarantine key so
   * nothing overwrites it, and the app is told once so it can say so.
   *
   * @param {string} name        key name
   * @param {(parsed: any) => any} accept returns the usable value, or null/
   *   undefined when the parsed JSON is not the shape this key holds
   * @returns {{value: any, state: "fresh"|"ok"|"corrupt"}}
   */
  let corrupt = [];
  /**
   * What each profile key is expected to hold. These used to be written inline
   * at ten call sites in app.js (v6-plan Q1.7); a key's shape is a fact about
   * the stored data, so it is kept here, next to the code that reads it, and
   * `read(name)` without an `accept` uses it.
   */
  const ACCEPT = {
    settings: (v) => (v && typeof v === "object" ? v : null),
    save: (v) => (v && v.v === 1 && typeof v.pgn === "string" && v.pgn ? v : null),
    learn: (v) => (v && v.v === 1 && v.done ? v : null),
    mines: (v) => (v && v.v === 1 && Array.isArray(v.list) ? v : null),
    progress: (v) => (v && typeof v === "object" ? v : null),
    puzzles: (v) => (v && v.v === 1 && v.solved ? v : null),
    stats: (v) => (v && (v.v === 2 || v.v === 1) && Array.isArray(v.games) ? migrateStats(v) : null),
    achievements: (v) => (v && Array.isArray(v.seen) ? v : null),
    slots: (v) => (v && Array.isArray(v.slots) ? v : null),
  };
  /**
   * stats v1 → v2: split the overloaded `sig` into the three things it was.
   * Reading it apart is safe — unlike an id remap, this derives nothing about
   * *which* game a record is, it only unpacks what was already stored in it.
   */
  function migrateStats(s) {
    if (s.v === 2) return s;
    return {
      v: 2,
      games: s.games.map((g, i) => {
        const sig = String(g.sig || "");
        const m = /#([a-zA-Z]+)$/.exec(sig);
        return Object.assign({}, g, {
          id: g.id || ("v1-" + (g.t || 0).toString(36) + "-" + i.toString(36)),
          pgn: g.pgn != null ? g.pgn : sig.replace(/#[a-zA-Z]+$/, ""),
          ending: g.ending != null ? g.ending : (m ? m[1] : ""),
          sig: undefined,
        });
      }),
    };
  }
  function read(name, accept) {
    if (!accept) accept = ACCEPT[name];
    if (typeof accept !== "function") throw new Error("read: no shape known for " + name);
    const raw = get(name);
    if (raw == null || raw === "") return { value: null, state: "fresh" };
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) { parsed = undefined; }
    let value = null;
    if (parsed !== undefined) {
      try { value = accept(parsed); } catch (_) { value = null; }
    }
    if (value != null) return { value, state: "ok" };
    quarantine(name, raw);
    return { value: null, state: "corrupt" };
  }

  /**
   * Keep a value that could not be read, so a later version (or the user) can.
   *
   * 6.1 closed three ways this used to lose the very thing it was keeping:
   *   * the same unreadable key was pushed again on every launch, and eight
   *     launches of one bad key evicted every genuinely distinct entry;
   *   * quarantining doubles the footprint of the bad value, so on the full
   *     quota that very likely caused the damage the write failed and the raw
   *     value was not kept at all — while read() still reported "corrupt";
   *   * `quarantine` sits in KEYS, so clearAll() removed it and restoreAll()
   *     overwrote it. Both now leave it alone (see those two functions).
   */
  function quarantine(name, raw) {
    corrupt.push(name);
    let list = [];
    try { list = JSON.parse(get("quarantine") || "[]"); } catch (_) { list = []; }
    if (!Array.isArray(list)) list = [];
    // the same value from the same key is the same evidence, not new evidence
    if (list.some((e) => e && e.name === name && e.raw === raw)) return;
    list.push({ name, raw, at: Date.now() });
    // bounded: a profile that keeps failing must not grow without limit.
    // Drop from the front, but never the entry just pushed.
    while (list.length > 8) list.shift();
    if (!set("quarantine", JSON.stringify(list))) {
      // no room to keep a copy. Say so rather than report a preserved value
      // that was never written.
      fail("quarantine");
    }
  }

  /** Names of the keys that failed to read this session, in order. */
  function corruptKeys() { return corrupt.slice(); }

  return { load, get, read, set, setJson, remove, clearAll, isBroken, wasEmpty, corruptKeys,
    recover, flushMirror, exportAll, restoreAll, isProfileDoc, migrateStats, freeze, releaseMirror,
    ACCEPT, KEYS, SCHEMA };
}
