/**
 * Print what the default sound set measures as, and optionally write it out
 * as WAV files to listen to.
 *
 * The app never loads these files — it renders the same buffers at runtime
 * (src/web/js/sound-bank.js says why). This is for the person reviewing a
 * change to the model: the table is what test-audio-e2e.mjs holds the sounds
 * to, and the WAVs are what the app will play.
 *
 *   node scripts/render-sounds.mjs              the table
 *   node scripts/render-sounds.mjs --out DIR    …and DIR/<name>.wav, 22.05 kHz mono 16-bit
 */
import fs from "fs";
import path from "path";
import { loadSoundBank, measure, wav } from "./lib/sound-metrics.mjs";

const { renderSound, SOUND_NAMES } = loadSoundBank();
const outAt = process.argv.indexOf("--out");
const dir = outAt > 0 ? process.argv[outAt + 1] : null;
if (dir) fs.mkdirSync(dir, { recursive: true });

const SR = 22050;
let bytes = 0;
console.log("name      ms   attack  decay-40dB  centroid  hash");
for (const name of SOUND_NAMES) {
  const x = renderSound(name, SR);
  const m = measure(renderSound(name, 44100), 44100);
  console.log(name.padEnd(9), String(m.ms).padStart(4), (m.attackMs + "ms").padStart(8),
    ((m.decayMs ?? "-") + "ms").padStart(11), (m.centroidHz + "Hz").padStart(9), " " + m.hash);
  if (dir) {
    const w = wav(x, SR);
    bytes += w.length;
    fs.writeFileSync(path.join(dir, name + ".wav"), w);
  }
}
if (dir) console.log("wrote " + SOUND_NAMES.length + " files, " + (bytes / 1024).toFixed(1) + " KB, to " + dir);
