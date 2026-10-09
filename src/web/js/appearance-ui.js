/**
 * The appearance pickers — light/dark, board, frame, pieces (v8-0-plan A3).
 *
 * Self-contained: `mount(container, deps)` builds the four rows into any
 * element and owns them from then on. It is mounted in the settings panel's
 * 界面 group today, where the 主题 row and the 跟随系统深浅 switch were; A1
 * moves it into a preferences window by mounting it there instead — nothing
 * here knows which.
 *
 * It reads and writes the look only through `deps`, so it holds no state of
 * its own and cannot disagree with the app:
 *
 *   deps.t(key)            the interface string
 *   deps.getLook()         {appearance, boardId, boardFrame, pieceSet}
 *   deps.setLook(patch)    apply and save a change (app.js)
 *   deps.pieceSvgs(id)     Promise of a set's twelve SVGs (board.js setSvgs)
 *
 * Each board and each set shows itself: a 4×4 corner of the board, drawn with
 * the board's own colours and texture, and the set's two kings side by side —
 * the pair that tells sets apart, and the pair that told the 7.x drawing
 * apart badly. The previews of the sets that are chunks are fetched when the
 * row first scrolls into view, not at startup.
 *
 * 7.6 rule: the buttons are built once; a choice only toggles classes, so
 * nothing is rebuilt under a pointer between its down and its up.
 * @module appearance-ui
 */
import { APPEARANCES, BOARD_IDS, FRAMES, PIECE_SET_IDS } from "./look.js";
import { textureTile } from "./board-skin.js";

/** The labels, by value: the i18n keys the rows are built from. */
const LABELS = {
  appearance: { system: "look.system", light: "look.light", dark: "look.dark" },
  frame: { flat: "frame.flat", frame: "frame.frame" },
};

/**
 * Paint a 4×4 preview of the board whose palette `el` carries (it has the
 * board's data-board attribute, so the board's custom properties resolve on
 * it), with the board's texture over the squares.
 */
function readStyle(el) {
  try { return getComputedStyle(el); } catch (_) { return null; }
}
function paintBoardPreview(cv, el) {
  const cs = readStyle(el);
  if (!cs) return;
  const light = cs.getPropertyValue("--sq-light").trim();
  const dark = cs.getPropertyValue("--sq-dark").trim();
  const texture = cs.getPropertyValue("--board-texture").trim();
  const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
  const px = Math.round(cv.clientWidth * dpr) || Math.round(40 * dpr);
  cv.width = px; cv.height = px;
  const pen = cv.getContext("2d");
  if (!pen) return;
  const n = 4, step = px / n;
  const edge = (i) => Math.round(i * step);
  const tiles = [textureTile(texture, false), textureTile(texture, true)];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const box = [edge(c), edge(r), edge(c + 1) - edge(c), edge(r + 1) - edge(r)];
      const d = (r + c) % 2;
      pen.fillStyle = d ? dark : light;
      pen.fillRect(...box);
      if (tiles[d]) {
        const pat = pen.createPattern(tiles[d], "repeat");
        try { if (pat && pat.setTransform && typeof DOMMatrix !== "undefined") pat.setTransform(new DOMMatrix().scale(step / 96)); } catch (_) { /* native size */ }
        if (pat) { pen.fillStyle = pat; pen.fillRect(...box); }
      }
    }
  }
}

/**
 * Build the pickers into `container`.
 * @param {HTMLElement} container
 * @param {{t: Function, getLook: Function, setLook: Function, pieceSvgs: Function}} deps
 * @returns {{sync: Function, repaint: Function}}
 */
export function mount(container, deps) {
  const t = deps.t;
  const make = (tag, cls, attrs) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    for (const k of Object.keys(attrs || {})) el.setAttribute(k, attrs[k]);
    return el;
  };
  const label = (el, key) => { el.setAttribute("data-i18n", key); el.textContent = t(key); return el; };
  // 9.0 V1: `quiet` — the row's name is its group's heading already (外观
  // under 外观), so it is kept for a screen reader and not drawn twice
  const row = (id, key, groupCls, quiet) => {
    const r = make("div", "setting-row stack", { id: "row-" + id });
    r.appendChild(label(make("span", quiet ? "setting-k sr-only" : "setting-k"), key));
    const g = make("div", groupCls, { id: id + "-seg", role: "group", "aria-label": t(key), "data-i18n-aria": key });
    r.appendChild(g);
    container.appendChild(r);
    return g;
  };
  const button = (group, attr, value) => {
    const b = make("button", "", { type: "button", ["data-" + attr]: value, "aria-pressed": "false" });
    group.appendChild(b);
    return b;
  };

  // 外观: light / dark / system
  const appearance = row("appearance", "look.appearance", "theme-row", true);
  appearance.setAttribute("data-i18n-title", "tip.look.appearance");
  appearance.title = t("tip.look.appearance");
  for (const a of APPEARANCES) label(button(appearance, "appearance", a), LABELS.appearance[a]);

  // 棋盘: five boards, each a small corner of itself
  const boards = row("board-pick", "look.board", "theme-row wrap look-grid");
  const previews = [];
  for (const id of BOARD_IDS) {
    const b = button(boards, "board-id", id);
    const sw = make("span", "look-swatch", { "data-board": id, "aria-hidden": "true" });
    const cv = make("canvas", "look-board");
    sw.appendChild(cv);
    b.appendChild(sw);
    b.appendChild(label(make("span", "look-name"), "boardName." + id));
    previews.push([cv, sw]);
  }

  // 边框: flat / the wooden frame
  const frame = row("frame", "look.frame", "theme-row");
  frame.setAttribute("data-i18n-title", "tip.look.frame");
  frame.title = t("tip.look.frame");
  for (const f of FRAMES) label(button(frame, "frame", f), LABELS.frame[f]);

  // 棋子: every set, as its two kings
  const pieces = row("piece-pick", "side.pieces", "theme-row wrap look-grid");
  const kings = {};
  for (const id of PIECE_SET_IDS) {
    const b = button(pieces, "piece-set", id);
    const pair = make("span", "look-kings", { "aria-hidden": "true" });
    kings[id] = [make("img", "look-king", { alt: "" }), make("img", "look-king", { alt: "" })];
    pair.append(kings[id][0], kings[id][1]);
    b.appendChild(pair);
    b.appendChild(label(make("span", "look-name"), "pieces." + id));
  }
  const asked = { kings: false };
  const loadKings = () => {
    if (asked.kings) return;
    asked.kings = true;
    for (const id of PIECE_SET_IDS) {
      deps.pieceSvgs(id).then((svgs) => {
        ["wk", "bk"].forEach((k, i) => {
          if (svgs && svgs[k]) kings[id][i].src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgs[k]);
        });
      }).catch(() => { /* the name alone still says which set it is */ });
    }
  };
  // the chunks are fetched when the row is first seen, not at startup
  if (typeof IntersectionObserver !== "undefined") {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); loadKings(); }
    });
    io.observe(pieces);
  } else {
    pieces.addEventListener("pointerenter", loadKings, { once: true });
    pieces.addEventListener("focusin", loadKings, { once: true });
  }

  // one click handler for the four groups; each patch is one field
  container.addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b || !container.contains(b)) return;
    const look = deps.getLook();
    let patch = null;
    if (b.dataset.appearance && b.dataset.appearance !== look.appearance) patch = { appearance: b.dataset.appearance };
    else if (b.dataset.boardId && b.dataset.boardId !== look.boardId) patch = { boardId: b.dataset.boardId };
    else if (b.dataset.frame && b.dataset.frame !== look.boardFrame) patch = { boardFrame: b.dataset.frame };
    else if (b.dataset.pieceSet && b.dataset.pieceSet !== look.pieceSet) patch = { pieceSet: b.dataset.pieceSet };
    if (patch) deps.setLook(patch);
  });

  /** Mark the current choice in each row. Classes only — nothing is rebuilt. */
  function sync() {
    const look = deps.getLook();
    const mark = (sel, on) => {
      for (const b of container.querySelectorAll(sel)) {
        const yes = on(b);
        b.classList.toggle("active", yes);
        b.setAttribute("aria-pressed", yes ? "true" : "false");
      }
    };
    mark("button[data-appearance]", (b) => b.dataset.appearance === look.appearance);
    mark("button[data-board-id]", (b) => b.dataset.boardId === look.boardId);
    mark("button[data-frame]", (b) => b.dataset.frame === look.boardFrame);
    mark("button[data-piece-set]", (b) => b.dataset.pieceSet === look.pieceSet);
  }
  /**
   * Draw the board previews — by the caller, once the row is on screen and
   * has a size. Not at mount: paper and marble build their textures in code,
   * and the preferences window this lives in is closed at launch and in most
   * sessions (Codex on #86).
   */
  function repaint() { for (const [cv, sw] of previews) paintBoardPreview(cv, sw); }

  sync();
  return { sync, repaint };
}

export const ChessAppearanceUI = { mount };
