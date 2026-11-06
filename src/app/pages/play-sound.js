/**
 * Sounds for the play screen: move, capture, check, castle, promote and the
 * endings, rendered once per take from 19.0's wooden set (core/sounds) into
 * an AudioContext made on the first gesture. `played` keeps the last names
 * for the e2e (headless Chromium does not let anyone listen).
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

export function createSound(enabled) {
  let ctx = null, last = -1;
  const buffers = new Map();
  const played = [];
  function play(name, piece) {
    played.push(name);
    if (played.length > 50) played.shift();
    if (!enabled()) return;
    try {
      if (!ctx) ctx = new AudioContext();
      if (ctx.state === "suspended") ctx.resume();
      let strike = Math.floor(Math.random() * STRIKES);
      if (strike === last) strike = (strike + 1) % STRIKES;
      last = strike;
      const heft = piece ? heftOf(piece) : "mid";
      const key = name + strike + heft;
      let buf = buffers.get(key);
      if (!buf) {
        const pcm = renderSound(name, ctx.sampleRate, { strike, heft });
        buf = ctx.createBuffer(1, pcm.length, ctx.sampleRate);
        buf.copyToChannel(pcm, 0);
        buffers.set(key, buf);
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start();
    } catch { /* no audio here: silence is fine */ }
  }
  return { play, played, close: () => ctx && ctx.close().catch(() => {}) };
}
