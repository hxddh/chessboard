/**
 * A classic worker in front of the Stockfish.js loader (third_party, not
 * edited). Its loader fetches the .wasm, gates on `r.ok` and compiles with
 * `instantiateStreaming`, both of which fail on macOS WKWebView, where a
 * zero:// fetch has status 0 and no headers (ADR 0001). So the fetch for the
 * .wasm is answered here: the bytes read whatever the status, checked for
 * the wasm magic number, and handed back as a 200 application/wasm Response.
 *
 * Started as  stockfish-worker.js#<wasm url>,main,<loader url>  (the loader
 * reads its .wasm from the first field; a second field "worker" would make it
 * a pthread, so it is "main").
 */
const [wasmUrl, , loaderUrl] = self.location.hash.slice(1).split(",").map(decodeURIComponent);
const realFetch = self.fetch.bind(self);
self.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  if (url !== wasmUrl) return realFetch(input, init);
  const r = await realFetch(input, init);
  const buf = await r.arrayBuffer();
  const m = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
  if (!(m[0] === 0 && m[1] === 0x61 && m[2] === 0x73 && m[3] === 0x6d)) throw new Error("stockfish: " + url + " is not wasm (status " + r.status + ")");
  return new Response(buf, { status: 200, headers: { "content-type": "application/wasm" } });
};
importScripts(loaderUrl);
