/**
 * 导入导出：棋谱、剪贴板、学习数据与整份档案。
 *
 * v8-1-plan F3: app.js's FEN / PGN I/O section and its two 6.0 file sections,
 * moved whole — the PGN written out (the tree's serializer, chess.js's
 * movetext as the fallback), the one text export with its three fallbacks
 * (native dialog, browser download, clipboard), the list picker a many-game
 * file opens, the PGN import itself, the paste and the file pickers, and the
 * learning file and the whole profile, out and back in. Moved, not rewritten:
 * the bodies are the ones app.js had.
 *
 * Everything it needs from the app arrives in the bag handed to `createIO()`,
 * createLibraryUI's shape; nothing here reaches back into app.js. The pure
 * modules are imported, not passed, because they are the same objects app.js
 * imports.
 * @module io
 */
import { Chess } from "./chess.js";
import { ChessDialog } from "./dialog.js";
import { ChessEditor } from "./editor.js";
import { ChessTree } from "./game-tree.js";
import { ChessHost } from "./host.js";
import { ChessLearning } from "./learning.js";
import { ChessPgnParser } from "./pgn-parser.js";
import { ChessPgn } from "./pgn.js";
import { tdot } from "./tdot.js";

/**
 * @param {object} d everything this module borrows from app.js
 */
export function createIO(d) {
  const {
    doc, t, tf, Persist, game, store, gameLoad, gameLoadPgn, sanHistory, startFen, baseGame, toast,
    confirmNative, saveSettings, saveGame, OppUI, invalidateEngine, maybeEngineTurn, tcTag, resetClocks,
    loadLearnState, Mistakes, loadMines, Progress, loadPuzzleState, restoreAnalysis, statsCache, renderStats,
    LibraryUI, RepUI, loadAchSeen, syncAutoFlip, gameResultToken, clearEndingFlags, adoptHeaderResult,
    stopEditor, moveCount, Shell, switchMode,
  } = d;
  const document = doc;
  const Host = ChessHost;
  const Dlg = ChessDialog;

  // --- FEN / PGN I/O ---
  async function copyText(text, okMsg) {
    try { await Host.writeClipboard(text); toast(okMsg); }
    catch (_) { toast(t("msg.copy.failed"), "fault"); }
  }

  /** Standard-conforming PGN: Seven Tag Roster + result token appended. */
  function pgnForExport() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    const engineName = "Stockfish 19 (" + OppUI.enName(store.session.difficulty) + ")";
    const white = store.session.mode === "ai" ? (store.session.humanColor === "w" ? "Player" : engineName) : "Player 1";
    const black = store.session.mode === "ai" ? (store.session.humanColor === "b" ? "Player" : engineName) : "Player 2";
    const result = gameResultToken();
    const tagPairs = [
      ["Event", "Casual game"],
      ["Site", "Chessboard"],
      ["Date", d.getFullYear() + "." + p(d.getMonth() + 1) + "." + p(d.getDate())],
      ["Round", "-"],
      ["White", white],
      ["Black", black],
      ["Result", result],
    ];
    tagPairs.push(["TimeControl", tcTag()]);
    if (result !== "*") {
      tagPairs.push(["Termination", store.game.flagFall ? "time forfeit" : "normal"]);
    }
    const sf = startFen();
    if (sf) tagPairs.push(["SetUp", "1"], ["FEN", sf]);
    // the tree writes the file: variations, comments, NAGs and shapes go out
    // as they came in, and the result token once (v6-plan Q2.2). The chess.js
    // path below is the fallback for a tree that fell out of step.
    if (treeInStep()) return ChessPgnParser.serializePgn(ChessTree.toPgnGame(store.game.tree, tagPairs));
    const tags = tagPairs.map(([k, v]) => "[" + k + " \"" + v + "\"]").join("\n");
    // game.pgn() may itself carry SetUp/FEN headers — keep only its movetext,
    // wrapped to the PGN-recommended 80 columns
    // chess.js already ends the movetext with the result token when the
    // header carries one (an imported game does) — strip it, so the token is
    // written exactly once, and by us (v6-plan D1)
    const movetext = ChessPgn.stripResult(game.pgn().split("\n\n").pop());
    const tokens = (movetext + " " + result).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    for (const tk of tokens) {
      if (line && line.length + 1 + tk.length > 80) { lines.push(line); line = tk; }
      else line = line ? line + " " + tk : tk;
    }
    if (line) lines.push(line);
    return tags + "\n\n" + lines.join("\n") + "\n";
  }

  /** Does the tree still hold the line chess.js is standing on? */
  function treeInStep() {
    const tree = store.game.tree;
    if (!tree || tree.startFen !== baseGame().fen()) return false;
    const line = store.game.line;
    const h = sanHistory();
    if (line.length !== h.length + 1) return false;
    for (let i = 0; i < h.length; i++) {
      const n = ChessTree.nodeAt(tree, line[i + 1]);
      if (!n || n.san !== h[i]) return false;
    }
    return true;
  }

  function pgnFileName() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return "chess-" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
      p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + ".pgn";
  }

  /**
   * What to say after a file has been written.
   *
   * 「已导出 report.png」 was a file name for a file the app had just put
   * somewhere the player never saw. It was fine only while `revealPath`
   * worked, and `revealPath` is best-effort: no `os.revealPath` on this build,
   * or a throw, and it returned quietly. So when the folder did not open, the
   * app had reported success and said nothing about where.
   *
   * The folder opened → the name is enough, you are looking at it.
   * It did not → the path is the answer to "where did it go", and it goes in
   * the longer toast tier because it is a sentence to read rather than a
   * receipt to ignore.
   */
  function savedToast(name, path, revealed) {
    if (revealed) toast(tf("msg.export.doneN", [name]));
    else toast(tf("msg.export.doneAtN", [path]), "fix");
  }

  /**
   * 5.2.1: what a text export does when the native dialog REFUSED.
   *
   * Two failures look alike from the catch block and mean opposite things.
   * No dialog API at all (Host.NO_FILE_DIALOG) is a build without dialogs —
   * a browser, or a test standing in for one — and the browser download path
   * is the right fallback. A dialog API that is there and rejected the call
   * is the shell saying no (5.0.0–5.2.0: permission_denied from an unlisted
   * builtin command), and inside the shell an `<a download>` click does
   * nothing — after which the toast said 「已导出 … 在下载文件夹里」 about a
   * file that did not exist. For that case the honest fallback is the
   * clipboard, and the toast says so.
   * @returns {boolean} true when the clipboard took it and nothing else should run
   */
  async function exportTextFallback(err, text) {
    if (!Host.hasZero() || !err || err.name === Host.NO_FILE_DIALOG) return false;
    // the shell refusing a write because the file is too big is not the same
    // failure as the shell having no dialog, and said so wrongly before this fix
    const tooBig = err.name === Host.FILE_TOO_LARGE || /InvalidRequest|too ?large/i.test(String(err && err.message));
    await copyText(text, t(tooBig ? "msg.export.tooLargeCopied" : "msg.export.bridgeCopied"));
    return true;
  }

  /**
   * 6.0: one text export, not two copies of it (v6-plan D9). The native
   * dialog first, the browser download second, the clipboard last — the three
   * fallbacks were written out twice, once for PGN and once for the learning
   * file, and differed only in MIME type and title.
   */
  async function exportText(name, text, mime, title, recent, onStaged) {
    if (Host.hasZero()) {
      try {
        // v8-1-plan N2: dialog, write, reveal and recent list all in main.zig
        const saved = await Host.saveText({ title, name, text, recent, onStaged });
        if (!saved) { toast(t("msg.export.cancelled")); return; }
        savedToast(saved.name, saved.path, saved.revealed);
        return;
      } catch (err) { if (await exportTextFallback(err, text)) return; }
    }
    try {
      const blob = new Blob([text], { type: mime });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast(tf("msg.export.doneDl", [name]), "fix");
    } catch (_) {
      copyText(text, t("msg.export.restrictedCopied"));
    }
  }

  async function downloadPgn() {
    if (!sanHistory().length) { toast(t("msg.export.noGame"), "fix"); return; }
    await exportText(pgnFileName(), pgnForExport(), "application/x-chess-pgn", t("dlg.exportPgn"), true);
  }

  function pickFromList(title, items, opts) {
    const modal = document.getElementById("pick-modal");
    const list = document.getElementById("pick-list");
    const titleEl = document.getElementById("pick-title");
    if (!modal || !list) return Promise.resolve(items.length ? 0 : null);
    if (titleEl) titleEl.textContent = title;
    const cancel = document.getElementById("pick-cancel");
    if (cancel) cancel.textContent = (opts && opts.cancelLabel) || t("act.cancel");
    list.replaceChildren();
    items.forEach((it, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pick-item";
      b.dataset.i = String(i);
      b.textContent = it.label;
      if (it.tag) {
        const tag = document.createElement("span");
        tag.className = "pick-tag";
        tag.textContent = it.tag;
        b.appendChild(tag);
      }
      if (it.sub) {
        const s = document.createElement("span");
        s.className = "pick-sub";
        s.textContent = it.sub;
        b.appendChild(s);
      }
      list.appendChild(b);
    });
    Dlg.open(modal, list.querySelector(".pick-item"));
    return new Promise((resolve) => { store.ui.pickResolver = resolve; });
  }
  function finishPick(v) {
    const modal = document.getElementById("pick-modal");
    Dlg.close(modal);
    if (store.ui.pickResolver) { store.ui.pickResolver(v); store.ui.pickResolver = null; }
  }

  /**
   * @param {string} text PGN
   * @param {string} label where it came from (for the toast)
   * @param {object} [prompt] override the replace-current-game confirmation.
   * Loading a save slot goes through the same import path, but telling the
   * user "Import PGN — importing replaces the current game" when they clicked
   * a save slot describes the plumbing rather than what they did.
   */
  async function importPgnText(text, label, prompt) {
    let text0 = (text || "").trim();
    if (!text0) { toast(t("msg.import.empty"), "fix"); return false; }
    // A PGN file may hold a whole database — importing only the last game (the
    // old behaviour) silently threw away everything before it.
    let games;
    try { games = ChessPgnParser.splitGames(text0); }
    catch (_) { games = ChessPgn.splitGames(text0); }
    if (games.length > 1) {
      const items = games.map((g, i) => {
        const s = ChessPgn.summary(g);
        return {
          label: (i + 1) + ". " + s.white + " — " + s.black + "  " + s.result,
          sub: tdot(s.event, s.date, s.plies ? tf("mm.plies", [s.plies]) : ""),
        };
      });
      const pick = await pickFromList(tf("dlg.pickGame", [games.length]), items);
      if (pick == null) { toast(t("msg.import.cancelled")); return false; }
      text0 = games[pick];
    }
    const ask = prompt || { msg: t("dlg.importPgn"), title: t("dlg.importPgnTitle"), ok: t("dlg.import") };
    if (sanHistory().length &&
        !(await confirmNative(ask.msg, ask.title, { ok: ask.ok, cancel: t("act.cancel") }))) {
      return false;
    }
    // the parser is the reader now (v6-plan Q2.2); chess.js's load_pgn only
    // gets a look at text the parser cannot place
    let parsed = false;
    try {
      const g = ChessPgnParser.parsePgn(text0).games[0];
      parsed = !!g && g.root.children.length > 0;
    } catch (_) { parsed = false; }
    if (!parsed) {
      const probe = new Chess();
      parsed = probe.load_pgn(text0, { sloppy: true }) && probe.history().length > 0;
    }
    // A game exported before its first move is legal PGN with no movetext, and
    // it is what a save slot or an export holds for a study position. chess.js
    // will not parse that shape, so fall back to its [SetUp]/[FEN] tags rather
    // than call the file malformed.
    const importFen = parsed ? null : ChessPgn.startFen(text0);
    if (!parsed && (!importFen || !new Chess().validate_fen(importFen).valid)) {
      toast(t("msg.import.badPgn"), "fault");
      return false;
    }
    // 6.1 (v6-plan Q2.2 said this and it was only ever wired into the manual
    // "load FEN" dialog): a [SetUp]/[FEN] game starts wherever its header
    // says, and chess.js's validate_fen accepts positions no game can reach —
    // two kings of a colour, a side already in check while its opponent is to
    // move. Read the header as written, because the parser has already handed
    // its FEN through chess.js by now and chess.js keeps only one king.
    {
      const headerFen = ChessPgn.startFen(text0);
      if (headerFen && ChessEditor) {
        // allowTerminal: the editor refuses a position with no legal move
        // because there would be nothing to play, but a game that starts from
        // a checkmate or a stalemate is a normal study file. Only the
        // structural and reachability checks belong on this path.
        const bad = ChessEditor.validate(ChessEditor.fromFen(headerFen, Chess), Chess, { allowTerminal: true });
        if (bad) { toast(t(bad), "fault"); return false; }
      }
    }
    invalidateEngine();
    stopEditor();
    if (parsed) {
      gameLoadPgn(text0, { sloppy: true });
    } else {
      gameLoad(importFen);
      game.header("SetUp", "1", "FEN", importFen);
    }
    store.game.selection = null;
    store.game.viewIndex = sanHistory().length;
    store.game.imported = true;
    clearEndingFlags();
    // the file's [Result] survives the import as a terminal state: a decisive
    // result that the board does not explain is a resignation, a draw that
    // the rules do not explain is an agreed one. Before 6.0 the result was
    // dropped and the export wrote `*` under a game the file called 1-0.
    adoptHeaderResult();
    // 7.6 §1c: a game analysed before comes back analysed, without a search
    restoreAnalysis();
    resetClocks(); syncAutoFlip();
    // a trainer draws its own board and a page covers it: the game opens in play, on the board (Codex on #86)
    if (store.session.mode === "learn" || store.session.mode === "puzzle") switchMode(store.ui.playMode === "pvp" ? "pvp" : "ai");
    Shell.toBoard(); store.commit("game", "action"); saveGame();
    toast(sanHistory().length
      ? tf("msg.import.doneN", [moveCount(Math.ceil(sanHistory().length / 2))])
      : t("mm.positionLoaded"));
    maybeEngineTurn();
    return true;
  }

  async function pastePgn() {
    try {
      // Host bridge first: the packaged WebView may not grant the page
      // clipboard-read permission, but the native side always can.
      const text = await Host.readClipboard();
      importPgnText(text, t("mm.clipboard"));
    } catch (_) {
      toast(t("msg.clipboard.readFailed"), "fault");
    }
  }

  /**
   * Toast for a failed host-side read. An oversized file gets its own words:
   * it is the one failure the player can act on, and lumping it in with
   * "could not open the file" is what made a truncated PGN library look like
   * a corrupt one.
   */
  function toastReadFailure(err) {
    if (err && err.name === Host.FILE_TOO_LARGE) {
      toast(tf("mm.fileTooLarge", [Math.floor((err.limit || 0) / 1024)]));
      return;
    }
    toast(t("msg.file.readFailed"), "fault");
  }

  /** Open a .pgn file: native dialog via the host bridge, <input> in browsers. */
  /**
   * @param {(text: string, label: string) => any} [sink] where the file goes.
   * The library import wants the same two pickers — native dialog, browser
   * fallback, the same recent-documents bookkeeping — and a different
   * destination; duplicating the picker to change the last line is how the two
   * quietly drift apart.
   */
  async function openPgnFile(sink) {
    const take = typeof sink === "function" ? sink : importPgnText;
    if (Host.hasZero()) {
      try {
        // v8-1-plan N2: main.zig opens, reads and lists it as recent; no path
        const picked = await Host.openPgn({ title: t("dlg.openPgn"), recent: true });
        if (picked) take(picked.text, picked.name); // null: cancelled
        return;
      } catch (err) {
        // "there is no file dialog on this build" is not a read failure — it
        // is the reason to use the browser's own picker, which is sitting
        // right below. Anything else really did fail to read.
        if (!err || err.name !== Host.NO_FILE_DIALOG) { toastReadFailure(err); return; }
      }
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pgn,.txt";
    input.onchange = () => {
      const f = input.files && input.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => take(String(reader.result || ""), f.name);
      reader.readAsText(f);
    };
    input.click();
  }

  // --- learning data: out as one file, back in as a merge (learning.js) ---
  const Learning = ChessLearning;
  // v8-2-plan T4: the repertoire whole (its lines are in their own store
  // once its chunk is up; the header holds 400 a side) and its cards' schedules
  async function learningBag() {
    await RepUI.ready();
    const bag = {};
    for (const k of Learning.LEARNING_KEYS) bag[k] = Persist.get(k);
    bag.repertoire = RepUI.bag(bag.repertoire);
    return bag;
  }
  function learningFileName() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return "chessboard-learning-" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + ".json";
  }
  async function exportLearning() {
    const doc = Learning.pack(await learningBag(), Date.now());
    await exportText(learningFileName(), JSON.stringify(doc, null, 2), "application/json", t("dlg.exportLearning"));
  }
  /** Merge a learning file into this machine's data and rebuild the views. */
  async function importLearningText(text) {
    let doc = null;
    try { doc = JSON.parse(text); } catch (_) { doc = null; }
    if (!Learning.isLearningDoc(doc)) { toast(t("msg.learning.badFile"), "fix"); return; }
    const merged = Learning.merge(await learningBag(), doc, Mistakes.MAX_MINES);
    for (const [k, v] of Object.entries(merged)) Persist.setJson(k, v);
    // the in-memory copies re-read what was just written — the same loaders
    // startup uses, so an imported book is served exactly like a saved one
    if (merged.mines) store.session.mines = loadMines();
    if (merged.learn) store.session.learnState = loadLearnState();
    if (merged.puzzles) store.session.puzzleState = loadPuzzleState().state;
    if (merged.progress) store.session.progress = Progress.coerce(Persist.read("progress", (v) => v).value);
    if (merged.achievements) store.session.achSeen = loadAchSeen();
    if (merged.repertoire) RepUI.reload();
    if (merged.stats) statsCache.v = null;
    renderStats();
    store.commit("session", "sync");
    toast(tf("msg.learning.imported", [store.session.mines.length]));
  }
  async function importLearning() {
    // the question comes before the file picker: what a merge means is worth
    // reading before choosing a file, and a picker that opens with nothing
    // said first is a control that appears to do nothing
    if (!(await confirmNative(t("dlg.importLearning"), t("act.learningImport"),
      { ok: t("act.learningImport"), cancel: t("act.cancel") }))) return;
    if (Host.hasZero()) {
      try {
        const picked = await Host.openPgn({ title: t("dlg.importLearning") });
        if (picked) await importLearningText(picked.text);
        return;
      } catch (err) {
        if (!err || err.name !== Host.NO_FILE_DIALOG) { toastReadFailure(err); return; }
      }
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = () => {
      const f = input.files && input.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => importLearningText(String(reader.result || ""));
      reader.readAsText(f);
    };
    input.click();
  }
  document.getElementById("learning-export").onclick = () => { exportLearning(); };
  document.getElementById("learning-import").onclick = () => { importLearning(); };

  // --- 6.0: the whole profile, out and back in (v6-plan Q1.1) --------------
  // The learning export is a merge of the things nobody can download again.
  // This is a copy of everything — the current game, the slots, the settings,
  // the record — for moving to another machine or for keeping. Import is a
  // replacement, and says so before the picker opens.
  function allDataFileName() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return "chessboard-all-" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + ".json";
  }
  /**
   * v8-2-plan F5: 「正在准备…」 beside the button while the file is built and
   * crosses the bridge. Ten thousand games are ~28 MB, dozens of pieces sent
   * before main.zig can show the save dialog, and for those seconds the click
   * had no answer at all. A live region, so a screen reader hears it too; it
   * is never hidden, only emptied (an empty one takes no room), because a
   * region that appears with its text already in it is often not read.
   */
  function allDataStatus(msg) {
    const el = document.getElementById("alldata-status");
    if (el) el.textContent = msg;
  }
  async function exportAllData() {
    allDataStatus(t("msg.allData.preparing"));
    try {
      // a frame for the line to show before the stringify below holds the thread
      await new Promise((r) => setTimeout(r, 30));
      saveGame();
      saveSettings();
      await LibraryUI.ready(); await RepUI.ready();   // v8-0-plan C1: the games are in the export once the library is loaded; the repertoire's records once its chunk is (M3 评审)
      // compact (v8-0-plan F3): the values are JSON strings already, so the
      // two-space indent only padded the envelope — and every byte of the file
      // crosses the bridge
      await exportText(allDataFileName(), JSON.stringify(RepUI.forExport(Persist.exportAll())), "application/json", t("dlg.exportAll"),
        // the last piece opens the dialog: the dialog is the answer from there
        // — unless its stage was lost and it all goes again (M1 评审)
        false, (last) => allDataStatus(last ? "" : t("msg.allData.preparing")));
    } finally { allDataStatus(""); }
  }
  async function importAllDataText(text) {
    let doc = null;
    try { doc = JSON.parse(text); } catch (_) { doc = null; }
    if (!Persist.isProfileDoc(doc)) { toast(t("msg.allData.badFile"), "fix"); return; }
    Persist.restoreAll(doc);
    // v8-0-plan F3: the page still stands on the old profile until the reload
    // below, and the reload's own beforeunload saveGame() wrote that old game
    // over the imported save — the one key that never came back equal. Freeze
    // writes as recover() does after a restore; the flush still runs.
    Persist.freeze();
    await Persist.flushMirror();
    toast(t("msg.allData.imported"));
    // every module holds a copy of what it read at startup; a reload is the
    // one way to make all of them read the new profile
    setTimeout(() => location.reload(), 900);
  }
  async function importAllData() {
    if (!(await confirmNative(t("dlg.importAll"), t("act.allImport"),
      { ok: t("act.allImport"), cancel: t("act.cancel"), danger: true }))) return;
    if (Host.hasZero()) {
      try {
        const picked = await Host.openPgn({ title: t("dlg.importAll"), max: Host.ALL_DATA_MAX });
        if (picked) await importAllDataText(picked.text);
        return;
      } catch (err) {
        if (!err || err.name !== Host.NO_FILE_DIALOG) { toastReadFailure(err); return; }
      }
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = () => {
      const f = input.files && input.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => importAllDataText(String(reader.result || ""));
      reader.readAsText(f);
    };
    input.click();
  }
  document.getElementById("alldata-export").onclick = () => { exportAllData(); };
  document.getElementById("alldata-import").onclick = () => { importAllData(); };

  return {
    copyText, pgnForExport, pgnFileName, savedToast, exportText, downloadPgn, pickFromList, finishPick,
    importPgnText, pastePgn, toastReadFailure, openPgnFile,
  };
}
