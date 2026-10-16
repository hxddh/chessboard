/**
 * Maia: a network that plays the move a person of a given rating would
 * (13.0 H, docs/v13-0-plan.md §1).
 *
 * Maia (CSSLab — McIlroy-Young, Sen, Kleinberg, Anderson, KDD 2020;
 * GPL-3.0, third_party/maia/) is a Leela Chess Zero network trained on
 * Lichess games of one rating band, to predict the human move rather than
 * find the best one. The nets are lc0's own file format; this module reads
 * them and runs the policy head, nothing else — no search, no value head —
 * so it needs no lc0, no ONNX, no dependency at all:
 *
 *   parseNet(bytes)          the .pb (ungzipped) → folded Float32 weights
 *   encodePlanes(fens)       the last eight positions → 112 input planes
 *   policyLogits(net, x)     the forward pass → 1858 logits
 *   moveIndex(uci, fen)      a legal move → its index among the 1858
 *   movePolicy(net, fens, legal)   the legal moves with their probabilities
 *
 * Every rule here is lc0 v0.30.0's, file by file:
 *   the format       lczero-common proto/net.proto (Net → Weights → Layer)
 *   the folding      src/neural/network_legacy.cc ConvBlock (batch norm into
 *                    the convolution's weights and biases, ε = 1e-5)
 *   the forward      src/neural/blas/network_blas.cc (input conv, the SE
 *                    residual tower, the convolutional policy head) and
 *                    se_unit.cc (γ = sigmoid, β, then the residual, ReLU)
 *   the input        src/neural/encoder.cc INPUT_CLASSICAL_112_PLANE
 *   the moves        human/lc0-tables.js (bitboard.cc, policy_map.h)
 * scripts/test-human.mjs holds each of them.
 * @module human/maia-net
 */
import { IDX_TO_MOVE, CONV_POLICY_MAP } from "./lc0-tables.js";

/**
 * Everything below, as one function of the two tables that refers to
 * nothing outside itself: human/worker.js builds its worker from this
 * function's own text (`maiaCore.toString()`), and the tables travel with
 * the init message.
 */
export function maiaCore(IDX_TO_MOVE, CONV_POLICY_MAP) {

  // --- the file: protobuf, the four wire types lc0 uses ------------------------

  /** The fields of one protobuf message in bytes [s, e). */
  function fieldsOf(b, s, e) {
    const out = [];
    let i = s;
    const varint = () => {
      let r = 0, mul = 1;
      for (;;) {
        const x = b[i++];
        r += (x & 0x7f) * mul;
        if (!(x & 0x80)) return r;
        mul *= 128;
      }
    };
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    while (i < e) {
      const key = varint();
      const f = Math.floor(key / 8), w = key & 7;
      if (w === 0) out.push({ f, v: varint() });
      else if (w === 1) { out.push({ f, v: dv.getFloat64(i, true) }); i += 8; }
      else if (w === 2) { const n = varint(); out.push({ f, s: i, e: i + n }); i += n; }
      else if (w === 5) { out.push({ f, v: dv.getFloat32(i, true) }); i += 4; }
      else throw new Error("maia: protobuf wire type " + w + " at " + i);
    }
    if (i !== e) throw new Error("maia: a message overran its length");
    return out;
  }
  const one = (fs, f) => fs.find((x) => x.f === f) || null;

  /** A Layer (LINEAR16: min + u16 / 65535 × (max − min)) as floats. */
  function layerOf(b, msg) {
    if (!msg) return new Float32Array(0);
    const fs = fieldsOf(b, msg.s, msg.e);
    const min = (one(fs, 1) || { v: 0 }).v, max = (one(fs, 2) || { v: 0 }).v;
    const enc = one(fs, 4);
    if (enc && enc.v !== 1 && enc.v !== 0) throw new Error("maia: layer encoding " + enc.v + " (only LINEAR16)");
    const p = one(fs, 3);
    if (!p) return new Float32Array(0);
    const n = (p.e - p.s) / 2, out = new Float32Array(n), range = max - min;
    const dv = new DataView(b.buffer, b.byteOffset + p.s, p.e - p.s);
    for (let k = 0; k < n; k++) out[k] = (dv.getUint16(2 * k, true) / 65535) * range + min;
    return out;
  }

  /**
   * A ConvBlock with its batch norm folded in, as network_legacy.cc does:
   * γ ← γ / √(σ² + ε), w ← w·γ, b ← β − γ·(μ − b).
   */
  function convOf(b, msg) {
    const fs = fieldsOf(b, msg.s, msg.e);
    const L = (f) => layerOf(b, one(fs, f));
    const w = L(1);
    let bias = L(2);
    const means = L(3), vars = L(4);
    let gammas = L(5), betas = L(6);
    const outs = Math.max(bias.length, means.length);
    if (!bias.length) bias = new Float32Array(outs);
    if (means.length) {
      if (!betas.length) { betas = new Float32Array(outs); gammas = new Float32Array(outs).fill(1); }
      const per = w.length / outs;
      for (let o = 0; o < outs; o++) {
        const g = gammas[o] / Math.sqrt(vars[o] + 1e-5);
        for (let c = 0; c < per; c++) w[o * per + c] *= g;
        bias[o] = -g * (means[o] - bias[o]) + betas[o];
      }
    }
    return { w, b: bias, outs, ins: w.length / outs / 9 };
  }

  /**
   * The net, from the ungzipped .pb. Only the shape Maia has is accepted —
   * 112 classical input planes, an SE residual tower, a convolutional policy
   * head — and anything else is refused by name rather than run wrongly.
   */
  function parseNet(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const top = fieldsOf(b, 0, b.length);
    const fmt = one(top, 4);
    const nf = fmt && one(fieldsOf(b, fmt.s, fmt.e), 2);
    const nfs = nf ? fieldsOf(b, nf.s, nf.e) : [];
    const input = (one(nfs, 1) || { v: 0 }).v, policy = (one(nfs, 4) || { v: 0 }).v;
    if (input !== 1) throw new Error("maia: input format " + input + " (only the classical 112 planes)");
    if (policy !== 2) throw new Error("maia: policy format " + policy + " (only the convolutional head)");
    const wm = one(top, 10);
    if (!wm) throw new Error("maia: no weights");
    const wf = fieldsOf(b, wm.s, wm.e);
    const residual = wf.filter((x) => x.f === 2).map((r) => {
      const rf = fieldsOf(b, r.s, r.e);
      const se = one(rf, 3);
      const sef = se ? fieldsOf(b, se.s, se.e) : null;
      return {
        conv1: convOf(b, one(rf, 1)),
        conv2: convOf(b, one(rf, 2)),
        se: sef && { w1: layerOf(b, one(sef, 1)), b1: layerOf(b, one(sef, 2)), w2: layerOf(b, one(sef, 3)), b2: layerOf(b, one(sef, 4)) },
      };
    });
    const net = { input: convOf(b, one(wf, 1)), residual, policy1: convOf(b, one(wf, 11)), policy: convOf(b, one(wf, 3)) };
    if (net.input.ins !== 112) throw new Error("maia: the input convolution takes " + net.input.ins + " planes, not 112");
    return net;
  }

  // --- the forward pass ----------------------------------------------------------

  /**
   * A 3×3 convolution over 8×8 planes, padded by one: out = W ∗ x + b, then
   * ReLU when `relu`. Weights are [out][in][3][3], rows before columns.
   */
  function conv3(x, cin, L, relu, pad) {
    const { w, b, outs } = L;
    // the input, each plane padded to 10×10 so the loops need no bounds checks
    for (let c = 0; c < cin; c++) {
      const pc = c * 100, xc = c * 64;
      for (let y = 0; y < 8; y++) for (let xx = 0; xx < 8; xx++) pad[pc + (y + 1) * 10 + xx + 1] = x[xc + y * 8 + xx];
    }
    const out = new Float32Array(outs * 64);
    for (let o = 0; o < outs; o++) {
      const oo = o * 64, wo = o * cin * 9;
      const acc = out.subarray(oo, oo + 64);
      acc.fill(b[o]);
      for (let c = 0; c < cin; c++) {
        const pc = c * 100, wc = wo + c * 9;
        for (let ky = 0; ky < 3; ky++) {
          for (let kx = 0; kx < 3; kx++) {
            const wv = w[wc + ky * 3 + kx];
            if (wv === 0) continue;
            for (let y = 0; y < 8; y++) {
              const ri = pc + (y + ky) * 10 + kx, ro = y * 8;
              acc[ro] += wv * pad[ri]; acc[ro + 1] += wv * pad[ri + 1];
              acc[ro + 2] += wv * pad[ri + 2]; acc[ro + 3] += wv * pad[ri + 3];
              acc[ro + 4] += wv * pad[ri + 4]; acc[ro + 5] += wv * pad[ri + 5];
              acc[ro + 6] += wv * pad[ri + 6]; acc[ro + 7] += wv * pad[ri + 7];
            }
          }
        }
      }
      if (relu) for (let k = 0; k < 64; k++) if (acc[k] < 0) acc[k] = 0;
    }
    return out;
  }

  /** y = W·x + b for W [out][in], ReLU when asked. */
  function fc(x, w, b, relu) {
    const outs = b.length, ins = x.length, y = new Float32Array(outs);
    for (let o = 0; o < outs; o++) {
      let s = b[o];
      for (let k = 0, base = o * ins; k < ins; k++) s += w[base + k] * x[k];
      y[o] = relu && s < 0 ? 0 : s;
    }
    return y;
  }

  /** The 1858 policy logits for 112 input planes (a Float32Array of 112 × 64). */
  function policyLogits(net, planes) {
    const pad = new Float32Array(Math.max(112, net.input.outs) * 100);
    let x = conv3(planes, 112, net.input, true, pad);
    const ch = net.input.outs;
    for (const r of net.residual) {
      const skip = x;
      const h = conv3(x, ch, r.conv1, true, pad);
      const z = conv3(h, ch, r.conv2, false, pad);
      if (r.se) {
        const pool = new Float32Array(ch);
        for (let c = 0; c < ch; c++) { let s = 0; for (let k = 0; k < 64; k++) s += z[c * 64 + k]; pool[c] = s / 64; }
        const s1 = fc(pool, r.se.w1, r.se.b1, true);
        const s2 = fc(s1, r.se.w2, r.se.b2, false);
        for (let c = 0; c < ch; c++) {
          const g = 1 / (1 + Math.exp(-s2[c])), be = s2[ch + c];
          for (let k = 0; k < 64; k++) {
            const v = g * z[c * 64 + k] + be + skip[c * 64 + k];
            z[c * 64 + k] = v > 0 ? v : 0;
          }
        }
      } else {
        for (let k = 0; k < z.length; k++) { const v = z[k] + skip[k]; z[k] = v > 0 ? v : 0; }
      }
      x = z;
    }
    const p1 = conv3(x, ch, net.policy1, true, pad);
    const head = conv3(p1, ch, net.policy, false, pad);
    const logits = new Float32Array(IDX_TO_MOVE.length).fill(-Infinity);
    for (let i = 0; i < CONV_POLICY_MAP.length; i++) {
      const j = CONV_POLICY_MAP[i];
      if (j >= 0) logits[j] = head[i];
    }
    return logits;
  }

  // --- the input: INPUT_CLASSICAL_112_PLANE ---------------------------------------

  const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
  const ORDER = "pnbrqk";

  /** A FEN's placement as 64 cells, a1 = 0 … h8 = 63; "" where empty. */
  function cellsOf(placement) {
    const cells = new Array(64).fill("");
    const rows = placement.split("/");
    for (let r = 0; r < 8; r++) {
      let f = 0;
      for (const ch of rows[r]) {
        if (ch >= "1" && ch <= "8") f += Number(ch);
        else cells[(7 - r) * 8 + f++] = ch;
      }
    }
    return cells;
  }

  /**
   * The 112 planes for the position at the end of `fens` (oldest first): the
   * last eight positions × 13 planes, each seen from the side to move now
   * (its pieces first, the board turned when it is Black), then castling, the
   * side to move, the 50-move count, a plane of zeros and one of ones.
   * Positions before the first are empty planes when the game began at the
   * start, and the first position again otherwise (lc0's "fen_only" fill).
   */
  function encodePlanes(fens) {
    const x = new Float32Array(112 * 64);
    const cur = fens[fens.length - 1].split(" ");
    const black = cur[1] === "b";
    const keyOf = (f) => f.split(" ").slice(0, 3).join(" ");
    const fromStart = fens[0].split(" ")[0] === START;
    for (let i = 0; i < 8; i++) {
      let idx = fens.length - 1 - i;
      if (idx < 0) { if (fromStart) break; idx = 0; }
      const f = fens[idx];
      const cells = cellsOf(f.split(" ")[0]);
      const base = i * 13 * 64;
      for (let sq = 0; sq < 64; sq++) {
        const p = cells[sq];
        if (!p) continue;
        const white = p === p.toUpperCase();
        const ours = white !== black;
        const t = ORDER.indexOf(p.toLowerCase());
        const to = black ? (7 - (sq >> 3)) * 8 + (sq & 7) : sq;
        x[base + ((ours ? 0 : 6) + t) * 64 + to] = 1;
      }
      // a repetition: the same placement, side and rights earlier in the game
      const k = keyOf(f);
      let reps = 0;
      for (let j = 0; j < idx; j++) if (keyOf(fens[j]) === k) reps++;
      if (reps >= 1) x.fill(1, base + 12 * 64, base + 13 * 64);
    }
    const rights = cur[2] || "-";
    const aux = 104 * 64;
    const set = (p, on) => { if (on) x.fill(1, aux + p * 64, aux + (p + 1) * 64); };
    set(0, rights.includes(black ? "q" : "Q"));
    set(1, rights.includes(black ? "k" : "K"));
    set(2, rights.includes(black ? "Q" : "q"));
    set(3, rights.includes(black ? "K" : "k"));
    set(4, black);
    x.fill(Number(cur[4]) || 0, aux + 5 * 64, aux + 6 * 64);
    set(7, true);
    return x;
  }

  // --- the output: legal moves among the 1858 ---------------------------------------

  const INDEX = new Map(IDX_TO_MOVE.map((m, i) => [m, i]));

  /**
   * A legal move (UCI, as the position `fen` has it) → its index among the
   * 1858: seen from the side to move, a knight promotion as the bare move,
   * castling as the king taking its rook.
   */
  function moveIndex(uci, fen) {
    const black = fen.split(" ")[1] === "b";
    const flip = (sq) => (black ? sq[0] + String(9 - Number(sq[1])) : sq);
    const from = flip(uci.slice(0, 2));
    let to = flip(uci.slice(2, 4));
    const promo = uci[4] && uci[4] !== "n" ? uci[4] : "";
    const cells = cellsOf(fen.split(" ")[0]);
    const at = uci.slice(0, 2);
    const piece = cells[(Number(at[1]) - 1) * 8 + (at.charCodeAt(0) - 97)];
    if (piece && piece.toLowerCase() === "k" && from === "e1") {
      if (to === "g1") to = "h1";
      else if (to === "c1") to = "a1";
    }
    const i = INDEX.get(from + to + promo);
    return i == null ? -1 : i;
  }

  /**
   * The legal moves of the last position with the probability a player of
   * this net's band plays each: a softmax over their logits, at `temperature`
   * (1 is the net's own). Sorted, most likely first.
   */
  function movePolicy(net, fens, legal, temperature = 1) {
    const fen = fens[fens.length - 1];
    const logits = policyLogits(net, encodePlanes(fens));
    const rows = legal.map((uci) => {
      const i = moveIndex(uci, fen);
      return { uci, l: i >= 0 ? logits[i] : -Infinity };
    });
    const t = Math.max(1e-3, temperature);
    const top = Math.max(...rows.map((r) => r.l));
    let sum = 0;
    for (const r of rows) { r.p = Number.isFinite(r.l) ? Math.exp((r.l - top) / t) : 0; sum += r.p; }
    for (const r of rows) r.p = sum > 0 ? r.p / sum : 1 / rows.length;
    return rows.sort((a, z) => z.p - a.p).map(({ uci, p }) => ({ uci, p }));
  }

  return { parseNet, encodePlanes, policyLogits, moveIndex, movePolicy };
}

const core = maiaCore(IDX_TO_MOVE, CONV_POLICY_MAP);
export const parseNet = core.parseNet;
export const encodePlanes = core.encodePlanes;
export const policyLogits = core.policyLogits;
export const moveIndex = core.moveIndex;
export const movePolicy = core.movePolicy;
