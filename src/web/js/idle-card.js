/**
 * The card on an untouched board (v11-0-plan P, the state before the game).
 *
 * At move 0 the play tab had nothing to show below the replay bar — measured
 * on 1.12, 239px of a 619px pane, the very first screen of every new game.
 * Through 10.1 this card filled it with lines of text: the last result, the
 * record, a recommendation, and a standing instruction (「走一步棋就会出现棋谱
 * ……」) that never went away. 11.0 makes it what Chess.com and Lichess put
 * there: the person across the board. Their face, their name, their rating
 * and style; your record against them; one suggestion if there is one; and
 * 新局. The standing instruction is gone — the notation appearing is its own
 * explanation. A two-player game has no opponent card, so it keeps the old
 * one-line "ready" body.
 * @module idle-card
 */

/**
 * @param {object} d what this borrows from app.js
 */
export function createIdleCard(d) {
  const { store, t, tf, tdot } = d;
  const el = (id) => document.getElementById(id);

  function render() {
    const card = el("idle-card");
    if (!card) return;
    // only on an untouched board in a real game — lessons and puzzles have
    // their own copy filling this space
    const mode = store.session.mode;
    const show = (mode === "ai" || mode === "pvp") && !d.sanHistory().length && !store.session.editor;
    card.hidden = !show;
    if (!show) return;
    const ai = mode === "ai";
    d.paintHello();
    // the opponent: a face, a name, the rung and style (the strip's words)
    const op = el("idle-op");
    if (op) {
      op.hidden = !ai;
      if (ai) {
        const o = d.strip(store.session.difficulty, store.session.personaId);
        d.portrait(el("idle-av"), o.portrait);
        d.setText(el("idle-name"), o.name);
        d.setText(el("idle-lvl"), o.level);
      }
    }
    // v8-0-plan §5: the way to the new-game dialog before the first move
    const ng = el("idle-new");
    if (ng && ng.textContent !== t("chrome.new")) ng.textContent = t("chrome.new");
    const body = el("idle-body") || card;
    body.replaceChildren();
    const add = (cls, text) => {
      const n = document.createElement("div");
      n.className = cls;
      n.textContent = text;
      body.appendChild(n);
      return n;
    };
    // 15.0 F: the card is this game, not only the opponent — the side and
    // the clock it will be played with (both changed in 新对局's dialog)
    const tc = store.game.timeControl || "off";
    const clock = tc === "off" ? t("clock.off") : tc.replace(/^c/, "");
    const side = store.session.colorRandom ? t("color.random") : t(store.session.humanColor === "b" ? "color.black" : "color.white");
    add("idle-v idle-game", ai ? tdot(side, clock) : clock);
    const games = d.loadStats().games || [];
    if (ai) {
      // your record against this rung, when there is one
      const mine = games.filter((g) => g.diff === store.session.difficulty);
      if (mine.length) {
        const w = mine.filter((g) => g.result === "win").length;
        const l = mine.filter((g) => g.result === "loss").length;
        add("idle-v idle-rec-line", tf("stats.wld", [w, l, mine.length - w - l]));
      }
    } else {
      const last = games[games.length - 1];
      add("idle-v", last ? tdot(t("idle.last"), d.historyLabel(last), d.historyWhen(last.t))
        : tdot(t("idle.ready"), t("idle.vsHuman")));
    }
    const rec = d.recommendation();
    if (rec) add("idle-rec", rec);
  }

  return { render };
}
