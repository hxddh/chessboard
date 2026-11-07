/**
 * 分析一局 — one door to the review, from wherever a game is (v10-0-plan A1).
 *
 * Reviewing a game played elsewhere took six to eight steps: allow the
 * network in settings, type a user name, sync, find the game in the library,
 * open it, press 分析 — or know that 粘贴 PGN lives in the board's ⋯. This is
 * the short way: paste a PGN or a Lichess game's link, or open a file, and
 * the game is on the board with its analysis running. The same dialog opens
 * a blank 分析棋盘 — a position to set up and explore with the engine's
 * lines, which is not a game and is never filed as one.
 *
 * A Lichess link is fetched by the native side (sync.zig, one game by its
 * id), and only when the network has been allowed in 设置 · 数据 — the same
 * switch the library's sync obeys. Chess.com has no single-game export, so a
 * link from there asks for the PGN instead (its 分享 → PGN).
 * @module analyse-entry
 */
import { ChessHost } from "./host.js";

/** A Lichess game link: the eight-character id, wherever the link points into it. */
const LICHESS_LINK = /lichess\.org\/(?:embed\/(?:game\/)?)?([A-Za-z0-9]{8})(?:[A-Za-z0-9]{4})?(?:[/?#]|$)/;
const CHESSCOM_LINK = /chess\.com\/(?:[a-z]{2}\/)?(?:game|analysis|live|daily)/i;

/** What the pasted text is: a Lichess game, a Chess.com link, or PGN text. */
export function readEntry(text) {
  const s = String(text || "").trim();
  if (!s) return { kind: "empty" };
  const li = /^\S+$/.test(s) && LICHESS_LINK.exec(s);
  if (li) return { kind: "lichess", id: li[1] };
  if (/^\S+$/.test(s) && CHESSCOM_LINK.test(s)) return { kind: "chesscom" };
  return { kind: "pgn", text: s };
}

/**
 * @param {object} d doc, t, Persist, Dlg, importPgnText,
 *   openPgnFile, analyse(), blankBoard(), openNetSettings()
 */
export function createAnalyseEntry(d) {
  const { doc, t, Persist, Dlg } = d;
  const el = (id) => doc.getElementById(id);
  let busy = false;

  function open() {
    const input = el("an-text");
    if (input) input.value = "";
    setNote("");
    Dlg.open(el("analyse-modal"), input);
  }
  function close() { Dlg.close(el("analyse-modal")); }
  /** The dialog's one line of news; `net`: with the way to the switch it needs. */
  function setNote(s, net) {
    const n = el("an-note");
    if (n) { n.textContent = s; n.hidden = !s; }
    const b = el("an-net");
    if (b) b.hidden = !net;
  }

  /** The text is on the board: analyse it, and show the review. */
  async function take(text, label) {
    const ok = await d.importPgnText(text, label);
    if (!ok) return false;
    close();
    d.analyse();
    return true;
  }

  async function submit() {
    if (busy) return;
    const e = readEntry((el("an-text") || {}).value);
    if (e.kind === "empty") { setNote(t("an.empty")); return; }
    if (e.kind === "chesscom") { setNote(t("an.chesscom")); return; }
    if (e.kind === "pgn") { await take(e.text, t("an.pasted")); return; }
    // a Lichess link: the network, as the settings allow it
    const sync = Persist.read("sync").value || {};
    if (sync.on !== true || !ChessHost.hasZero()) { setNote(t("an.needNet"), true); return; }
    busy = true;
    setNote(t("an.fetching"));
    let r = null;
    try { r = await ChessHost.fetchGames({ site: "lichess", game: e.id }); } catch (_) { r = null; }
    busy = false;
    if (!r || r.error || !r.pgn) {
      setNote(t(r && r.error === "not_found" ? "an.notFound" : r && r.error === "offline" ? "an.offline" : "an.fetchFailed"));
      return;
    }
    await take(r.pgn, "Lichess · " + e.id);
  }

  function wire() {
    const go = el("an-go");
    if (go) go.onclick = () => { submit(); };
    const file = el("an-file");
    if (file) file.onclick = () => { d.openPgnFile((text, label) => { take(text, label); }); };
    const board = el("an-board");
    if (board) board.onclick = async () => { close(); await d.blankBoard(); };
    const cancel = el("an-cancel");
    if (cancel) cancel.onclick = close;
    const net = el("an-net");
    if (net) net.onclick = () => { close(); d.openNetSettings(); };
    const modal = el("analyse-modal");
    // Escape's closer is registered with the others (app.js wireDialogs)
    if (modal) modal.onclick = (ev) => { if (ev.target === modal) close(); };
    const text = el("an-text");
    // ⌘/Ctrl+Enter is 分析; a plain Enter is a new line of PGN
    if (text) text.onkeydown = (ev) => { if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); submit(); } };
    for (const id of ["today-analyse", "lib-analyse-one"]) {
      const b = el(id);
      if (b) b.onclick = open;
    }
  }

  return { open, close, wire, submit };
}
