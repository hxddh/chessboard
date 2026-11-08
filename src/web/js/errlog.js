/**
 * 19.1 G4: the page's uncaught errors, kept on disk.
 *
 * Until 19.1 an uncaught error showed the fault banner and was then gone: on
 * a real machine nothing was left to read afterwards. 20.0 broke on real
 * machines and left no trace at all. Now the last few are written beside the
 * profile, under the appdata key `errlog` (profile/errlog.json, next to the
 * self-test's `selftest`), with the version and the time, so a report can
 * say what happened. Nothing leaves the machine.
 *
 * Writes are coalesced (one per `delay` ms at most) and never throw: a log
 * that fails must not become a second fault.
 * @module errlog
 */

/** The appdata key the log is kept under. Not a persist.js key: no manifest lists it. */
export const ERRLOG_KEY = "errlog";
/** How many entries the file keeps, newest last. */
export const ERRLOG_MAX = 30;

/**
 * @param {object} d
 * @param {{appdataReadKey?: Function, appdataWriteKey?: Function}} d.host
 * @param {string} [d.version]
 * @param {() => number} [d.now]
 * @param {number} [d.delay] ms between writes
 */
export function createErrLog(d) {
  const host = d.host || {};
  const now = d.now || (() => Date.now());
  const delay = d.delay == null ? 1000 : d.delay;
  const can = typeof host.appdataWriteKey === "function";
  let entries = null; // read from disk on the first write
  const queued = [];
  let timer = null, writing = null;

  /** One error as a plain record: what, where, and when. */
  function entryOf(err, kind) {
    const e = err && typeof err === "object" ? err : { message: String(err) };
    return {
      t: now(),
      v: d.version || "",
      kind: kind || "error",
      msg: String(e.message || e.name || e).slice(0, 500),
      stack: typeof e.stack === "string" ? e.stack.slice(0, 1500) : "",
    };
  }

  async function load() {
    if (entries) return entries;
    entries = [];
    try {
      const r = typeof host.appdataReadKey === "function" ? await host.appdataReadKey(ERRLOG_KEY) : null;
      const list = r && typeof r.text === "string" ? JSON.parse(r.text) : null;
      if (list && Array.isArray(list.entries)) entries = list.entries.slice(-ERRLOG_MAX);
    } catch (_) { entries = []; }
    return entries;
  }

  async function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!can || !queued.length) return false;
    if (writing) { await writing; return flush(); }
    writing = (async () => {
      const list = await load();
      list.push(...queued.splice(0));
      entries = list.slice(-ERRLOG_MAX);
      try { return (await host.appdataWriteKey(ERRLOG_KEY, JSON.stringify({ v: 1, entries }))) === true; }
      catch (_) { return false; }
    })();
    try { return await writing; } finally { writing = null; }
  }

  /** Keep one error; the write follows within `delay`. */
  function record(err, kind) {
    if (!can) return;
    try { queued.push(entryOf(err, kind)); } catch (_) { return; }
    if (queued.length > ERRLOG_MAX) queued.splice(0, queued.length - ERRLOG_MAX);
    if (!timer) timer = setTimeout(() => { timer = null; flush().catch(() => {}); }, delay);
  }

  return { record, flush };
}
