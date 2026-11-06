/**
 * Store actions → db events. Autosave is one event per thing that happened:
 * a move appends a move, never the whole game (ADR 0003).
 * @module state/persist
 */
export function persist(store, db) {
  return store.subscribe(({ name, payload, prev, next }) => {
    const g = next.play && next.play.game, was = prev.play && prev.play.game;
    if (name === "play.new") {
      db.append({ type: "game.start", gameId: g.id, mode: g.mode, engineColor: g.engineColor, startFen: g.startFen });
    } else if (name === "play.move") {
      const m = g.moves[g.moves.length - 1];
      db.append({ type: "game.move", gameId: g.id, ply: g.moves.length - 1, uci: m.uci, san: m.san });
    } else if (name === "play.undo") {
      if (g.moves.length < was.moves.length) db.append({ type: "game.undo", gameId: g.id, ply: g.moves.length });
    } else if (name === "settings.set") {
      db.append({ type: "settings.set", key: payload.key, value: payload.value });
    }
    if (g && g.result && !(was && was.id === g.id && was.result) && name !== "play.restore") {
      db.append({ type: "game.end", gameId: g.id, result: g.result.result, reason: g.result.reason });
    }
  });
}

/** The latest game back into the store; a fresh one if there is none. */
export async function restore(store, db, newId) {
  const [saved, cur] = await Promise.all([db.query("settings.all"), db.query("game.current")]);
  store.dispatch("settings.load", saved);
  if (store.get().play.game) return;
  if (cur) store.dispatch("play.restore", cur);
  else store.dispatch("play.new", { id: newId(), mode: "pvp" });
}
