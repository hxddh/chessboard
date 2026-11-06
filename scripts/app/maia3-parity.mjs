/**
 * Maia-3 parity: our forward pass (src/app/services/maia3, fp16 weights)
 * against the original PyTorch model (CSSLab/maia3 models.py, fp32), on the
 * positions in fixtures/maia3-reference.json — opening to endgame, both
 * colours, real move history, promotions, castling, en passant, ratings
 * 600 / 1100 / 1500 / 2000 / 2600 (self and opponent differing in half).
 * The fixture was produced once with the reference code; PyTorch is not a
 * dependency of this repo.
 *
 * Per position: the same most likely move, KL(reference ‖ ours) < 1e-3, and
 * the WDL within 0.01. `compare` is browser-safe; run alone in Node:
 *
 *   node scripts/app/maia3-parity.mjs          (--js: the plain-JS kernel)
 */
export const KL_MAX = 1e-3;
export const WDL_MAX = 0.01;

/** @param {(c: object) => { policy: {move,p}[], wdl: {win,draw,loss} }} evaluate */
export function compare(cases, evaluate) {
  const rows = cases.map((c) => {
    const r = evaluate(c);
    const ours = new Map(r.policy.map((x) => [x.move, x.p]));
    const ref = Object.entries(c.policy);
    let kl = 0;
    for (const [m, p] of ref) if (p > 0) kl += p * Math.log(p / Math.max(ours.get(m) ?? 0, 1e-30));
    const refTop = ref.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
    const dw = Math.max(Math.abs(r.wdl.win - c.wdl[0]), Math.abs(r.wdl.draw - c.wdl[1]), Math.abs(r.wdl.loss - c.wdl[2]));
    const sameMoves = ours.size === ref.length && ref.every(([m]) => ours.has(m));
    return { name: c.name, kl, top: r.policy[0]?.move, refTop, dw, sameMoves, ms: r.ms };
  });
  const bad = rows.filter((x) => x.top !== x.refTop || !(x.kl < KL_MAX) || !(x.dw < WDL_MAX) || !x.sameMoves);
  return {
    rows, bad,
    worstKl: Math.max(...rows.map((x) => x.kl)),
    worstWdl: Math.max(...rows.map((x) => x.dw)),
    top1: rows.filter((x) => x.top === x.refTop).length,
  };
}

/** Node: load the net from the repo's files. */
export async function loadInNode({ js = false } = {}) {
  const fs = await import("fs");
  const { fileURLToPath } = await import("url");
  const { loadMaia3, FILES } = await import("../../src/app/services/maia3/model.js");
  const read = (u) => { const b = fs.readFileSync(fileURLToPath(u)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
  return loadMaia3({
    header: JSON.parse(fs.readFileSync(fileURLToPath(FILES.header), "utf8")),
    weights: read(FILES.weights),
    wasm: js ? null : read(FILES.wasm),
  });
}

export async function referenceCases() {
  const fs = await import("fs");
  return JSON.parse(fs.readFileSync(new URL("./fixtures/maia3-reference.json", import.meta.url), "utf8")).cases;
}

if (typeof process === "object" && process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const js = process.argv.includes("--js");
  const t0 = Date.now();
  const m = await loadInNode({ js });
  console.log("kernel " + m.kernel + ", loaded in " + (Date.now() - t0) + " ms, heap " + (m.heapBytes / 1e6).toFixed(1) + " MB");
  const cases = await referenceCases();
  const r = compare(cases, (c) => m.evaluate(c.fen, { history: c.history, self: c.self, oppo: c.oppo }));
  for (const x of r.bad) console.log("FAIL " + x.name + " top " + x.top + "/" + x.refTop + " kl " + x.kl.toExponential(2) + " dwdl " + x.dw.toFixed(4) + (x.sameMoves ? "" : " (move sets differ)"));
  const ms = r.rows.map((x) => x.ms).sort((a, b) => a - b);
  console.log(cases.length + " positions: top-1 " + r.top1 + "/" + cases.length + ", worst KL " + r.worstKl.toExponential(2) +
    ", worst |ΔWDL| " + r.worstWdl.toExponential(2) + ", median " + ms[ms.length >> 1].toFixed(1) + " ms/eval");
  process.exit(r.bad.length ? 1 : 0);
}
