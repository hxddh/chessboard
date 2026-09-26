/**
 * The default sound set (7.7, v7-7-plan §8): wooden pieces on a wooden board,
 * rendered as sample buffers from a small physical model rather than played
 * from recordings.
 *
 * **Why rendered, not recorded.** §8 asked for sampled sounds under a licence
 * GPLv3 can carry. Checked while writing this (September 2026), in
 * lichess-org/lila's COPYING.md: its sound sets are AGPLv3+ (futuristic, nes,
 * piano, sfx), CC BY-NC-SA 4.0 (lisp), or "the other sounds in public/sound"
 * under "Exceptions (non-free)" — which is where the standard wooden set is.
 * And freesound, OpenGameArt, Kenney and Wikimedia Commons were unreachable
 * from the machine that made this set, so no CC0 recording could be verified
 * at its source. A recording nobody could check the licence of does
 * not go into a GPL app. So these are the project's own work, GPLv3 like the
 * rest of it, and there is nothing to attribute.
 *
 * **Why at runtime, not as files.** zero:// cannot fetch (bundle.mjs,
 * engine.js), so a .wav would have had to travel as base64 inside the bundle —
 * a third bigger than the file and the same bytes as the code below renders in
 * a few milliseconds. The buffers are made on first use, per AudioContext,
 * with no asset, no request and no decode.
 *
 * **The model.** A struck object is a short excitation feeding a set of
 * resonant modes, each a damped sine: `a · sin(2πft) · e^(−t/τ)`. What makes
 * it sound like wood and not a bell is the damping — wood loses its high
 * modes fast, so τ falls with frequency, and nothing rings past ~150 ms. Every
 * impact here is three layers:
 *
 *   contact   a 1–3 ms burst of band-passed noise: the felt and the edge of
 *             the base meeting the board, and the only part with no pitch
 *   piece     a few high, fast modes (≈2–6 kHz, τ 5–20 ms): the small hard
 *             boxwood body of the piece itself
 *   board     lower, slower modes (≈150 Hz–2 kHz, τ 25–70 ms): the plate
 *
 * A placement is all three, balanced so the energy sits where a wooden click
 * does (spectral centroid ~2–3 kHz). A capture is two of them 28 ms apart:
 * a harder piece-on-piece clack, then a heavier board hit with the piece
 * modes turned down and the plate modes lowered and lengthened, so it
 * reads as heavier. The chimes (start, the endings, a lesson star, check) are
 * the same model with a tuned bar's mode ratios, 1 : 3.9 : 9.2, which is a
 * marimba — wood again, not a synthesiser's sine.
 *
 * Every buffer is deterministic (seeded noise, no Math.random): the tests hash
 * them to prove no two events share a sound, and a hash of something random
 * proves nothing. The numbers each one is held to — attack, decay, centroid —
 * are measured in scripts/test-audio-e2e.mjs, and scripts/render-sounds.mjs
 * writes them out as WAV for anyone who wants to listen.
 *
 * @module sound-bank
 */

/** Every event the default set has a sound for. */
export const SOUND_NAMES = ["move", "capture", "check", "castle", "promote", "lift", "refused",
  "start", "win", "loss", "draw", "lowtime", "star", "wrong"];

/** mulberry32: a small seeded PRNG, [-1, 1). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 2147483648) - 1;
  };
}

/**
 * One damped mode.
 *
 * The 0.5 ms rise is what keeps a sine that starts at full amplitude from
 * clicking; it is well inside the "attack under 5 ms" the tests ask for.
 */
function mode(out, sr, t0, f, amp, tau, phase = 0) {
  const i0 = Math.round(t0 * sr);
  const n = Math.min(out.length - i0, Math.ceil(tau * 7 * sr));
  // a rotating phasor and two running products instead of sin and exp per
  // sample: the same curve, and a whole game-over chord renders in a few ms
  const w = 2 * Math.PI * f / sr, c = Math.cos(w), s = Math.sin(w);
  const decay = Math.exp(-1 / (tau * sr)), rise = Math.exp(-1 / (0.0005 * sr));
  let re = Math.cos(phase), im = Math.sin(phase), a = amp, r = 1;
  for (let i = 0; i < n; i++) {
    out[i0 + i] += a * im * (1 - r);
    const nr = re * c - im * s;
    im = re * s + im * c;
    re = nr;
    a *= decay;
    r *= rise;
  }
}

/** RBJ band-pass biquad, applied in place over [i0, i0+n). */
function bandpass(buf, sr, f, q) {
  const w = 2 * Math.PI * f / sr, al = Math.sin(w) / (2 * q), c = Math.cos(w);
  const a0 = 1 + al;
  const b0 = al / a0, b2 = -al / a0, a1 = -2 * c / a0, a2 = (1 - al) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    buf[i] = y;
  }
}

/** The contact: a noise burst, band-passed, with an exponential tail. */
function contact(out, sr, t0, { f, q, amp, tau, seed }) {
  const r = rng(seed);
  const n = Math.ceil(tau * 8 * sr);
  const tmp = new Float32Array(n);
  for (let i = 0; i < n; i++) tmp[i] = r() * Math.exp(-i / (tau * sr));
  bandpass(tmp, sr, f, q);
  bandpass(tmp, sr, f, q);
  const i0 = Math.round(t0 * sr);
  for (let i = 0; i < n && i0 + i < out.length; i++) out[i0 + i] += amp * tmp[i] * 4;
}

/**
 * A piece set down on the board.
 *
 * `pitch` scales every mode (a king is a bigger object than a pawn, a
 * castling rook lands on a different spot of the plate); `weight` shifts the
 * balance from the piece to the board and lengthens the board's ring.
 */
function place(out, sr, t0, { pitch = 1, weight = 0, level = 1, seed = 1 } = {}) {
  const r = rng(seed * 7919);
  const jit = () => 1 + r() * 0.015;   // no two strikes excite exactly the same spot
  contact(out, sr, t0, { f: 3200 * pitch, q: 0.7, amp: 1.3 * level * (1 - 0.4 * weight), tau: 0.0015, seed });
  // the piece: small, hard, gone in a few milliseconds
  const piece = [[2450, 0.45, 0.015], [3650, 0.30, 0.010], [5300, 0.15, 0.006]];
  for (const [f, a, tau] of piece) {
    mode(out, sr, t0, f * pitch * jit(), a * level * (1 - 0.6 * weight), tau, r() * Math.PI);
  }
  // the board: lower and longer, and more of it when the blow is heavier
  const board = [[170, 0.10, 0.030], [395, 0.10, 0.028], [760, 0.13, 0.026],
    [1230, 0.17, 0.022], [1780, 0.16, 0.018]];
  const drop = 1 - 0.28 * weight;
  for (const [f, a, tau] of board) {
    mode(out, sr, t0, f * pitch * drop * jit(), a * level * (1 + 1.6 * weight), tau * (1 + 0.8 * weight), r() * Math.PI);
  }
}

/** A struck wooden bar (marimba mode ratios), for anything with a pitch. */
function bar(out, sr, t0, f, { level = 1, tau = 0.35, seed = 3 } = {}) {
  contact(out, sr, t0, { f: Math.min(4000, f * 4), q: 0.9, amp: 0.10 * level, tau: 0.0008, seed });
  mode(out, sr, t0, f, 0.50 * level, tau);
  mode(out, sr, t0, f * 3.93, 0.16 * level, tau / 4.5);
  mode(out, sr, t0, f * 9.2, 0.05 * level, tau / 12);
}

/** A hollow wooden block: two close, short modes — a clock's tick. */
function block(out, sr, t0, f, { level = 1, seed = 5 } = {}) {
  contact(out, sr, t0, { f: f * 1.6, q: 1.2, amp: 0.25 * level, tau: 0.001, seed });
  mode(out, sr, t0, f, 0.45 * level, 0.030);
  mode(out, sr, t0, f * 1.47, 0.22 * level, 0.020);
  mode(out, sr, t0, f * 2.76, 0.10 * level, 0.012);
}

/** A low, dry knock on the board's frame: "no". */
function knock(out, sr, t0, f, { level = 1, seed = 9 } = {}) {
  contact(out, sr, t0, { f: 900, q: 0.6, amp: 0.5 * level, tau: 0.0015, seed });
  mode(out, sr, t0, f, 0.40 * level, 0.035);
  mode(out, sr, t0, f * 2.3, 0.18 * level, 0.022);
  mode(out, sr, t0, f * 4.1, 0.07 * level, 0.012);
}

const NOTE = { G4: 392.0, A4: 440.0, "F#4": 369.99, C5: 523.25, D5: 587.33, E5: 659.25,
  G5: 783.99, A5: 880.0, C6: 1046.5, E6: 1318.51 };

/**
 * What each event is made of: [length in seconds, peak level, the strikes].
 *
 * Peak levels are relative, and deliberately uneven — a placement is the
 * sound heard hundreds of times a game and sits lowest among the loud ones;
 * losing is quieter than winning (audio.js playLoss says why).
 */
const RECIPES = {
  move: [0.16, 0.40, (o, sr) => place(o, sr, 0, { seed: 11 })],
  capture: [0.26, 0.48, (o, sr) => {
    place(o, sr, 0, { pitch: 1.18, level: 0.7, seed: 21 });          // piece on piece
    place(o, sr, 0.028, { pitch: 0.82, weight: 1, level: 1.1, seed: 22 }); // down, hard
  }],
  check: [0.55, 0.42, (o, sr) => {
    place(o, sr, 0, { seed: 31 });
    bar(o, sr, 0.05, NOTE.E6, { level: 0.55, tau: 0.16, seed: 32 });
  }],
  castle: [0.30, 0.42, (o, sr) => {
    place(o, sr, 0, { pitch: 0.93, seed: 41 });          // the king
    place(o, sr, 0.095, { pitch: 1.07, level: 0.85, seed: 42 }); // the rook
  }],
  promote: [0.80, 0.44, (o, sr) => {
    place(o, sr, 0, { pitch: 0.9, weight: 0.6, seed: 51 });
    bar(o, sr, 0.03, NOTE.A4 / 2, { level: 0.55, tau: 0.30, seed: 52 });
    bar(o, sr, 0.03, NOTE.E5 / 2, { level: 0.35, tau: 0.26, seed: 53 });
  }],
  lift: [0.05, 0.14, (o, sr) => {
    contact(o, sr, 0, { f: 3800, q: 1.0, amp: 0.5, tau: 0.0015, seed: 61 });
    mode(o, sr, 0, 4100, 0.12, 0.006);
  }],
  refused: [0.16, 0.26, (o, sr) => knock(o, sr, 0, 150, { seed: 71 })],
  start: [1.00, 0.30, (o, sr) => {
    bar(o, sr, 0, NOTE.G4, { tau: 0.35, seed: 81 });
    bar(o, sr, 0.11, NOTE.D5, { tau: 0.40, seed: 82 });
  }],
  win: [1.70, 0.36, (o, sr) => {
    [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6].forEach((f, i) =>
      bar(o, sr, i * 0.09, f, { tau: i === 3 ? 0.55 : 0.30, seed: 90 + i }));
  }],
  loss: [1.20, 0.22, (o, sr) => {
    bar(o, sr, 0, NOTE.A4, { tau: 0.35, seed: 101 });
    bar(o, sr, 0.15, NOTE["F#4"], { tau: 0.45, seed: 102 });
  }],
  draw: [1.20, 0.27, (o, sr) => {
    bar(o, sr, 0, NOTE.E5, { tau: 0.32, seed: 111 });
    bar(o, sr, 0.17, NOTE.C5, { tau: 0.42, seed: 112 });
  }],
  lowtime: [0.40, 0.34, (o, sr) => {
    [0, 0.12, 0.24].forEach((t, i) => block(o, sr, t, i === 1 ? 1320 : 1560, { seed: 121 + i }));
  }],
  star: [0.60, 0.32, (o, sr) => {
    bar(o, sr, 0, NOTE.A5, { tau: 0.20, seed: 131 });
    bar(o, sr, 0.07, NOTE.E6, { tau: 0.22, seed: 132 });
  }],
  wrong: [0.32, 0.26, (o, sr) => {
    knock(o, sr, 0, 220, { seed: 141 });
    knock(o, sr, 0.13, 175, { seed: 142 });
  }],
};

/**
 * Render one sound as mono PCM at `sampleRate`.
 *
 * Normalised to its recipe's peak, and ended with a 25 ms fade so a mode that
 * is still (barely) ringing at the cut does not click.
 *
 * @param {string} name  one of SOUND_NAMES
 * @param {number} sampleRate
 * @returns {Float32Array}
 */
export function renderSound(name, sampleRate) {
  const rec = RECIPES[name];
  if (!rec) throw new Error("no such sound: " + name);
  const [len, peak, build] = rec;
  const out = new Float32Array(Math.ceil(len * sampleRate));
  build(out, sampleRate);
  let m = 0;
  for (let i = 0; i < out.length; i++) m = Math.max(m, Math.abs(out[i]));
  const k = m > 0 ? peak / m : 0;
  const fade = Math.round(0.025 * sampleRate);
  for (let i = 0; i < out.length; i++) {
    const tail = out.length - i;
    out[i] *= k * (tail < fade ? tail / fade : 1);
  }
  return out;
}
