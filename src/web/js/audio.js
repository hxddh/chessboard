/**
 * Game sounds: two sets, one API.
 *
 * **木质 (wood, the default from v7-7-plan §8 on).** Sample buffers of wooden pieces on a
 * wooden board, rendered on first use by sound-bank.js from a small physical
 * model — a distinct sound for a move, a capture, check, castling, promotion,
 * the start, the three endings, low time, a lesson star and a wrong puzzle
 * move (v7-7-plan §8). sound-bank.js has the model, and why it is rendered
 * rather than recorded.
 *
 * **经典 (classic).** The oscillator set this app shipped until 7.6, kept as
 * it was: an oscillator and a noise burst per event. Each play function below
 * tries the wooden sample first (`sample()` answers true when the wooden set
 * is in use) and falls through to its classic voices otherwise.
 *
 * App wires an isEnabled callback via init(); play calls no-op when disabled.
 *
 * Two things every voice in here goes through, in both sets:
 *
 * **A master gain.** Every sound used to connect straight to
 * `ctx.destination`, which means nothing limited the sum. One move that both
 * captures and gives check stacks four voices — the clack, the body, the
 * capture thunk, the check ping — and if a lesson star lands on top of that it
 * is five. Peaks add, and the result is a click, which is the one artefact
 * that makes a synthesised sound feel cheap.
 *
 * **A little variation.** Until 2.0 every move by the same colour was
 * byte-identical, which no physical object is: the same piece on the same
 * square twice does not make the same sound. ±3% detune and ±10% level is
 * enough to stop the ear from noticing it is a recording, and small enough
 * that nobody can name what changed.
 *
 * @module audio
 */
import { SOUND_NAMES, renderSound } from "./sound-bank.js";

  let audioCtx = null;
  let master = null;
  let enabled = () => true;

  function init(isEnabled) {
    if (typeof isEnabled === "function") enabled = isEnabled;
  }

  /** 7.7: which set plays — "wood" (sampled, the default) or "classic". */
  const SOUND_SETS = ["wood", "classic"];
  let soundSet = "wood";
  function setSoundSet(id) { if (SOUND_SETS.includes(id)) soundSet = id; }
  function getSoundSet() { return soundSet; }

  /**
   * The wooden set's buffers, rendered once per AudioContext at its own
   * sample rate (a buffer at another rate would be resampled on every play).
   */
  let bankCtx = null;
  const bank = new Map();
  function sampleBuffer(ctx, name) {
    if (bankCtx !== ctx) { bank.clear(); bankCtx = ctx; }
    let b = bank.get(name);
    if (!b) {
      const pcm = renderSound(name, ctx.sampleRate);
      b = ctx.createBuffer(1, pcm.length, ctx.sampleRate);
      b.getChannelData(0).set(pcm);
      bank.set(name, b);
    }
    return b;
  }

  /**
   * Play one of the wooden set's sounds, if that is the set in use.
   *
   * @param {string} name  one of sound-bank.js SOUND_NAMES
   * @param {number} [rate]  playback rate. A placement is wobbled ±3%, which
   *   moves its pitch and its length together, the way a slightly different
   *   blow would; anything with a tune plays at exactly 1.
   * @returns {boolean} true when the wooden set is in use (whether or not the
   *   platform let it play), so the caller skips its classic voices
   */
  function sample(name, rate = 1) {
    if (soundSet !== "wood") return false;
    try {
      const ctx = ensureAudio();
      const src = ctx.createBufferSource();
      src.buffer = sampleBuffer(ctx, name);
      src.playbackRate.value = rate;
      const g = ctx.createGain();
      g.gain.value = rate === 1 ? 1 : wobble(0.08);
      src.connect(g); g.connect(out(ctx));
      src.start(ctx.currentTime);
    } catch (_) {}
    return true;
  }

  /** A placement's rate: black a shade lower than white, and never twice the same. */
  const placeRate = (color) => (color === "b" ? 0.95 : 1) * wobble(0.03);

  function ensureAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  /**
   * The one node everything connects to.
   *
   * A compressor rather than a plain gain: a gain would just make every sound
   * quieter, and the problem is not loudness in general, it is the peaks when
   * several voices land in the same 200ms. The threshold is set so a single
   * move never touches it and a four-voice pile-up is pulled back rather than
   * clipped.
   */
  function out(ctx) {
    if (master && master.context === ctx) return master;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.12;
    const g = ctx.createGain();
    g.gain.value = 0.9 * volume;
    comp.connect(g);
    g.connect(ctx.destination);   // the only node that touches the output
    master = comp;
    masterGain = g;
    return master;
  }

  /**
   * 6.0: one volume for everything (v6-plan Q2.8). The compressor above keeps
   * the peaks in line; this is the player's own level under it, 0–1, applied
   * to the single node every voice runs through.
   */
  let masterGain = null;
  let volume = 1;
  function setVolume(v) {
    volume = Math.max(0, Math.min(1, Number(v) || 0));
    if (masterGain) masterGain.gain.value = 0.9 * volume;
  }
  function getVolume() { return volume; }

  /**
   * A small deterministic wobble, so repeated moves are not identical.
   *
   * Seeded rather than Math.random: the tests replay fixed games and a sound
   * that differs run to run is a sound nobody can assert anything about.
   */
  let wobbleSeed = 0x9e3779b9;
  function wobble(spread) {
    wobbleSeed = (wobbleSeed * 1103515245 + 12345) & 0x7fffffff;
    return 1 + ((wobbleSeed / 0x7fffffff) * 2 - 1) * spread;
  }

  /** Cached short white-noise buffer — reused for every piece's "tap". */
  let noiseBuf = null;
  function noiseBuffer(ctx) {
    if (noiseBuf) return noiseBuf;
    const n = Math.floor(ctx.sampleRate * 0.06);
    noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let seed = 0x2545f491; // deterministic — no Math.random needed
    for (let i = 0; i < n; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      d[i] = (seed / 0x40000000 - 1) * (1 - i / n); // fade toward silence
    }
    return noiseBuf;
  }

  // A felted chess piece set on a wooden board: a soft tap (bandpassed noise)
  // plus a lower woody body resonance — deeper than a bare stone click.
  // opts: { captured, check } layer extra cues on top of the base tap.
  function playMove(color, opts) {
    if (!enabled()) return;
    // check outranks capture: it is the one the player has to answer
    const o0 = opts || {};
    if (sample(o0.check ? "check" : o0.captured ? "capture" : "move", placeRate(color))) return;
    try {
      const ctx = ensureAudio();
      const t0 = ctx.currentTime;
      const o = opts || {};
      // 1) the clack: brief bandpassed noise burst
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = (color === "b" ? 1450 : 1700) * wobble(0.03);
      bp.Q.value = 0.9;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.22 * wobble(0.1), t0);
      ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
      src.connect(bp); bp.connect(ng); ng.connect(out(ctx));
      src.start(t0); src.stop(t0 + 0.06);
      // 2) the body: fast-decaying woody tone, black lower than white
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "triangle";
      const detune = wobble(0.03);
      osc.frequency.setValueAtTime((color === "b" ? 195 : 255) * detune, t0);
      osc.frequency.exponentialRampToValueAtTime((color === "b" ? 145 : 190) * detune, t0 + 0.08);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.1, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
      osc.connect(g); g.connect(out(ctx));
      osc.start(t0); osc.stop(t0 + 0.13);
      // capture: a second, heavier thunk right after — piece knocked off
      if (o.captured) {
        const o2 = ctx.createOscillator();
        const g2 = ctx.createGain();
        o2.type = "triangle";
        o2.frequency.setValueAtTime(120, t0 + 0.03);
        o2.frequency.exponentialRampToValueAtTime(85, t0 + 0.14);
        g2.gain.setValueAtTime(0.0001, t0 + 0.03);
        g2.gain.exponentialRampToValueAtTime(0.14, t0 + 0.045);
        g2.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
        o2.connect(g2); g2.connect(out(ctx));
        o2.start(t0 + 0.03); o2.stop(t0 + 0.2);
      }
      // check: a small alert ping on top
      if (o.check) {
        const o3 = ctx.createOscillator();
        const g3 = ctx.createGain();
        o3.type = "sine";
        o3.frequency.value = 1567; // G6
        g3.gain.setValueAtTime(0.0001, t0 + 0.06);
        g3.gain.exponentialRampToValueAtTime(0.055, t0 + 0.075);
        g3.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
        o3.connect(g3); g3.connect(out(ctx));
        o3.start(t0 + 0.06); o3.stop(t0 + 0.32);
      }
    } catch (_) {}
  }

  function playWin() {
    if (!enabled()) return;
    if (sample("win")) return;
    try {
      const ctx = ensureAudio();
      // rising major arpeggio, then a soft sustained chord to land on
      const arp = [523.25, 659.25, 783.99, 1046.5];
      arp.forEach((f, i) => {
        const t0 = ctx.currentTime + i * 0.085;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.11, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.24);
        osc.connect(g); g.connect(out(ctx));
        osc.start(t0); osc.stop(t0 + 0.26);
      });
      const tc = ctx.currentTime + arp.length * 0.085 + 0.02;
      [523.25, 659.25, 783.99].forEach((f) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = f;
        g.gain.setValueAtTime(0.0001, tc);
        g.gain.exponentialRampToValueAtTime(0.06, tc + 0.04);
        g.gain.exponentialRampToValueAtTime(0.0001, tc + 0.6);
        osc.connect(g); g.connect(out(ctx));
        osc.start(tc); osc.stop(tc + 0.64);
      });
    } catch (_) {}
  }

  /** Bright two-note chime for collecting a lesson star. */
  function playStar() {
    if (!enabled()) return;
    if (sample("star")) return;
    try {
      const ctx = ensureAudio();
      [880, 1318.5].forEach((f, i) => {
        const t0 = ctx.currentTime + i * 0.07;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.09, t0 + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
        osc.connect(g); g.connect(out(ctx));
        osc.start(t0); osc.stop(t0 + 0.24);
      });
    } catch (_) {}
  }

  /** Neutral two-note close for draws — settles, neither rises nor falls hard. */
  function playDraw() {
    if (!enabled()) return;
    if (sample("draw")) return;
    try {
      const ctx = ensureAudio();
      [[659.25, 0], [523.25, 0.16]].forEach(([f, dt]) => {
        const t0 = ctx.currentTime + dt;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.07, t0 + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
        osc.connect(g); g.connect(out(ctx));
        osc.start(t0); osc.stop(t0 + 0.55);
      });
    } catch (_) {}
  }

  /**
   * Losing.
   *
   * A falling minor third, short, and quiet — the opposite shape to playWin's
   * rising arpeggio and about half its level. Until 2.0 there was no such
   * sound: being checkmated, losing on time and *resigning* all played the
   * victory fanfare, because the dispatch asked "did the game end" rather than
   * "who won". 缺陷 1.
   *
   * Deliberately not harsh. Losing is the normal case while you are learning,
   * and a sound that punishes you for it is a sound you turn off.
   */
  function playLoss() {
    if (!enabled()) return;
    if (sample("loss")) return;
    try {
      const ctx = ensureAudio();
      [[440, 0], [369.99, 0.13]].forEach(([f, dt]) => {
        const t0 = ctx.currentTime + dt;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.055, t0 + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45);
        osc.connect(g); g.connect(out(ctx));
        osc.start(t0); osc.stop(t0 + 0.5);
      });
    } catch (_) {}
  }

  /**
   * A move that was refused — the piece is going back where it came from.
   *
   * "No" is a state this app already draws (the piece slides home rather than
   * blinking back); it should be audible too. Short, dull, low: a thud, not a
   * buzzer.
   */
  function playRefused() {
    if (!enabled()) return;
    if (sample("refused")) return;
    try {
      const ctx = ensureAudio();
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(196, t0);
      osc.frequency.exponentialRampToValueAtTime(155, t0 + 0.09);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.13);
      osc.connect(g); g.connect(out(ctx));
      osc.start(t0); osc.stop(t0 + 0.14);
    } catch (_) {}
  }

  /** Picking a piece up: the quietest thing in here, felt more than heard. */
  function playLift() {
    if (!enabled()) return;
    if (sample("lift", wobble(0.03))) return;
    try {
      const ctx = ensureAudio();
      const t0 = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 2600 * wobble(0.04);
      bp.Q.value = 1.4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.05 * wobble(0.1), t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.03);
      src.connect(bp); bp.connect(g); g.connect(out(ctx));
      src.start(t0); src.stop(t0 + 0.04);
    } catch (_) {}
  }

  /**
   * Castling: two pieces, so two sounds.
   *
   * King then rook, 70ms apart — the gap is what makes it read as two hands
   * rather than one heavy piece. It is the only move that moves two pieces and
   * the hardest one to follow on the board, which is exactly why it is worth
   * hearing.
   */
  function playCastle(color) {
    if (!enabled()) return;
    if (sample("castle", placeRate(color))) return;
    playMove(color);
    try {
      const ctx = ensureAudio();
      const t0 = ctx.currentTime + 0.07;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "triangle";
      const f = (color === "b" ? 178 : 232) * wobble(0.03);
      osc.frequency.setValueAtTime(f, t0);
      osc.frequency.exponentialRampToValueAtTime(f * 0.75, t0 + 0.08);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.13);
      osc.connect(g); g.connect(out(ctx));
      osc.start(t0); osc.stop(t0 + 0.14);
    } catch (_) {}
  }

  /**
   * Promotion: the same piece, heavier.
   *
   * A pawn becoming a queen should sound like the object got bigger — a lower
   * body and a longer tail under the ordinary placement, not a fanfare. The
   * fanfare belongs to winning, and promoting is not winning yet.
   */
  function playPromote(color) {
    if (!enabled()) return;
    if (sample("promote", placeRate(color))) return;
    playMove(color);
    try {
      const ctx = ensureAudio();
      const t0 = ctx.currentTime + 0.02;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(110, t0);
      osc.frequency.exponentialRampToValueAtTime(87, t0 + 0.3);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.1, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.36);
      osc.connect(g); g.connect(out(ctx));
      osc.start(t0); osc.stop(t0 + 0.38);
    } catch (_) {}
  }

  /**
   * A new game (7.7): two rising wooden notes. The classic set never had a
   * sound here and still does not.
   */
  function playStart() {
    if (!enabled()) return;
    sample("start");
  }

  /**
   * A puzzle move that was not the answer (7.7): two low, dry knocks. Not the
   * refusal: that move was legal and was played, it was only wrong. The
   * classic set was silent here and stays so.
   */
  function playWrong() {
    if (!enabled()) return;
    sample("wrong");
  }

  /**
   * Under 20 seconds (v7-7-plan §8): three quick wooden ticks. This one is
   * information rather than decoration, so the classic set gets a voice for
   * it too — two short high beeps.
   */
  function playLowTime() {
    if (!enabled()) return;
    if (sample("lowtime")) return;
    try {
      const ctx = ensureAudio();
      [0, 0.14].forEach((dt) => {
        const t0 = ctx.currentTime + dt;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = 988; // B5
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.06, t0 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1);
        osc.connect(g); g.connect(out(ctx));
        osc.start(t0); osc.stop(t0 + 0.11);
      });
    } catch (_) {}
  }

  /**
   * The clock, as app.js renders it: `side` has `ms` left.
   *
   * Plays playLowTime once, when a clock crosses below 20 s. "Once" has to
   * survive the increment: at 3+2 a player hovering around 20 s would cross
   * it on every move, so a side is armed only while its clock reads 30 s or
   * more — in practice, at the start of the next game. A clock first seen
   * already under 20 s (a game restored late) was never armed: nobody has
   * just run low.
   */
  const LOW_MS = 20000, ARM_MS = 30000;
  const lowArmed = { w: false, b: false };
  function noteClock(side, ms) {
    if (!(side in lowArmed) || !Number.isFinite(ms)) return;
    if (ms >= ARM_MS) lowArmed[side] = true;
    else if (lowArmed[side] && ms < LOW_MS && ms > 0) {
      lowArmed[side] = false;
      playLowTime();
    }
  }

  /**
   * The packaged app's self-test (app.js runSelftest, 7.7): can this WebView
   * build the default set's buffers and render them?
   *
   * Offline, so it needs no user gesture and makes no sound: every sound is
   * rendered through an OfflineAudioContext, one after another, and each
   * stretch of the result must be audible. The live context is not touched.
   *
   * @returns {Promise<{pass: boolean, sounds: number, err?: string}>}
   */
  async function selftest() {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) throw new Error("no OfflineAudioContext");
    const sr = 44100;
    const pcms = SOUND_NAMES.map((n) => renderSound(n, sr));
    const off = new OAC(1, pcms.reduce((a, p) => a + p.length, 0), sr);
    const spans = [];
    let at = 0;
    for (const pcm of pcms) {
      const b = off.createBuffer(1, pcm.length, sr);
      b.getChannelData(0).set(pcm);
      const src = off.createBufferSource();
      src.buffer = b;
      src.connect(off.destination); // rendered into memory, never heard
      src.start(at / sr);
      spans.push([at, at + pcm.length]);
      at += pcm.length;
    }
    // WKWebView before Safari 14.1 answered through oncomplete, not a promise
    const done = new Promise((resolve) => { off.oncomplete = (e) => resolve(e.renderedBuffer); });
    const p = off.startRendering();
    const data = (await (p && typeof p.then === "function" ? p : done)).getChannelData(0);
    const silent = SOUND_NAMES.filter((_, i) => {
      let peak = 0;
      for (let k = spans[i][0]; k < spans[i][1]; k++) peak = Math.max(peak, Math.abs(data[k]));
      return !(peak > 0.05);
    });
    const r = { pass: silent.length === 0, sounds: SOUND_NAMES.length };
    if (silent.length) r.err = "rendered silent: " + silent.join(", ");
    return r;
  }

  export const ChessAudio = { init, playMove, playWin, playLoss, playStar, playDraw,
    playRefused, playLift, playCastle, playPromote, playStart, playWrong, playLowTime,
    noteClock, setVolume, getVolume, setSoundSet, getSoundSet, SOUND_SETS, selftest };
