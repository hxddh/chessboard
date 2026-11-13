/**
 * The sounds' door: the names the app calls, and the chunk that is their
 * code (audio.js with sound-bank.js, chunk-audio.js).
 *
 * 22.0 C1: 16 KB of synthesis sat in every first paint for a sound that can
 * only be heard after a first move. The chunk is asked for in idle time once
 * the page is up, so it is there before a piece is set down; a call that
 * still comes first fetches it and is made when the code arrives — settings
 * in the order they were given, then the sound.
 * @module audio-lazy
 */
import { loadChunk } from "./chunk.js";

/** the sets audio.js plays (its SOUND_SETS; scripts/test/sync-charts-sounds.mjs holds the two together) */
const SOUND_SETS = ["wood", "classic"];
const S = { real: null, asked: null, kept: [], booked: false, failedAt: 0 };
/** after a failed fetch, how long calls go quietly unanswered before the chunk is asked for again */
const RETRY_MS = 10000;

function ensure() {
  if (S.real) return Promise.resolve(S.real);
  // 23.0 (review-22.0 §3.1-6): a chunk that keeps failing was asked for again —
  // a fresh <script> — by every sound, every clock tick
  if (!S.asked && S.failedAt && Date.now() - S.failedAt < RETRY_MS) return Promise.resolve(null);
  if (!S.asked) {
    S.asked = loadChunk("chunk-audio.js", "ChessAudio").then((a) => {
      // 23.0 (§3.1-5): a setting that throws while being replayed (no
      // AudioContext, say) must not leave a rejected promise behind for every
      // later sound to trip over — the sounds are optional, the page is not
      for (const [k, args] of S.kept.splice(0)) {
        try { a[k](...args); } catch (_) { /* that setting is lost; the next one still applies */ }
      }
      S.real = a;
      return a;
    }, () => { S.asked = null; S.failedAt = Date.now(); return null; });
  }
  return S.asked;
}

/**
 * A setting: applied now, or kept in order until the code is here. The first
 * one (init, at launch) books the fetch for idle time a moment after the
 * first frame — nothing but the boot chunk and the pieces loads before that
 * (test-board-e2e) — and a sound asked for sooner fetches it at once.
 */
const setting = (k) => (...args) => {
  if (S.real) return S.real[k](...args);
  // only the last of each setting is owed (init excepted: it runs once, first) —
  // 23.0 (§3.1-6): through 22.0 noteClock queued one entry per clock tick
  // for as long as the chunk was missing
  if (k !== "init") S.kept = S.kept.filter(([kk]) => kk !== k);
  S.kept.push([k, args]);
  if (S.booked) return;
  S.booked = true;
  const g = typeof window !== "undefined" ? window : globalThis;
  g.setTimeout(() => (g.requestIdleCallback || g.setTimeout)(() => ensure()), 1500);
};
/** A sound (or a question): asked of the code, once it is here. */
const call = (k) => (...args) => (S.real ? S.real[k](...args) : ensure().then((a) => {
  if (!a) return undefined;
  try { return a[k](...args); } catch (_) { return undefined; }
}));

/** the app's handle on the sounds — `ChessAudio` itself is the chunk's name for the code */
export const ChessSound = { SOUND_SETS };
for (const k of ["init", "setVolume", "setSoundSet", "noteClock"]) ChessSound[k] = setting(k);
for (const k of ["playMove", "playWin", "playLoss", "playStar", "playDraw", "playRefused", "playLift", "playCastle",
  "playPromote", "playStart", "playWrong", "playLowTime", "getVolume", "getSoundSet", "selftest", "useKit"]) ChessSound[k] = call(k);
