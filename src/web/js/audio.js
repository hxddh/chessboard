/**
 * Offline-synthesized game sounds — no assets, no files, just an oscillator
 * and a noise burst per event.
 *
 * App wires an isEnabled callback via init(); play calls no-op when disabled.
 *
 * Two things every voice in here goes through:
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
  let audioCtx = null;
  let master = null;
  let enabled = () => true;

  function init(isEnabled) {
    if (typeof isEnabled === "function") enabled = isEnabled;
  }

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
    g.gain.value = 0.9;
    comp.connect(g);
    g.connect(ctx.destination);   // the only node that touches the output
    master = comp;
    return master;
  }

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

  export const ChessAudio = { init, playMove, playWin, playLoss, playStar, playDraw,
    playRefused, playLift, playCastle, playPromote };
