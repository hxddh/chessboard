/**
 * The e2e's view of the 棋谱库 (v8-0-plan C1).
 *
 * The games are one IndexedDB record each (library-db.js) and `chess.library`
 * is a header that counts them, so:
 *
 *   libOf(page)     the library the app holds — waits for the library chunk
 *                   to have loaded it, then answers as `{v, names, games}`;
 *   storedLib(page) what IndexedDB itself holds (games and the header), for
 *                   the checks that are about persistence rather than about
 *                   the page;
 *   seedLibrary     a library for a page before it starts, for
 *                   ctx.addInitScript(seedLibrary, {names, games}).
 */
export const libOf = (page) => page.evaluate(async () => {
  const hook = () => window.__chess && window.__chess.library;
  for (let i = 0; i < 200 && !(hook() && hook()().ready); i++) await new Promise((r) => setTimeout(r, 25));
  if (!hook()) return null;
  const l = window.__chess.library();
  return { v: 1, names: l.names.slice(), games: JSON.parse(JSON.stringify(l.games)), mode: l.mode };
});

export const storedLib = (page) => page.evaluate(() => new Promise((resolve) => {
  let header = null;
  try { header = JSON.parse(localStorage.getItem("chess.library") || "null"); } catch (_) { header = null; }
  const req = indexedDB.open("chessboard.games");
  req.onupgradeneeded = () => { req.transaction.abort(); };
  req.onerror = () => resolve({ header, games: null });
  req.onsuccess = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains("games")) { db.close(); resolve({ header, games: [] }); return; }
    const all = db.transaction(["games"], "readonly").objectStore("games").getAll();
    all.onsuccess = () => {
      const games = all.result.map((r) => { const g = Object.assign({}, r); const pk = !!g.pk; delete g.pk; g.__pk = pk; return g; });
      db.close();
      resolve({ header, games });
    };
    all.onerror = () => { db.close(); resolve({ header, games: null }); };
  };
}));

/**
 * A library the way the app keeps one: the games in IndexedDB
 * ("chessboard.games", library-db.js) and the header (`chess.library`)
 * counting them. For ctx.addInitScript(seedLibrary, {names, games,
 * claimAsked, once}): it runs before the page's own scripts, so its write
 * is the first transaction on the store, and IndexedDB runs transactions on
 * one store in the order they were made — the library's first read finds
 * the games. A game already stored is left as it is (a reload keeps what
 * the page did to it); `once` seeds the first page of the session only.
 * Resolves once the games are written (for page.evaluate before a reload).
 */
export function seedLibrary(o) {
  if (o.once) {
    if (sessionStorage.getItem("seed.library")) return;
    sessionStorage.setItem("seed.library", "1");
  }
  const games = o.games || [];
  const header = { v: 1, names: o.names || [], n: games.filter((g) => g && g.src !== "local").length };
  if (o.claimAsked) header.claimAsked = true;
  localStorage.setItem("chess.library", JSON.stringify(header));
  if (!games.length) return Promise.resolve();
  return new Promise((resolve) => {
    const req = indexedDB.open("chessboard.games", 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("games")) d.createObjectStore("games", { keyPath: "id" });
      if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta");
    };
    req.onsuccess = () => {
      const db = req.result;
      const t = db.transaction(["games"], "readwrite");
      const s = t.objectStore("games");
      for (const g of games) {
        const r = s.add(g);
        r.onerror = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
      }
      t.oncomplete = () => { db.close(); resolve(); };
      t.onabort = () => { db.close(); resolve(); };
    };
    req.onerror = () => resolve();
  });
}
