/**
 * 我的开局书的数据库一半 (v8-1-plan T3) — chunk-rep.js, loaded after the
 * library's chunk (it keeps its records in the library's database).
 *
 * repertoire-ui.js keeps what it always had: the lines, their import, the
 * 按线练 drills, the section. This module keeps the book **by position**
 * (rep-book.js) and everything that needs it:
 *
 *   * storage: one IndexedDB record per (side, position) in the "repertoire"
 *     store of chessboard.library, through the library's own connection
 *     (library-db.js `rep`), mirrored into the native per-key store as four
 *     shards "rep0" … "rep3" (persist.js BULK, port kind "rep");
 *   * boot: migrate a 7.2–8.0 book, take back what IndexedDB lost from the
 *     native shards, index again whatever the header does not vouch for
 *     (rep-book.js reconcile);
 *   * the cards: due list, grading;
 *   * the edits that need positions: taking a move out wherever it is played;
 *   * the cross-check against the library, and the section's rows for both;
 *   * export as PGN with variations.
 *
 * The lines stay in `chess.v1.repertoire` — the header — exactly as 7.2–8.0
 * wrote them, plus `db: 2, n, sig`: an older build still reads and drills
 * the whole book, and what it changes there is indexed again on the next
 * launch here.
 * @module rep-page
 */
import { ChessRepBook as B } from "./rep-book.js";
import { createReplay } from "./explorer/replay.js";

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

/** The same interface as library-db.js `rep`, over a Map: no IndexedDB this session. */
function memoryRep() {
  const m = new Map();
  return {
    kind: "memory",
    async all() { return [...m.values()]; },
    async put(rs) { for (const r of rs) m.set(r.id, r); return true; },
    async remove(ids) { for (const id of ids) m.delete(id); return true; },
    async clear() { m.clear(); return true; },
    async getMeta() { return undefined; },
    async setMeta() { return true; },
  };
}

/**
 * @param {object} d from repertoire-ui.js: store, Persist, t, tf, toast, doc,
 *   R (ChessRepertoire), libDb (library-page.js's controller, or null),
 *   LibraryQuery (or null), cardName(side, sans), onChange() (the section again)
 * @returns {Promise<object>} the controller
 */
async function bootRepertoire(d) {
  const { store, Persist, t, tf, toast, R } = d;
  const c = d.libDb || null;
  const LQ = d.LibraryQuery || null;
  let backend = (c && c.repBackend) || memoryRep();
  const raw = Persist.get("repertoire");
  const header = readHeader(raw);
  const book = () => ({ w: store.session.repertoire.w || [], b: store.session.repertoire.b || [] });
  let warned = false;
  const warnOnce = (e) => { if (warned) return; warned = true; toast(tf("rep.saveFailed", [(e && e.name) || ""]), "fault"); };

  let stored = [];
  try { stored = await backend.all(); } catch (e) { backend = memoryRep(); stored = []; }
  // the WebView's storage lost records the header counted, or there is none
  // this session: the native shards are the copy
  let shards = null;
  if (header && header.db === 2 && (backend.kind === "memory" || stored.length < Number(header.n))) {
    shards = recordsOf(await Persist.readBulk("rep"));
  }
  // the migration: the value as found, before anything is written (the
  // library's rule — 7.0 lost PGNs moving data between shapes)
  if (raw && (!header || header.db !== 2) && !stored.length) {
    try { await backend.setMeta("rep-v1:" + Date.now(), { raw }); } catch (_) { /* the header keeps it anyway */ }
  }
  const booted = book();
  const r = B.reconcile({ book: booted, header, stored, shards, state: store.session.puzzleState, now: Date.now() });
  // M3 评审 P2-3: the signature of the lines the records were indexed from —
  // what the header may vouch for. An edit made while this boot was still
  // awaiting changes book() but not the records, and the header must not
  // then claim they match (repertoire-ui.js syncs on ready when they differ).
  let indexedSig = B.sigOf(booted);
  let records = r.records;
  let version = 1;
  let frozen = false;
  let chain = Promise.resolve();

  /** The shards a set of record ids lives in. */
  const shardsOf = (ids) => [...new Set(ids.map(B.shardOf))];
  /** Write what changed: the shards are owed first, then IndexedDB (library-page.js save's order). */
  function save(put, gone) {
    if (frozen || (!put.length && !gone.length)) return chain;
    Persist.touchBulk(shardsOf(put.map((x) => x.id).concat(gone)));
    chain = chain.then(async () => {
      try {
        if (gone.length) await backend.remove(gone);
        if (put.length) await backend.put(put);
      } catch (e) { warnOnce(e); }
    });
    return chain;
  }
  // the boot's own writes, read back before the header may say db 2
  let vouched = r.fresh;
  if (!r.fresh) {
    save(r.put, r.gone);
    await chain;
    try { vouched = (await backend.all()).length === records.size; } catch (_) { vouched = false; }
  }
  // a build from before the shards (or 8.0, which lists only lib shards)
  // committed a manifest without them: owed now (M5 review P3-1's rule)
  if (Persist.touchUnlisted && records.size) Persist.touchUnlisted(shardsOf([...records.keys()]));

  /**
   * The lines changed (import, edit, clear, learning file): index them again.
   * `from`: records to take cards from as well (an undone removal, M3 评审
   * P2-2) — the records here win where both have one.
   */
  function sync(from) {
    const now = book();
    const next = B.indexBook(now, from ? new Map([...from, ...records]) : records);
    indexedSig = B.sigOf(now);
    const { put, gone } = B.diff(records, next);
    records = next;
    version++;
    vouched = true;
    save(put, gone);
  }

  /** Due cards as trainer drills (trainer/puzzles.js seats `pre`, then asks for `answers`). */
  function dueDrills() {
    return B.dueCards(records, Date.now()).slice(0, DUE_LIST).map((x) => {
      const pre = x.path ? x.path.split(" ") : [];
      const answers = x.moves.map((m) => m.san);
      const line = pre.concat(answers[0]);
      return { id: "repc:" + x.id, cat: "rep", side: x.side === "b" ? "b" : undefined, card: x.id, pre, answers, line,
        eco: "", name: d.cardName(x.side, line) };
    });
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

  /** The section's rows: what is due, and where the library disagrees. */
  function renderInto(body) {
    const doc = d.doc;
    const due = B.dueCards(records, Date.now()).length;
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

  return {
    fresh: r.fresh,
    migrated: r.migrating && !!raw,
    seeded: r.seeded,
    recovered: r.recovered,
    mode: () => backend.kind || "idb",
    /** what the header says about the records (repertoire-ui.js saveBook) */
    extra: () => (vouched ? { db: 2, n: records.size, sig: indexedSig } : {}),
    /** the lines changed since they were last indexed (an edit during boot) */
    stale: () => indexedSig !== B.sigOf(book()),
    sync,
    records: () => records,
    /** the records as they are now, cards copied: what an undo gives back (M3 评审 P2-2) */
    snapshot: () => new Map([...records].map(([id, x]) => [id, Object.assign({}, x, x.card ? { card: Object.assign({}, x.card) } : {})])),
    dueCount: () => B.dueCards(records, Date.now()).length,
    dueDrills,
    grade,
    removeAt,
    cross,
    renderInto,
    exportPgn: (event) => ["w", "b"].map((s) => B.toPgn(records, s, event(s))).filter(Boolean).join("\n"),
    // persist.js's port for the "rep" shards
    shardNames: () => shardsOf([...records.keys()]),
    shardText: (name) => {
      const list = [...records.values()].filter((x) => B.shardOf(x.id) === name);
      return list.length ? JSON.stringify({ v: 1, rep: list }) : null;
    },
    // 导入全部数据: the restored profile's records, then the page reloads onto them
    restoreShards: async (texts) => {
      frozen = true;
      await chain.catch(() => {});
      const incoming = recordsOf(texts);
      await backend.clear();
      await backend.put(incoming);
    },
    // 清除全部存档
    clear: () => {
      records = new Map();
      version++;
      chain = chain.then(() => backend.clear()).catch(() => {});
    },
  };
}

export const CHESS_REP = { bootRepertoire };
