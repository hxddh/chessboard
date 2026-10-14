# Recorded sounds

Empty: the wooden set the app plays is rendered from a physical model
(`src/web/js/sound-bank.js`), the project's own work under GPLv3.

To use recordings instead, put WAV files here named for the event and the
take (`move-1.wav`, `move-2.wav`, `capture-1.wav`, … — the events are
`SOUND_NAMES` in `sound-bank.js`), run `node scripts/sound-kit.mjs`, then
`npm run build`. 16-bit PCM, at most 2 s each and 300 KB in all.

Every file needs a line below: where it came from and its licence. Only a
licence GPLv3 can carry (CC0, CC BY, CC BY-SA 4.0) — not NC, not "free for
personal use", not a licence nobody could check at its source.

| file | source | licence |
|---|---|---|
