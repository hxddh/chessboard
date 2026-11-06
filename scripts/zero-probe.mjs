/**
 * The zero:// probe (v20-0-plan A5): what a page served by the SDK's asset
 * handler can load, asked inside the real app on the real WebView.
 *
 * Writes a small page into frontend/dist/probe/ — only the automation jobs
 * call this, after sync-dist.mjs and before packaging their dist-auto/ build;
 * the shipped package never has it. The automation build's `zero-probe`
 * scenario (src/web/js/selftest-scenarios.js) opens probe/index.html in a
 * hidden iframe, which answers with one entry per feature; the driver
 * (scripts/automation-scenarios.mjs) prints them as a PASS/FAIL table.
 *
 * The iframe has a CSP of its own: index.html's `worker-src blob:` would
 * refuse a Worker from a zero:// URL before the SDK is ever asked, and the
 * question here is the SDK's, not our CSP's. A same-origin frame loaded by
 * URL takes its own policy, not its parent's.
 *
 *   node scripts/zero-probe.mjs [dist dir, default frontend/dist]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** (module (func (export "add") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add)) */
export const ADD_WASM = Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0, 1, 7, 1, 96, 2, 127, 127, 1, 127, 3, 2, 1, 0, 7, 7, 1, 3, 97, 100, 100, 0, 0, 10, 9, 1, 7, 0, 32, 0, 32, 1, 106, 11]);
/** what fetch("data.bin") must give back, byte for byte (high bytes: no text decoding on the way) */
export const DATA_BIN = Uint8Array.from([1, 2, 3, 0, 250, 251, 252, 255]);

const INDEX = `<!doctype html>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'">
<title>zero:// probe</title>
<script src="classic.js"></script>
<script type="module" src="probe.js"></script>
`;

// A classic script first: it answers even when module scripts do not load,
// and then says so.
const CLASSIC = `(function () {
  var results = [], sent = false;
  function add(name, pass, detail) { results.push({ name: name, pass: !!pass, detail: String(detail) }); }
  function finish() {
    if (sent) return;
    sent = true;
    if (!window.__probeModuleRan) add("module script", false, "probe.js (type=module) did not run in 30 s");
    parent.postMessage({ zeroProbe: { href: location.href, ua: navigator.userAgent, results: results } }, "*");
  }
  window.__probe = { add: add, finish: finish };
  add("classic script", true, location.href);
  setTimeout(finish, 30000);
})();
`;

const PROBE = `import { staticImport } from "./dep.js";
const P = window.__probe;
window.__probeModuleRan = true;
P.add("module script", true, "ran");
P.add("static import", staticImport === "dep", staticImport);
P.add("isSecureContext", true, String(self.isSecureContext));
P.add("crossOriginIsolated", self.crossOriginIsolated === true, String(self.crossOriginIsolated) + ", SharedArrayBuffer " + typeof SharedArrayBuffer);
const within = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error("timeout " + ms + " ms")), ms))]);
async function step(name, fn) {
  try { const r = await within(fn(), 10000); P.add(name, r.pass, r.detail); }
  catch (e) { P.add(name, false, "ERR " + (e && e.message || e)); }
}
const WANT = ${JSON.stringify(Array.from(DATA_BIN))};
await step("dynamic import()", async () => { const m = await import("./dyn.js"); return { pass: m.dynamicImport === "dyn", detail: m.dynamicImport }; });
// the body is the question; status and headers are their own row (WKWebView
// hands a scheme handler's plain NSURLResponse to fetch as status 0, no headers)
await step("fetch text", async () => {
  const r = await fetch("dep.js"); const t = await r.text();
  return { pass: t.includes("staticImport"), detail: t.length + " B (status " + r.status + ", " + r.headers.get("content-type") + ")" };
});
await step("fetch binary", async () => {
  const r = await fetch("data.bin"); const b = Array.from(new Uint8Array(await r.arrayBuffer()));
  return { pass: b.join() === WANT.join(), detail: "[" + b.join(",") + "] (status " + r.status + ")" };
});
await step("fetch status 200 + Content-Type", async () => {
  const r = await fetch("add.wasm"); await r.arrayBuffer();
  return { pass: r.status === 200 && /application\\/wasm/.test(r.headers.get("content-type") || ""), detail: r.status + " " + r.headers.get("content-type") };
});
await step("WebAssembly.instantiate(arrayBuffer)", async () => {
  const { instance } = await WebAssembly.instantiate(await (await fetch("add.wasm")).arrayBuffer());
  const v = instance.exports.add(2, 3); return { pass: v === 5, detail: "add(2,3) = " + v };
});
await step("instantiateStreaming", async () => {
  const { instance } = await WebAssembly.instantiateStreaming(fetch("add.wasm"));
  const v = instance.exports.add(2, 3); return { pass: v === 5, detail: "add(2,3) = " + v };
});
// spa_fallback = true in app.zon: what a missing file comes back as (its
// body being index.html is the trap — that is a FAIL here)
await step("missing file (spa_fallback)", async () => {
  let r;
  try { r = await fetch("no-such-file.bin"); } catch (e) { return { pass: true, detail: "fetch rejected: " + (e && e.message || e) }; }
  const t = await r.text();
  const html = /<!doctype html>/i.test(t);
  return { pass: !html && !r.ok, detail: r.status + " " + r.headers.get("content-type") + (html ? " (index.html)" : " " + t.length + " B") };
});
function viaWorker(url, opts) {
  return new Promise((resolve, reject) => {
    let w;
    try { w = new Worker(url, opts); } catch (e) { reject(e); return; }
    w.onmessage = (e) => { w.terminate(); resolve(e.data); };
    w.onerror = (e) => { reject(new Error("worker error: " + (e.message || "load failed"))); };
    w.postMessage(0);
  });
}
await step("Worker classic (zero:// URL)", async () => {
  const d = await viaWorker("worker-classic.js");
  return { pass: d.classic === "ok", detail: JSON.stringify(d) };
});
await step("fetch inside classic Worker", async () => {
  const d = await viaWorker("worker-classic.js");
  return { pass: d.fetched === WANT.join(), detail: JSON.stringify(d.fetched) };
});
await step("Worker module (zero:// URL)", async () => {
  const d = await viaWorker("worker-module.js", { type: "module" });
  return { pass: d.module === "dep", detail: JSON.stringify(d) };
});
await step("instantiateStreaming inside module Worker", async () => {
  const d = await viaWorker("worker-module.js", { type: "module" });
  return { pass: d.wasm === 5, detail: JSON.stringify(d.wasm) };
});
await step("instantiate(arrayBuffer) inside module Worker", async () => {
  const d = await viaWorker("worker-module.js", { type: "module" });
  return { pass: d.wasmBuf === 5, detail: JSON.stringify(d.wasmBuf) };
});
P.finish();
`;

const WORKER_CLASSIC = `onmessage = async () => {
  let fetched;
  try { fetched = Array.from(new Uint8Array(await (await fetch("data.bin")).arrayBuffer())).join(); } catch (e) { fetched = "ERR " + (e && e.message || e); }
  postMessage({ classic: "ok", fetched });
};
`;

const WORKER_MODULE = `import { staticImport } from "./dep.js";
onmessage = async () => {
  let wasm, wasmBuf;
  try { wasm = (await WebAssembly.instantiateStreaming(fetch("add.wasm"))).instance.exports.add(2, 3); } catch (e) { wasm = "ERR " + (e && e.message || e); }
  try { wasmBuf = (await WebAssembly.instantiate(await (await fetch("add.wasm")).arrayBuffer())).instance.exports.add(2, 3); } catch (e) { wasmBuf = "ERR " + (e && e.message || e); }
  postMessage({ module: staticImport, wasm, wasmBuf });
};
`;

/** @param {string} dist the frontend/dist to write probe/ into */
export function writeProbe(dist) {
  const dir = path.join(dist, "probe");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const files = {
    "index.html": INDEX,
    "classic.js": CLASSIC,
    "probe.js": PROBE,
    "dep.js": "export const staticImport = \"dep\";\n",
    "dyn.js": "export const dynamicImport = \"dyn\";\n",
    "worker-classic.js": WORKER_CLASSIC,
    "worker-module.js": WORKER_MODULE,
    "add.wasm": ADD_WASM,
    "data.bin": DATA_BIN,
  };
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return Object.keys(files);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dist = path.resolve(process.argv[2] || path.join(ROOT, "frontend", "dist"));
  if (!fs.existsSync(path.join(dist, "index.html"))) {
    console.error("FAIL: " + dist + " has no index.html — run scripts/sync-dist.mjs first");
    process.exit(1);
  }
  const names = writeProbe(dist);
  console.log("ok: zero:// probe written to " + path.join(dist, "probe") + " (" + names.join(", ") + ")");
}
