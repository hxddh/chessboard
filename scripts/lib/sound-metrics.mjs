/**
 * Numbers for a sound nobody running the tests can hear.
 *
 * The default sound set (src/web/js/sound-bank.js) is rendered from a model,
 * and a model can drift into something that no longer sounds like wood without
 * any test noticing. These are the three measurements a listener's ear makes
 * first, taken from the PCM itself:
 *
 *   attackMs   onset (first sample above 5% of the peak) to the loudest
 *              sample of the first 20 ms — a struck object is at full level
 *              within a few milliseconds
 *   decayMs    the 2 ms RMS envelope, from its peak to 40 dB below it — how
 *              long the thing rings; wood is short
 *   centroidHz the spectral centroid of the first 150 ms — where the energy
 *              sits: a light wooden click is bright (~2–3 kHz), a heavy
 *              thud is lower
 *
 * Plus a hash, so "no two events share a sound" is a comparison of numbers.
 *
 * @module sound-metrics
 */
import { loadAppModules } from "./app-module.mjs";

/** The bank, loaded the way the other scripts load app modules. */
export function loadSoundBank() {
  const ctx = loadAppModules(["src/web/js/sound-bank.js"]);
  return { renderSound: ctx.renderSound, SOUND_NAMES: [...ctx.SOUND_NAMES] };
}

/** FNV-1a over the samples quantised to 16 bits — what a WAV of it would hold. */
export function pcmHash(x) {
  let h = 0x811c9dc5;
  for (let i = 0; i < x.length; i++) {
    const v = Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))) & 0xffff;
    h = Math.imul(h ^ (v & 0xff), 0x01000193);
    h = Math.imul(h ^ (v >>> 8), 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function rmsEnvelope(x, sr, winS) {
  const w = Math.max(1, Math.round(winS * sr));
  const e = [];
  for (let i = 0; i + w <= x.length; i += w) {
    let s = 0;
    for (let j = 0; j < w; j++) s += x[i + j] * x[i + j];
    e.push(Math.sqrt(s / w));
  }
  return e;
}

/**
 * Spectral centroid of x[from, to), radix-2 FFT.
 *
 * Not Hann-windowed: a Hann window weights the middle of the span most, and
 * the middle of a 150 ms click is its tail, after the bright part has died —
 * it measured a wooden click as 600 Hz. Only the last 10% is tapered.
 */
function centroid(x, sr, from, to) {
  let n = 1;
  while (n < to - from) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  const span = to - from, taper = Math.max(1, Math.round(span * 0.1));
  for (let i = from; i < to; i++) {
    const left = to - i;
    re[i - from] = x[i] * (left < taper ? 0.5 - 0.5 * Math.cos(Math.PI * left / taper) : 1);
  }
  for (let i = 1, j = 0; i < n; i++) {
    let b = n >> 1;
    for (; j & b; b >>= 1) j ^= b;
    j ^= b;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, h = len / 2;
    for (let i = 0; i < n; i += len) {
      for (let j = 0; j < h; j++) {
        const c = Math.cos(a * j), s = Math.sin(a * j);
        const vr = re[i + j + h] * c - im[i + j + h] * s, vi = re[i + j + h] * s + im[i + j + h] * c;
        re[i + j + h] = re[i + j] - vr; im[i + j + h] = im[i + j] - vi;
        re[i + j] += vr; im[i + j] += vi;
      }
    }
  }
  let num = 0, den = 0;
  for (let k = 1; k < n / 2; k++) {
    const m = re[k] * re[k] + im[k] * im[k];
    num += (k * sr / n) * m;
    den += m;
  }
  return den ? num / den : 0;
}

/** @returns {{attackMs:number, decayMs:number|null, centroidHz:number, peak:number, ms:number, hash:string}} */
export function measure(x, sr) {
  let peak = 0, at = 0;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > peak) { peak = Math.abs(x[i]); at = i; }
  const onset = x.findIndex((v) => Math.abs(v) > peak * 0.05);
  // the attack of the first strike: a capture or an arpeggio peaks on a later
  // one, and that is composition, not a slow attack
  let first = 0, firstAt = onset;
  for (let i = onset; i < Math.min(x.length, onset + Math.round(0.02 * sr)); i++) {
    if (Math.abs(x[i]) > first) { first = Math.abs(x[i]); firstAt = i; }
  }
  const e = rmsEnvelope(x, sr, 0.002);
  let em = 0, ei = 0;
  e.forEach((v, i) => { if (v > em) { em = v; ei = i; } });
  let decay = null;
  for (let i = ei; i < e.length; i++) if (e[i] < em * 0.01) { decay = (i - ei) * 2; break; }
  return {
    attackMs: +((firstAt - onset) / sr * 1000).toFixed(2),
    decayMs: decay,
    centroidHz: Math.round(centroid(x, sr, 0, Math.min(x.length, Math.round(0.15 * sr)))),
    peak: +peak.toFixed(3),
    ms: Math.round(x.length / sr * 1000),
    hash: pcmHash(x),
  };
}

/** 16-bit mono PCM WAV. */
export function wav(x, sr) {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2);
  return b;
}
