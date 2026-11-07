/**
 * The native mirror and recovery (persist.js), on a fake host.
 *
 * Part of scripts/test-chess.mjs, which runs every module here in order.
 */
import { assert } from "./harness.mjs";

export async function run() {
  // --- 6.0: the native mirror and recovery (v6-plan Q1.1), on a fake host
  {
    const { createPersist, KEYS } = await import("../../src/web/js/persist.js");
    const mem = () => {
      const m = new Map();
      return {
        m,
        storageGet: (k) => (m.has(k) ? m.get(k) : null),
        storageSet: (k, v) => { m.set(k, String(v)); return true; },
        storageRemove: (k) => { m.delete(k); },
        hasZero: () => true,
      };
    };
    // a host with a per-key store: `initial` is a profile document's JSON
    // (written as its key files and a manifest) or, when it is not one, the
    // manifest's text as it is; `file` reads the profile back as one document
    // (the manifest as it is when it does not parse), and `writes` counts
    // commits — manifest writes
    const withFile = (text) => {
      const h = mem();
      h.store = new Map();
      h.writes = 0;
      let initial = null;
      try { initial = text == null ? null : JSON.parse(text); } catch (_) { initial = null; }
      if (text != null && !(initial && initial.keys)) h.store.set("meta", text);
      else if (initial) {
        for (const [k, v] of Object.entries(initial.keys)) h.store.set(k, v);
        h.store.set("meta", JSON.stringify({ app: "chessboard", schema: initial.schema, writtenAt: initial.writtenAt,
          keys: Object.keys(initial.keys), files: Object.fromEntries(Object.keys(initial.keys).map((k) => [k, k])) }));
      }
      h.appdataReadKey = async (k) => (h.store.has(k) ? { text: h.store.get(k) } : { missing: true });
      h.appdataWriteKey = async (k, t) => { h.store.set(k, t); if (k === "meta") h.writes++; return true; };
      Object.defineProperty(h, "file", { get() {
        const raw = h.store.get("meta");
        let m = null;
        try { m = JSON.parse(raw); } catch (_) { return raw == null ? null : raw; }
        const keys = {};
        for (const k of m.keys) keys[k] = h.store.get(m.files[k]);
        return JSON.stringify({ app: m.app, schema: m.schema, writtenAt: m.writtenAt, keys });
      } });
      return h;
    };
    const tick = (ms) => new Promise((r) => setTimeout(r, ms));

    // 1. a write reaches the file, once, whole
    {
      const h = withFile(null);
      const P = createPersist(h, () => {});
      P.load();
      // 6.1: the mirror is gated on recover(); the boot path always reconciles
      // before it is allowed to write over the file (see scheduleMirror)
      await P.recover();
      P.set("settings", "{\"a\":1}");
      P.set("learn", "{\"b\":2}");
      await tick(600);
      const doc = JSON.parse(h.file);
      assert(h.writes === 1 && doc.keys.settings === "{\"a\":1}" && doc.keys.learn === "{\"b\":2}",
        "two writes in a burst become one mirror commit (" + h.writes + ")");
      assert(doc.app === "chessboard" && typeof doc.writtenAt === "number", "…stamped as ours");
      // 6.0 review: the mirror used to take its own Date.now() ~400ms after the
      // cache stamp, so every next launch read "file newer than cache" and
      // restored + reloaded a profile that was already in sync
      assert(String(doc.writtenAt) === h.m.get("chess.writtenAt"),
        "…with the cache's own revision stamp, not a later one (" + doc.writtenAt + " vs " + h.m.get("chess.writtenAt") + ")");
      const P2 = createPersist(h, () => {});
      P2.load();
      assert((await P2.recover()) === "kept", "…so a synchronized profile is kept on the next launch, not restored");
    }
    // 2. empty cache + a file = the file is restored
    {
      const h = withFile(JSON.stringify({ app: "chessboard", schema: 3, writtenAt: 5000,
        keys: { stats: "{\"v\":2,\"games\":[]}", learn: "{\"v\":1}" } }));
      const P = createPersist(h, () => {});
      P.load();
      assert(P.wasEmpty(), "the cache was empty");
      const r = await P.recover();
      assert(r === "restored", "recover() takes the file when the cache is empty (" + r + ")");
      assert(P.get("stats") === "{\"v\":2,\"games\":[]}" && h.m.get(KEYS.learn) === "{\"v\":1}",
        "…and every key in the file is back in storage");
    }
    // 3. a live cache newer than the file keeps the cache, and re-mirrors it
    {
      const h = withFile(JSON.stringify({ app: "chessboard", schema: 3, writtenAt: 5000, keys: { learn: "old" } }));
      h.m.set(KEYS.learn, "new"); h.m.set("chess.writtenAt", "9000");
      const P = createPersist(h, () => {});
      P.load();
      const r = await P.recover();
      assert(r === "kept" && P.get("learn") === "new", "a newer cache is kept over an older file (" + r + ")");
      await tick(600);
      assert(JSON.parse(h.file).keys.learn === "new", "…and the file is brought up to date");
    }
    // 4. a cache older than the file yields to it (data written on another launch that this cache missed)
    {
      const h = withFile(JSON.stringify({ app: "chessboard", schema: 3, writtenAt: 9000, keys: { learn: "file" } }));
      h.m.set(KEYS.learn, "cache"); h.m.set("chess.writtenAt", "5000");
      const P = createPersist(h, () => {});
      P.load();
      const r = await P.recover();
      assert(r === "restored" && P.get("learn") === "file", "an older cache yields to the file (" + r + ")");
    }
    // 5. export / restore round-trip and the failure latch
    {
      const h = withFile(null);
      let failed = null;
      const P = createPersist(h, (info) => { failed = info; });
      P.load();
      await P.recover();
      P.set("slots", "{\"v\":1}");
      const doc = P.exportAll();
      assert(doc.keys.slots === "{\"v\":1}" && P.isProfileDoc(doc), "exportAll() is a profile document");
      P.clearAll();
      assert(P.get("slots") == null, "clearAll() empties the cache");
      P.restoreAll(doc);
      assert(P.get("slots") === "{\"v\":1}", "restoreAll() brings it back");
      h.appdataWriteKey = async () => { throw new Error("disk full"); };
      P.set("slots", "x");
      await tick(600);
      assert(failed && failed.key === "appdata", "a refused mirror write latches the failure like a refused cache write");
    }
    // 6.1 — 7. the boot race: a cleared cache, an intact file, a slow read.
    // Before 6.1 the boot writes armed the 400ms mirror while recover() was
    // still in flight, so an empty profile reached the file first, recover()
    // then read back what it had just destroyed, and the user was told their
    // profile had been restored.
    {
      const good = JSON.stringify({ app: "chessboard", schema: 3, writtenAt: 9000,
        keys: { stats: "{\"v\":2,\"games\":[1]}", learn: "{\"v\":1,\"done\":1}" } });
      const h = withFile(good);
      const read = h.appdataReadKey;
      h.appdataReadKey = async (k) => { await tick(900); return read(k); };  // slower than MIRROR_DELAY
      const P = createPersist(h, () => {});
      P.load();
      const pending = P.recover();
      P.set("settings", "{\"fresh\":1}");   // what loadSettings/saveGame do on boot
      P.set("save", "{\"v\":1,\"pgn\":\"\"}");
      await tick(600);                      // the old mirror would have fired here
      assert(h.writes === 0, "no mirror write reaches the file before recover() has run (" + h.writes + ")");
      assert(JSON.parse(h.file).keys.stats === "{\"v\":2,\"games\":[1]}", "…so the good file is still the good file");
      const r = await pending;
      assert(r === "restored", "…and the file wins over the cache the boot just wrote (" + r + ")");
      assert(P.get("stats") === "{\"v\":2,\"games\":[1]}", "…with the real stats back in storage");
    }
    // 8. after a restore nothing may write again: the page is still standing on
    // its pre-restore state and is about to reload onto the new one
    {
      const h = withFile(JSON.stringify({ app: "chessboard", schema: 3, writtenAt: 9000, keys: { save: "{\"v\":1,\"pgn\":\"real\"}" } }));
      h.m.set("chess.writtenAt", "5000"); h.m.set(KEYS.save, "{\"v\":1,\"pgn\":\"stale\"}");
      const P = createPersist(h, () => {});
      P.load();
      assert((await P.recover()) === "restored", "the older cache yields to the file");
      P.set("save", "{\"v\":1,\"pgn\":\"stale\"}");   // beforeunload → saveGame() during the reload delay
      await tick(600);
      assert(P.get("save") === "{\"v\":1,\"pgn\":\"real\"}", "a write after a restore does not clobber what was restored");
      assert(h.writes === 0, "…and nothing stale reaches the file either (" + h.writes + ")");
    }
    // 9. a restore that cannot be written is reported, not silently half-done
    {
      const h = withFile(null);
      let failed = null;
      const P = createPersist(h, (info) => { failed = info; });
      P.load();
      await P.recover();
      const doc = { app: "chessboard", schema: 3, writtenAt: 1, keys: { learn: "a", stats: "b" } };
      let allow = 1;
      const realSet = h.storageSet;
      h.storageSet = (k, v) => (allow-- > 0 ? realSet(k, v) : false);   // quota dies mid-restore
      const ok = P.restoreAll(doc);
      assert(ok === false, "restoreAll() reports a refused write instead of returning as if it wrote");
      assert(failed && failed.key === "restore", "…and latches the failure so the app can say so");
      h.storageSet = realSet;
    }
    // 10. a file that exists and holds nothing is damage, not a fresh install
    {
      const h = withFile(null);
      h.appdataReadKey = async () => ({ empty: true });
      let failed = null;
      const P = createPersist(h, (info) => { failed = info; });
      P.load();
      const r = await P.recover();
      assert(r === "corrupt", "a zero-length profile file reads as corrupt, not missing (" + r + ")");
      assert(failed && failed.key === "appdataCorrupt", "…and the user is told");
    }
    // 11b. …and the damaged file is genuinely left alone. The banner promises
    // exactly that, and the recovery e2e caught it being false: recover()'s own
    // finally released the mirror, and the write the boot path had queued
    // replaced the damaged bytes within MIRROR_DELAY — the one copy the user was
    // told was kept, destroyed moments after they were told.
    {
      const damaged = "{not json at all";
      const h = withFile(damaged);
      let failed = null;
      const P = createPersist(h, (info) => { failed = info; });
      P.load();
      P.set("save", "{\"v\":1,\"pgn\":\"whatever the boot path writes\"}");
      const r = await P.recover();
      await tick(700);
      assert(r === "corrupt" && failed && failed.key === "appdataCorrupt", "an unreadable file is reported (" + r + ")");
      assert(h.writes === 0 && h.file === damaged,
        "…and nothing overwrites it, which is what the banner promises (" + h.writes + " write(s))");
      P.set("learn", "later in the same session");
      await tick(700);
      assert(h.writes === 0 && h.file === damaged, "…for the rest of the session, not just the first moment");
    }
    // 11. an unreadable file is reported too — before 6.1 it returned "none" in
    // silence and the broken file was left in place forever
    {
      const h = withFile("{not json at all");
      let failed = null;
      const P = createPersist(h, (info) => { failed = info; });
      P.load();
      const r = await P.recover();
      assert(r === "corrupt", "a file that will not parse reads as corrupt (" + r + ")");
      assert(failed && failed.key === "appdataCorrupt", "…and says so once");
    }
    // 12. the quarantine keeps the evidence it promises to keep
    {
      const h = mem();
      const P = createPersist(h, () => {});
      h.m.set(KEYS.learn, "{oops");
      P.load();
      for (let i = 0; i < 12; i++) { P.load(); P.read("learn"); }   // twelve launches, one bad key
      const list = JSON.parse(P.get("quarantine"));
      assert(list.length === 1 && list[0].raw === "{oops",
        "the same unreadable value is kept once, not pushed on every launch (" + list.length + ")");
      P.clearAll();
      assert(P.get("quarantine") != null, "clearAll() does not destroy the quarantined evidence");
      P.restoreAll({ app: "chessboard", schema: 3, writtenAt: 1, keys: {} });
      assert(P.get("quarantine") != null, "…and neither does a restore");
    }
    // 13. a cache that cannot stamp itself must not report the write as kept:
    // an unstamped cache reads as older than it is and the file overwrites it
    {
      const h = mem();
      let failed = null;
      const P = createPersist(h, (info) => { failed = info; });
      P.load();
      const realSet = h.storageSet;
      h.storageSet = (k, v) => (k === "chess.writtenAt" ? false : realSet(k, v));
      assert(P.set("learn", "x") === false, "a refused revision stamp is a refused write");
      assert(failed && failed.key === "learn", "…and latches");
      h.storageSet = realSet;
    }
    // 14. no bridge at all: nothing mirrors, nothing fails, recover() says none
    {
      const h = mem();
      const P = createPersist(h, () => { throw new Error("must not be called"); });
      P.load();
      P.set("learn", "x");
      assert(await P.recover() === "none", "a browser has no file and no error");
    }
  }
}
