/**
 * Reading the app's own files (ADR 0001, real-device probe): on macOS
 * WKWebView a zero:// fetch has the body but status 0 and no headers, so
 * `r.ok` and Content-Type mean nothing there; and a missing file comes back
 * as index.html (spa_fallback) on both platforms. So: never gate on the
 * status, check what came back instead.
 * @module services/asset
 */
const HTML = [0x3c]; // "<" — index.html standing in for a missing file

/** The bytes at `url`, or a throw when they are empty or are a page. `magic`: bytes the file must start with. */
export async function fetchBytes(url, { magic = null } = {}) {
  let r;
  try { r = await fetch(url); } catch (e) { throw new Error("asset: " + url + ": " + (e && e.message || e)); }
  const buf = await r.arrayBuffer();
  const head = new Uint8Array(buf, 0, Math.min(16, buf.byteLength));
  if (!buf.byteLength) throw new Error("asset: " + url + " is empty (status " + r.status + ")");
  if (magic ? !magic.every((b, i) => head[i] === b) : head[0] === HTML[0] && String.fromCharCode(...head).toLowerCase().startsWith("<!doctype")) {
    throw new Error("asset: " + url + " is not the file asked for (status " + r.status + ")");
  }
  return buf;
}

export const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d];

/** JSON at `url`, validated by parsing (an index.html in its place fails here). */
export async function fetchJson(url) {
  const buf = await fetchBytes(url);
  try { return JSON.parse(new TextDecoder().decode(buf)); } catch { throw new Error("asset: " + url + " is not JSON"); }
}
