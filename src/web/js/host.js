/**
 * Host port: Native SDK bridge + localStorage (no game rules).
 */
// `global` here means the real global object: `zero` is injected by the
// Native SDK WebView, so it can only ever be read from there.
const global = typeof window !== "undefined" ? window : globalThis;
  function hasZero() {
    return typeof global.zero === "object" && global.zero != null;
  }

  function bytesToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function base64ToString(b64) {
    const raw = typeof b64 === "string" ? b64 : String(b64);
    const bin = atob(raw);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /**
   * `err.name` on the rejection for a path the native side never issued.
   *
   * v6-plan Q1.2: chess.readTextFile / chess.writeTextFile accept only a path
   * the native side handed out in this process — one a file dialog returned,
   * one that was dropped on the window, or one the OS opened. The dialogs are
   * SDK builtins whose answer main.zig never sees, so the wrappers below call
   * chess.issuePath on every path they return; main.zig validates it (home or
   * a removable volume, no dotfiles, no ~/Library / AppData, no .app bundle)
   * and only then remembers it. A call site that names a path from anywhere
   * else gets this error, which is the point.
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

  /**
   * Register `path` with the native side as one the player picked.
   *
   * Best-effort and silent: on a build without chess.issuePath (or in a
   * browser) the read/write that follows either works as before or fails
   * with its own error, and nothing here can add information to that.
   * @returns {Promise<boolean>} whether the native side accepted it
   */
  async function issuePath(path) {
    if (!path || !hasZero() || typeof global.zero.invoke !== "function") return false;
    try {
      const r = await global.zero.invoke("chess.issuePath", { path: path });
      return !!(r && r.ok);
    } catch (_) { return false; }
  }

  async function issuePaths(input) {
    const paths = normalizePaths(input);
    for (let i = 0; i < paths.length; i++) await issuePath(paths[i]);
    return paths;
  }

  async function writeTextFile(path, text) {
    if (!hasZero()) throw new Error("no bridge");
    const r = await global.zero.invoke("chess.writeTextFile", {
      path: path,
      b64: bytesToBase64(text),
    });
    throwIfRefused(r, path);
  }

  /**
   * Write raw bytes, given as base64.
   *
   * Same bridge command as writeTextFile — the native side has always just
   * base64-decoded and written the result, so it was binary-capable all along.
   * Only this façade assumed text, because bytesToBase64 runs its argument
   * through a UTF-8 encoder first, and a PNG does not survive that.
   *
   * @param {string} b64 base64 of the bytes to write, with no data: prefix
   */
  async function writeBinaryFile(path, b64) {
    if (!hasZero()) throw new Error("no bridge");
    const r = await global.zero.invoke("chess.writeTextFile", { path: path, b64: b64 });
    throwIfRefused(r, path);
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

  async function readTextFile(path) {
    if (!hasZero()) throw new Error("no bridge");
    const r = await global.zero.invoke("chess.readTextFile", { path: path });
    // this used to be a bare base64 string, which had nowhere to put the
    // refusal; the old shape still reads fine.
    if (typeof r === "string") return base64ToString(r);
    if (!r || typeof r !== "object") throw new Error("bad read result");
    throwIfRefused(r, path);
    if (r.tooLarge) throw fileTooLargeError(r.limit);
    return base64ToString(r.b64);
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

  // Both dialogs hand their answer to chess.issuePath before returning it
  // (see UNISSUED_PATH): the dialog is the native side's word that the player
  // chose this path, and the read/write that follows is refused without it.
  async function saveFileDialog(options) {
    if (!hasZero() || !global.zero.dialogs || !global.zero.dialogs.saveFile) throw noFileDialogError();
    const picked = await global.zero.dialogs.saveFile(options || {});
    await issuePaths(picked);
    return picked;
  }

  async function openFileDialog(options) {
    if (!hasZero() || !global.zero.dialogs || !global.zero.dialogs.openFile) throw noFileDialogError();
    const picked = await global.zero.dialogs.openFile(options || {});
    await issuePaths(picked);
    return picked;
  }

  /**
   * Show the saved file in the OS file manager.
   *
   * Returns whether that actually happened. It used to return nothing and
   * swallow every failure, and the caller then said 「已导出 report.png」 —
   * a file name and no path, for a file the app had just put somewhere the
   * player never saw. When the folder does not open, the path is the only
   * thing left that answers "where did it go", so the caller needs to know.
   * @returns {Promise<boolean>}
   */
  async function revealPath(path) {
    if (!hasZero() || !global.zero.os || !global.zero.os.revealPath) return false;
    if (!(await supports("reveal_path", true))) return false;
    try {
      await global.zero.os.revealPath(path);
      return true;
    } catch (_) { return false; }
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
      // a dropped path is native-issued too — register it before the handler
      // reads it (see UNISSUED_PATH)
      return global.zero.on("drop:files", async function (payload) {
        await issuePaths(eventPaths(payload));
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
  // One native file, chessboard.json, in the per-user data directory
  // (macOS ~/Library/Application Support/Chessboard/, Windows
  // %APPDATA%\Chessboard\). The page owns the contents; the native side
  // writes atomically (tmp → rename) and keeps the previous file as
  // chessboard.json.bak. Every wrapper answers null when there is no bridge
  // (the browser) or the platform gave no data directory, so persist.js can
  // keep localStorage as the fallback and the one-time migration source.

  /**
   * @returns {Promise<{text: string, bak?: boolean}|{missing: true}|{empty: true}|null>}
   *   the file (with `bak` true when the native side had to fall back to
   *   chessboard.json.bak), "no file yet" (a fresh install — migrate from
   *   localStorage), "the file is there and holds nothing" (6.1: damage, not
   *   a fresh install), or null when native storage is unavailable here.
   *   Throws FileTooLargeError when the file is over the native limit.
   */
  async function appdataRead() {
    if (!hasZero() || typeof global.zero.invoke !== "function") return null;
    let r;
    try { r = await global.zero.invoke("chess.appdataRead", {}); }
    catch (_) { return null; }
    if (!r || typeof r !== "object") return null;
    if (r.missing) return { missing: true };
    if (r.empty) return { empty: true };
    if (r.tooLarge) throw fileTooLargeError(r.limit);
    if (r.error || typeof r.b64 !== "string") return null;
    return { text: base64ToString(r.b64), bak: r.bak === true };
  }

  /**
   * @returns {Promise<boolean|null>} true when written, null when native
   *   storage is unavailable here. Throws when the native side refused or
   *   failed the write — the caller must NOT treat that as saved.
   */
  async function appdataWrite(text) {
    if (!hasZero() || typeof global.zero.invoke !== "function") return null;
    const r = await global.zero.invoke("chess.appdataWrite", { b64: bytesToBase64(String(text)) });
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

  /** @returns {Promise<string|null>} where chessboard.json lives, for About */
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

  function onAppLifecycle(handlers) {
    if (!hasZero() || typeof global.zero.on !== "function") return;
    try {
      if (handlers.deactivate) global.zero.on("app:deactivate", handlers.deactivate);
      if (handlers.activate) global.zero.on("app:activate", handlers.activate);
      if (handlers.shortcut) global.zero.on("shortcut", handlers.shortcut);
    } catch (_) {}
  }

  /** Normalize openFile / drop path lists to string paths. */
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
    writeBinaryFile,
    readTextFile,
    FILE_TOO_LARGE,
    NO_FILE_DIALOG,
    UNISSUED_PATH,
    issuePath,
    saveFileDialog,
    openFileDialog,
    showMessage,
    revealPath,
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
    appdataRead,
    appdataWrite,
    appdataPath,
    setMenuLanguage,
    checkUpdate,
  };
