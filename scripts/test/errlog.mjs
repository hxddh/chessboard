/**
 * The on-disk error log (errlog.js, 19.1 G4), on a fake host.
 *
 * Part of scripts/test-chess.mjs, which runs every module here in order.
 */
import { assert } from "./harness.mjs";

export async function run() {
  const { createErrLog, ERRLOG_KEY, ERRLOG_MAX } = await import("../../src/web/js/errlog.js");
  const files = new Map();
  let writes = 0;
  const host = {
    appdataReadKey: async (k) => (files.has(k) ? { text: files.get(k) } : { missing: true }),
    appdataWriteKey: async (k, t) => { writes++; files.set(k, t); return true; },
  };
  files.set(ERRLOG_KEY, JSON.stringify({ v: 1, entries: [{ t: 1, v: "19.0.0", kind: "error", msg: "older", stack: "" }] }));
  const log = createErrLog({ host, version: "19.1.0", now: () => 42, delay: 10_000 });
  log.record(new TypeError("x is undefined"), "error");
  log.record("a plain string", "rejection");
  assert(writes === 0, "errors are coalesced, not written one by one");
  assert(await log.flush() === true, "a flush writes them");
  const kept = JSON.parse(files.get(ERRLOG_KEY)).entries;
  assert(kept.length === 3 && kept[0].msg === "older", "what an earlier launch kept is kept too (" + kept.length + ")");
  assert(kept[1].msg === "x is undefined" && kept[1].v === "19.1.0" && kept[1].t === 42 && /TypeError/.test(kept[1].stack),
    "each entry has the message, the version, the time and the stack");
  assert(kept[2].kind === "rejection" && kept[2].msg === "a plain string", "a rejected non-Error is kept as text");
  for (let i = 0; i < ERRLOG_MAX + 5; i++) log.record(new Error("e" + i));
  await log.flush();
  const after = JSON.parse(files.get(ERRLOG_KEY)).entries;
  assert(after.length === ERRLOG_MAX && after[after.length - 1].msg === "e" + (ERRLOG_MAX + 4), "the file keeps the newest " + ERRLOG_MAX);
  // a host that refuses, throws, or is missing never turns the log into a fault
  const bad = createErrLog({ host: { appdataWriteKey: async () => { throw new Error("disk"); } }, delay: 10_000 });
  bad.record(new Error("y"));
  assert(await bad.flush() === false, "a failed write is reported to the caller, not thrown");
  const none = createErrLog({ host: {} });
  none.record(new Error("z"));
  assert(await none.flush() === false, "no native storage: nothing to write, nothing thrown");
}
