/**
 * Host port: Native SDK bridge + localStorage (no game rules).
 */
(function (global) {
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

  async function writeTextFile(path, text) {
    if (!hasZero()) throw new Error("no bridge");
    await global.zero.invoke("chess.writeTextFile", {
      path: path,
      b64: bytesToBase64(text),
    });
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
    await global.zero.invoke("chess.writeTextFile", { path: path, b64: b64 });
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
    if (r.tooLarge) throw fileTooLargeError(r.limit);
    return base64ToString(r.b64);
  }

  async function saveFileDialog(options) {
    if (!hasZero() || !global.zero.dialogs || !global.zero.dialogs.saveFile) return null;
    return global.zero.dialogs.saveFile(options || {});
  }

  async function openFileDialog(options) {
    if (!hasZero() || !global.zero.dialogs || !global.zero.dialogs.openFile) return null;
    return global.zero.dialogs.openFile(options || {});
  }

  async function revealPath(path) {
    if (!hasZero() || !global.zero.os || !global.zero.os.revealPath) return;
    if (!(await supports("reveal_path", true))) return;
    try {
      await global.zero.os.revealPath(path);
    } catch (_) {}
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
   * @param {{title: string, body?: string}} opts
   * @returns {Promise<boolean>} whether it was actually shown
   */
  async function notify(opts) {
    if (!opts || !opts.title) return false;
    if (!hasZero() || !global.zero.os || !global.zero.os.showNotification) return false;
    if (!(await supports("notifications", false))) return false;
    try { return !!(await global.zero.os.showNotification(opts)); }
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

  function onDropFiles(handler) {
    if (!hasZero() || typeof global.zero.on !== "function") return function () {};
    try {
      return global.zero.on("drop:files", handler);
    } catch (_) {
      return function () {};
    }
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

  global.ChessHost = {
    hasZero,
    bytesToBase64,
    writeTextFile,
    writeBinaryFile,
    readTextFile,
    FILE_TOO_LARGE,
    saveFileDialog,
    openFileDialog,
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
    onAppLifecycle,
    normalizePaths,
  };
})(typeof window !== "undefined" ? window : globalThis);
