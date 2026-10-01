/**
 * 我的开局书的数据库一半 (v8-1-plan T3) — chunk-rep.js, loaded after the
 * library's chunk (it keeps its records in the library's database).
 *
 * repertoire-ui.js keeps what it always had: the lines, their import, the
 * 按线练 drills, the section. This module keeps the book **by position**
 * (rep-book.js) and everything that needs it:
 *
 *   * storage: one IndexedDB record per (side, position) in the "repertoire"
 *     store of its own database, chessboard.repertoire (rep-db.js — not the
 *     library's, whose version bump would lock 8.0 out of it: M3 评审),
 *     mirrored into the native per-key store as four shards "rep0" … "rep3"
 *     (persist.js BULK, port kind "rep");
 *   * boot: migrate a 7.2–8.0 book, take back what IndexedDB lost from the
 *     native shards, index again whatever the header does not vouch for
 *     (rep-book.js reconcile);
 *   * the cards: due list, grading;
 *   * the edits that need positions: taking a move out wherever it is played;
 *   * the cross-check against the library, and the section's rows for both;
 *   * export as PGN with variations.
 *
 * 8.1 left the lines in `chess.v1.repertoire` — the header — exactly as
 * 7.2–8.0 wrote them, plus `db: 2, n, sig`. v8-2-plan T4 moved them into the
 * same database ("lines", rep-lines.js) and the same shards, without the
 * 400-line cap; the header keeps the first 400 a side, which is what an
 * older build reads and drills, and what it changes there is laid over the
 * stored book on the next launch here (rep-lines.js mergeHead).
 * @module rep-page
 */
import { ChessRepBook as B } from "./rep-book.js";
import { ChessRepLines as L } from "./rep-lines.js";
import { createReplay } from "./explorer/replay.js";
import { openRepDb } from "./rep-db.js";
import { ChessSrs } from "./srs.js";

/** The due list the trainer holds at a time (it is recomputed after every answer). */
const DUE_LIST = 50;

/** The header as stored, or null. */
function readHeader(raw) {
  if (raw == null || raw === "") return null;
  try { const v = JSON.parse(raw); return v && typeof v === "object" ? v : null; } catch (_) { return null; }
}

/** Records out of the native shards' texts ({name: text}). */
function recordsOf(texts) {
  const out = [];
  for (const text of Object.values(texts || {})) {
    const v = readHeader(text);
    if (v && Array.isArray(v.rep)) for (const r of v.rep) if (r && typeof r.id === "string" && Array.isArray(r.moves)) out.push(r);
  }
  return out;
}

/** The same interface as rep-db.js, over two Maps: no IndexedDB this session. */
function memoryRep() {
  const m = new Map(), lines = new Map();
  return {
    kind: "memory",
    async all() { return [...m.values()]; },
    async put(rs) { for (const r of rs) m.set(r.id, r); return true; },
    async remove(ids) { for (const id of ids) m.delete(id); return true; },
    async lines() { return [...lines.values()]; },
    async putLines(rows, gone) { for (const k of gone) lines.delete(k); for (const r of rows) lines.set(r.k, r); return true; },
    async clear() { m.clear(); lines.clear(); return true; },
    async getMeta() { return undefined; },
    async setMeta() { return true; },
  };
}

/**
 * @param {object} d from repertoire-ui.js: store, Persist, t, tf, toast, doc,
 *   R (ChessRepertoire), libDb (library-page.js's controller, or null: the cross-check),
 *   repBackend (tests: a backend instead of rep-db.js),
 *   LibraryQuery (or null), cardName(side, sans), onChange() (the section again),
 *   forget(ids) (lines that left the book at boot: their drills' queue entries)
 * @returns {Promise<object>} the controller
 */
async function bootRepertoire(d) {
  const { store, Persist, t, tf, toast, R } = d;
  const c = d.libDb || null;
  const LQ = d.LibraryQuery || null;
  // its own database (rep-db.js): the library's stays at version 1, which 8.0 opens (M3 评审)
  let backend = d.repBackend || (await openRepDb(typeof indexedDB !== "undefined" ? indexedDB : null)) || memoryRep();
  const raw = Persist.get("repertoire");
  const header = readHeader(raw);
  const book = () => ({ w: store.session.repertoire.w || [], b: store.session.repertoire.b || [] });
  let warned = false;
  const warnOnce = (e) => { if (warned) return; warned = true; toast(tf("rep.saveFailed", [(e && e.name) || ""]), "fault"); };

  let stored = [], storedLines = [];
  try { stored = await backend.all(); storedLines = await backend.lines(); } catch (e) { backend = memoryRep(); stored = []; storedLines = []; }
  const memory = backend.kind === "memory";
  // M3 评审: which write the records in IndexedDB are from. The header's
  // `gen` is the last write any session made (a session with no IndexedDB
  // wrote only the native shards); older here means the shards are newer.
  const headGen = header && header.db === 2 ? Number(header.gen) || 0 : 0;
  let idbGen = 0;
  if (!memory && headGen) { try { idbGen = Number(await backend.getMeta("rep-gen")) || 0; } catch (_) { idbGen = 0; } }
  const newer = headGen > idbGen && !memory;
  // the WebView's storage lost records the header counted, or there is none
  // this session, or it is behind the shards: the native shards are the copy.
  // v8-2-plan T4: the same for lines the header says the store held (`ln`)
  let shards = null, shardLines = [];
  let hold = false;
  if ((header && header.db === 2 && (memory || newer || stored.length < Number(header.n))) ||
      (header && !header.lf && Number(header.ln) > storedLines.length)) {
    const texts = await Persist.readBulk("rep");
    // M3 评审: a native store that is there but could not be read this time
    // (not "there is none"): the cards may be exactly what it holds. Nothing
    // is written this session — no records, no shards, and the header keeps
    // what it said — so the next launch reads them again.
    hold = texts == null && !!(Persist.hasStore && Persist.hasStore());
    shards = recordsOf(texts);
    shardLines = L.rowsOfShards(texts);
  }
  // the migration: the value as found, before anything is written (the
  // library's rule — 7.0 lost PGNs moving data between shapes)
  if (raw && (!header || header.db !== 2) && !stored.length) {
    try { await backend.setMeta("rep-v1:" + Date.now(), { raw }); } catch (_) { /* the header keeps it anyway */ }
  }
  // v8-2-plan T4: the lines move from the header into the store — the header
  // as found is kept here too, and the header itself keeps the first 400 a
  // side for 7.2–8.1 (rep-lines.js)
  if (raw && header && !header.ln && !header.lf && !storedLines.length && !memory && !hold) {
    try { await backend.setMeta("rep-v2:" + Date.now(), { raw }); } catch (_) { /* the header keeps it anyway */ }
  }
  // Which lines this launch holds. From here to the assignment nothing
  // awaits: an edit made while the reads above were out went into the
  // header's lines (book(), the main bundle's) and is laid over the stored
  // book with them (rep-lines.js mergeHead).
  const picked = L.pick(R, { header, head: book(), stored: storedLines, shards: shardLines, newer });
  if (picked.from !== "head") {
    store.session.repertoire.w = picked.book.w;
    store.session.repertoire.b = picked.book.b;
  }
  if (picked.gone.length && d.forget) d.forget(picked.gone);
  // the lines past the header's copy are out of reach this launch (no
  // IndexedDB, no shards that have them): nothing is written, as above, and
  // an edit goes into the header, to be laid over the store when it is back
  if (picked.short && memory) hold = true;
  // what the store holds now: the rows a write compares against. With no
  // IndexedDB, the shards are the store
  let lineMap = L.mapOf(memory && picked.from === "shards" ? shardLines : storedLines);
  const booted = book();
  const r = B.reconcile({ book: booted, header, stored, shards, newer, state: store.session.puzzleState, now: Date.now() });
  // M3 评审 P2-3: the signature of the lines the records were indexed from —
  // what the header may vouch for. An edit made while this boot was still
  // awaiting changes book() but not the records, and the header must not
  // then claim they match (repertoire-ui.js syncs on ready when they differ).
  let indexedSig = B.sigOf(booted);
  let indexedFrom = booted;
  let records = r.records;
  let version = 1;
  let frozen = hold;
  let chain = Promise.resolve();
  let gen = headGen;
  // two windows, one database (the library's rule, library-page.js): a write
  // is announced, and the other windows read the book back (v8-2-plan T4)
  const peers = typeof BroadcastChannel === "function" && !memory ? new BroadcastChannel("chessboard.repertoire") : null;

  /** The shards a set of record ids (and line keys) lives in. */
  const shardsOf = (ids) => [...new Set(ids.map(B.shardOf))];
  /**
   * Write what changed: the shards are owed first, then IndexedDB
   * (library-page.js save's order). `lput` / `lgone`: line rows and keys
   * (v8-2-plan T4), in the same shards.
   */
  function save(put, gone, lput, lgone) {
    const lp = lput || [], lg = lgone || [];
    if (frozen || (!put.length && !gone.length && !lp.length && !lg.length)) return chain;
    Persist.touchBulk(shardsOf(put.map((x) => x.id).concat(gone, lp.map((x) => x.k), lg)));
    gen = Math.max(gen + 1, Date.now());
    const g = gen;
    chain = chain.then(async () => {
      try {
        if (gone.length) await backend.remove(gone);
        if (put.length) await backend.put(put);
        if (lp.length || lg.length) await backend.putLines(lp, lg);
        await backend.setMeta("rep-gen", g);
        if (peers) peers.postMessage({ gen: g });
      } catch (e) { warnOnce(e); }
    });
    return chain;
  }
  /** The lines as they are now, into the store: rows new, moved or renamed, rows gone. */
  function saveLines() {
    if (frozen) return;
    const { put, gone } = L.diff(lineMap, book());
    if (!put.length && !gone.length) return;
    for (const k of gone) lineMap.delete(k);
    for (const x of put) lineMap.set(x.k, x);
    save([], [], put, gone);
  }
  // the boot's own writes, read back before the header may say db 2
  let vouched = r.fresh;
  // the lines first: a migration moves them in here (v8-2-plan T4)
  saveLines();
  if (!r.fresh && !hold) {
    save(r.put, r.gone);
    await chain;
    try { vouched = (await backend.all()).length === records.size; } catch (_) { vouched = false; }
  }
  // a build from before the shards (or 8.0, which lists only lib shards)
  // committed a manifest without them: owed now (M5 review P3-1's rule).
  // 8.1 wrote the rep shards without the lines: the lines' shards are owed
  // whenever the shards read this launch did not carry these lines
  if (Persist.touchUnlisted && records.size && !hold) Persist.touchUnlisted(shardsOf([...records.keys()]));
  if (shards && !hold) {
    const sd = L.diff(L.mapOf(shardLines), book());
    if (sd.put.length || sd.gone.length) Persist.touchBulk(shardsOf(sd.put.map((x) => x.k).concat(sd.gone)));
  }

  /**
   * The lines changed (import, edit, clear, learning file): index them again.
   * `from`: records to take cards from as well (an undone removal, M3 评审
   * P2-2) — the records here win where both have one.
   */
  function sync(from) {
    const now = book();
    const prev = from ? new Map([...from, ...records]) : records;
    // v8-2-plan T4: a side whose lines are the ones it was indexed from keeps
    // its records — with thousands of lines a side, an edit indexes one side
    const next = new Map();
    for (const s of ["w", "b"]) {
      if (!from && now[s] === indexedFrom[s]) { for (const [id, x] of records) if (x.side === s) next.set(id, x); }
      else for (const [id, x] of B.indexLines(s, now[s], prev)) next.set(id, x);
    }
    indexedFrom = now;
    indexedSig = B.sigOf(now);
    const { put, gone } = B.diff(records, next);
    records = next;
    version++;
    vouched = true;
    save(put, gone);
  }

  /** Today's due cards (rep-book.js dose: DAILY a day, the rest moved on and written). */
  function today() {
    const d = B.dose(records, Date.now());
    if (d.moved.length) { version++; save(d.moved, []); }
    return d.today;
  }

  /** Due cards as trainer drills (trainer/puzzles.js seats `pre`, then asks for `answers`). */
  function dueDrills() {
    return today().slice(0, DUE_LIST).map((x) => {
      const pre = x.path ? x.path.split(" ") : [];
      const answers = x.moves.map((m) => m.san);
      const line = pre.concat(answers[0]);
      return { id: "repc:" + x.id, cat: "rep", side: x.side === "b" ? "b" : undefined, card: x.id, pre, answers, line,
        eco: "", name: d.cardName(x.side, line) };
    });
  }

  /**
   * Cards from a learning file (M3 评审): where both have one, the card
   * further up the ladder wins (the same rule the endgame reviews merge by);
   * a position the book no longer has takes nothing.
   */
  function takeCards(cards) {
    const put = [];
    for (const [id, x] of records) {
      const inc = x.card && cards[id];
      if (!inc || typeof inc !== "object") continue;
      const e = ChessSrs.entry(inc);
      if (e.s > x.card.s || (e.s === x.card.s && e.n > x.card.n)) { x.card = e; put.push(x); }
    }
    if (put.length) { version++; save(put, []); }
    return put.length;
  }

  function grade(p, ok) {
    const x = p && records.get(p.card);
    if (!x || !x.card) return;
    x.card = B.grade(x.card, ok, Date.now());
    version++;
    save([x], []);
  }

  /**
   * Take the last move of `sans` out of `side`'s book (rep-book.js removeMove).
   * @returns {{lines: object[], gone: string[]}|null}
   */
  function removeAt(side, sans) {
    const pos = createReplay();
    for (const san of sans.slice(0, -1)) if (!pos.move(san)) return null;
    return B.removeMove(R, book()[side === "b" ? "b" : "w"], pos.key(), sans[sans.length - 1], side);
  }

  // --- the cross-check -------------------------------------------------------
  let crossMemo = null;
  // a migrated or restored library indexes its games in the background
  // (library-db.js indexMissing): the answer grows under the same list
  if (c && c.indexing && typeof c.indexing.then === "function") {
    c.indexing.then(() => { crossMemo = null; if (d.onChange) d.onChange(); }, () => {});
  }
  /**
   * What you play in your library where your book says something else
   * (rep-book.js crossCheck). One pass over the games' position index —
   * each game's positions looked up among the book's, not the book's
   * positions searched for in every game: a 10,000-game library is one
   * Map lookup per indexed position.
   */
  function cross() {
    if (!c || !LQ || typeof c.all !== "function") return [];
    const games = c.all();
    if (crossMemo && crossMemo.version === version && crossMemo.lib === store.session.library && crossMemo.n === games.length) return crossMemo.rows;
    const want = { w: new Map(), b: new Map() };
    // the library's key has no en-passant field (library-query.js positionKey)
    for (const x of records.values()) if (x.card && x.moves.length) want[x.side].set(LQ.hashKey(LQ.positionKey(x.key)), x);
    const hits = new Map();
    for (const g of games) {
      const side = g && (g.side === "w" || g.side === "b") ? g.side : null;
      const pk = side && want[side].size ? c.pkOf(g) : null;
      if (!pk) continue;
      const sans = String(g.sans || "").split(" ");
      const seen = new Set();
      for (let i = 0; i < pk.length && i < sans.length; i++) {
        const x = want[side].get(pk[i]);
        if (!x || seen.has(x.id)) continue;   // a game counts once per position
        seen.add(x.id);
        let m = hits.get(x.id);
        if (!m) hits.set(x.id, (m = new Map()));
        m.set(sans[i], (m.get(sans[i]) || 0) + 1);
      }
    }
    const rows = B.crossCheck(records, (x) => {
      const m = hits.get(x.id);
      return m ? [...m].map(([san, n]) => ({ san, n })) : null;
    });
    crossMemo = { version, lib: store.session.library, n: games.length, rows };
    return rows;
  }

  // --- 「今天到期」 between repaints (v8-2-plan T4) ------------------------------
  // 8.1 counted it only when the section was drawn again, so a window left
  // open showed this morning's number all day and yesterday's after midnight.
  // Once a minute, and when the window comes back into view, the count is
  // asked again — only while the window is visible and the row is on the
  // page — and the section is drawn only when the count or the date moved.
  // A press in progress waits for the next minute (7.6: nothing is rebuilt
  // between pointerdown and pointerup).
  let shown = { n: -1, day: "" };
  const dayOf = () => new Date().toDateString();
  function tick() {
    const doc = d.doc;
    if (!doc || doc.visibilityState === "hidden" || !doc.getElementById("rep-due-n")) return;
    if (store.ui && store.ui.pointerPressed) return;
    if (today().length !== shown.n || dayOf() !== shown.day) { if (d.onChange) d.onChange(); }
  }
  if (d.doc && d.doc.addEventListener) {
    setInterval(tick, 60000);
    d.doc.addEventListener("visibilitychange", tick);
  }

  /** The section's rows: what is due, and where the library disagrees. */
  function renderInto(body) {
    const doc = d.doc;
    const due = today().length;
    shown = { n: due, day: dayOf() };
    const row = doc.createElement("div");
    row.className = "stat-row";
    const k = doc.createElement("span");
    k.className = "stat-k";
    k.textContent = t("rep.due");
    const v = doc.createElement("span");
    v.className = "stat-v num";
    v.id = "rep-due-n";
    v.textContent = tf("rep.dueN", [due]);
    row.append(k, v);
    body.appendChild(row);
    const rows = cross();
    if (!rows.length) return;
    const h = doc.createElement("p");
    h.className = "hint";
    h.textContent = t("rep.crossTitle");
    body.appendChild(h);
    const list = doc.createElement("ul");
    list.className = "rep-cross";
    list.id = "rep-cross";
    for (const x of rows) {
      const li = doc.createElement("li");
      li.className = "hint";
      li.dataset.key = x.key;
      li.textContent = t(x.side === "b" ? "color.black" : "color.white") + " · " +
        tf("rep.cross", [B.pathText(x.path) || "—", x.usual, x.n, x.of, x.book.join(" / ")]);
      list.appendChild(li);
    }
    body.appendChild(list);
  }

  /**
   * Another window wrote (v8-2-plan T4): its book is the one in the store
   * now. Read back, lines and records, so an edit here starts from it and
   * the header this window writes next is that book's copy.
   */
  if (peers) {
    peers.onmessage = async (ev) => {
      if (frozen) return;
      let ls, rs;
      try { ls = await backend.lines(); rs = await backend.all(); } catch (_) { return; }
      const b = L.bookOf(ls);
      lineMap = L.mapOf(ls);
      store.session.repertoire.w = b.w;
      store.session.repertoire.b = b.b;
      records = new Map(rs.map((x) => [x.id, x]));
      indexedFrom = book();
      indexedSig = B.sigOf(indexedFrom);
      gen = Math.max(gen, Number(ev.data && ev.data.gen) || 0);
      vouched = true;
      version++;
      if (d.onChange) d.onChange();
    };
  }

  /**
   * The header to write (repertoire-ui.js saveBook), after writing the lines
   * themselves into the store (v8-2-plan T4, rep-lines.js):
   *   - IndexedDB: the first HEAD lines a side — what 7.2–8.1 read — and `ln`;
   *   - no IndexedDB: the whole book, `lf` (the pre-T4 shape: the header is
   *     the one copy a browser without either store keeps);
   *   - held: the header as it was, with the lines as they are now — an edit
   *     made now is laid over the store on a launch that can read it.
   */
  function head() {
    const b = book();
    if (hold) return Object.assign({}, header, { v: 1, w: b.w, b: b.b });
    saveLines();
    const x = extra();
    return memory ? Object.assign({ v: 1, w: b.w, b: b.b }, x, { lf: 1 })
      : Object.assign({ v: 1 }, L.headOf(b), x, { ln: b.w.length + b.b.length });
  }
  /** what the header says about the records */
  // held (M3 评审): what the header said, until a launch can read the shards
  function extra() {
    return hold ? { db: 2, n: header.n, sig: header.sig, gen: headGen }
      : vouched ? { db: 2, n: records.size, sig: indexedSig, gen } : {};
  }

  /**
   * 导出 / 导入学习数据 (learning.js reads raw header texts): the book whole
   * rather than the header's copy, and the cards' schedules beside it (M3
   * 评审: `cards`, record id → card, until the records take them).
   */
  function bag(raw) {
    const v = readHeader(raw);
    if (!v) return raw;
    const cards = {};
    for (const [id, x] of records) if (x.card) cards[id] = x.card;
    const b = book();
    return JSON.stringify(Object.assign(v, { w: b.w, b: b.b, cards }));
  }

  return {
    fresh: r.fresh,
    migrated: r.migrating && !!raw,
    seeded: r.seeded,
    recovered: r.recovered,
    mode: () => backend.kind || "idb",
    extra,
    head,
    bag,
    held: () => hold,
    /** the lines changed since they were last indexed (an edit during boot) */
    stale: () => indexedSig !== B.sigOf(book()),
    sync,
    takeCards,
    records: () => records,
    /** the records as they are now, cards copied: what an undo gives back (M3 评审 P2-2) */
    snapshot: () => new Map([...records].map(([id, x]) => [id, Object.assign({}, x, x.card ? { card: Object.assign({}, x.card) } : {})])),
    dueCount: () => today().length,
    dueDrills,
    grade,
    removeAt,
    cross,
    renderInto,
    exportPgn: (event) => ["w", "b"].map((s) => B.toPgn(records, s, event(s))).filter(Boolean).join("\n"),
    // persist.js's port for the "rep" shards
    // held: not known — the store keeps the shards it has (persist.js valueOf)
    // v8-2-plan T4: a shard carries the lines whose key hashes to it as well
    // (`lines`, beside 8.1's `rep`, which 8.1 reads and the lines do not disturb)
    shardNames: () => (hold ? null : shardsOf([...records.keys(), ...lineMap.keys()])),
    shardText: (name) => {
      const list = [...records.values()].filter((x) => B.shardOf(x.id) === name);
      const lines = [...lineMap.values()].filter((x) => B.shardOf(x.k) === name);
      return list.length || lines.length ? JSON.stringify(Object.assign({ v: 1, rep: list }, lines.length ? { lines } : {})) : null;
    },
    // 导入全部数据: the restored profile's records and lines, then the page reloads onto them
    restoreShards: async (texts) => {
      frozen = true;
      await chain.catch(() => {});
      const incoming = recordsOf(texts);
      await backend.clear();
      await backend.put(incoming);
      await backend.putLines(L.rowsOfShards(texts), []);
    },
    // 清除全部存档
    clear: () => {
      records = new Map();
      lineMap = new Map();
      version++;
      chain = chain.then(() => backend.clear()).catch(() => {});
    },
  };
}

export const CHESS_REP = { bootRepertoire };
