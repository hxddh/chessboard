/**
 * Opening a file the player picks, in the app and in a browser.
 *
 * In the app the dialog and the read are native (chess.openPgn, src/dialogs.zig,
 * v8-1-plan N2): the page never sees a path, only the file's name and its
 * bytes, a piece of at most 512 KB per answer, continued by the token the
 * first answer carries. A platform without dialogs answers no_dialog and the
 * browser's picker is used, as everywhere outside the app.
 *
 *   openTextFile({ title, max, accept }) → { name, text } | null (cancelled)
 *   throws FileError { code: "tooLarge" | "read" }
 *   nextOpenedFile(invoke, max)  a file the OS handed the app (double-clicked,
 *                                dropped, a second launch: chess.openedFile,
 *                                src/opened.zig) → { name, text } | null (none
 *                                left); throws FileError with the file's `name`
 * @module services/files
 */

export class FileError extends Error {
  constructor(code, detail = "", file = "") { super(code + (detail ? ": " + detail : "")); this.name = "FileError"; this.code = code; this.file = file; }
}

const inShell = (g = globalThis) => typeof g.zero === "object" && g.zero !== null && typeof g.zero.invoke === "function";

function bytesOf(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/**
 * A file from the shell, in pieces: the first answer from `first`, the rest
 * by the token it carries. null: cancelled, or nothing waiting; undefined: no
 * dialog here.
 */
async function readPieces(invoke, cmd, first, max) {
  let r = await invoke(cmd, first);
  if (!r || typeof r !== "object") throw new FileError("read", "bad answer");
  if (r.cancelled === true || r.none === true) return null;
  if (r.error === "no_dialog") return undefined;
  const file = typeof r.name === "string" ? r.name : "";
  if (r.tooLarge) throw new FileError("tooLarge", "", file);
  if (typeof r.error === "string") throw new FileError("read", r.error, file);
  if (typeof r.b64 !== "string") throw new FileError("read", "no bytes", file);
  const name = String(r.name || "");
  const token = typeof r.token === "number" ? r.token : 0;
  const parts = [bytesOf(r.b64)];
  let size = parts[0].length;
  while (r.more === true) {
    if (size > max) throw new FileError("tooLarge", "", name);
    r = await invoke(cmd, { token, offset: size });
    if (r && r.tooLarge) throw new FileError("tooLarge", "", name);
    if (!r || typeof r.b64 !== "string") throw new FileError("read", (r && r.error) || "broke off", name);
    const piece = bytesOf(r.b64);
    if (!piece.length && r.more === true) throw new FileError("read", "no progress", name);
    parts.push(piece);
    size += piece.length;
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { bytes.set(p, at); at += p.length; }
  // decoded once, whole: a piece boundary can fall inside a UTF-8 sequence
  return { name, text: new TextDecoder().decode(bytes) };
}

/**
 * The native dialog and read. null: cancelled; undefined: no dialog here.
 * @param {(cmd: string, payload: object) => Promise<any>} invoke
 */
export function nativeOpen(invoke, { title = "", max }) {
  return readPieces(invoke, "chess.openPgn", { title, max, recent: false }, max);
}

/**
 * The next file the OS handed the app, or null when none is waiting.
 * @param {(cmd: string, payload: object) => Promise<any>} invoke
 */
export async function nextOpenedFile(invoke, max = 64 * 1024 * 1024) {
  const r = await readPieces(invoke, "chess.openedFile", {}, max);
  return r || null;
}

/** The browser's picker. Resolves null when the player closes it without a file (where the browser says so). */
function browserOpen({ accept, max }) {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.hidden = true;
    input.dataset.test = "file-input";
    let done = false;
    const finish = (fn) => { if (done) return; done = true; input.remove(); fn(); };
    input.addEventListener("cancel", () => finish(() => resolve(null)));
    input.addEventListener("change", () => {
      const f = input.files && input.files[0];
      if (!f) { finish(() => resolve(null)); return; }
      if (f.size > max) { finish(() => reject(new FileError("tooLarge"))); return; }
      f.text().then((text) => finish(() => resolve({ name: f.name, text })), (e) => finish(() => reject(new FileError("read", e && e.message))));
    });
    document.body.append(input);
    input.click();
  });
}

export async function openTextFile({ title = "", max = 16 * 1024 * 1024, accept = ".pgn,.json,.txt" } = {}) {
  if (inShell()) {
    const r = await nativeOpen((cmd, p) => globalThis.zero.invoke(cmd, p), { title, max });
    if (r !== undefined) return r;
  }
  return browserOpen({ accept, max });
}
