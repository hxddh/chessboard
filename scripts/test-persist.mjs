/**
 * v8-0-plan F3 — the save store, without a browser.
 *
 * Two halves. host.js cuts every native transfer into pieces that fit the
 * SDK's 1 MiB bridge frame; here it talks to a stand-in that behaves like
 * main.zig (refuses an oversized frame, stages pieces, answers reads with
 * {b64, more}). persist.js mirrors into a per-key store and writes only what
 * changed; here it runs on a fake host whose files are a Map, which is where
 * the SCHEMA 1 → 2 migration is proved against 6.x–7.x shaped profiles.
 *
 * 跑:node scripts/test-persist.mjs
 */
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";
import { compileModuleSync } from "./bundle.mjs";
import { createPersist, KEYS, SCHEMA, STORE_META, isStoreMeta, storeFiles } from "../src/web/js/persist.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let failed = 0;
const assert = (cond, msg) => {
  if (cond) console.log("ok   " + msg);
  else { failed++; console.error("FAIL " + msg); }
};
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

// --- 1. host.js: pieces that fit the bridge ---------------------------------
/**
 * main.zig, as far as the page can tell: one frame ≤ 1 MiB each way, pieces
 * of ≤ 512 KiB staged by txn and written when the last is in, reads answered
 * a piece at a time. `files` is the disk.
 */
function nativeStandIn() {
  const LIMIT = 1024 * 1024, CHUNK = 512 * 1024, MAX = 16 * 1024 * 1024;
  const files = new Map();
  const stages = new Map();
  const frames = [];
  const receive = (target, a) => {
    const bytes = Buffer.from(a.b64 || "", "base64");
    if (a.total == null) return { done: bytes };
    if (a.total > MAX) return { answer: { tooLarge: true, limit: MAX } };
    let st = stages.get(a.txn);
    if (a.offset === 0) { st = { target, data: Buffer.alloc(a.total), filled: 0 }; stages.set(a.txn, st); }
    if (!st || st.target !== target || st.filled !== a.offset || a.offset + bytes.length > a.total) {
      stages.delete(a.txn);
      return { answer: { error: "stage_lost" } };
    }
    bytes.copy(st.data, a.offset);
    st.filled += bytes.length;
    if (st.filled < a.total) return { answer: { ok: true, pending: true } };
    stages.delete(a.txn);
    return { done: st.data };
  };
  const piece = (buf, a, extra) => {
    const off = a.offset || 0;
    if (!off && buf.length > MAX) return { tooLarge: true, limit: MAX };
    return Object.assign({ b64: buf.subarray(off, off + CHUNK).toString("base64"), more: off + CHUNK < buf.length }, extra);
  };
  const zero = {
    files, stages, frames,
    invoke: async (cmd, a) => {
      const size = JSON.stringify({ id: "0123456789abcdef", command: cmd, payload: a }).length;
      frames.push({ cmd, size, a });
      if (size > LIMIT) throw new Error("PayloadTooLarge");
      let r;
      if (cmd === "chess.writeTextFile" || cmd === "chess.appdataWrite") {
        const target = cmd === "chess.writeTextFile" ? "path:" + a.path : "appdata:" + (a.key || "");
        const got = receive(target, a);
        if (got.answer) r = got.answer;
        else { files.set(target, got.done); r = cmd === "chess.writeTextFile" ? true : { ok: true }; }
      } else if (cmd === "chess.readTextFile" || cmd === "chess.appdataRead") {
        const target = cmd === "chess.readTextFile" ? "path:" + a.path : "appdata:" + (a.key || "");
        const f = files.get(target);
        if (!f) r = cmd === "chess.appdataRead" ? { missing: true } : null;
        else r = piece(f, a, cmd === "chess.appdataRead" ? { bak: false } : null);
      } else r = {};
      if (JSON.stringify(r).length + 64 > LIMIT) throw new Error("result over the frame");
      return r;
    },
  };
  return zero;
}

function loadHost(zero) {
  const c = { console, TextEncoder, TextDecoder, btoa, atob, Date, Math, setTimeout, navigator: {}, document: {} };
  c.globalThis = c;
  c.window = c;
  if (zero) c.zero = zero;
  vm.createContext(c);
  vm.runInContext(compileModuleSync(path.join(root, "src/web/js/host.js")), c, { filename: "host.js" });
  return c.ChessHost;
}

{
  // the base64 fast path agrees with Node's, at every slice boundary
  const H = loadHost(null);
  let same = true;
  for (const n of [0, 1, 2, 3, 24575, 24576, 24577, 49152, 100003]) {
    const s = Array.from({ length: n }, (_, i) => String.fromCharCode(32 + ((i * 7919) % 90))).join("");
    if (H.bytesToBase64(s) !== Buffer.from(s, "utf8").toString("base64")) same = false;
  }
  assert(same, "bytesToBase64 over 3 × 8192-byte slices is byte-for-byte Node's base64");
  const cjk = "国际象棋 ♔♕ " + "😀".repeat(3);
  assert(H.bytesToBase64(cjk) === Buffer.from(cjk, "utf8").toString("base64"), "…including multi-byte UTF-8");
}

{
  const zero = nativeStandIn();
  const H = loadHost(zero);
  // 2 MB, with a four-byte character every so often so that piece boundaries
  // land inside UTF-8 sequences
  const big = Array.from({ length: 70000 }, (_, i) => (i % 97 ? "e4 e5 Nf3 Nc6 Bb5 a6 " : "😀 国际象棋 ")).join("").slice(0, 2 * 1024 * 1024);
  await H.writeTextFile("/Users/me/all.json", big);
  const writes = zero.frames.filter((f) => f.cmd === "chess.writeTextFile");
  assert(writes.length === Math.ceil(Buffer.byteLength(big) / (512 * 1024)),
    `a 2 MB export goes as ${writes.length} pieces of ≤ 512 KiB (not one ${Buffer.byteLength(big)}-byte frame)`);
  assert(writes.every((f) => f.size <= 1024 * 1024), "…every frame under the SDK's 1 MiB");
  assert(new Set(writes.map((f) => f.a.txn)).size === 1 && writes.every((f) => f.a.total === Buffer.byteLength(big)),
    "…all one transfer, each naming the total");
  assert(zero.files.get("path:/Users/me/all.json").toString("utf8") === big, "…and the file on disk is the text, exactly");
  zero.frames.length = 0;
  const back = await H.readTextFile("/Users/me/all.json");
  const reads = zero.frames.filter((f) => f.cmd === "chess.readTextFile");
  assert(back === big, `it reads back equal, in ${reads.length} pieces`);
  assert(reads.map((f) => f.a.offset || 0).join(",") === "0,524288,1048576,1572864" || reads.length === Math.ceil(Buffer.byteLength(big) / 524288),
    "…each piece asking for the next offset");

  // small stays the pre-F3 shape: one frame, no staging fields
  zero.frames.length = 0;
  await H.writeTextFile("/Users/me/a.pgn", "1. e4 e5");
  assert(zero.frames.length === 1 && zero.frames[0].a.txn == null && zero.frames[0].a.total == null,
    "a small file is one frame without txn/total, as every earlier shell expects");

  // the per-key appdata pair
  const lib = JSON.stringify({ v: 1, games: Array.from({ length: 30000 }, (_, i) => ({ id: "lib:" + i, sans: "e4 e5 Nf3 Nc6 Bb5" })) });
  assert((await H.appdataWriteKey("library", lib)) === true, `appdataWriteKey writes a ${lib.length}-byte key in pieces`);
  const r = await H.appdataReadKey("library");
  assert(r && r.text === lib && r.bak === false, "…and appdataReadKey reads the same bytes back");
  assert((await H.appdataReadKey("nothing")).missing === true, "…a key never written reads as missing");
  assert(zero.files.has("appdata:library") && !zero.files.has("appdata:"), "…into its own file, not chessboard.json");

  // a transfer that loses its stage (another writer took the slot) starts
  // over once, and says so if it cannot
  let lose = 1;
  const real = zero.invoke;
  zero.invoke = async (cmd, a) => {
    if (cmd === "chess.appdataWrite" && a.offset === 524288 && lose-- > 0) zero.stages.clear();
    return real(cmd, a);
  };
  assert((await H.appdataWriteKey("library", lib + " ")) === true, "a lost stage is retried from the top once");
  zero.invoke = async (cmd, a) => {
    if (cmd === "chess.appdataWrite" && a.offset > 0) zero.stages.clear();
    return real(cmd, a);
  };
  let threw = null;
  try { await H.appdataWriteKey("library", lib); } catch (e) { threw = e; }
  assert(threw && /stage_lost/.test(threw.message), "…and a second loss is a failed write, not a quiet one");
  zero.invoke = real;

  // a shell that ignores the staging fields writes each piece as the whole
  // file and says "done" — that must not read as saved
  const H2 = loadHost({ invoke: async () => ({ ok: true }) });
  let partial = null;
  try { await H2.appdataWriteKey("library", lib); } catch (e) { partial = e; }
  assert(partial && /not_staged/.test(partial.message), "a shell that cannot stage is a failed write, not a truncated file");

  // too large, as the native side says it
  const H3 = loadHost({ invoke: async () => ({ tooLarge: true, limit: 16777216 }) });
  let tl = null;
  try { await H3.readTextFile("/x.json"); } catch (e) { tl = e; }
  assert(tl && tl.name === H3.FILE_TOO_LARGE && tl.limit === 16777216, "an oversized file is FileTooLargeError with the 16 MiB limit");
}

// --- 2. persist.js: the per-key store -----------------------------------------
const mem = () => {
  const m = new Map();
  return {
    m,
    storageGet: (k) => (m.has(k) ? m.get(k) : null),
    storageSet: (k, v) => { m.set(k, String(v)); return true; },
    storageRemove: (k) => { m.delete(k); },
    hasZero: () => true,
  };
};
/** A host with the per-key store (`store`), and optionally the old file. */
const withStore = (legacy) => {
  const h = mem();
  h.store = new Map();
  h.legacy = legacy == null ? null : legacy;
  h.writes = [];
  h.appdataRead = async () => (h.legacy == null ? { missing: true } : { text: h.legacy });
  h.appdataWrite = async (t) => { h.legacy = t; h.writes.push(""); return true; };
  h.appdataReadKey = async (k) => (h.store.has(k) ? { text: h.store.get(k) } : { missing: true });
  h.appdataWriteKey = async (k, t) => { h.store.set(k, t); h.writes.push(k); return true; };
  return h;
};
const LS = (name) => KEYS[name];
const metaOf = (h) => JSON.parse(h.store.get(STORE_META));
/** A key's value as the store's manifest has it (each key has two files, STORE_ALT). */
const valOf = (h, name) => h.store.get(storeFiles(metaOf(h))[name]);

assert(SCHEMA === 2, "SCHEMA is 2");

// 2a. the migration, the ordinary way: a 7.x profile in the cache and the
// same revision in chessboard.json. Every key becomes its own file.
{
  // shapes as 6.x–7.x wrote them: stats v1 with the overloaded `sig`, a
  // library, the quarantine, the window preference
  const keys = {
    settings: JSON.stringify({ mode: "ai", langId: "en", themeId: "wood" }),
    save: JSON.stringify({ v: 1, pgn: "[Event \"?\"]\n\n1. e4 e5 *" }),
    stats: JSON.stringify({ v: 1, games: [{ t: 1, sig: "e4 e5#mate", result: "1-0" }] }),
    library: JSON.stringify({ v: 1, games: [{ id: "lib:1", sans: "e4 e5", plies: 2 }], names: ["me"] }),
    quarantine: JSON.stringify([{ name: "learn", raw: "{oops", at: 1 }]),
    panelOpen: "1",
  };
  const legacy = JSON.stringify({ app: "chessboard", schema: 1, writtenAt: 7000, keys });
  const h = withStore(legacy);
  for (const [n, v] of Object.entries(keys)) h.m.set(LS(n), v);
  h.m.set("chess.schema", "1");
  h.m.set("chess.writtenAt", "7000");
  const P = createPersist(h, () => {});
  P.load();
  assert(h.m.get("chess.schema") === "2", "load() records schema 2 for a schema-1 cache");
  const r = await P.recover();
  assert(r === "kept", "a 7.x profile whose file matches the cache is kept (" + r + ")");
  await tick(600);
  const meta = metaOf(h);
  assert(isStoreMeta(meta) && meta.schema === 2 && meta.writtenAt === 7000,
    "…the store gets a manifest: schema 2, the cache's revision");
  assert(Object.keys(keys).every((n) => h.store.get(n) === keys[n]) && Object.keys(keys).every((n) => meta.keys.includes(n)),
    "…and every key of the old file as its own file, byte for byte (" + meta.keys.join(",") + ")");
  assert(h.legacy === legacy, "…chessboard.json is left exactly as it was, for a downgrade");
  assert(h.writes.indexOf(STORE_META) === h.writes.length - 1, "…the manifest is written last");

  // the next launch: the store is at the cache's revision, nothing is rewritten
  h.writes.length = 0;
  const P2 = createPersist(h, () => {});
  P2.load();
  assert((await P2.recover()) === "kept", "the next launch keeps the cache");
  await tick(600);
  assert(h.writes.length === 0, "…and writes nothing — the store is already in sync (" + h.writes.join(",") + ")");

  // one change: that key and the manifest, nothing else
  P2.set("save", JSON.stringify({ v: 1, pgn: "1. d4 *" }));
  await tick(600);
  assert(h.writes.join(",") === "save-b," + STORE_META, "a change writes that key (into its other file) and the manifest only (" + h.writes.join(",") + ")");
  assert(valOf(h, "save") === JSON.stringify({ v: 1, pgn: "1. d4 *" }) && h.store.get("save") === keys.save,
    "…the manifest points at the new file; the old one is untouched until the next change");
  assert(metaOf(h).writtenAt === Number(h.m.get("chess.writtenAt")), "…the manifest carries the cache's new revision");
}

// 2b. the migration when the cache was cleared: chessboard.json is restored
// from, exactly as 7.x did, and the store is written on the launch after
{
  const keys = { save: JSON.stringify({ v: 1, pgn: "1. c4 *" }), learn: JSON.stringify({ v: 1, done: { a: 1 } }) };
  const h = withStore(JSON.stringify({ app: "chessboard", schema: 1, writtenAt: 9000, keys }));
  const P = createPersist(h, () => {});
  P.load();
  assert((await P.recover()) === "restored", "an empty cache is restored from chessboard.json");
  assert(P.get("save") === keys.save && P.get("learn") === keys.learn, "…every key back in the cache");
  await tick(600);
  assert(h.writes.length === 0, "…and nothing is written before the reload (frozen)");
  const P2 = createPersist(h, () => {});   // the reload
  P2.load();
  assert((await P2.recover()) === "kept", "after the reload the cache is kept");
  await tick(600);
  assert(h.store.get("save") === keys.save && h.store.get("learn") === keys.learn && metaOf(h).keys.length === 2,
    "…and the store now holds both keys");
}

// 2c. the store is where a restore comes from once it exists
{
  const h = withStore(JSON.stringify({ app: "chessboard", schema: 1, writtenAt: 1, keys: { save: "old" } }));
  h.store.set("save", JSON.stringify({ v: 1, pgn: "1. Nf3 *" }));
  h.store.set("stats", JSON.stringify({ v: 2, games: [] }));
  h.store.set(STORE_META, JSON.stringify({ app: "chessboard", schema: 2, writtenAt: 5000, keys: ["save", "stats"] }));
  const P = createPersist(h, () => {});
  P.load();
  assert((await P.recover()) === "restored", "an empty cache is restored from the store's manifest");
  assert(P.get("save") === h.store.get("save") && P.get("stats") === h.store.get("stats"),
    "…with the store's keys, not chessboard.json's");
}

// 2d. damage in the store is reported, and left alone
{
  const h = withStore(null);
  h.store.set(STORE_META, "{not json");
  h.m.set(LS("save"), "x");
  let failedKey = null;
  const P = createPersist(h, (i) => { failedKey = i.key; });
  P.load();
  assert((await P.recover()) === "corrupt" && failedKey === "appdataCorrupt", "an unreadable manifest is reported");
  P.set("save", "y");
  await tick(600);
  assert(h.writes.length === 0 && h.store.get(STORE_META) === "{not json", "…and nothing overwrites the store");

  const h2 = withStore(null);
  h2.store.set(STORE_META, JSON.stringify({ app: "chessboard", schema: 2, writtenAt: 5000, keys: ["save", "library"] }));
  h2.store.set("save", "s");
  const P2 = createPersist(h2, () => {});
  P2.load();
  assert((await P2.recover()) === "corrupt", "a key the manifest lists and the store lost is damage, not a partial restore");
  assert(P2.get("save") == null, "…nothing half-restored into the cache");
}

// 2e. a cache newer than the store (a crash between writes, a failed flush)
// makes the next launch rewrite all of it
{
  const h = withStore(null);
  h.store.set(STORE_META, JSON.stringify({ app: "chessboard", schema: 2, writtenAt: 5000, keys: ["save"] }));
  h.store.set("save", "old");
  h.m.set(LS("save"), "new");
  h.m.set(LS("learn"), "L");
  h.m.set("chess.writtenAt", "8000");
  const P = createPersist(h, () => {});
  P.load();
  assert((await P.recover()) === "kept", "a newer cache is kept");
  await tick(600);
  assert(valOf(h, "save") === "new" && valOf(h, "learn") === "L" && metaOf(h).writtenAt === 8000,
    "…and the whole store is brought up to its revision");
}

// 2f. clearing: files of removed keys are overwritten, chessboard.json too
{
  const h = withStore(JSON.stringify({ app: "chessboard", schema: 1, writtenAt: 1, keys: { save: "s" } }));
  const P = createPersist(h, () => {});
  P.load();
  await P.recover();
  P.set("save", "s1");
  P.set("library", "L");
  await tick(600);
  h.writes.length = 0;
  P.clearAll();
  await P.flushMirror();
  await tick(10);
  assert(["save", "save-b", "library", "library-b"].every((f) => !h.store.has(f) || h.store.get(f) === "null"),
    "clearing overwrites both files of every removed key (" + h.writes.join(",") + ")");
  assert(!metaOf(h).keys.includes("save") && JSON.parse(h.legacy).keys.save == null,
    "…the manifest lists none of them, and chessboard.json no longer holds the old profile");
}

// 2g. a failed write keeps its keys owed; flushes never overlap
{
  const h = withStore(null);
  let fail = true, inFlight = 0, most = 0;
  h.appdataWriteKey = async (k, t) => {
    inFlight++; most = Math.max(most, inFlight);
    await tick(20);
    inFlight--;
    if (fail) throw new Error("disk full");
    h.store.set(k, t); h.writes.push(k); return true;
  };
  let failedKey = null;
  const P = createPersist(h, (i) => { failedKey = failedKey || i.key; });
  P.load();
  await P.recover();
  P.set("learn", "A");
  await P.flushMirror();
  assert(failedKey === "appdata", "a refused key write latches the failure");
  fail = false;
  const a = P.flushMirror(), b = P.flushMirror();
  P.set("save", "B");
  await Promise.all([a, b, P.flushMirror()]);
  assert(h.store.get("learn") === "A" && h.store.get("save") === "B", "…the key it could not write is written by the next flush");
  assert(most === 1, "…and flushes queue behind one another instead of interleaving (" + most + " at once)");
}

// 2h. the manifest never claims a revision its files do not hold: a write
// landing mid-flush is left for the next flush, and the stamp says so
{
  const h = withStore(null);
  const P = createPersist(h, () => {});
  P.load();
  await P.recover();
  let P2set = null;
  const orig = h.appdataWriteKey;
  h.appdataWriteKey = async (k, t) => {
    if (k === "learn" && P2set) { P2set(); P2set = null; }
    return orig(k, t);
  };
  P.set("learn", "A");
  await tick(2);
  P2set = () => { h.m.set("chess.writtenAt", "99999999999999"); P.set("learn", "B"); };
  await P.flushMirror();
  const m1 = metaOf(h);
  assert(m1.writtenAt !== 99999999999999 && Number(h.m.get("chess.writtenAt")) > m1.writtenAt,
    "a flush's manifest carries the revision it started from, not one set while it ran");
  await P.flushMirror();
  assert(valOf(h, "learn") === "B", "…and the later value is written by the flush after");
}

// 2i. writing the value that is already stored is not a change: no new
// revision, nothing owed to the store. Every quit saves the same game twice
// (beforeunload, pagehide), and each used to re-stamp the cache, so the next
// launch always found the store a revision behind and rewrote all of it.
{
  const h = withStore(null);
  const P = createPersist(h, () => {});
  P.load();
  await P.recover();
  P.set("save", "same");
  await P.flushMirror();
  const at = h.m.get("chess.writtenAt");
  h.writes.length = 0;
  await tick(3);
  assert(P.set("save", "same") === true, "an unchanged write still reports success");
  await P.flushMirror();
  assert(h.m.get("chess.writtenAt") === at && h.writes.length === 0, "…but stamps nothing and writes nothing to the store");
  h.m.delete(LS("save"));   // storage cleared under the page
  P.set("save", "same");
  assert(h.m.get(LS("save")) === "same", "…while a value missing from storage is written again, whatever the bag says");
  await P.flushMirror();
  // and the next launch finds the store in sync
  const P2 = createPersist(h, () => {});
  P2.load();
  h.writes.length = 0;
  assert((await P2.recover()) === "kept", "the relaunch keeps the cache");
  await tick(600);
  assert(h.writes.length === 0, "…and rewrites nothing (" + h.writes.join(",") + ")");
}

// 2j. (Codex on #85) removing one key on its own is a change like any other:
// it re-stamps the cache and reaches the store without another write's help
{
  const h = withStore(null);
  const P = createPersist(h, () => {});
  P.load();
  await P.recover();
  P.set("stats", JSON.stringify({ v: 2, games: [1] }));
  P.set("save", "s");
  await P.flushMirror();
  const before = Number(h.m.get("chess.writtenAt"));
  await tick(3);
  P.remove("stats");
  assert(Number(h.m.get("chess.writtenAt")) > before, "a lone remove() re-stamps the cache");
  await tick(600);
  assert(!metaOf(h).keys.includes("stats") && metaOf(h).writtenAt === Number(h.m.get("chess.writtenAt")),
    "…and the store's manifest drops the key on its own schedule (" + metaOf(h).keys.join(",") + ")");
}

// 2k. (Codex on #85) a flush of several keys is one generation: an exit
// between its key files and its manifest leaves the store exactly as the old
// manifest describes it, never a mix of the two profiles
for (const how of ["restore", "clear"]) {
  const h = withStore(null);
  const P = createPersist(h, () => {});
  P.load();
  await P.recover();
  P.set("save", "s1");
  P.set("library", "L1");
  await P.flushMirror();
  // the process dies after the first key file of the next flush
  const orig = h.appdataWriteKey;
  let n = 0;
  h.appdataWriteKey = async (k, t) => { if (n++ >= 1) throw new Error("exit"); return orig(k, t); };
  if (how === "restore") P.restoreAll({ app: "chessboard", schema: 2, writtenAt: Date.now(), keys: { save: "s2", library: "L2" } });
  else P.clearAll();
  await P.flushMirror();
  h.appdataWriteKey = orig;
  // the next launch has lost the cache: it can only rebuild from the store
  h.m.clear();
  const P2 = createPersist(h, () => {});
  P2.load();
  const r = await P2.recover();
  const got = P2.get("save") + ", " + P2.get("library");
  // a restore dies before its manifest: the old profile, whole. A clear
  // writes no key files, so its first write is the manifest — it committed,
  // and its cleanup after the commit is what died: cleared, whole.
  assert(how === "restore" ? got === "s1, L1" : got === "null, null",
    how + " cut short: the store holds one whole profile, not a mix (" + r + ": " + got + ")");
}

// 2l. (Codex on #85) a manifest read that fails (the bridge answers null) is
// not "no store": the boot's defaults must not be flushed over the profile
// the next launch could still recover
{
  const h = withStore(null);
  h.store.set("save", "good");
  const meta0 = JSON.stringify({ app: "chessboard", schema: 2, writtenAt: 5000, keys: ["save"] });
  h.store.set(STORE_META, meta0);
  const orig = h.appdataReadKey;
  h.appdataReadKey = async () => null;
  const P = createPersist(h, () => {});
  P.load();
  P.set("settings", "defaults");   // the boot writes before recover() answers
  const r = await P.recover();
  h.appdataReadKey = orig;
  await tick(600);
  await P.flushMirror();
  assert(h.store.get(STORE_META) === meta0 && h.store.get("save") === "good" && h.writes.length === 0,
    "an unreadable manifest leaves the store alone for the session (" + r + "; wrote " + h.writes.join(",") + ")");
  // and the next launch, with the bridge back, still restores from it
  h.m.clear();
  const P2 = createPersist(h, () => {});
  P2.load();
  assert((await P2.recover()) === "restored" && P2.get("save") === "good", "…which the next launch restores from");
}
// …and the same for chessboard.json while migrating: a failed read of it is
// not "no profile", or the store would be born holding only the defaults
{
  const legacy = JSON.stringify({ app: "chessboard", schema: 1, writtenAt: 7000, keys: { save: "old" } });
  const h = withStore(legacy);
  h.appdataRead = async () => null;
  const P = createPersist(h, () => {});
  P.load();
  P.set("settings", "defaults");
  await P.recover();
  await tick(600);
  await P.flushMirror();
  assert(!h.store.has(STORE_META) && h.legacy === legacy, "a failed read of chessboard.json while migrating writes no store (" + h.writes.join(",") + ")");
}

// 2m. (Codex on #85) removed and written again before the flush: the new
// value is what the store keeps, not "null"
{
  const h = withStore(null);
  const P = createPersist(h, () => {});
  P.load();
  await P.recover();
  P.set("stats", "old");
  await P.flushMirror();
  P.remove("stats");
  P.set("stats", "fresh");
  await P.flushMirror();
  assert(valOf(h, "stats") === "fresh", "a key cleared and rewritten in one burst keeps its new value in the store (" + valOf(h, "stats") + ")");
}

// 2n. (Codex on #85) two windows on one store: one removes a key while the
// other writes it again and commits between the first one's manifest and its
// cleanup. The cleanup must not null the files the store's manifest now names.
{
  const h = withStore(null);
  const A = createPersist(h, () => {});
  A.load();
  await A.recover();
  A.set("stats", "old");
  A.set("save", "s");
  await A.flushMirror();
  const B = createPersist(h, () => {});
  B.load();
  await B.recover();
  const orig = h.appdataWriteKey;
  let hook = async () => { B.set("stats", "again"); await B.flushMirror(); };
  h.appdataWriteKey = async (k, t) => {
    const r = await orig(k, t);
    if (k === STORE_META && hook) { const f = hook; hook = null; await f(); }
    return r;
  };
  A.remove("stats");
  await A.flushMirror();
  h.appdataWriteKey = orig;
  assert(metaOf(h).keys.includes("stats") && valOf(h, "stats") === "again",
    "a removal's cleanup leaves alone what another window committed meanwhile (" + valOf(h, "stats") + ")");
}

if (failed) { console.error(failed + " 项失败"); process.exit(1); }
console.log("all passed");
