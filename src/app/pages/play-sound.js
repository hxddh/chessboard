/**
 * Sounds for the play screen: move, capture, check, castle, promote and the
 * endings, from 19.0's wooden set (core/sounds). `played` keeps the last
 * names for the e2e (headless Chromium does not let anyone listen).
 *
 * Feel (v20-0-plan §5 H), as 19.0's audio.js tuned it:
 *   latency   the AudioContext ("interactive") is made and resumed on the
 *             first pointer or key press, and the takes heard every move are
 *             rendered then, in idle time — a move only starts a buffer
 *   weight    a capture is heavier than a move, a heavy man (R Q K) lower
 *             than a pawn; Black's placements a shade lower than White's, and
 *             no take twice running, so forty moves are not one recording
 *   level     every take peaks under 0.5; all of them go through one
 *             compressor and a 0.9 gain before the output, so two that
 *             overlap (your move, the reply) never clip
 *   setting   `enabled()` is read on every sound; off makes no context at all
 * @module pages/play-sound
 */
import { renderSound, heftOf, STRIKES } from "../core/sounds.js";

/** The sound a move makes, from its SAN. */
export function moveSound(san) {
  if (/^O-O/.test(san)) return "castle";
  if (/=[QRBN]/.test(san)) return "promote";
  if (/[+#]$/.test(san)) return "check";
  if (san.includes("x")) return "capture";
  return "move";
}

/** Sounds with four takes and a weight per man (sound-bank VARIED / HEFTED). */
const VARIED = new Set(["move", "capture", "check", "castle", "promote"]);
const HEFTED = new Set(["move", "capture"]);
const WARM = ["move", "capture", "check", "castle", "promote"];
export const MASTER_GAIN = 0.9;

export function createSound(enabled) {
  let ctx = null, master = null, warmed = false;
  const last = {};
  const buffers = new Map();
  const played = [];
  const stats = { plays: 0, rendered: 0, cold: 0, worstMs: 0 };
  let seed = 0x9e3779b9;
  const wobble = (spread) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return 1 + ((seed / 0x7fffffff) * 2 - 1) * spread; };

  function context() {
    if (!ctx) {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      ctx = new AC({ latencyHint: "interactive" });
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 4;
      comp.attack.value = 0.004; comp.release.value = 0.12;
      const g = ctx.createGain();
      g.gain.value = MASTER_GAIN;
      comp.connect(g);
      g.connect(ctx.destination);
      master = comp;
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }

  function buffer(name, strike, heft) {
    const key = name + strike + heft;
    let buf = buffers.get(key);
    if (!buf) {
      const pcm = renderSound(name, ctx.sampleRate, { strike, heft });
      buf = ctx.createBuffer(1, pcm.length, ctx.sampleRate);
      buf.copyToChannel(pcm, 0);
      buffers.set(key, buf);
      stats.rendered++;
    }
    return buf;
  }

  /** Render the every-move takes ahead of time, a few per idle slice. */
  function warm() {
    if (warmed || !ctx) return;
    warmed = true;
    const todo = [];
    for (const name of WARM) for (let s = 0; s < STRIKES; s++)
      for (const heft of HEFTED.has(name) ? ["light", "mid", "heavy"] : ["mid"]) todo.push([name, s, heft]);
    const idle = globalThis.requestIdleCallback || ((f) => setTimeout(() => f({ timeRemaining: () => 8 }), 16));
    const step = (dl) => {
      while (todo.length && dl.timeRemaining() > 2) buffer(...todo.shift());
      if (todo.length) idle(step);
    };
    idle(step);
  }

  /** On the first gesture: make the context while the page may, and start warming. */
  function unlock() {
    if (!enabled()) return;
    try { context(); warm(); } catch { /* no audio here */ }
  }

  function play(name, piece, color) {
    played.push(name);
    if (played.length > 50) played.shift();
    if (!enabled()) return;
    const t0 = performance.now();
    try {
      context();
      let strike = 0;
      if (VARIED.has(name)) {
        strike = Math.floor(Math.random() * STRIKES);
        if (strike === last[name]) strike = (strike + 1) % STRIKES;
        last[name] = strike;
      }
      const heft = HEFTED.has(name) && piece ? heftOf(piece) : "mid";
      const before = stats.rendered;
      const src = ctx.createBufferSource();
      src.buffer = buffer(name, strike, heft);
      if (stats.rendered > before) stats.cold++;
      if (VARIED.has(name)) src.playbackRate.value = (color === "b" ? 0.95 : 1) * wobble(0.03);
      src.connect(master);
      src.start();
      warm();
    } catch { /* no audio here: silence is fine */ }
    stats.plays++;
    stats.worstMs = Math.max(stats.worstMs, performance.now() - t0);
  }

  const onGesture = () => unlock();
  if (typeof addEventListener === "function") {
    addEventListener("pointerdown", onGesture, { capture: true, passive: true });
    addEventListener("keydown", onGesture, { capture: true, passive: true });
  }
  return {
    play, played, stats, unlock,
    get latency() { return ctx ? { base: ctx.baseLatency || 0, output: ctx.outputLatency || 0, state: ctx.state } : null; },
    close() {
      if (typeof removeEventListener === "function") {
        removeEventListener("pointerdown", onGesture, { capture: true });
        removeEventListener("keydown", onGesture, { capture: true });
      }
      if (ctx) ctx.close().catch(() => {});
    },
  };
}
