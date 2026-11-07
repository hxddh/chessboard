/**
 * services/asset.js: zero:// on macOS answers status 0 with no headers and the
 * body intact; a missing file is index.html. Reads must go by the body.
 */
import { fetchBytes, fetchJson, WASM_MAGIC } from "../../src/app/services/asset.js";

const respond = (bytes, status = 0) => async () => ({ ok: status >= 200 && status < 300, status, headers: new Map(),
  arrayBuffer: async () => new Uint8Array(bytes).buffer });
const enc = (s) => [...new TextEncoder().encode(s)];

export default function (test) {
  test("asset: status 0 without headers still reads (WKWebView zero://)", async (a) => {
    const real = globalThis.fetch;
    try {
      globalThis.fetch = respond([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);
      a.equal((await fetchBytes("x.wasm", { magic: WASM_MAGIC })).byteLength, 8);
      globalThis.fetch = respond(enc('{"elements": 3}'));
      a.deepEqual(await fetchJson("x.json"), { elements: 3 });
    } finally { globalThis.fetch = real; }
  });
  test("asset: index.html in place of a missing file is refused", async (a) => {
    const real = globalThis.fetch;
    try {
      globalThis.fetch = respond(enc("<!doctype html><html>…"), 200);
      await a.rejects(fetchBytes("x.f16"));
      await a.rejects(fetchBytes("x.wasm", { magic: WASM_MAGIC }));
      await a.rejects(fetchJson("x.json"));
      globalThis.fetch = respond([]);
      await a.rejects(fetchBytes("x.f16"), "an empty body is refused");
    } finally { globalThis.fetch = real; }
  });
}
