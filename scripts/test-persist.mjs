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
import { createPersist, KEYS, SCHEMA, STORE_META, BULK, isStoreMeta, storeFiles } from "../src/web/js/persist.js";
import { migrateLook, lookAttrs, LEGACY_THEMES, LOOK_DEFAULT, PIECE_SET_IDS, BOARD_IDS } from "../src/web/js/look.js";

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
  // MAX for the store's files, USER_MAX for one the player picked (main.zig
  // FILE_MAX_BYTES / USER_FILE_MAX_BYTES, M5 review P2-3)
  const LIMIT = 1024 * 1024, CHUNK = 512 * 1024, MAX = 16 * 1024 * 1024, USER_MAX = 64 * 1024 * 1024;
  const files = new Map();
  const stages = new Map();
  const frames = [];
  const receive = (target, a) => {
    const bytes = Buffer.from(a.b64 || "", "base64");
    if (a.total == null) return { done: bytes };
    const max = target.startsWith("appdata:") ? MAX : USER_MAX;
    if (a.total > max) return { answer: { tooLarge: true, limit: max } };
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
  const piece = (buf, a, extra, max) => {
    const off = a.offset || 0;
    if (!off && buf.length > max) return { tooLarge: true, limit: max };
    return Object.assign({ b64: buf.subarray(off, off + CHUNK).toString("base64"), more: off + CHUNK < buf.length }, extra);
  };
  const zero = {
    files, stages, frames,
    // what the next dialog answers: a path, null (Cancel) or "no_dialog"
    pick: null, opened: null, seq: 0,
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
        else r = cmd === "chess.appdataRead" ? piece(f, a, { bak: false }, MAX) : piece(f, a, null, USER_MAX);
      } else if ((cmd === "chess.saveText" || cmd === "chess.openPgn") && a.probe === true) {
        r = { probe: true, dialogs: true };
      } else if (cmd === "chess.saveText") {
        // v8-1-plan N2: staged like any write; the dialog (zero.pick) only
        // once the last piece is in
        const got = receive("dialog:save", a);
        if (got.answer) r = got.answer;
        else if (zero.pick === "no_dialog") r = { error: "no_dialog" };
        else if (zero.pick == null) r = { cancelled: true };
        else { files.set("path:" + zero.pick, got.done); r = { ok: true, name: zero.pick.split("/").pop(), revealed: true }; }
      } else if (cmd === "chess.openPgn") {
        // the dialog, then the file, the first piece carrying its name; the
        // rest asked for by token
        if (a.token != null) {
          const o = zero.opened;
          r = !o || o.token !== a.token ? { error: "open_lost" } : piece(files.get("path:" + o.path), a, null, o.limit);
        } else if (zero.pick === "no_dialog") r = { error: "no_dialog" };
        else if (zero.pick == null) r = { cancelled: true };
        else {
          const limit = Math.min(a.max || MAX, USER_MAX);
          r = piece(files.get("path:" + zero.pick), { offset: 0 }, null, limit);
          if (r.more) zero.opened = { path: zero.pick, token: ++zero.seq, limit };
          if (r.b64 != null) r = Object.assign({ name: zero.pick.split("/").pop() }, r.more ? { token: zero.seq } : null, r);
        }
      } else r = {};
      if (JSON.stringify(r).length + 64 > LIMIT) throw new Error("result over the frame");
      return r;
    },
  };
  return zero;
}

function loadHost(zero, over) {
  const c = Object.assign({ console, TextEncoder, TextDecoder, btoa, atob, Date, Math, setTimeout, navigator: {}, document: {} }, over);
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
  assert(writes.length >= Math.ceil(Buffer.byteLength(big) / (512 * 1024)) &&
    writes.every((f) => Buffer.from(f.a.b64, "base64").length <= 512 * 1024),
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

  // v8-1-plan F3: a big text is encoded a piece at a time. encode() of the
  // whole 2 MB header was 7–10 ms in the first launch's first round trip.
  let widest = 0;
  class Spy extends TextEncoder {
    encode(s) { widest = Math.max(widest, String(s).length); return super.encode(s); }
  }
  const HS = loadHost(zero, { TextEncoder: Spy });
  // a four-byte character on each side of every 128 Ki-char cut, and one
  // astride it; a lone surrogate, which TextEncoder writes as U+FFFD
  const cut = 128 * 1024;
  let wide = "";
  for (let k = 1; k <= 8; k++) wide += "a".repeat(cut - 3) + "😀" + "b" + (k % 2 ? "😀" : "国");
  wide += "\ud800 end";
  zero.frames.length = 0;
  assert((await HS.appdataWriteKey("wide", wide)) === true, `a ${wide.length}-char key with 4-byte characters at the piece cuts is written`);
  const pieces = zero.frames.filter((f) => f.cmd === "chess.appdataWrite");
  assert(widest <= 512 * 1024, `…never encoding more than one piece's worth at once (widest encode ${widest} chars)`);
  assert(pieces.length > 1 && pieces.every((f) => Buffer.from(f.a.b64, "base64").length <= 128 * 1024 && f.a.total === Buffer.byteLength(wide)),
    `…in ${pieces.length} pieces of ≤ 128 KiB, each naming the whole length`);
  assert(zero.files.get("appdata:wide").equals(Buffer.from(new TextEncoder().encode(wide))), "…and the bytes on disk are exactly TextEncoder's");
  lose = 1;
  zero.invoke = async (cmd, a) => {
    if (cmd === "chess.appdataWrite" && a.offset > 600000 && lose-- > 0) zero.stages.clear();
    return real(cmd, a);
  };
  assert((await HS.appdataWriteKey("wide", wide + "!")) === true &&
    zero.files.get("appdata:wide").equals(Buffer.from(new TextEncoder().encode(wide + "!"))), "…and a retry from the top encodes it again from the start");
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

// --- 1b. v8-1-plan N2: the file dialogs run in main.zig ----------------------
// chess.saveText takes the bytes (in pieces) and opens the save dialog itself;
// chess.openPgn opens the dialog and hands the file over (in pieces, by token).
// The page never sees, sends or names a path.
{
  const zero = nativeStandIn();
  const H = loadHost(zero);
  const big = Array.from({ length: 70000 }, (_, i) => (i % 97 ? "e4 e5 Nf3 Nc6 Bb5 a6 " : "😀 国际象棋 ")).join("").slice(0, 2 * 1024 * 1024);
  zero.pick = "/Users/me/games/export.pgn";
  const saved = await H.saveText({ title: "导出", name: "chess.pgn", text: big, recent: true });
  const saves = zero.frames.filter((f) => f.cmd === "chess.saveText");
  assert(saved && saved.name === "export.pgn" && saved.revealed === true && saved.path === "",
    "saveText answers with the name the player gave it, and no path when the folder opened");
  assert(zero.files.get("path:/Users/me/games/export.pgn").toString("utf8") === big &&
    saves.length >= Math.ceil(Buffer.byteLength(big) / (512 * 1024)) && saves.every((f) => f.size <= 1024 * 1024),
    `…a 2 MB export crosses in ${saves.length} pieces under the 1 MiB frame and lands whole`);
  assert(saves.every((f) => f.a.name === "chess.pgn" && f.a.recent === true && !("path" in f.a)),
    "…every piece names the suggested file, none names a path");
  zero.frames.length = 0;
  const opened = await H.openPgn({ title: "打开", recent: true });
  const opens = zero.frames.filter((f) => f.cmd === "chess.openPgn");
  assert(opened && opened.text === big && opened.name === "export.pgn",
    `openPgn reads it back equal, with its name (${opens.length} pieces)`);
  assert(opens[0].a.recent === true && opens.slice(1).every((f) => typeof f.a.token === "number" && f.a.offset > 0 &&
    Object.keys(f.a).sort().join() === "offset,token"), "…the later pieces ask by token and offset, nothing else");
  assert(opens.every((f) => !JSON.stringify(f.a).includes("/Users/")), "…and no frame carries the path");

  // a picture: bytes that are not UTF-8 survive
  const png = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  zero.pick = "/Users/me/report.png";
  await H.saveText({ name: "report.png", b64: png.toString("base64") });
  assert(Buffer.compare(zero.files.get("path:/Users/me/report.png"), png) === 0, "saveText writes b64 bytes verbatim (the report PNG)");

  // Cancel is null, not an error and not an empty file
  zero.pick = null;
  const before = zero.files.size;
  assert((await H.saveText({ name: "x.pgn", text: "1. e4" })) === null && zero.files.size === before, "a cancelled save is null and writes nothing");
  assert((await H.openPgn({})) === null, "a cancelled open is null");
  // no dialog on this platform → the browser's picker (NoFileDialogError)
  zero.pick = "no_dialog";
  let nd1 = null, nd2 = null;
  try { await H.saveText({ name: "x.pgn", text: "1. e4" }); } catch (e) { nd1 = e; }
  try { await H.openPgn({}); } catch (e) { nd2 = e; }
  assert(nd1 && nd1.name === H.NO_FILE_DIALOG && nd2 && nd2.name === H.NO_FILE_DIALOG, "no dialog here is NoFileDialogError, both ways");
  // a shell that refuses the command is an error the call site reports, not a missing dialog
  const H2 = loadHost({ invoke: async () => { throw new Error("permission_denied"); } });
  let pd = null;
  try { await H2.openPgn({}); } catch (e) { pd = e; }
  assert(pd && pd.name !== H.NO_FILE_DIALOG, "a refused command is not mistaken for a platform without dialogs");

  // too large: a PGN stops at 16 MiB, 导入全部数据 reads to 64 MiB
  const huge = Buffer.alloc(17 * 1024 * 1024, 0x61);
  zero.files.set("path:/Users/me/huge.json", huge);
  zero.pick = "/Users/me/huge.json";
  let tl = null;
  try { await H.openPgn({}); } catch (e) { tl = e; }
  assert(tl && tl.name === H.FILE_TOO_LARGE && tl.limit === 16 * 1024 * 1024, "an open past 16 MiB is FileTooLargeError naming 16 MiB");
  const all = await H.openPgn({ max: H.ALL_DATA_MAX });
  assert(all && all.text.length === huge.length, "…while an open asking for ALL_DATA_MAX reads the 17 MiB file whole");

  // review P3-4: a later piece the native side refuses — the file was saved
  // over (open_lost) or is past the limit (tooLarge) — is that refusal, not
  // "the transfer broke off": too large still gets its own words on screen
  const real = zero.invoke;
  zero.files.set("path:/Users/me/big.pgn", Buffer.alloc(600 * 1024, 0x61));
  zero.pick = "/Users/me/big.pgn";
  const refusals = [
    [{ tooLarge: true, limit: 16777216 }, (e) => e.name === H.FILE_TOO_LARGE && e.limit === 16777216, "FileTooLargeError"],
    [{ error: "open_lost" }, (e) => e.name !== H.FILE_TOO_LARGE && /open_lost/.test(e.message), "an error naming open_lost"],
  ];
  for (const [later, ok, what] of refusals) {
    zero.invoke = async (cmd, a) => (cmd === "chess.openPgn" && a.token != null ? later : real(cmd, a));
    let e = null;
    try { await H.openPgn({}); } catch (x) { e = x; }
    assert(e && ok(e), `a later piece answered ${JSON.stringify(later)} is ${what} (${e && e.name}: ${e && e.message})`);
  }
  zero.invoke = real;

  // the self-test probe: both commands answer without a dialog
  zero.frames.length = 0;
  const probe = await H.probeFileCommands();
  assert(probe.openPgn.probe === true && probe.saveText.dialogs === true && zero.frames.every((f) => f.a.probe === true),
    "probeFileCommands asks both commands with probe and nothing else");
}

// v8-1-plan N3: the self-test opens the library's database before the library
// may have — same name, same version, same stores, or it could leave the
// library a database without its stores
{
  const fs = await import("fs");
  const lib = fs.readFileSync(path.join(root, "src/web/js/library-db.js"), "utf8");
  const st = fs.readFileSync(path.join(root, "src/web/js/selftest-native.js"), "utf8");
  const val = (src, name) => (new RegExp("const " + name + " = ([^;]+);").exec(src) || [])[1];
  const stores = (src) => [...src.matchAll(/createObjectStore\(([^)]*)\)/g)].map((m) => m[1]).join("|");
  assert(val(lib, "DB_NAME") === val(st, "IDB_NAME") && val(lib, "DB_VERSION") === val(st, "IDB_VERSION") &&
    stores(lib) === stores(st) && stores(st).length > 0,
    `selftest-native.js opens ${val(st, "IDB_NAME")} v${val(st, "IDB_VERSION")} exactly as library-db.js does (${stores(st)})`);
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

// 2o. (Codex on #85) two windows flushing different keys from the same
// starting manifest: the second commit must not point the first one's key
// back at its old file
{
  const h = withStore(null);
  const A = createPersist(h, () => {});
  A.load();
  await A.recover();
  A.set("save", "s1");
  A.set("settings", "t1");
  await A.flushMirror();
  const B = createPersist(h, () => {});
  B.load();
  await B.recover();
  A.set("save", "s2");
  await A.flushMirror();
  B.set("settings", "t2");
  await B.flushMirror();
  assert(valOf(h, "save") === "s2" && valOf(h, "settings") === "t2",
    "each window's commit keeps the other's newer key (save " + valOf(h, "save") + ", settings " + valOf(h, "settings") + ")");
}

// 2p. (Codex on #85) a restore reads the files one manifest names; if a
// commit lands while it reads, it reads again rather than stitch generations
{
  const h = withStore(null);
  h.store.set("save", "s-old");
  h.store.set(STORE_META, JSON.stringify({ app: "chessboard", schema: 2, writtenAt: 5000, keys: ["save"], files: { save: "save" } }));
  const orig = h.appdataReadKey;
  let once = true;
  h.appdataReadKey = async (k) => {
    const r = await orig(k);
    if (k === "save" && once) {
      once = false;
      // another window commits a new generation, and the file just read is
      // then overwritten by a third flush (as a stale view would)
      h.store.set("save-b", "s-new");
      h.store.set(STORE_META, JSON.stringify({ app: "chessboard", schema: 2, writtenAt: 6000, keys: ["save"], files: { save: "save-b" } }));
      h.store.set("save", "{half");
      return { text: "{half" };
    }
    return r;
  };
  const P = createPersist(h, () => {});
  P.load();
  const r = await P.recover();
  assert(r === "restored" && P.get("save") === "s-new", "a commit during a restore's reads is read again, whole (" + r + ": " + P.get("save") + ")");
}

// 2q. (Codex on #85) two windows flushing at the same moment: with the
// store's lock (navigator.locks in host.js) one whole flush — read, write,
// commit, clean up — runs before the other starts, so neither drops the
// other's key however their bridge calls interleave
{
  const h = withStore(null);
  let chain = Promise.resolve();
  h.withStoreLock = (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };
  const orig = h.appdataWriteKey, origR = h.appdataReadKey;
  h.appdataWriteKey = async (k, t) => { await tick(5); return orig(k, t); };
  h.appdataReadKey = async (k) => { await tick(5); return origR(k); };
  const A = createPersist(h, () => {});
  A.load();
  await A.recover();
  A.set("save", "s1");
  A.set("stats", "old");
  await A.flushMirror();
  const B = createPersist(h, () => {});
  B.load();
  await B.recover();
  A.set("save", "s2");
  B.set("settings", "t2");
  B.remove("stats");
  A.set("stats", "again");
  await Promise.all([A.flushMirror(), B.flushMirror()]);
  const got = ["save", "settings", "stats"].map((n) => n + "=" + valOf(h, n)).join(" ");
  assert(valOf(h, "save") === "s2" && valOf(h, "settings") === "t2",
    "two windows flushing at once under the store lock keep both keys (" + got + ")");
}

// --- 2x. v8-0-plan C1: the library's games as shard keys (BULK) ------------
// The games left localStorage for IndexedDB, which is the WebView's too, so
// the store mirrors them as "lib00" … "lib3f" beside the other keys: the same
// manifest, the same two slots, the same lock. The values come from a port the
// library attaches, not from the bag.
{
  /** A library port over a Map of shard → text, the way library-page.js serves it. */
  const port = (shards) => {
    const p = { shards: new Map(Object.entries(shards || {})), restored: null, cleared: 0, ready: true };
    p.names = () => (p.ready ? [...p.shards.keys()] : null);
    p.read = (n) => (p.shards.has(n) ? p.shards.get(n) : null);
    p.restore = async (texts) => { await tick(5); p.restored = texts; p.shards = new Map(Object.entries(texts)); };
    p.clear = () => { p.cleared++; p.shards.clear(); };
    return p;
  };
  const libText = (ids) => JSON.stringify({ v: 1, games: ids.map((id) => ({ id, sans: "e4 e5", plies: 2 })) });

  // a flush writes the touched shards, into their other slot, and lists them
  const h = withStore(null);
  h.m.set(LS("library"), JSON.stringify({ v: 1, games: [], names: [], db: 2, n: 2 }));
  const P = createPersist(h, () => {});
  P.load();
  const lib = port({ lib00: libText(["lib:a"]), lib3f: libText(["lib:b"]) });
  P.attachBulk(lib);
  await P.recover();
  await tick(600);
  let meta = metaOf(h);
  assert(meta.keys.includes("lib00") && meta.keys.includes("lib3f") && valOf(h, "lib00") === libText(["lib:a"]),
    "C1: the first flush mirrors every shard the library names (" + meta.keys.filter((k) => BULK.test(k)).join(",") + ")");
  h.writes.length = 0;
  lib.shards.set("lib00", libText(["lib:a", "lib:c"]));
  assert(P.touchBulk(["lib00"]) === true, "C1: touchBulk stamps like set()");
  await tick(600);
  assert(h.writes.join(",") === "lib00-b," + STORE_META, "C1: a touched shard is written alone, into its other slot, then the manifest (" + h.writes.join(",") + ")");
  assert(valOf(h, "lib00") === libText(["lib:a", "lib:c"]) && valOf(h, "lib3f") === libText(["lib:b"]),
    "C1: …the manifest points at the new copy and keeps the untouched shard");
  assert(Number(h.m.get("chess.writtenAt")) === metaOf(h).writtenAt, "C1: …at the cache's revision");

  // a shard the library emptied goes from the manifest, and its files are cleared
  h.writes.length = 0;
  lib.shards.delete("lib3f");
  P.touchBulk(["lib3f"]);
  await tick(600);
  meta = metaOf(h);
  assert(!meta.keys.includes("lib3f") && h.store.get("lib3f") === "null", "C1: an emptied shard leaves the manifest and its files are cleared");

  // the export carries the games
  const doc = P.exportAll();
  assert(doc.keys.lib00 === libText(["lib:a", "lib:c"]) && !("lib3f" in doc.keys), "C1: exportAll has the library's shards");

  // a port that is not ready (the chunk still loading) leaves shards owed and
  // the manifest's files alone
  lib.ready = false;
  h.writes.length = 0;
  P.touchBulk(["lib00"]);
  P.set("save", JSON.stringify({ v: 1, pgn: "1. e4 *" }));
  await tick(600);
  assert(!h.writes.some((w) => BULK.test(w.replace(/-b$/, ""))) && valOf(h, "lib00") === libText(["lib:a", "lib:c"]),
    "C1: before the library has loaded, its shards stay owed and the store keeps the copy it has");
  lib.ready = true;
  P.set("save", JSON.stringify({ v: 1, pgn: "1. d4 *" }));
  await tick(600);
  assert(h.writes.some((w) => w.startsWith("lib00")), "C1: …and go out with the next flush once it has");

  // restoreAll (导入全部数据): the document's games go to IndexedDB (the port)
  // and to the store — not the library the page is still holding
  h.writes.length = 0;
  const incoming = { lib01: libText(["lib:x"]) };
  P.restoreAll({ app: "chessboard", schema: 2, writtenAt: 99, keys: Object.assign({ save: JSON.stringify({ v: 1, pgn: "1. c4 *" }) }, incoming) });
  P.freeze();
  await P.flushMirror();
  assert(lib.restored && lib.restored.lib01 === incoming.lib01, "C1: a restored profile's shards reach the library's store before the flush");
  meta = metaOf(h);
  assert(valOf(h, "lib01") === incoming.lib01 && !meta.keys.includes("lib00"),
    "C1: …the store holds the document's shards, and a shard the document lacks is gone (" + meta.keys.filter((k) => BULK.test(k)).join(",") + ")");

  // readBulk: the shards as the store holds them, for a library that lost IndexedDB
  const back = await P.readBulk();
  assert(back && back.lib01 === incoming.lib01 && Object.keys(back).length === 1, "C1: readBulk returns the store's shards");
}

// 2x′. v8-1-plan T3: the repertoire's records ride as "rep0" … "rep3" behind a
// port of their own — each owner serves, restores and clears only its shards
{
  const h = withStore(null);
  h.m.set(LS("repertoire"), JSON.stringify({ v: 1, w: [], b: [], db: 2, n: 1 }));
  const P = createPersist(h, () => {});
  P.load();
  const mk = (m) => {
    const p = { m: new Map(Object.entries(m)), restored: null, cleared: 0 };
    p.names = () => [...p.m.keys()];
    p.read = (n) => (p.m.has(n) ? p.m.get(n) : null);
    p.restore = async (texts) => { p.restored = texts; };
    p.clear = () => { p.cleared++; p.m.clear(); };
    return p;
  };
  const lib = mk({ lib00: "L0" }), rep = mk({ rep2: "R2" });
  P.attachBulk(lib);
  P.attachBulk(rep, "rep");
  await P.recover();
  await tick(600);
  const meta = metaOf(h);
  assert(meta.keys.includes("lib00") && meta.keys.includes("rep2") && valOf(h, "rep2") === "R2",
    "T3: the first flush mirrors both owners' shards (" + meta.keys.filter((k) => BULK.test(k)).join(",") + ")");
  assert(BULK.test("rep0") && BULK.test("rep3") && !BULK.test("rep4") && !BULK.test("repertoire"), "T3: rep0–rep3 are shard names, the header key is not");
  h.writes.length = 0;
  rep.m.set("rep2", "R2'");
  P.touchBulk(["rep2"]);
  await tick(600);
  assert(h.writes.join(",") === "rep2-b," + STORE_META && valOf(h, "lib00") === "L0", "T3: a touched rep shard is written alone; the library's stay (" + h.writes.join(",") + ")");
  const onlyRep = await P.readBulk("rep");
  assert(onlyRep && Object.keys(onlyRep).join() === "rep2" && onlyRep.rep2 === "R2'", "T3: readBulk(\"rep\") returns the repertoire's shards only");
  P.restoreAll({ app: "chessboard", schema: 2, writtenAt: 99, keys: { lib01: "L1", rep1: "R1" } });
  P.freeze();
  await P.flushMirror();
  assert(JSON.stringify(lib.restored) === JSON.stringify({ lib01: "L1" }) && JSON.stringify(rep.restored) === JSON.stringify({ rep1: "R1" }),
    "T3: a restore hands each owner its own shards", JSON.stringify([lib.restored, rep.restored]));
  const h2 = withStore(null);
  const P2 = createPersist(h2, () => {});
  P2.load();
  const lib2 = mk({ lib00: "L0" }), rep2 = mk({ rep0: "R0" });
  P2.attachBulk(lib2);
  P2.attachBulk(rep2, "rep");
  P2.clearAll();
  assert(lib2.cleared === 1 && rep2.cleared === 1, "T3: 清除全部存档 clears both owners");
}

// 2y. recover(): a cleared cache is restored with its games, and the reload
// waits for them to be in IndexedDB
{
  const h = withStore(null);
  const t1 = JSON.stringify({ v: 1, games: [{ id: "lib:q", sans: "d4", plies: 1 }] });
  h.store.set("save", JSON.stringify({ v: 1, pgn: "1. Nf3 *" }));
  h.store.set("lib07", t1);
  h.store.set(STORE_META, JSON.stringify({ app: "chessboard", schema: 2, writtenAt: 5000, keys: ["save", "lib07"] }));
  const P = createPersist(h, () => {});
  P.load();
  let got = null, at = 0;
  P.attachBulk({ names: () => [], read: () => null, restore: async (texts) => { await tick(30); got = texts; at = Date.now(); } });
  const r = await P.recover();
  assert(r === "restored" && got && got.lib07 === t1 && at > 0, "C1: recover() hands the store's shards to the library before it answers \"restored\"");

  // clearAll: the library is told, and the shard files go
  const h2 = withStore(null);
  h2.m.set(LS("library"), JSON.stringify({ v: 1, games: [], names: [], db: 2, n: 1 }));
  const P2 = createPersist(h2, () => {});
  P2.load();
  let cleared = 0;
  const shards = new Map([["lib05", t1]]);
  P2.attachBulk({ names: () => [...shards.keys()], read: (n) => shards.get(n) || null, restore: async () => {}, clear: () => { cleared++; shards.clear(); } });
  await P2.recover();
  await tick(600);
  assert(metaOf(h2).keys.includes("lib05"), "C1: (a shard in the store)");
  P2.clearAll();
  await P2.flushMirror();
  assert(cleared === 1 && !metaOf(h2).keys.includes("lib05") && h2.store.get("lib05") === "null" && h2.store.get("lib05-b") === "null",
    "C1: 清除全部存档 clears the library's store and its shard files");
}

// M5 review P3-1: a manifest from before the shards (an 8.0 dev build commits
// KEYS alone), at the cache's revision, owes nothing — so the games the
// library holds must be marked owed against what that manifest lists
{
  const h = withStore(null);
  const save = JSON.stringify({ v: 1, pgn: "1. e4 *" });
  const t1 = JSON.stringify({ v: 1, games: [{ id: "lib:q", sans: "d4", plies: 1 }] });
  const t2 = JSON.stringify({ v: 1, games: [{ id: "lib:r", sans: "c4", plies: 1 }] });
  h.store.set("save", save);
  h.store.set("lib01", t2);
  h.store.set(STORE_META, JSON.stringify({ app: "chessboard", schema: 2, writtenAt: 7000, keys: ["save", "lib01"] }));
  h.m.set(LS("save"), save);
  h.m.set("chess.schema", "2");
  h.m.set("chess.writtenAt", "7000");
  const P = createPersist(h, () => {});
  P.load();
  const shards = new Map([["lib00", t1], ["lib01", t2]]);
  P.attachBulk({ names: () => [...shards.keys()], read: (n) => shards.get(n) || null, restore: async () => {}, clear: () => {} });
  const r = await P.recover();
  await tick(600);
  assert(r === "kept" && !metaOf(h).keys.includes("lib00"), "(in step with a manifest that lacks lib00: nothing owed — " + r + ")");
  h.writes.length = 0;
  const n = typeof P.touchUnlisted === "function" ? await P.touchUnlisted([...shards.keys()]) : -1;
  await tick(600);
  assert(n === 1 && valOf(h, "lib00") === t1 && valOf(h, "lib01") === t2 && !h.writes.includes("lib01") && !h.writes.includes("lib01-b"),
    "P3-1: the shard the manifest does not list is written, the one it lists is left (" + n + "; " + h.writes.join(",") + ")");
}

// M5 review P2-1: a library that cannot say which shards exist (no IndexedDB
// this session) leaves the store's shards and the manifest's list alone —
// after a launch that owes the store everything, not only after a quiet one
{
  const h = withStore(null);
  const t1 = JSON.stringify({ v: 1, games: [{ id: "lib:q", sans: "d4", plies: 1 }] });
  h.m.set(LS("library"), JSON.stringify({ v: 1, games: [], names: [], db: 2, n: 1 }));
  let P = createPersist(h, () => {});
  P.load();
  P.attachBulk({ names: () => ["lib00"], read: () => t1 });
  await P.recover();
  await tick(600);
  h.m.set("chess.writtenAt", String(Date.now() + 5));   // the cache newer than the store: every key owed
  P = createPersist(h, () => {});
  P.load();
  P.attachBulk({ names: () => null, read: () => null });
  await P.recover();
  P.set("save", JSON.stringify({ v: 1, pgn: "1. d4 *" }));
  await tick(600);
  assert(metaOf(h).keys.includes("lib00") && valOf(h, "lib00") === t1,
    "P2-1: shards the library cannot name stay listed and whole (" + metaOf(h).keys.filter((k) => BULK.test(k)).join(",") + ")");
}

// M5 review P2-3: 导出全部数据 / 导入全部数据 at the library's cap. Every
// shard rides in the export, so ten thousand analysed games (~2.6 KB each)
// are ~28 MB — past the 16 MiB a picked file could be. Through host.js and
// the stand-in for main.zig: exported, written, read back and restored whole.
{
  const plies = 80;
  const sans = Array.from({ length: plies }, (_, i) => ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6"][i % 8]).join(" ");
  const entry = (i) => ({ id: "lib:" + i.toString(36).padStart(6, "0"), t: 1758000000000 + i, white: "someplayer", black: "opponent_" + (i % 97),
    date: "2026.09.21", event: "Rated blitz game", site: "https://lichess.org/Ab3dEf7h", round: "-", result: "1-0", tc: "180+2",
    plies, sans, fen: "", side: "w", outcome: "win", eco: "C50", ecoName: "Italian Game",
    clk: Array.from({ length: plies }, (_, k) => 180 - k), motifs: { 3: "fork" },
    an: { acc: { w: 83.4, b: 71.2 }, acpl: { w: 41.3, b: 66.2 }, budget: 900,
      tags: Array.from({ length: plies }, (_, k) => ["", "", "?!", "?", "??", "!"][k % 6]),
      losses: Array.from({ length: plies }, (_, k) => (k * 37) % 400),
      scalars: Array.from({ length: plies + 1 }, (_, k) => ((k * 97) % 900) - 450),
      bests: Array.from({ length: plies }, () => "e2e4") } });
  const per = JSON.stringify(entry(0)).length;
  const shards = new Map();
  for (let i = 0; i < 10000; i++) {
    const name = "lib" + (i % 64).toString(16).padStart(2, "0");
    if (!shards.has(name)) shards.set(name, []);
    shards.get(name).push(entry(i));
  }
  const texts = new Map([...shards].map(([k, v]) => [k, JSON.stringify({ v: 1, games: v })]));
  const h = withStore(null);
  h.m.set(LS("library"), JSON.stringify({ v: 1, games: [], names: ["someplayer"], db: 2, n: 10000 }));
  const P = createPersist(h, () => {});
  P.load();
  P.attachBulk({ names: () => [...texts.keys()], read: (n) => texts.get(n) || null });
  const out = JSON.stringify(P.exportAll());
  const zero = nativeStandIn();
  const H = loadHost(zero);
  let wrote = null, read = null, back = "";
  // v8-1-plan N2: the road 导出 / 导入全部数据 takes — the native dialogs
  zero.pick = "/Users/me/chessboard-all.json";
  try { await H.saveText({ name: "chessboard-all.json", text: out }); wrote = true; } catch (e) { wrote = e; }
  try { back = (await H.openPgn({ max: H.ALL_DATA_MAX })).text; read = true; } catch (e) { read = e; }
  assert(per >= 2500 && out.length > 16 * 1024 * 1024 && wrote === true && read === true && back === out,
    `P2-3: 10,000 analysed games (${per} B each) export as ${(out.length / 1048576).toFixed(1)} MB and read back whole (write ${wrote === true ? "ok" : wrote && wrote.name}, read ${read === true ? "ok" : read && read.name})`);
  const h2 = withStore(null);
  const P2 = createPersist(h2, () => {});
  P2.load();
  let restored = null;
  P2.attachBulk({ names: () => [], read: () => null, restore: async (t) => { restored = t; } });
  if (read === true) P2.restoreAll(JSON.parse(back));
  await P2.bulkSettled();
  const n = restored ? Object.values(restored).reduce((a, t) => a + JSON.parse(t).games.length, 0) : 0;
  assert(n === 10000 && [...texts].every(([k, v]) => restored[k] === v), `P2-3: …and 导入全部数据 hands the library all ${n} games, every shard byte for byte`);
  // a PGN is still read to 16 MiB, as before
  let pgn = null;
  try { await H.openPgn({}); } catch (e) { pgn = e; }
  assert(pgn && pgn.name === H.FILE_TOO_LARGE && pgn.limit === 16 * 1024 * 1024, "P2-3: …while any other file read stops at 16 MiB");
}

// 2z. the shard keys are tokens the native store accepts (main.zig
// storeKeyValid: [A-Za-z0-9_-], ≤ STORE_KEY_MAX), with room for the "-b" slot
{
  const all = Array.from({ length: 64 }, (_, i) => "lib" + i.toString(16).padStart(2, "0"));
  assert(all.every((k) => BULK.test(k) && /^[A-Za-z0-9_-]+$/.test(k + "-b")) && !BULK.test("library") && !BULK.test("lib40"),
    "C1: 64 shard names, all plain tokens; `library` (the header) is an ordinary key");
}

// --- 3. v8-0-plan A3: the look, migrated from 7.x settings ------------------
// The settings record kept one `themeId` (and a `followSystem` switch over
// it) through 7.x; 8.0 keeps four fields. Every old id, the switch, a first
// run and a value nobody wrote must land somewhere deliberate — and every old
// theme must come back as the shell it was, since a profile that opens in a
// different colour looks like a profile that was lost.
{
  const cases = [
    // [stored, want look, want data-theme when the system is light / dark]
    [null, { appearance: "system", boardId: "wood", boardFrame: "flat", pieceSet: "cburnett" }, "day", "wood"],
    [{ mode: "ai" }, { appearance: "system", boardId: "wood", boardFrame: "flat", pieceSet: "cburnett" }, "day", "wood"],
    [{ themeId: "wood" }, { appearance: "dark", boardId: "wood", boardFrame: "flat", pieceSet: "cburnett" }, "wood", "wood"],
    [{ themeId: "night" }, { appearance: "dark", boardId: "green", boardFrame: "flat", pieceSet: "cburnett" }, "night", "night"],
    [{ themeId: "day" }, { appearance: "light", boardId: "wood", boardFrame: "flat", pieceSet: "cburnett" }, "day", "day"],
    [{ themeId: "notebook" }, { appearance: "light", boardId: "blue", boardFrame: "flat", pieceSet: "cburnett" }, "notebook", "notebook"],
    // 7.x's follow switch overrode the theme on every launch; it still does
    [{ themeId: "night", followSystem: true }, { appearance: "system", boardId: "green", boardFrame: "flat", pieceSet: "cburnett" }, "notebook", "night"],
    [{ themeId: "day", followSystem: false, pieceSet: "merida" }, { appearance: "light", boardId: "wood", boardFrame: "flat", pieceSet: "merida" }, "day", "day"],
    // 7.7+ wrote "cburnett" for everybody: it is the new default drawing now
    [{ themeId: "wood", pieceSet: "cburnett" }, { appearance: "dark", boardId: "wood", boardFrame: "flat", pieceSet: "cburnett" }, "wood", "wood"],
    // garbage falls back field by field
    [{ themeId: "toString", pieceSet: "nope" }, { appearance: "system", boardId: "wood", boardFrame: "flat", pieceSet: "cburnett" }, "day", "wood"],
    // 8.0 settings are read as written, and win over the themeId beside them
    [{ themeId: "wood", followSystem: false, appearance: "light", boardId: "marble", boardFrame: "frame", pieceSet: "fantasy" },
      { appearance: "light", boardId: "marble", boardFrame: "frame", pieceSet: "fantasy" }, "day", "day"],
    [{ appearance: "dark", boardId: "paper", boardFrame: "sideways", pieceSet: "classic" },
      { appearance: "dark", boardId: "paper", boardFrame: "flat", pieceSet: "classic" }, "wood", "wood"],
    [{ appearance: "sepia", boardId: "blue" }, { appearance: "system", boardId: "blue", boardFrame: "flat", pieceSet: "cburnett" }, "notebook", "night"],
  ];
  for (const [stored, want, lightShell, darkShell] of cases) {
    const got = migrateLook(stored);
    assert(JSON.stringify(got) === JSON.stringify(want),
      "migrateLook(" + JSON.stringify(stored) + ") = " + JSON.stringify(got));
    assert(lookAttrs(got, false).theme === lightShell && lookAttrs(got, true).theme === darkShell,
      "…in the " + lightShell + " / " + darkShell + " shell on a light / dark system");
  }
  // every 7.x theme is covered, and comes back as exactly the shell it was
  for (const id of ["wood", "night", "day", "notebook"]) {
    assert(Object.prototype.hasOwnProperty.call(LEGACY_THEMES, id), "7.x theme " + id + " has a migration");
    for (const dark of [false, true]) {
      assert(lookAttrs(migrateLook({ themeId: id }), dark).theme === id,
        "7.x theme " + id + " opens in its own shell (system " + (dark ? "dark" : "light") + ")");
    }
  }
  assert(JSON.stringify(migrateLook(null)) === JSON.stringify(LOOK_DEFAULT), "a first run gets the default look");
  assert(LOOK_DEFAULT.appearance === "system" && LOOK_DEFAULT.boardFrame === "flat",
    "…which follows the system, on the flat board (§8 decision 3)");
  // what the stored record can say is what the pickers offer
  for (const id of PIECE_SET_IDS) {
    assert(migrateLook({ appearance: "system", pieceSet: id }).pieceSet === id, "piece set " + id + " survives a save");
  }
  for (const id of BOARD_IDS) {
    assert(migrateLook({ appearance: "system", boardId: id }).boardId === id, "board " + id + " survives a save");
  }
}

// v8-0-plan B4: stats v2 may carry the engine-game rating. Optional — no
// version bump, a 7.x build reads v2 and writes back what it read — and
// vetted: a malformed rating is dropped, never the games with it.
{
  const h = withStore(null);
  const P = createPersist(h, () => {});
  P.load();
  const games = [{ id: "g1", t: 1, diff: "normal", color: "w", result: "win", moves: 30, pgn: "", ending: "",
    rb: null, ra: 1662, perf: 2100 }];
  const good = { v: 2, games, rating: { r: 1662.4, rd: 290.3, vol: 0.06, at: 1, n: 1 } };
  P.setJson("stats", good);
  let r = P.read("stats");
  assert(r.state === "ok" && JSON.stringify(r.value) === JSON.stringify(good),
    "B4: a stats record with a rating reads back as written, games carrying rb / ra / perf");
  for (const bad of [{ r: "1662" , rd: 290, vol: 0.06 }, { r: 1662, rd: 0, vol: 0.06 }, { r: 1662, rd: 290 }, null, 7]) {
    P.setJson("stats", { v: 2, games, rating: bad });
    r = P.read("stats");
    assert(r.state === "ok" && !("rating" in r.value) && r.value.games.length === 1,
      "B4: a malformed rating (" + JSON.stringify(bad) + ") is dropped and the games are kept");
  }
  P.setJson("stats", { v: 2, games });
  r = P.read("stats");
  assert(r.state === "ok" && !("rating" in r.value), "B4: a 7.x record without a rating reads as it is");
  // a v1 record still migrates, and a rating on it survives the unpacking
  P.setJson("stats", { v: 1, games: [{ t: 1, sig: "e4 e5#resigned", result: "win" }], rating: good.rating });
  r = P.read("stats");
  assert(r.state === "ok" && r.value.v === 2 && r.value.games[0].ending === "resigned",
    "B4: …and a v1 record still comes forward");
}

if (failed) { console.error(failed + " 项失败"); process.exit(1); }
console.log("all passed");
