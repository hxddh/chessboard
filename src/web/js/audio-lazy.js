/**
 * The sounds' door: the names the app calls, and the chunk that is their
 * code (audio.js with sound-bank.js, chunk-audio.js).
 *
 * 22.0 C1: 16 KB of synthesis sat in every first paint for a sound that can
 * only be heard after a first move. The chunk is asked for as soon as the
 * page is up (init), so it is there long before a piece is set down; a call
 * that still comes first is kept and made when the code arrives — settings
 * in the order they were given, then the sound.
 * @module audio-lazy
 */
import { loadChunk } from "./chunk.js";

/** the sets audio.js plays (its SOUND_SETS; scripts/test/sync-charts-sounds.mjs holds the two together) */
const SOUND_SETS = ["wood", "classic"];
const S = { real: null, asked: null, kept: [] };

function ensure() {
  if (!S.asked) {
    S.asked = loadChunk("chunk-audio.js", "ChessAudio").then((a) => {
      S.real = a;
      for (const [k, args] of S.kept.splice(0)) a[k](...args);
      return a;
    }, () => { S.asked = null; return null; });
  }
  return S.asked;
}

/** A setting: applied now, or kept in order until the code is here. */
const setting = (k) => (...args) => {
  if (S.real) return S.real[k](...args);
  S.kept.push([k, args]);
  ensure();
};
/** A sound (or a question): asked of the code, once it is here. */
const call = (k) => (...args) => (S.real ? S.real[k](...args) : ensure().then((a) => (a ? a[k](...args) : undefined)));

/** the app's handle on the sounds — `ChessAudio` itself is the chunk's name for the code */
export const ChessSound = { SOUND_SETS };
for (const k of ["init", "setVolume", "setSoundSet", "noteClock"]) ChessSound[k] = setting(k);
for (const k of ["playMove", "playWin", "playLoss", "playStar", "playDraw", "playRefused", "playLift", "playCastle",
  "playPromote", "playStart", "playWrong", "playLowTime", "getVolume", "getSoundSet", "selftest", "useKit"]) ChessSound[k] = call(k);
