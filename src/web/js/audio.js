/**
 * Offline-synthesized game sounds (no assets): wooden piece placement + win chord.
 * App wires an isEnabled callback via init(); play calls no-op when disabled.
 * @module audio
 */
(function (global) {
  let audioCtx = null;
  let enabled = () => true;

  function init(isEnabled) {
    if (typeof isEnabled === "function") enabled = isEnabled;
  }

  function ensureAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
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
      bp.frequency.value = color === "b" ? 1450 : 1700;
      bp.Q.value = 0.9;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.22, t0);
      ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
      src.connect(bp); bp.connect(ng); ng.connect(ctx.destination);
      src.start(t0); src.stop(t0 + 0.06);
      // 2) the body: fast-decaying woody tone, black lower than white
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(color === "b" ? 195 : 255, t0);
      osc.frequency.exponentialRampToValueAtTime(color === "b" ? 145 : 190, t0 + 0.08);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.1, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
      osc.connect(g); g.connect(ctx.destination);
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
        o2.connect(g2); g2.connect(ctx.destination);
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
        o3.connect(g3); g3.connect(ctx.destination);
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
        osc.connect(g); g.connect(ctx.destination);
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
        osc.connect(g); g.connect(ctx.destination);
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
        osc.connect(g); g.connect(ctx.destination);
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
        osc.connect(g); g.connect(ctx.destination);
        osc.start(t0); osc.stop(t0 + 0.55);
      });
    } catch (_) {}
  }

  global.ChessAudio = { init, playMove, playWin, playStar, playDraw };
})(typeof window !== "undefined" ? window : globalThis);
