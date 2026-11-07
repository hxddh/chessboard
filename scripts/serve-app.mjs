/**
 * Dev server for the 20.0 app (src/app): static files over http — the ES
 * modules as they are under /src/app/, and the split build under /dist-app/
 * (scripts/build-app.mjs). Missing files are 404 — never index.html — the
 * way app.zon serves them once spa_fallback is off (ADR 0001).
 *
 *   node scripts/serve-app.mjs            → http://127.0.0.1:8020/
 *   PORT=0 node scripts/serve-app.mjs     (any free port)
 *
 * Imported by the e2e: `const { url, close } = await startServer()`.
 */
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
/** What the app may load: its own tree, the 19.0 core it reuses, engine assets, the browser-side test suites. */
const ALLOWED = ["/dist-app/", "/src/app/", "/third_party/stockfish/", "/third_party/maia3/", "/scripts/app/"];
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".txt": "text/plain",
};

function handle(req, res) {
  let p;
  try { p = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch { res.writeHead(400); res.end(); return; }
  if (p === "/" || p === "/index.html") { res.writeHead(302, { location: "/src/app/" }); res.end(); return; }
  if (p.endsWith("/")) p += "index.html";
  const file = path.normalize(path.join(ROOT, p));
  const rel = "/" + path.relative(ROOT, file).split(path.sep).join("/");
  if (!file.startsWith(ROOT + path.sep) || !ALLOWED.some((a) => rel.startsWith(a))) { res.writeHead(404); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(data);
  });
}

export async function startServer({ port = 0, host = "127.0.0.1" } = {}) {
  const server = http.createServer(handle);
  await new Promise((r) => server.listen(port, host, r));
  const addr = server.address();
  // url: the modules as they are; dist: the split build (scripts/build-app.mjs)
  return { url: `http://${host}:${addr.port}/src/app/`, dist: `http://${host}:${addr.port}/dist-app/`, port: addr.port, close: () => new Promise((r) => server.close(r)) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.argv.includes("--build")) await (await import("./build-app.mjs")).buildApp();
  const { url, dist } = await startServer({ port: Number(process.env.PORT ?? 8020) });
  console.log("serving src/app at " + url + " and the build at " + dist + " (--build to make it first)");
}
