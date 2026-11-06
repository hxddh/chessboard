/**
 * Deep searches for an audit, in parallel: each position is searched to a
 * fixed node count (`go nodes N`, a clean hash each time, so a result does
 * not depend on the order), by several child processes running the vendored
 * Stockfish — the oracle of scripts/audit-explain.mjs (v20-0-plan §4 F1:
 * 「对照 100 万节点的深搜」). Results are { s (White's scalar, app evalScalar),
 * b (best, UCI), pv (UCI, space-separated) }.
 *
 *   as a module:  await deepSearch(fens, { nodes, jobs, onDone })
 *   as a child:   node sf-deep.mjs --child <nodes>   (FENs on stdin, JSON lines out)
 */
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");

/** app.js evalScalar(): White's view, mate as ±(10000 − 10·n) */
function scalarOf(kind, val, turn) {
  const sign = turn === "w" ? 1 : -1;
  if (kind === "mate") {
    const mag = 10000 - Math.min(Math.abs(val), 50) * 10;
    return val > 0 ? sign * mag : -sign * mag;
  }
  return sign * val;
}

async function child(nodes) {
  const require = createRequire(import.meta.url);
  const listeners = [];
  const engine = {
    wasmBinary: new Uint8Array(fs.readFileSync(path.join(ROOT, "third_party/stockfish/stockfish-19-lite-single.wasm"))),
    listener: (l) => { for (const h of listeners.slice()) h(l); },
  };
  const factory = require(path.join(ROOT, "third_party/stockfish/stockfish-19-lite-single.js"));
  await (factory.length >= 1 ? factory(engine) : factory()(engine));
  await new Promise((r) => { const t = () => (engine._isReady && !engine._isReady() ? setTimeout(t, 10) : r()); t(); });
  const send = (c) => engine.ccall("command", null, ["string"], [c], { async: /^go\b/.test(c) });
  const waitFor = (pred) => new Promise((res) => { const h = (l) => { if (typeof l === "string" && pred(l)) { listeners.splice(listeners.indexOf(h), 1); res(l); } }; listeners.push(h); });
  const ready = async () => { const w = waitFor((l) => l === "readyok"); send("isready"); await w; };
  const ok = waitFor((l) => l === "uciok"); send("uci"); await ok;
  for (const c of ["setoption name MultiPV value 1", "setoption name Skill Level value 20", "setoption name UCI_LimitStrength value false", "setoption name Hash value 64"]) send(c);
  let buf = "";
  const queue = [];
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    while (queue.length) {
      const fen = queue.shift();
      send("ucinewgame"); await ready();
      send("position fen " + fen);
      let last = null;
      const collect = (l) => {
        if (typeof l !== "string" || !l.startsWith("info") || !/\bpv\b/.test(l)) return;
        const s = l.match(/\bscore (cp|mate) (-?\d+)\b/), pv = l.match(/\bpv (.+)$/);
        if (s && pv) last = { kind: s[1], val: Number(s[2]), pv: pv[1].trim() };
      };
      listeners.push(collect);
      const done = waitFor((l) => l.startsWith("bestmove"));
      send("go nodes " + nodes);
      const bm = String(await done).split(/\s+/)[1];
      listeners.splice(listeners.indexOf(collect), 1);
      const turn = fen.split(" ")[1];
      process.stdout.write(JSON.stringify({ fen, s: last ? scalarOf(last.kind, last.val, turn) : null, b: bm && bm !== "(none)" ? bm : null,
        pv: last ? last.pv.split(/\s+/).slice(0, 16).join(" ") : "" }) + "\n");
    }
    busy = false;
    if (ended) process.exit(0);
  };
  let ended = false;
  process.stdin.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) { const f = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (f) queue.push(f); }
    run();
  });
  process.stdin.on("end", () => { ended = true; if (!busy) process.exit(0); });
}

/**
 * Search every FEN in `fens` to `nodes` nodes, `jobs` at a time.
 * @returns {Promise<Map<string, {s, b, pv}>>}
 */
export async function deepSearch(fens, { nodes = 1000000, jobs = 3, onDone = () => {} } = {}) {
  const out = new Map();
  const todo = [...new Set(fens)];
  if (!todo.length) return out;
  const n = Math.max(1, Math.min(jobs, todo.length));
  const shards = Array.from({ length: n }, (_, i) => todo.filter((_, j) => j % n === i));
  await Promise.all(shards.map((list) => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [fileURLToPath(import.meta.url), "--child", String(nodes)], { stdio: ["pipe", "pipe", "inherit"] });
    let buf = "";
    p.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const l = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!l.trim()) continue;
        const r = JSON.parse(l);
        out.set(r.fen, { s: r.s, b: r.b, pv: r.pv });
        onDone(r.fen, out.get(r.fen));
      }
    });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("sf-deep child exit " + code))));
    p.stdin.end(list.join("\n") + "\n");
  })));
  return out;
}

if (process.argv[2] === "--child") child(Number(process.argv[3]) || 1000000);
