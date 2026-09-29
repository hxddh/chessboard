/**
 * Host port: Native SDK bridge + localStorage (no game rules).
 */
// `global` here means the real global object: `zero` is injected by the
// Native SDK WebView, so it can only ever be read from there.
const global = typeof window !== "undefined" ? window : globalThis;
  function hasZero() {
    return typeof global.zero === "object" && global.zero != null;
  }

  // ---- bytes over the bridge (v8-0-plan F3) --------------------------------
  //
  // Everything the native side reads or writes rides as base64 in a JSON
  // frame, and the SDK caps one frame at 1 MiB each way (0.10.1:
  // bridge.max_message_bytes / max_result_bytes). So a transfer is cut into
  // pieces of CHUNK raw bytes — main.zig's CHUNK_BYTES, whose base64 plus the
  // envelope fits a frame — and anything larger than one piece goes as
  // several: a write as {txn, total, offset, b64} pieces the native side
  // stages and commits once the last one is in, a read as {offset} requests
  // answered {b64, more}. One piece is sent exactly as before (no txn), which
  // is also what every earlier shell understood.
  const CHUNK = 512 * 1024;
  /** main.zig FILE_MAX_BYTES: the largest file either direction carries. */
  const FILE_MAX = 16 * 1024 * 1024;
  /**
   * main.zig USER_FILE_MAX_BYTES: what 导入全部数据 may read (M5 review P2-3).
   * The export carries every library shard, and an analysed 80-ply game is
   * ~2.6 KB of JSON: 10,000 of them (library.js MAX_GAMES) are ~28 MB once
   * escaped into the export, past 16 MiB at ~5,500 games. 64 MiB is twice
   * the full library plus every other key. A PGN is still read to FILE_MAX.
   */
  const ALL_DATA_MAX = 64 * 1024 * 1024;

  /**
   * base64 of raw bytes, a slice at a time.
   *
   * It used to append one String.fromCharCode per byte to a growing string:
   * 2 MB took 80+ ms on the main thread, on every autosave. btoa over slices
   * of 3 × 8192 bytes does the same work in native code; every slice but the
   * last is a whole number of 3-byte groups, so the pieces join without
   * padding in between.
   */
  function b64FromBytes(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i += 24576) {
      out += btoa(String.fromCharCode.apply(null, bytes.subarray(i, i + 24576)));
    }
    return out;
  }

  function bytesFromB64(b64) {
    const bin = atob(typeof b64 === "string" ? b64 : String(b64));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function bytesToBase64(str) {
    return b64FromBytes(new TextEncoder().encode(str));
  }

  function base64ToString(b64) {
    return new TextDecoder().decode(bytesFromB64(b64));
  }

  let txnSeq = 0;
  /** A name for one chunked write, unique in this page ([A-Za-z0-9_-], ≤ 32). */
  function newTxn() {
    txnSeq = (txnSeq + 1) % 1e9;
    return "p" + Date.now().toString(36) + "-" + txnSeq.toString(36) + "-" + Math.floor(Math.random() * 1e9).toString(36);
  }

  /**
   * Send `bytes` through `call` (one bridge command), in pieces when they
   * would not fit one frame.
   * @param {(fields: object) => Promise<any>} call the invoke, command fixed
   * @param {object} fields what every piece carries besides the bytes
   * @param {Uint8Array} bytes
   * @returns {Promise<any>} the answer to the last piece, or the first answer
   *   that was not "go on" (a refusal, or a shell that does not stage)
   */
  async function sendBytes(call, fields, bytes) {
    if (bytes.length <= CHUNK) return call(Object.assign({}, fields, { b64: b64FromBytes(bytes) }));
    for (let attempt = 0; ; attempt++) {
      const txn = newTxn();
      let r = null;
      for (let offset = 0; offset < bytes.length; offset += CHUNK) {
        // one slice encoded per bridge round trip, so no single task on the
        // main thread holds more than CHUNK bytes' worth of this
        const b64 = b64FromBytes(bytes.subarray(offset, offset + CHUNK));
        r = await call(Object.assign({}, fields, { txn, total: bytes.length, offset, b64 }));
        const last = offset + CHUNK >= bytes.length;
        if (last || (r && typeof r === "object" && r.ok === true && r.pending === true)) continue;
        // "done" before the last piece is a shell that ignored the staging
        // fields and wrote this one piece as the whole file: not saved
        if (r === true || (r && typeof r === "object" && r.ok === true)) r = { error: "not_staged" };
        break;
      }
      // Another transfer took this one's staging slot (main.zig keeps a few
      // at once; two windows saving together can use them up). Once more
      // from the top is enough — the other writer is not a loop.
      if (r && r.error === "stage_lost" && attempt === 0) continue;
      return r;
    }
  }

  /**
   * Read through `call`, following {more} until the whole content is in.
   * @returns {Promise<any>} the first answer, with `bytes` (Uint8Array) set to
   *   the whole content when it carried any; any other shape ({missing},
   *   {tooLarge}, an error, an older shell's bare string) exactly as it came
   */
  async function readBytes(call, fields, max) {
    const limit = max || FILE_MAX;
    const first = await call(fields);
    if (!first || typeof first !== "object" || typeof first.b64 !== "string") return first;
    const parts = [bytesFromB64(first.b64)];
    let size = parts[0].length;
    let r = first;
    while (r.more === true) {
      if (size > limit) throw fileTooLargeError(limit);
      // the .bak the first piece came from, if it did: the rest must too
      r = await call(Object.assign({}, fields, { offset: size }, first.bak === true ? { bak: true } : null));
      if (!r || typeof r !== "object" || typeof r.b64 !== "string") throw new Error("chunked read broke off");
      const piece = bytesFromB64(r.b64);
      if (!piece.length && r.more === true) throw new Error("chunked read made no progress");
      parts.push(piece);
      size += piece.length;
    }
    let bytes = parts[0];
    if (parts.length > 1) {
      bytes = new Uint8Array(size);
      let at = 0;
      for (const p of parts) { bytes.set(p, at); at += p.length; }
    }
    return Object.assign({}, first, { bytes, more: false });
  }

  /** A write answer that says the native side did not take it. */
  function throwIfWriteRefused(r, path) {
    throwIfRefused(r, path);
    if (r && typeof r === "object") {
      if (r.tooLarge) throw fileTooLargeError(r.limit);
      if (typeof r.error === "string") throw new Error("write failed: " + r.error);
    }
  }

  /**
   * `err.name` on the rejection for a path the native side never issued.
   *
   * v6-plan Q1.2: chess.readTextFile / chess.writeTextFile accept only a path
   * the native side handed out in this process — one that was dropped on the
   * window, or one the OS opened; main.zig issues both itself (v8-0-plan F3).
   * The file dialogs no longer hand the page a path at all: they run in
   * main.zig (openPgn / saveText below, v8-1-plan N2), and chess.issuePath,
   * which the page once called on what they returned, is left for older
   * pages only. A call site that names a path from anywhere else gets this
   * error, which is the point.
   */
  const UNISSUED_PATH = "UnissuedPathError";

  function unissuedPathError(path) {
    const e = new Error("path was not issued by the native side");
    e.name = UNISSUED_PATH;
    e.path = path;
    return e;
  }

  /** The refusal, if `r` is one; the old "true" / bare-string shapes pass. */
  function throwIfRefused(r, path) {
    if (r && typeof r === "object" && r.error === "unissued_path") throw unissuedPathError(path);
  }

  async function writeTextFile(path, text) {
    if (!hasZero()) throw new Error("no bridge");
    const r = await sendBytes((f) => global.zero.invoke("chess.writeTextFile", f),
      { path: path }, new TextEncoder().encode(String(text)));
    throwIfWriteRefused(r, path);
  }

  /**
   * `err.name` on the rejection you get when the native side refused a file
   * for being over its read limit. It is called out separately because "this
   * file is too big" and "this file is not a PGN" need different words on
   * screen, and the caller could not tell them apart while the bridge handed
   * back the first 256 KiB of an oversized file as if that were all of it.
   */
  const FILE_TOO_LARGE = "FileTooLargeError";

  function fileTooLargeError(limit) {
    const e = new Error("file too large");
    e.name = FILE_TOO_LARGE;
    e.limit = limit || 0;
    return e;
  }

  /** @param {number} [max] the most to read: FILE_MAX, or ALL_DATA_MAX for 导入全部数据 */
  async function readTextFile(path, max) {
    if (!hasZero()) throw new Error("no bridge");
    const r = await readBytes((f) => global.zero.invoke("chess.readTextFile", f), { path: path }, max);
    // this used to be a bare base64 string, which had nowhere to put the
    // refusal; the old shape still reads fine.
    if (typeof r === "string") return base64ToString(r);
    if (!r || typeof r !== "object") throw new Error("bad read result");
    throwIfRefused(r, path);
    if (r.tooLarge) throw fileTooLargeError(r.limit);
    if (!r.bytes) throw new Error("bad read result");
    // decoded once, whole: a piece boundary can fall inside a UTF-8 sequence
    return new TextDecoder().decode(r.bytes);
  }

  /**
   * `err.name` for "this build has no file dialogs at all".
   *
   * Both dialog helpers used to answer `null` for that, and `null` is also how
   * the SDK says "the player pressed Cancel". Every call site read it the
   * second way, so on a build without `zero.dialogs` exporting a PGN said
   * 「已取消导出」 — no file, no error, and the blame on the player — while
   * 「打开」 did nothing at all, silently, with no toast and no fallback. The
   * comment further down says exactly this about `supports()`; the missing-API
   * case reaches the same place by a different road.
   *
   * Now it throws, which is what the call sites already handle: their catch
   * takes the browser path.
   */
  const NO_FILE_DIALOG = "NoFileDialogError";

  function noFileDialogError() {
    const e = new Error("file dialogs unavailable");
    e.name = NO_FILE_DIALOG;
    return e;
  }

  /**
   * An answer from chess.openPgn / chess.saveText that is not the file: the
   * platform has no dialog (the call site takes the browser's picker), or the
   * native side could not do it.
   */
  function throwIfDialogRefused(r, what) {
    if (!r || typeof r !== "object") throw new Error(what + ": bad result " + JSON.stringify(r));
    if (r.error === "no_dialog") throw noFileDialogError();
    if (r.tooLarge) throw fileTooLargeError(r.limit);
    if (typeof r.error === "string") throw new Error(what + " failed: " + r.error);
  }

  /**
   * v8-1-plan N2: the open dialog and the read, both in the native layer.
   *
   * Before v8-1-plan N2 the page opened the SDK's dialog, got a path, asked
   * chess.issuePath to trust it and then read it; now main.zig opens the
   * dialog and reads the file itself, and the page gets the text and the
   * file's name — never the path. A file past one bridge piece comes in
   * pieces asked for by the token the first answer carries.
   *
   * @param {{title?: string, max?: number, recent?: boolean}} [opts] `max`:
   *   FILE_MAX unless 导入全部数据 asks for ALL_DATA_MAX; `recent`: put the
   *   file on the OS's recent-documents list (a PGN, not a data file)
   * @returns {Promise<{name: string, text: string}|null>} null: cancelled
   */
  async function openPgn(opts) {
    if (!hasZero() || typeof global.zero.invoke !== "function") throw noFileDialogError();
    const o = opts || {};
    const max = o.max || FILE_MAX;
    const first = { title: String(o.title || ""), max, recent: !!o.recent };
    let token = 0;
    const r = await readBytes(async (f) => {
      if (!f.offset) {
        const a = await global.zero.invoke("chess.openPgn", first);
        if (a && typeof a.token === "number") token = a.token;
        return a;
      }
      return global.zero.invoke("chess.openPgn", { token, offset: f.offset });
    }, {}, max);
    if (r && r.cancelled === true) return null;
    throwIfDialogRefused(r, "open");
    if (!r.bytes) throw new Error("open: bad result");
    // decoded once, whole: a piece boundary can fall inside a UTF-8 sequence
    return { name: String(r.name || ""), text: new TextDecoder().decode(r.bytes) };
  }

  /**
   * v8-1-plan N2: the save dialog, the write and the reveal, in the native
   * layer. The bytes cross first (in pieces past CHUNK, like any write) and
   * main.zig shows the dialog once they are all there, suggesting `name`;
   * then it writes the file and shows it in its folder.
   *
   * @param {{title?: string, name: string, text?: string, b64?: string,
   *          recent?: boolean}} opts `b64` for bytes that are not text (the
   *   report PNG); `recent`: put the file on the recent-documents list
   * @returns {Promise<{name: string, revealed: boolean, path: string}|null>}
   *   null: cancelled. `path` is set only when the folder did not open — it
   *   is for the toast to say where the file went, and no command takes it.
   */
  async function saveText(opts) {
    if (!hasZero() || typeof global.zero.invoke !== "function") throw noFileDialogError();
    const bytes = typeof opts.b64 === "string" ? bytesFromB64(opts.b64) : new TextEncoder().encode(String(opts.text));
    const r = await sendBytes((f) => global.zero.invoke("chess.saveText", f),
      { title: String(opts.title || ""), name: String(opts.name || ""), recent: !!opts.recent }, bytes);
    if (r && r.cancelled === true) return null;
    throwIfDialogRefused(r, "save");
    if (r.ok !== true) throw new Error("save: bad result " + JSON.stringify(r));
    return { name: String(r.name || opts.name || ""), revealed: r.revealed === true, path: String(r.path || "") };
  }

  /**
   * The self-test's `nativeIo` check (v8-1-plan N3): are chess.openPgn and
   * chess.saveText registered and callable here? `probe` answers at once,
   * without a dialog — nobody is there to close one.
   * @returns {Promise<{openPgn: any, saveText: any}>} each command's answer
   */
  async function probeFileCommands() {
    if (!hasZero() || typeof global.zero.invoke !== "function") throw new Error("no bridge");
    const ask = (cmd) => global.zero.invoke(cmd, { probe: true }).catch((err) => ({ error: String((err && err.message) || err) }));
    return { openPgn: await ask("chess.openPgn"), saveText: await ask("chess.saveText") };
  }

  // Deliberately NOT gated on supports(): the clipboard and the file dialogs
  // below have real browser fallbacks, and the call sites in app.js choose
  // between native and browser by asking hasZero(). Returning null from here
  // because the platform said no would read as "the player cancelled" and the
  // fallback would never run — the guard has to move to the call site first,
  // and that is a change with a real risk for a platform nobody has hit yet.

  async function writeClipboard(text) {
    if (hasZero() && global.zero.clipboard && global.zero.clipboard.writeText) {
      await global.zero.clipboard.writeText(text);
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      if (!document.execCommand("copy")) throw new Error("copy failed");
    } finally {
      document.body.removeChild(ta);
    }
  }

  async function readClipboard() {
    if (hasZero() && global.zero.clipboard && global.zero.clipboard.readText) {
      const t = await global.zero.clipboard.readText();
      return t == null ? "" : String(t);
    }
    if (navigator.clipboard && navigator.clipboard.readText) {
      return await navigator.clipboard.readText();
    }
    throw new Error("clipboard read unavailable");
  }

  /**
   * Does the platform actually provide this capability?
   *
   * Until 1.16 every bridge call here guessed: `if (zero.os && zero.os.foo)`
   * proves the *method* exists, which it always does — the SDK ships one API
   * surface for every platform — and says nothing about whether the platform
   * behind it can do the thing. The SDK has a real query for this; use it, and
   * fall back to the old presence check only when the query itself is missing.
   *
   * Answers are cached: the set of things a platform can do does not change
   * while the app is running, and these sit on the path of ordinary actions
   * like opening a file.
   *
   * @param {string} feature an SDK platform-feature name, e.g. "notifications"
   * @param {boolean} [fallback] what to assume when the query is unavailable
   * @returns {Promise<boolean>}
   */
  const _features = new Map();
  async function supports(feature, fallback) {
    if (_features.has(feature)) return _features.get(feature);
    let ok = !!fallback;
    if (hasZero() && global.zero.platform && global.zero.platform.supports) {
      try { ok = !!(await global.zero.platform.supports({ feature: feature })); }
      catch (_) { ok = !!fallback; }
    }
    _features.set(feature, ok);
    return ok;
  }

  /**
   * The platform's own alert.
   *
   * Only worth reaching for where the in-page box is genuinely not enough:
   * something irreversible. A `.modal-bg` is a div — it can be scrolled past,
   * it shares the window with the thing it is asking about, and it looks like
   * the rest of the app, which is exactly wrong for the one question whose
   * answer cannot be taken back. A system alert is the platform's word for
   * "stop and read this", and it is the same word every other app uses.
   *
   * Returns "primary" / "secondary" / "tertiary", or null when this build has
   * no such dialog — null means *fall back*, not "cancelled". Getting that
   * wrong would turn a missing capability into a silently ignored button.
   *
   * @param {{style?: string, title?: string, message?: string,
   *          primaryButton?: string, secondaryButton?: string,
   *          tertiaryButton?: string}} opts
   * @returns {Promise<string|null>}
   */
  async function showMessage(opts) {
    if (!hasZero() || !global.zero.dialogs || !global.zero.dialogs.showMessage) return null;
    if (!(await supports("dialogs", false))) return null;
    try {
      const answer = await global.zero.dialogs.showMessage(opts || {});
      return typeof answer === "string" ? answer : null;
    } catch (_) { return null; }
  }

  /**
   * Remember a document the player opened, for the Dock menu / jump list.
   *
   * Best-effort by design: a recent-documents list is a courtesy, and a
   * platform that cannot offer one must not turn opening a PGN into an error.
   *
   * @param {string} path
   */
  async function addRecentDocument(path) {
    if (!path || !hasZero() || !global.zero.os || !global.zero.os.addRecentDocument) return;
    if (!(await supports("recent_documents", false))) return;
    try { await global.zero.os.addRecentDocument({ path: path }); } catch (_) {}
  }

  /** Forget every remembered document — paired with clearing local data. */
  async function clearRecentDocuments() {
    if (!hasZero() || !global.zero.os || !global.zero.os.clearRecentDocuments) return;
    if (!(await supports("recent_documents", false))) return;
    try { await global.zero.os.clearRecentDocuments(); } catch (_) {}
  }

  /**
   * A system notification, for work that finished while the app was in the
   * background. Never for anything the player is looking at — a toast is the
   * right answer when the window is in front.
   *
   * `id` and the action pair are 0.10.1 (7.0). `id` replaces an earlier
   * notification carrying the same one instead of stacking a new one beside
   * it, which is what a long job needs: analysing three hundred imported
   * games takes half an hour, and twenty progress notifications is not
   * progress, it is a mess. `actionLabel` + `actionCommand` put one button on
   * it that dispatches an ordinary app command — so "分析完成" can offer
   * "看诊断" rather than making the player find the page themselves.
   *
   * Both are dropped on an older shell: the fields are simply ignored there,
   * and the notification still shows. Nothing here branches on the SDK
   * version — a field the host does not know is not an error.
   *
   * @param {{title: string, body?: string, id?: string,
   *          actionLabel?: string, actionCommand?: string}} opts
   * @returns {Promise<boolean>} whether it was actually shown
   */
  async function notify(opts) {
    if (!opts || !opts.title) return false;
    if (!hasZero() || !global.zero.os || !global.zero.os.showNotification) return false;
    if (!(await supports("notifications", false))) return false;
    // the pair travels together or not at all — the SDK rejects a half of it
    const payload = { title: opts.title };
    if (opts.body) payload.body = opts.body;
    if (opts.id) payload.id = String(opts.id);
    if (opts.actionLabel && opts.actionCommand) {
      payload.actionLabel = String(opts.actionLabel);
      payload.actionCommand = String(opts.actionCommand);
    }
    try { return !!(await global.zero.os.showNotification(payload)); }
    catch (_) { return false; }
  }

  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (_) {
      return false;
    }
  }

  function storageRemove(key) {
    try {
      localStorage.removeItem(key);
    } catch (_) {}
  }

  /** The paths inside a drop:files / open:files payload, whichever shape. */
  function eventPaths(payload) {
    return normalizePaths(payload && payload.paths ? payload.paths : payload);
  }

  function onDropFiles(handler) {
    if (!hasZero() || typeof global.zero.on !== "function") return function () {};
    try {
      // v8-0-plan F3 (§6): main.zig issues a dropped path itself, from the
      // SDK's files_dropped event, before the page hears "drop:files" — so a
      // drop no longer goes through chess.issuePath (see UNISSUED_PATH)
      return global.zero.on("drop:files", function (payload) {
        return handler(payload);
      });
    } catch (_) {
      return function () {};
    }
  }

  /**
   * A document the OS opened with this app (a double-clicked .pgn, once the
   * type is registered — scripts/add-pgn-doctype.sh / register-pgn.reg).
   * main.zig forwards it as "open:files" with the same {paths} shape as
   * drop:files and has already issued the paths. Deduplicated over a short
   * window in case the SDK also relays the OS event to the page itself.
   * @returns {function} unsubscribe
   */
  function onOpenFiles(handler) {
    if (!hasZero() || typeof global.zero.on !== "function") return function () {};
    let lastKey = "";
    let lastAt = 0;
    try {
      return global.zero.on("open:files", function (payload) {
        const paths = eventPaths(payload);
        if (!paths.length) return;
        const key = paths.join("\n");
        const now = Date.now();
        if (key === lastKey && now - lastAt < 1000) return;
        lastKey = key;
        lastAt = now;
        return handler({ paths: paths });
      });
    } catch (_) {
      return function () {};
    }
  }

  // ---- app data (v6-plan Q1.1) --------------------------------------------
  //
  // The per-user data directory (macOS ~/Library/Application Support/
  // Chessboard/, Windows %APPDATA%\Chessboard\). The page owns the contents;
  // the native side writes atomically (tmp → rename) and keeps the previous
  // copy as a .bak. Every wrapper answers null when there is no bridge (the
  // browser) or the platform gave no data directory, so persist.js can keep
  // localStorage as the fallback and the one-time migration source.
  //
  // v8-0-plan F3: two kinds of file live there. `key` names one file of the
  // per-key store (store/<key>.json) that persist.js mirrors into since v8-0-plan F3;
  // no key is chessboard.json, the one-document mirror 6.x–7.x wrote, which
  // the page now only reads to migrate from.

  /**
   * @param {string} [key] a store key; omitted for chessboard.json
   * @returns {Promise<{text: string, bak?: boolean}|{missing: true}|{empty: true}|null>}
   *   the file (with `bak` true when the native side had to fall back to
   *   its .bak), "no file yet" (a fresh install — migrate from
   *   localStorage), "the file is there and holds nothing" (6.1: damage, not
   *   a fresh install), or null when native storage is unavailable here.
   *   Throws FileTooLargeError when the file is over the native limit.
   */
  async function appdataRead(key) {
    if (!hasZero() || typeof global.zero.invoke !== "function") return null;
    let r;
    try { r = await readBytes((f) => global.zero.invoke("chess.appdataRead", f), key == null ? {} : { key: String(key) }); }
    catch (err) { if (err && err.name === FILE_TOO_LARGE) throw err; return null; }
    if (!r || typeof r !== "object") return null;
    if (r.missing) return { missing: true };
    if (r.empty) return { empty: true };
    if (r.tooLarge) throw fileTooLargeError(r.limit);
    if (r.error || !r.bytes) return null;
    return { text: new TextDecoder().decode(r.bytes), bak: r.bak === true };
  }

  /**
   * @param {string} text
   * @param {string} [key] a store key; omitted for chessboard.json
   * @returns {Promise<boolean|null>} true when written, null when native
   *   storage is unavailable here. Throws when the native side refused or
   *   failed the write — the caller must NOT treat that as saved.
   */
  async function appdataWrite(text, key) {
    if (!hasZero() || typeof global.zero.invoke !== "function") return null;
    const r = await sendBytes((f) => global.zero.invoke("chess.appdataWrite", f),
      key == null ? {} : { key: String(key) }, new TextEncoder().encode(String(text)));
    if (r && typeof r === "object") {
      if (r.ok) return true;
      if (r.tooLarge) throw fileTooLargeError(r.limit);
      if (r.error === "no_appdata_dir") return null;
      if (typeof r.error === "string") throw new Error("appdata write failed: " + r.error);
    }
    // any other answer is a shell that does not know the command (an older
    // build, a test double): no mirror, and not a failure of the profile
    return null;
  }

  /**
   * Run `fn` holding the per-key store's lock (Codex on #85). Two instances
   * of the app can share one store (a second launch on Windows shares the
   * WebView2 profile, and so its localStorage); a flush reads the manifest,
   * writes key files, commits and cleans up, and two of those interleaved
   * can drop each other's keys. Web Locks are held across every same-origin
   * page of one browser profile, so one whole flush runs at a time. Where
   * the API is missing (Safari before 15.4) there is no second instance to
   * share a store with in practice, and `fn` simply runs.
   * @template T @param {() => Promise<T>} fn @returns {Promise<T>}
   */
  function withStoreLock(fn) {
    const locks = global.navigator && global.navigator.locks;
    if (!locks || typeof locks.request !== "function") return fn();
    return locks.request("chessboard.store", () => fn());
  }

  /** @returns {Promise<string|null>} the data directory, for About */
  async function appdataPath() {
    if (!hasZero() || typeof global.zero.invoke !== "function") return null;
    try {
      const r = await global.zero.invoke("chess.appdataPath", {});
      return r && typeof r === "object" && typeof r.path === "string" ? r.path : null;
    } catch (_) { return null; }
  }

  /**
   * Tell the native shell which UI language the menus should use.
   *
   * The menu bar is built once at launch from app.zon and the Runtime has no
   * rebuild, so the native side stores the choice and applies it at the next
   * launch; the answer says so (`applied: false, restartRequired: true`) and
   * the caller should tell the player. null when there is no bridge.
   * @param {"zh"|"en"|"ja"} lang
   * @returns {Promise<{ok: boolean, applied: boolean, restartRequired: boolean}|null>}
   */
  async function setMenuLanguage(lang) {
    if (!hasZero() || typeof global.zero.invoke !== "function") return null;
    try {
      const r = await global.zero.invoke("chess.setMenuLanguage", { lang: String(lang) });
      return r && typeof r === "object" ? r : null;
    } catch (_) { return null; }
  }

  /**
   * Ask GitHub for the latest release. The native side returns the tag and
   * the release page; comparing that tag with this build's own version — and
   * deciding whether to say anything — is the page's job. Never called at
   * startup on its own; only from an explicit "check for updates".
   *
   * Races the bridge call against 5 s: the native fetch has no timeout of
   * its own, and a check that hangs the About panel is worse than none.
   * @returns {Promise<{tag: string, url: string}|{error: string}|null>} null
   *   when there is no bridge
   */
  async function checkUpdate() {
    if (!hasZero() || typeof global.zero.invoke !== "function") return null;
    const call = global.zero.invoke("chess.checkUpdate", {}).then(
      (r) => (r && typeof r === "object" ? r : { error: "bad_result" }),
      () => ({ error: "network" }),
    );
    const timeout = new Promise((resolve) => setTimeout(() => resolve({ error: "timeout" }), 5000));
    return Promise.race([call, timeout]);
  }

  /**
   * v8-0-plan C2: a player's recent games from Lichess or Chess.com, fetched
   * by the native side (main.zig fetchGames) — the page's CSP stays
   * connect-src 'self'. Called only from the sync dialog's 同步 button,
   * which races it and reads the answer (sync-ui.js ask).
   * @param {{site: string, user: string, max: number}} p
   * @returns {Promise<any>} null when there is no bridge
   */
  function fetchGames(p) {
    return hasZero() && typeof global.zero.invoke === "function" ? global.zero.invoke("chess.fetchGames", p) : Promise.resolve(null);
  }

  /**
   * 7.5 — whether the packaged app was launched with CHESS_SELFTEST=1 (see
   * main.zig). false everywhere else, including every browser and every
   * build without the command.
   * @returns {Promise<boolean>}
   */
  async function selftestMode() {
    if (!hasZero() || typeof global.zero.invoke !== "function") return false;
    try {
      const r = await global.zero.invoke("chess.selftestMode", {});
      return !!(r && r.on === true);
    } catch (_) { return false; }
  }

  /**
   * Hand the self-test's result to the native side, which writes it to
   * CHESS_SELFTEST_OUT and exits the process — this call does not return
   * when it works.
   * @param {{ok: boolean}} report
   */
  async function selftestReport(report) {
    if (!hasZero() || typeof global.zero.invoke !== "function") return;
    try { await global.zero.invoke("chess.selftestReport", report); } catch (_) {}
  }

  function onAppLifecycle(handlers) {
    if (!hasZero() || typeof global.zero.on !== "function") return;
    try {
      if (handlers.deactivate) global.zero.on("app:deactivate", handlers.deactivate);
      if (handlers.activate) global.zero.on("app:activate", handlers.activate);
      if (handlers.shortcut) global.zero.on("shortcut", handlers.shortcut);
    } catch (_) {}
  }

  /** Normalize drop / open:files path lists to string paths. */
  function normalizePaths(input) {
    if (!input) return [];
    const arr = Array.isArray(input) ? input : [input];
    return arr
      .map((p) => {
        if (typeof p === "string") return p;
        if (p && typeof p.path === "string") return p.path;
        if (p && typeof p === "object" && typeof p.toString === "function") {
          const s = p.toString();
          return s && s !== "[object Object]" ? s : "";
        }
        return "";
      })
      .filter(Boolean);
  }

  export const ChessHost = {
    hasZero,
    bytesToBase64,
    writeTextFile,
    readTextFile,
    ALL_DATA_MAX,
    FILE_TOO_LARGE,
    NO_FILE_DIALOG,
    UNISSUED_PATH,
    openPgn,
    saveText,
    probeFileCommands,
    showMessage,
    supports,
    addRecentDocument,
    clearRecentDocuments,
    notify,
    writeClipboard,
    readClipboard,
    storageGet,
    storageSet,
    storageRemove,
    onDropFiles,
    onOpenFiles,
    onAppLifecycle,
    normalizePaths,
    appdataRead: () => appdataRead(),
    appdataWrite: (text) => appdataWrite(text),
    // v8-0-plan F3: one file of the per-key store (persist.js)
    appdataReadKey: (key) => appdataRead(key),
    appdataWriteKey: (key, text) => appdataWrite(text, key),
    withStoreLock,
    appdataPath,
    setMenuLanguage,
    checkUpdate,
    fetchGames,
    selftestMode,
    selftestReport,
  };
