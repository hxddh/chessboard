/**
 * The e2e's view of the 棋谱库 (v8-0-plan C1).
 *
 * Until C1 the suites read the library straight out of localStorage
 * (`chess.v1.library`, `{v: 1, names, games}`). The games are one IndexedDB
 * record each now and `chess.v1.library` is a header, so:
 *
 *   libOf(page)     the library the app holds — waits for the library chunk
 *                   to have loaded it, then answers in the old `{v, names,
 *                   games}` shape, so an assertion written against 7.x reads
 *                   the same;
 *   storedLib(page) what IndexedDB itself holds (games and the header), for
 *                   the checks that are about persistence rather than about
 *                   the page.
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
  try { header = JSON.parse(localStorage.getItem("chess.v1.library") || "null"); } catch (_) { header = null; }
  const req = indexedDB.open("chessboard.library");
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
