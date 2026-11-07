/**
 * The Maia-3 5M forward pass, written for this app from the architecture in
 * the Chessformer paper (Monroe et al., ICLR 2026) and the shapes of the
 * released checkpoint — GPL-3.0-or-later like the rest of the app; the
 * weights it reads are AGPL-3.0 (third_party/maia3/README.md).
 *
 * Encoder-only transformer over the 64 squares:
 *
 *   tokens   one-hot pieces × 8 positions (encode.js) ⊕ two rating embeddings
 *            (each a blend of two learned vectors, weight rating / 5000)
 *            → linear → d = 256
 *   block×8  post-norm: x = rms(x + attn(x)); x = rms(x + mlp(x))
 *            attn: 8 heads × 32, no q/k/v biases, plus a per-head 64×64
 *            "geometric attention bias": mean of the tokens → 64 → GELU → LN
 *            → 8×64 → GELU → LN, times one 64×4096 table shared by all blocks
 *            mlp: 256 → 512 → GELU (erf) → 256
 *   heads    layer norm; policy = from(x)·to(x)ᵀ / 16 plus a promotion bias
 *            per target square; value = WDL from the token mean; ponder
 *            (a move-time head, unused by the app so far)
 *
 * Matrix products go to `gemm` — the wasm SIMD kernel (kernels.c) when the
 * runtime has it, else the same loop in plain JS. Everything lives in one
 * Float32Array heap (the wasm memory, or an ArrayBuffer for the JS path),
 * laid out once at load.
 * @module services/maia3/net
 */
import { MOVES } from "./encode.js";

const RMS_EPS = 1.1920928955078125e-7;   // torch.finfo(float32).eps, RMSNorm's default
const LN_EPS = 1e-5;

/** float16 bit pattern → float32, by table. */
let F16 = null;
function f16Table() {
  if (F16) return F16;
  F16 = new Float32Array(65536);
  for (let h = 0; h < 65536; h++) {
    const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023;
    F16[h] = e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15);
  }
  return F16;
}

/** erf to ~1e-7 (Numerical Recipes erfc, Chebyshev). */
function erf(x) {
  const z = Math.abs(x), t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? 1 - r : r - 1;
}
const gelu = (x) => 0.5 * x * (1 + erf(x * Math.SQRT1_2));

/** The JS gemm, same contract as kernels.c (offsets in floats; bias < 0: none). */
function jsGemm(H) {
  let row = new Float32Array(0);
  return (M, N, K, alpha, A, lda, B, ldb, C, ldc, bias, acc) => {
    if (row.length < N) row = new Float32Array(N);
    for (let i = 0; i < M; i++) {
      row.fill(0, 0, N);
      const a = A + i * lda;
      for (let k = 0; k < K; k++) {
        const x = H[a + k];
        if (x === 0) continue;
        const b = B + k * ldb;
        for (let j = 0; j < N; j++) row[j] += x * H[b + j];
      }
      const c = C + i * ldc;
      for (let j = 0; j < N; j++) H[c + j] = alpha * row[j] + (acc ? H[c + j] : 0) + (bias >= 0 ? H[bias + j] : 0);
    }
  };
}

/**
 * @param {{ header: object, weights: ArrayBuffer, wasm?: ArrayBuffer|WebAssembly.Module|null }} o
 *   header: third_party/maia3/maia3-5m.json; weights: maia3-5m.f16; wasm: kernels.wasm (null: JS only)
 * @returns {Promise<{ forward: Function, kernel: string, heapBytes: number }>}
 */
export async function createNet({ header, weights, wasm = null }) {
  const cfg = header.config;
  const D = cfg.dim_vit, NH = cfg.num_heads, HD = D / NH, FF = cfg.mlp_dim, E = cfg.dim_emb;
  const GG = cfg.gab_gen_size, GI = cfg.gab_intermediate_dim, IN = 12 * cfg.history;
  if (weights.byteLength !== header.elements * 2) throw new Error("maia3: weights are " + weights.byteLength + " bytes, header says " + header.elements * 2);
  if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) throw new Error("maia3: big-endian hosts are not supported");

  // activations, then weights; offsets in floats
  const sizes = {
    x: 64 * D, qkv: 64 * 3 * D, att: 64 * D, tmp: 64 * D, hid: 64 * FF, scores: 64 * 64, kt: HD * 64,
    bias: NH * 4096, pool: D, g1: GI, g2: NH * GG, elo: 2 * E, tokc: D,
    from: 64 * D, to: 64 * D, toT: D * 64, pol: 64 * 64, promo: 8 * 4, v1: D, v2: 4, p1: D, p2: 4,
  };
  let kernel = "js", H, gemm, base = 0, memory = null, heapBytes;
  const actFloats = Object.values(sizes).reduce((a, b) => a + ((b + 15) & ~15), 0);
  const total = actFloats + header.elements + 64;
  if (wasm && typeof WebAssembly === "object" && WebAssembly.validate) {
    try {
      const mod = wasm instanceof WebAssembly.Module ? wasm : await WebAssembly.compile(wasm);
      const inst = await WebAssembly.instantiate(mod, {});
      memory = inst.exports.memory;
      const heapBase = (inst.exports.__heap_base.value + 63) & ~63;
      const need = heapBase + total * 4;
      if (need > memory.buffer.byteLength) memory.grow(Math.ceil((need - memory.buffer.byteLength) / 65536));
      base = heapBase / 4;
      H = new Float32Array(memory.buffer);
      const g = inst.exports.gemm;
      gemm = (M, N, K, alpha, A, lda, B, ldb, C, ldc, bias, acc) =>
        g(M, N, K, alpha, A * 4, lda, B * 4, ldb, C * 4, ldc, bias < 0 ? 0 : bias * 4, acc ? 1 : 0);
      kernel = "wasm-simd";
      heapBytes = memory.buffer.byteLength;
    } catch { kernel = "js"; }
  }
  if (kernel === "js") { H = new Float32Array(total); gemm = jsGemm(H); base = 0; heapBytes = total * 4; }

  const at = {};
  let off = base;
  for (const [k, n] of Object.entries(sizes)) { at[k] = off; off += (n + 15) & ~15; }
  const W = {};
  const table = f16Table(), src = new Uint16Array(weights);
  for (const t of header.tensors) {
    const n = t.shape.reduce((a, b) => a * b, 1);
    const o = off + t.offset;
    for (let i = 0; i < n; i++) H[o + i] = table[src[t.offset + i]];
    W[t.name] = o;
  }

  const rmsRows = (x, w) => {
    for (let r = 0; r < 64; r++) {
      const o = x + r * D;
      let s = 0;
      for (let i = 0; i < D; i++) s += H[o + i] * H[o + i];
      const k = 1 / Math.sqrt(s / D + RMS_EPS);
      for (let i = 0; i < D; i++) H[o + i] = H[o + i] * k * H[w + i];
    }
  };
  const layerNorm = (o, n, w, b) => {
    let m = 0;
    for (let i = 0; i < n; i++) m += H[o + i];
    m /= n;
    let v = 0;
    for (let i = 0; i < n; i++) { const d = H[o + i] - m; v += d * d; }
    const k = 1 / Math.sqrt(v / n + LN_EPS);
    for (let i = 0; i < n; i++) H[o + i] = (H[o + i] - m) * k * H[w + i] + H[b + i];
  };
  const geluN = (o, n) => { for (let i = 0; i < n; i++) H[o + i] = gelu(H[o + i]); };
  const reluN = (o, n) => { for (let i = 0; i < n; i++) if (H[o + i] < 0) H[o + i] = 0; };
  const meanRows = (x, out) => {
    for (let i = 0; i < D; i++) H[out + i] = 0;
    for (let r = 0; r < 64; r++) for (let i = 0; i < D; i++) H[out + i] += H[x + r * D + i];
    for (let i = 0; i < D; i++) H[out + i] /= 64;
  };
  const addInto = (x, y, n) => { for (let i = 0; i < n; i++) H[x + i] += H[y + i]; };

  function block(i) {
    const p = "b" + i + ".";
    // geometric attention bias, one 64×64 table per head
    meanRows(at.x, at.pool);
    gemm(1, GI, D, 1, at.pool, D, W[p + "gab1.w"], GI, at.g1, GI, W[p + "gab1.b"], false);
    geluN(at.g1, GI);
    layerNorm(at.g1, GI, W[p + "gabn1.w"], W[p + "gabn1.b"]);
    gemm(1, NH * GG, GI, 1, at.g1, GI, W[p + "gab2.w"], NH * GG, at.g2, NH * GG, W[p + "gab2.b"], false);
    geluN(at.g2, NH * GG);
    layerNorm(at.g2, NH * GG, W[p + "gabn2.w"], W[p + "gabn2.b"]);
    gemm(NH, 4096, GG, 1, at.g2, GG, W.gab, 4096, at.bias, 4096, -1, false);
    // attention
    gemm(64, 3 * D, D, 1, at.x, D, W[p + "qkv.w"], 3 * D, at.qkv, 3 * D, -1, false);
    const scale = 1 / Math.sqrt(HD);
    for (let h = 0; h < NH; h++) {
      const q = at.qkv + h * HD, k = at.qkv + D + h * HD, v = at.qkv + 2 * D + h * HD;
      for (let r = 0; r < 64; r++) for (let c = 0; c < HD; c++) H[at.kt + c * 64 + r] = H[k + r * 3 * D + c];
      H.copyWithin(at.scores, at.bias + h * 4096, at.bias + (h + 1) * 4096);
      gemm(64, 64, HD, scale, q, 3 * D, at.kt, 64, at.scores, 64, -1, true);
      for (let r = 0; r < 64; r++) {
        const o = at.scores + r * 64;
        let top = -Infinity;
        for (let c = 0; c < 64; c++) if (H[o + c] > top) top = H[o + c];
        let s = 0;
        for (let c = 0; c < 64; c++) { const e = Math.exp(H[o + c] - top); H[o + c] = e; s += e; }
        for (let c = 0; c < 64; c++) H[o + c] /= s;
      }
      gemm(64, HD, 64, 1, at.scores, 64, v, 3 * D, at.att + h * HD, D, -1, false);
    }
    gemm(64, D, D, 1, at.att, D, W[p + "out.w"], D, at.tmp, D, -1, false);
    addInto(at.x, at.tmp, 64 * D);
    rmsRows(at.x, W[p + "norm1.w"]);
    // feed-forward
    gemm(64, FF, D, 1, at.x, D, W[p + "mlp1.w"], FF, at.hid, FF, W[p + "mlp1.b"], false);
    geluN(at.hid, 64 * FF);
    gemm(64, D, FF, 1, at.hid, FF, W[p + "mlp2.w"], D, at.tmp, D, W[p + "mlp2.b"], false);
    addInto(at.x, at.tmp, 64 * D);
    rmsRows(at.x, W[p + "norm2.w"]);
  }

  /**
   * @param {Int32Array} feats encode.features()
   * @param {number} selfElo the side to move's rating
   * @param {number} oppoElo the opponent's
   * @returns {{ logits: Float32Array, value: number[], ponder: number }}
   *   logits 4352 (mover's frame); value [loss, draw, win] logits for the side to move
   */
  function forward(feats, selfElo, oppoElo) {
    // the rating part of every token is the same: project it once
    [selfElo, oppoElo].forEach((e, j) => {
      const w = Math.min(Math.max(Number(e) || 0, 0), cfg.elo_max) / cfg.elo_max;
      for (let i = 0; i < E; i++) H[at.elo + j * E + i] = w * H[W.elo_low + i] + (1 - w) * H[W.elo_high + i];
    });
    gemm(1, D, 2 * E, 1, at.elo, 2 * E, W["tok.w"] + IN * D, D, at.tokc, D, W["tok.b"], false);
    for (let r = 0; r < 64; r++) H.copyWithin(at.x + r * D, at.tokc, at.tokc + D);
    for (let f = 0; f < feats.length; f += 2) addInto(at.x + feats[f] * D, W["tok.w"] + feats[f + 1] * D, D);

    for (let i = 0; i < cfg.num_blocks; i++) block(i);
    for (let r = 0; r < 64; r++) layerNorm(at.x + r * D, D, W["final.w"], W["final.b"]);

    // policy
    const HH = cfg.head_hid_dim;
    gemm(64, HH, D, 1, at.x, D, W["from.w"], HH, at.from, HH, -1, false);
    gemm(64, HH, D, 1, at.x, D, W["to.w"], HH, at.to, HH, -1, false);
    for (let r = 0; r < 64; r++) for (let c = 0; c < HH; c++) H[at.toT + c * 64 + r] = H[at.to + r * HH + c];
    gemm(64, 64, HH, 1 / Math.sqrt(HH), at.from, HH, at.toT, 64, at.pol, 64, -1, false);
    gemm(8, 4, HH, Math.sqrt(HH), at.to + 56 * HH, HH, W["promo.w"], 4, at.promo, 4, -1, false);
    const logits = new Float32Array(MOVES);
    logits.set(H.subarray(at.pol, at.pol + 4096));
    for (let ff = 0; ff < 8; ff++) for (let tf = 0; tf < 8; tf++) {
      const base = H[at.pol + (48 + ff) * 64 + 56 + tf];
      for (let k = 0; k < 4; k++) logits[4096 + (ff * 8 + tf) * 4 + k] = base + H[at.promo + tf * 4 + k];
    }

    // value and ponder, from the mean token
    meanRows(at.x, at.pool);
    layerNorm(at.pool, D, W["pool.w"], W["pool.b"]);
    gemm(1, D, D, 1, at.pool, D, W["value1.w"], D, at.v1, D, W["value1.b"], false);
    reluN(at.v1, D);
    gemm(1, 3, D, 1, at.v1, D, W["value2.w"], 3, at.v2, 3, W["value2.b"], false);
    gemm(1, D, D, 1, at.pool, D, W["ponder1.w"], D, at.p1, D, W["ponder1.b"], false);
    reluN(at.p1, D);
    gemm(1, 1, D, 1, at.p1, D, W["ponder2.w"], 1, at.p2, 1, W["ponder2.b"], false);
    return { logits, value: [H[at.v2], H[at.v2 + 1], H[at.v2 + 2]], ponder: H[at.p2] };
  }

  return { forward, kernel, heapBytes };
}
