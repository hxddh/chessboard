/**
 * The one door to stored state.
 *
 * Every key the app stores, its expected shape, the profile's one schema
 * number, and a "clear the save" that cannot forget a key. 缺陷 33.
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
  save: "chess.save",
  settings: "chess.settings",
  stats: "chess.stats",
  learn: "chess.learn",
  puzzles: "chess.puzzles",
  mines: "chess.mines",
  progress: "chess.progress",
  achievements: "chess.achv",
  slots: "chess.slots",
  // 7.0: the imported games library and their offline analyses. Its own key
  // and not part of `stats`, because it is much the largest thing this app
  // stores (a few hundred games with a per-ply loss array each) and a quota
  // failure writing it must not take the play history down with it.
  library: "chess.library",
  // 7.2: the player's own opening book. Its own key for the same reason the
  // library has one — it is imported data with its own lifetime, and it is
  // the one thing here a player may want to clear on its own.
  repertoire: "chess.repertoire",
  // 7.6: finished board analyses, by game (analysis-store.js). Its own key
  // for the library's reason: the largest-but-one thing stored, and a quota
  // failure writing it must not take the save down with it.
  analyses: "chess.analyses",
  // v8-0-plan C2: 允许联网同步 and the last site / user name asked for
  // (sync-ui.js). A key of its own so 清除全部存档 takes the name with it.
  sync: "chess.sync",
  panelOpen: "chess.panelOpen",
  // 6.0: where a value that failed to parse is kept, instead of being thrown
  // away and overwritten by the next autosave (v6-plan D2)
  quarantine: "chess.quarantine",
};

/** Where the profile's schema version lives — the one number, not eight. */
export const SCHEMA_KEY = "chess.schema";
/** When the cache last changed — what recover() compares against the file. */
export const STAMP_KEY = "chess.writtenAt";
/**
 * The packaged app's self-test marker (app.js runSelftest). Deliberately not
 * in KEYS: it is not part of the profile, so it is never mirrored to the
 * native file or restored from it — a restart check that the file could
 * answer would not be a check of localStorage.
 */
export const SELFTEST_KEY = "chess.selftest";

/**
 * The profile's schema version. 9.0 started the profile over (v9-0-plan §H):
 * nothing written by an earlier version is read.
 */
export const SCHEMA = 3;

/**
 * v8-0-plan F3: the per-key store's manifest — {app, schema, writtenAt, keys,
 * files} where `keys` lists the keys that hold the profile as of `writtenAt`
 * and `files` names the file each one is in. Written after the key files of a
 * flush, so it never names a file that the flush it describes did not reach.
 */
export const STORE_META = "meta";

/**
 * Each key has two files, `<key>` and `<key>-b`, and a flush writes the one
 * the manifest on disk is not pointing at (Codex on #85). Until the manifest
 * is replaced the old generation is untouched, so an exit halfway through a
 * restore or a clear leaves the store holding the old profile whole — never
 * some keys of each. The manifest write is the commit.
 */
export const STORE_ALT = "-b";

/**
 * v8-0-plan C1: the library's games, as store keys that are not KEYS.
 *
 * The games moved from one localStorage value to one IndexedDB record each
 * (library-db.js), and IndexedDB is the WebView's, exactly like localStorage:
 * "remove website data" takes it. So they are mirrored here as well — in 64
 * shards, "lib00" … "lib3f", each a key of the per-key store with its two
 * slots, listed in the same manifest, written under the same lock. What is
 * different is only where the value comes from: not the bag, but the port
 * the library attaches (attachBulk), which serialises a shard when a flush
 * asks for it. The header (`library`) stays a KEY like any other.
 *
 * v8-1-plan T3: the repertoire's records (rep-page.js) went into the same
 * IndexedDB, and ride here the same way in four shards, "rep0" … "rep3",
 * behind a port of their own. A shard's first three letters say whose it is
 * (`bulkKind`); each owner attaches its port under that kind.
 */
export const BULK = /^(lib[0-3][0-9a-f]|rep[0-3])$/;
/** Whose port serves shard `name`: "lib" or "rep". */
const bulkKind = (name) => String(name).slice(0, 3);

/**
 * v8-1-plan F3: `fn()`, timed for a test's `__persistProbe(name, ms)` when one
 * is installed (host.js has the same) — the breakdown of a long slice after
 * a bridge answer on an engine CI runs and this machine cannot profile.
 */
function timed(name, fn) {
  const probe = globalThis.__persistProbe;
  if (typeof probe !== "function") return fn();
  const t = performance.now();
  try { return fn(); } finally { probe(name, performance.now() - t); }
}

/** Is `m` a manifest this app wrote? */
export function isStoreMeta(m) {
  return !!m && m.app === "chessboard" && Array.isArray(m.keys) &&
    m.keys.every((k) => typeof k === "string") && Number.isFinite(Number(m.writtenAt)) &&
    !!m.files && typeof m.files === "object" &&
    m.keys.every((k) => m.files[k] === k || m.files[k] === k + STORE_ALT);
}

/** The file each listed key of manifest `m` is in. */
export function storeFiles(m) {
  const files = {};
  for (const name of m.keys) files[name] = m.files[name];
  return files;
}

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
  let foundAt = null;

  /**
   * Read every key, once.
   *
   * One pass at startup instead of scattered reads, so the rest of the app
   * never has to wonder whether some other key has been touched since.
   */
  function load() {
    bag = {};
    for (const [name, key] of Object.entries(KEYS)) bag[name] = host.storageGet(key);
    // long before anything writes: the profile as it was found. panelOpen is
    // excluded — it is a window preference, not evidence that somebody has
    // played.
    foundEmpty = Object.entries(bag)
      .every(([name, v]) => name === "panelOpen" || v == null);
    // v8-0-plan F3: the revision the cache was at when first found. The boot
    // path writes (settings, the save) while recover()'s read is still on the
    // bridge, so by the time recover() compares, the live stamp has always
    // moved; what says "the store already holds this profile" is the stamp
    // as found. The boot writes themselves are dirty and flush as usual.
    if (foundAt == null) foundAt = Number(host.storageGet(STAMP_KEY) || 0) || 0;
    if (host.storageGet(SCHEMA_KEY) !== String(SCHEMA)) host.storageSet(SCHEMA_KEY, String(SCHEMA));
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
    // v8-0-plan F3: the value that is already stored is not a change. Every
    // quit calls saveGame() twice (beforeunload, then pagehide) with the same
    // game; each used to re-stamp the cache, so the store's manifest was
    // always a revision behind and every launch rewrote the whole store.
    // Read back rather than trusted from the bag, so storage cleared under the
    // page still gets written.
    if (bag && bag[name] === value && host.storageGet(key) === value) return true;
    const ok = host.storageSet(key, value);
    if (!bag) bag = {};
    if (ok) {
      bag[name] = value;
      dirty.add(name);
      // (Codex on #85) written again after a remove(): no longer removed, or
      // the flush would null the files of the value it just committed
      removed.delete(name);
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
  // also written to files the shell owns in the user's application-data
  // directory (host.appdataWriteKey, atomic with a .bak): one per key plus a
  // manifest, and a flush writes only the keys that changed (v8-0-plan F3,
  // see flushKeys). localStorage stays the synchronous cache the app boots
  // from; the files are what survives. The two are reconciled once, at
  // startup, by recover(): when the cache is empty or older than the store,
  // the store wins and the page reloads onto it — the one moment the async
  // read is allowed to change what the app is standing on.
  // ------------------------------------------------------------------------
  const MIRROR_DELAY = 400; // ms; every autosave in a burst becomes one write
  let mirrorTimer = null;
  // the per-key store, when the host offers one
  const keyed = typeof host.appdataReadKey === "function" && typeof host.appdataWriteKey === "function";
  let mirrorEnabled = keyed;
  // 6.1: no write reaches the file before recover() has reconciled the two
  // copies; with no store there is nothing to reconcile, so the gate is open
  // from the start.
  let reconciled = !keyed;
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
  // keys whose cache value the store has not been given yet (set, remove,
  // restoreAll add to it; a flush takes it)
  const dirty = new Set();
  // of those, the ones remove() emptied — their files still hold the old value
  const removed = new Set();
  // key → file, as the manifest on disk has it; null until this session has
  // read the manifest (recover) or written one. See STORE_ALT.
  let committed = null;
  // one flush at a time: flushMirror() queues behind the one in flight
  let flushChain = Promise.resolve(true);
  // v8-0-plan C1: the library's port — {names() → shard names holding games
  // (null until the library has loaded), read(name) → a shard's text or null,
  // restore(texts) → Promise, clear()}. See BULK. v8-1-plan T3: one port per
  // kind ("lib", "rep"), each answering for its own shards only.
  const ports = {};
  const portOf = (name) => ports[bulkKind(name)] || null;
  const portList = () => Object.keys(ports).map((k) => [k, ports[k]]);
  // "every shard is owed", waiting for each port to say which shards exist;
  // the kinds already expanded since it was set
  let bulkAll = false;
  let bulkDone = new Set();
  // shard texts a restore brought, until the reload: what a flush writes for
  // them, instead of the library the page is still holding
  let bulkOverride = null;
  // the restore's write into IndexedDB, which the reload must not outrun
  let bulkRestoring = null;
  function markAllDirty() { for (const name of Object.keys(KEYS)) dirty.add(name); bulkAll = true; bulkDone = new Set(); }
  /** A dirty name's value for the store: undefined = not known yet (keep it owed). */
  function valueOf(name) {
    if (!BULK.test(name)) return bag ? bag[name] : null;
    if (bulkOverride && bulkOverride.has(name)) return bulkOverride.get(name);
    const port = portOf(name);
    return port && timed("shardNames", () => port.names()) ? timed("shardText", () => port.read(name)) : undefined;
  }
  /** Expand "every shard is owed", port by port, once each can name its shards. */
  function expandBulk() {
    if (!bulkAll) return;
    for (const [kind, port] of portList()) {
      if (bulkDone.has(kind) || !port.names()) continue;
      bulkDone.add(kind);
      for (const name of port.names()) dirty.add(name);
      // a shard the store still lists and the owner no longer fills is
      // owed too — as a removal
      for (const name of Object.keys(committed || {})) if (BULK.test(name) && bulkKind(name) === kind) dirty.add(name);
    }
  }
  /** The revision stamp the cache carries, made if it has none. */
  function stamp() {
    // the same revision stamp the cache carries (set() wrote it before
    // scheduling this): a mirror stamped a few hundred ms later than the
    // cache would read as "the file knows more" on the next launch, and
    // recover() would rewrite storage and reload after every ordinary session
    let at = Number(host.storageGet(STAMP_KEY) || 0) || 0;
    if (!at) { at = Date.now(); host.storageSet(STAMP_KEY, String(at)); }
    return at;
  }
  function mirrorDoc() {
    const keys = {};
    for (const name of Object.keys(KEYS)) if (bag && bag[name] != null) keys[name] = bag[name];
    // v8-0-plan C1: the library's games are part of the profile
    for (const [, port] of portList()) {
      const shards = port.names();
      if (shards) for (const name of shards) { const v = port.read(name); if (v != null) keys[name] = v; }
    }
    return { app: "chessboard", schema: SCHEMA, writtenAt: stamp(), keys };
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
  /**
   * Bring the native copy up to date now: only the keys that changed, then
   * the manifest — a move writes the save, not the library (v8-0-plan F3).
   * @returns {Promise<boolean>}
   */
  function flushMirror() {
    if (mirrorTimer) { clearTimeout(mirrorTimer); mirrorTimer = null; }
    if (!mirrorEnabled || mirrorBlocked) return Promise.resolve(false);
    // one flush at a time on this page, and — with the store's lock — across
    // every window sharing the store (host.js withStoreLock, Codex on #85)
    const locked = () => (typeof host.withStoreLock === "function" ? host.withStoreLock(flushKeys) : flushKeys());
    // v8-0-plan C1: a restore's games reach IndexedDB before anything else
    // happens — the callers reload once this settles
    const before = bulkRestoring ? flushChain.then(() => bulkRestoring).catch(() => {}) : flushChain;
    const run = before.then(locked, locked);
    flushChain = run;
    return run;
  }

  /**
   * One flush of the per-key store.
   *
   * Everything it writes is taken at its start — the dirty names, their
   * values, the revision stamp, the list of keys that hold anything — before
   * the first await. A set() landing while this is on the bridge is dirty
   * again and makes the cache's stamp newer than this manifest's, so the next
   * flush (or, after a crash, the next launch's resync) picks it up; nothing
   * written here can claim a revision it does not hold.
   */
  async function flushKeys() {
    if (!mirrorEnabled || mirrorBlocked) return false;
    expandBulk();
    if (!dirty.size) return true;
    const gone = new Set(removed);
    const values = [];
    // per kind: a port that can name its shards (v8-1-plan T3)
    const known = {};
    const shardsKnown = (name) => {
      const k = bulkKind(name);
      if (!(k in known)) { const port = portOf(name); known[k] = !!(port && port.names()); }
      return known[k];
    };
    for (const name of dirty) {
      // a shard is serialised when its turn to be written comes, not here:
      // sixty-four of them at once held the main thread for 30 ms at 2 MB
      // (the F3 line is 16). Newer than the stamp at worst, never older —
      // a change after this point marks it dirty again anyway.
      if (BULK.test(name)) {
        // a shard the library cannot serialise yet (not loaded) stays owed,
        // and the manifest keeps whatever file it already names
        if (!shardsKnown(name) && !(bulkOverride && bulkOverride.has(name))) continue;
        values.push([name, undefined]);
        continue;
      }
      values.push([name, valueOf(name)]);
    }
    const names = values.map(([name]) => name);
    if (!names.length && !gone.size) return true;
    for (const name of names) dirty.delete(name);
    removed.clear();
    const meta = { app: "chessboard", schema: SCHEMA, writtenAt: stamp(), keys: [] };
    try {
      // (Codex on #85) the manifest on disk, read fresh: a second window
      // (two instances share one store) may have committed since this one
      // last looked, and a slot picked from a stale map could be the file
      // that window's manifest names
      const before = await readDisk();
      const base = before.missing ? committed || {} : before.files;
      // the new generation: every changed key into the file the manifest on
      // disk does not name (STORE_ALT). Nothing the old manifest points at
      // is touched before the new one replaces it.
      const written = {};
      for (const [name, v0] of values) {
        const value = v0 === undefined ? valueOf(name) : v0;
        // a shard the library emptied is a removal, like remove()'s
        if (value == null) { if (BULK.test(name)) gone.add(name); continue; }
        const file = base[name] === name ? name + STORE_ALT : name;
        const ok = await host.appdataWriteKey(file, value);
        if (ok == null) { mirrorEnabled = false; return false; }
        written[name] = file;
      }
      // Commit against the manifest as it is now: this flush's keys are
      // ours, every other key is whatever the last commit — possibly another
      // window's — says it is. The store lock (flushMirror) keeps another
      // window's whole flush out from between this read and the write.
      const now = await readDisk();
      const cur = now.missing ? base : now.files;
      const flushed = new Set(names);
      const files = {};
      // the library's shards (BULK) ride along: this flush's, and every
      // other one the manifest on disk lists
      const shardNames = Object.keys(written).concat(Object.keys(cur)).filter((n) => BULK.test(n));
      for (const name of new Set(Object.keys(KEYS).concat(shardNames))) {
        if (written[name]) files[name] = written[name];
        else if (!flushed.has(name) && cur[name]) files[name] = cur[name];
      }
      meta.keys = Object.keys(files);
      meta.files = files;
      const ok = await host.appdataWriteKey(STORE_META, timed("manifest", () => JSON.stringify(meta)));
      if (ok == null) { mirrorEnabled = false; return false; }
      committed = files;
      // committed: now a removed key's files can go, so a cleared profile
      // does not stay on disk. "null" is never read back — the manifest no
      // longer lists the key. A key that is simply empty has nothing to clear.
      // Asked of the manifest on disk, not assumed from ours: a second window
      // may have written the key again and committed since (Codex on #85).
      const after = gone.size ? (await readDisk()).files : {};
      for (const name of gone) {
        if (after[name]) continue;
        for (const file of [name, name + STORE_ALT]) {
          if ((await host.appdataWriteKey(file, "null")) == null) { mirrorEnabled = false; return false; }
        }
      }
      return true;
    } catch (_) {
      // not written: they stay owed to the next flush
      for (const name of names) dirty.add(name);
      for (const name of gone) removed.add(name);
      if (host.hasZero && host.hasZero()) fail("appdata");
      else mirrorEnabled = false;
      return false;
    }
  }

  /**
   * The manifest on disk, as its key → file map. A store with no manifest
   * has nothing committed.
   * @returns {Promise<{files: object, missing: boolean}>}
   */
  async function readDisk() {
    const r = await host.appdataReadKey(STORE_META);
    if (r && r.missing) return { files: {}, missing: true };
    let m = null;
    try { m = r && typeof r.text === "string" ? timed("readMeta", () => JSON.parse(r.text)) : null; } catch (_) { m = null; }
    if (isStoreMeta(m)) return { files: storeFiles(m), missing: false };
    // not knowing which files the store's profile is in, writing any of them
    // could break it: the flush fails and its keys stay owed
    throw new Error("store manifest unreadable");
  }

  /** Is a document one of ours, in a shape we can restore from? */
  function isProfileDoc(doc) {
    return !!doc && doc.app === "chessboard" && Number(doc.schema) === SCHEMA && !!doc.keys && typeof doc.keys === "object";
  }
  /**
   * Adopt the native file when it knows more than the cache does.
   * @returns {Promise<"kept"|"restored"|"none">} "restored" means storage
   *   was rewritten from the file and the caller should reload the page
   */
  async function recover() {
    // v8-0-plan F3: unless the store is provably at the cache's revision,
    // every key is owed to it — a store written by nothing yet, one a crash
    // or a failed write left behind, or one this launch could not read.
    // Rewriting it whole is the one answer that is right in all of those.
    let inSync = false;
    // 6.1: whatever happens below, the mirror gate opens exactly once on the
    // way out — a recover() that returns early must not leave the file
    // unwritable for the rest of the session.
    try {
      const r = await recoverInner();
      inSync = r === "in-sync";
      return inSync ? "kept" : r;
    } finally {
      if (keyed && !inSync) markAllDirty();
      if (!frozen) releaseMirror(); else reconciled = true;
    }
  }

  /**
   * v8-0-plan F3: the per-key store, through its manifest. Its key files are
   * read only when the store wins — on an ordinary launch the manifest's
   * stamp is all recover() needs.
   */
  async function readStore() {
    let r;
    try { r = await host.appdataReadKey(STORE_META); } catch (_) { return { failed: true }; }
    // no manifest: this store has never been written
    if (r && r.missing) { committed = {}; return { none: true }; }
    if (r && r.empty) return { damaged: true };
    // (Codex on #85) anything but an explicit "missing" without text is a
    // read that did not happen — host.js answers null for a bridge error as
    // much as for no bridge. "No store" here would let the boot's defaults
    // be flushed over a profile the next launch could still restore.
    if (!r || typeof r.text !== "string") return { failed: true };
    let meta = null;
    try { meta = JSON.parse(r.text); } catch (_) { meta = null; }
    if (!isStoreMeta(meta)) return { damaged: true };
    committed = storeFiles(meta);
    return {
      at: Number(meta.writtenAt) || 0,
      // (Codex on #85) the files one manifest names, read against that same
      // manifest: a commit from another window while this reads (a large
      // key takes several bridge calls) means reading again from the new
      // one, never stitching two generations into one profile
      load: async () => {
        let text = r.text, m = meta;
        for (let tries = 0; tries < 3; tries++) {
          const files = storeFiles(m);
          const keys = {};
          for (const name of m.keys) {
            if (!KEYS[name] && !BULK.test(name)) continue;   // a key a later version added
            const v = await host.appdataReadKey(files[name]);
            // a key the manifest lists and the store cannot produce is damage
            if (!v || typeof v.text !== "string") return null;
            keys[name] = v.text;
          }
          const again = await host.appdataReadKey(STORE_META);
          if (again && again.text === text) {
            committed = files;
            return { app: "chessboard", schema: Number(m.schema) || SCHEMA, writtenAt: m.writtenAt, keys };
          }
          let next = null;
          try { next = again && typeof again.text === "string" ? JSON.parse(again.text) : null; } catch (_) { next = null; }
          if (!isStoreMeta(next)) return null;
          text = again.text; m = next;
        }
        return null;
      },
    };
  }

  async function recoverInner() {
    if (!keyed) return "none";
    const src = await readStore();
    // the file could not be read, so which side is newer is unknown: leave it
    // alone for this session. The cache keeps everything; the next launch
    // asks again.
    if (src.failed) { mirrorEnabled = false; return "none"; }
    // 6.1: damage — an empty file, one that does not parse, one that is not
    // ours. Before 6.1 this returned "none" in silence, left the broken file
    // in place and never told anyone. Report it, and keep the cache:
    // overwriting the file is the caller's decision, not this one's.
    if (src.damaged) { blockMirror(); return "corrupt"; }
    if (src.none) { if (bag && !foundEmpty) scheduleMirror(); return "none"; }
    const cacheAt = Number(host.storageGet(STAMP_KEY) || 0) || 0;
    // the cache wins whenever it has anything and is not provably older: a
    // file must not undo what the player did in a session the file missed
    if (!foundEmpty && (!cacheAt || src.at <= cacheAt)) {
      scheduleMirror();
      return foundAt && src.at === foundAt ? "in-sync" : "kept";
    }
    const doc = await src.load();
    if (!doc || !isProfileDoc(doc)) { blockMirror(); return "corrupt"; }
    if (!restoreAll(doc)) return "corrupt";
    // 6.1: storage now holds the file's profile but the page still holds the
    // old one. Freeze until the caller reloads onto it.
    freeze();
    // v8-0-plan C1: …and the library's games are in IndexedDB before the
    // caller is told to reload. A refused write is not the end of them: the
    // store still holds the shards, and the library pulls them back when it
    // finds fewer games than its header counts (library-ui.js).
    await bulkSettled();
    return "restored";
  }

  /** v8-0-plan C1: resolves once a restore's games have reached IndexedDB. */
  function bulkSettled() { return Promise.resolve(bulkRestoring).then(() => true, () => false); }

  /**
   * v8-0-plan C1: the library attaches its port (see BULK); v8-1-plan T3: the
   * repertoire attaches its own under `kind` "rep".
   */
  function attachBulk(port, kind) { ports[kind || "lib"] = port; }

  /**
   * v8-0-plan C1: these shards changed. Stamped and mirrored like set(): the
   * values themselves are read from the port when the flush runs.
   */
  function touchBulk(names) {
    if (frozen) return true;
    for (const name of names) { if (BULK.test(name)) { dirty.add(name); removed.delete(name); } }
    if (!host.storageSet(STAMP_KEY, String(Date.now()))) { fail("library"); return false; }
    scheduleMirror();
    return true;
  }

  /**
   * v8-0-plan C1: the library's shards as the native store holds them now
   * ({name: text}), for a library that finds IndexedDB emptier than its
   * header says — the WebView's data went, the store's did not.
   * @returns {Promise<object|null>} null when there is no store to ask
   */
  function readBulk(kind) {
    if (!keyed) return Promise.resolve(null);
    // under the store's lock, so no other window's commit lands between the
    // manifest and the files it names
    const inner = () => readBulkInner(kind);
    return typeof host.withStoreLock === "function" ? host.withStoreLock(inner) : inner();
  }
  /** `kind` (v8-1-plan T3): only that owner's shards; omitted, every shard. */
  async function readBulkInner(kind) {
    try {
      const r = await host.appdataReadKey(STORE_META);
      let m = null;
      try { m = r && typeof r.text === "string" ? JSON.parse(r.text) : null; } catch (_) { m = null; }
      if (!isStoreMeta(m)) return null;
      const files = storeFiles(m);
      const out = {};
      for (const name of m.keys) {
        if (!BULK.test(name) || (kind && bulkKind(name) !== kind)) continue;
        const v = await host.appdataReadKey(files[name]);
        if (!v || typeof v.text !== "string") return null;
        out[name] = v.text;
      }
      return out;
    } catch (_) { return null; }
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
      else { host.storageRemove(KEYS[name]); removed.add(name); }
      // v8-0-plan F3: the whole profile changed, so the whole store is owed
      dirty.add(name);
    }
    // v8-0-plan C1: the library's games — into IndexedDB (the port), and into
    // the store from the document itself, not from the library the page is
    // still holding. A shard the document does not have is emptied.
    const texts = {};
    for (const [name, v] of Object.entries(doc.keys)) if (BULK.test(name) && typeof v === "string") texts[name] = v;
    bulkOverride = new Map(Object.entries(texts));
    const stale = Object.keys(committed || {});
    for (const [, port] of portList()) stale.push(...(port.names() || []));
    for (const name of stale) if (BULK.test(name) && !bulkOverride.has(name)) bulkOverride.set(name, null);
    for (const name of bulkOverride.keys()) dirty.add(name);
    // each owner is handed its own shards (v8-1-plan T3)
    const restoring = portList().filter(([, port]) => port.restore).map(([kind, port]) => {
      const mine = {};
      for (const name of Object.keys(texts)) if (bulkKind(name) === kind) mine[name] = texts[name];
      return Promise.resolve().then(() => port.restore(mine));
    });
    bulkRestoring = restoring.length ? Promise.all(restoring) : null;
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
    dirty.add(name);
    removed.add(name);
    // (Codex on #85) a removal is a change like set()'s: stamp it and let
    // the mirror carry it. Unstamped, clearing the statistics on its own
    // left the store's manifest at the cache's revision, listing the old
    // statistics — recover() saw the two in sync, and after the cache was
    // lost the "cleared" history came back from the file.
    // (Frozen after a restore, the stamp is the restored profile's and stays.)
    if (frozen) return;
    if (!host.storageSet(STAMP_KEY, String(Date.now()))) fail(name);
    scheduleMirror();
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
    // v8-0-plan C1: the library's games are in IndexedDB and in the shards
    // the store lists; "clear my data" takes both
    const names = Object.keys(committed || {});
    for (const [, port] of portList()) {
      names.push(...(port.names() || []));
      if (port.clear) port.clear();
    }
    for (const name of names) {
      if (BULK.test(name)) { dirty.add(name); removed.add(name); }
    }
    scheduleMirror();
  }

  /** Has a write failed in this session? Then what is on screen is not saved. */
  function isBroken() { return !!broken; }

  /**
   * Swap the self-test marker (SELFTEST_KEY) for `next`: what was there
   * before, and whether `next` was written and reads back.
   * @returns {{found: string|null, stored: boolean}}
   */
  function swapSelftestMarker(next) {
    const found = host.storageGet(SELFTEST_KEY);
    const stored = host.storageSet(SELFTEST_KEY, next) !== false && host.storageGet(SELFTEST_KEY) === next;
    return { found, stored };
  }

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
    stats: (v) => (v && v.v === 2 && Array.isArray(v.games) ? vetStatsRating(v) : null),
    achievements: (v) => (v && Array.isArray(v.seen) ? v : null),
    slots: (v) => (v && Array.isArray(v.slots) ? v : null),
    library: (v) => (v && v.v === 1 && Array.isArray(v.names) ? v : null),
    repertoire: (v) => (v && v.v === 1 && (Array.isArray(v.w) || Array.isArray(v.b)) ? v : null),
    analyses: (v) => (v && v.v === 1 && Array.isArray(v.list) ? v : null),
    sync: (v) => (v && v.v === 1 ? v : null),
  };
  /**
   * v8-0-plan B4: stats may carry the engine-game rating, `{r, rd, vol, at,
   * n}` (opponents.js fileRating). A rating that is not one is dropped rather
   * than failing the whole record — the games are the valuable part, and the
   * rating is rebuilt from them.
   */
  function vetStatsRating(s) {
    const r = s.rating;
    if (r === undefined) return s;
    const ok = r && typeof r === "object" && [r.r, r.rd, r.vol].every((x) => typeof x === "number" && Number.isFinite(x)) &&
      r.rd > 0 && r.vol > 0;
    if (ok) return s;
    const out = Object.assign({}, s);
    delete out.rating;
    return out;
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

  return { load, get, read, set, setJson, remove, clearAll, isBroken, swapSelftestMarker, wasEmpty, corruptKeys,
    recover, flushMirror, exportAll, restoreAll, isProfileDoc, freeze, releaseMirror,
    attachBulk, touchBulk, readBulk, bulkSettled, ACCEPT, KEYS, SCHEMA,
    /**
     * is there a native per-key store (readBulk's null then means a failed read, not "none").
     * v8-2-plan T4: host.js always has the two functions; without the native
     * shell they answer null — no store at all, which a reader must not wait on
     */
    hasStore: () => keyed && !!(host.hasZero && host.hasZero()) };
}
