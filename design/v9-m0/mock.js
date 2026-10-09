/**
 * mock.js — 设计稿的「显影液」，不是应用逻辑。
 *
 * 只做几件纯展示的事：把 data-icon 换成内联 SVG 图标，把 data-fen 画成
 * CSS 网格棋盘（cburnett 棋子），把着法里的 N/B/R/Q/K 换成棋子小图，把
 * data-series 画成细线曲线与进度环。所有数据都写在 HTML 里，是假的。
 *
 * 图标取自 src/web/js/icons.js（Lucide，ISC；其中十个源自 Feather，MIT），
 * 另补 17 个同一套里的图标。许可证原文见 icons.js 文件头。
 */
(function () {
  "use strict";
  const NODES = {
    "undo-2": [["path",{"d":"M9 14 4 9l5-5"}],["path",{"d":"M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"}]],
    "lightbulb": [["path",{"d":"M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"}],["path",{"d":"M9 18h6"}],["path",{"d":"M10 22h4"}]],
    "menu": [["path",{"d":"M4 5h16"}],["path",{"d":"M4 12h16"}],["path",{"d":"M4 19h16"}]],
    "chevrons-left": [["path",{"d":"m11 17-5-5 5-5"}],["path",{"d":"m18 17-5-5 5-5"}]],
    "chevron-left": [["path",{"d":"m15 18-6-6 6-6"}]],
    "chevron-right": [["path",{"d":"m9 18 6-6-6-6"}]],
    "chevrons-right": [["path",{"d":"m6 17 5-5-5-5"}],["path",{"d":"m13 17 5-5-5-5"}]],
    "x": [["path",{"d":"M18 6 6 18"}],["path",{"d":"m6 6 12 12"}]],
    "check": [["path",{"d":"M20 6 9 17l-5-5"}]],
    "lock": [["rect",{"width":"18","height":"11","x":"3","y":"11","rx":"2","ry":"2"}],["path",{"d":"M7 11V7a5 5 0 0 1 10 0v4"}]],
    "clipboard-copy": [["rect",{"width":"8","height":"4","x":"8","y":"2","rx":"1","ry":"1"}],["path",{"d":"M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"}],["path",{"d":"M16 4h2a2 2 0 0 1 2 2v4"}],["path",{"d":"M21 14H11"}],["path",{"d":"m15 10-4 4 4 4"}]],
    "download": [["path",{"d":"M12 15V3"}],["path",{"d":"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}],["path",{"d":"m7 10 5 5 5-5"}]],
    "archive": [["rect",{"width":"20","height":"5","x":"2","y":"3","rx":"1"}],["path",{"d":"M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"}],["path",{"d":"M10 12h4"}]],
    "square-pen": [["path",{"d":"M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"}],["path",{"d":"M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"}]],
    "ellipsis": [["circle",{"cx":"12","cy":"12","r":"1"}],["circle",{"cx":"19","cy":"12","r":"1"}],["circle",{"cx":"5","cy":"12","r":"1"}]],
    "flag": [["path",{"d":"M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"}]],
    "handshake": [["path",{"d":"m11 17 2 2a1 1 0 1 0 3-3"}],["path",{"d":"m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"}],["path",{"d":"m21 3 1 11h-2"}],["path",{"d":"M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3"}],["path",{"d":"M3 4h8"}]],
    "rotate-ccw": [["path",{"d":"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"}],["path",{"d":"M3 3v5h5"}]],
    "chart-line": [["path",{"d":"M3 3v16a2 2 0 0 0 2 2h16"}],["path",{"d":"m19 9-5 5-4-4-3 3"}]],
    "arrow-right": [["path",{"d":"M5 12h14"}],["path",{"d":"m12 5 7 7-7 7"}]],
    "user": [["path",{"d":"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"}],["circle",{"cx":"12","cy":"7","r":"4"}]],
    "bot": [["path",{"d":"M12 8V4H8"}],["rect",{"width":"16","height":"12","x":"4","y":"8","rx":"2"}],["path",{"d":"M2 14h2"}],["path",{"d":"M20 14h2"}],["path",{"d":"M15 13v2"}],["path",{"d":"M9 13v2"}]],
    "coins": [["path",{"d":"M13.744 17.736a6 6 0 1 1-7.48-7.48"}],["path",{"d":"M15 6h1v4"}],["path",{"d":"m6.134 14.768.866-.5 2 3.464"}],["circle",{"cx":"16","cy":"8","r":"6"}]],
    "scale": [["path",{"d":"M12 3v18"}],["path",{"d":"m19 8 3 8a5 5 0 0 1-6 0zV7"}],["path",{"d":"M3 7h1a17 17 0 0 0 8-2 17 17 0 0 0 8 2h1"}],["path",{"d":"m5 8 3 8a5 5 0 0 1-6 0zV7"}],["path",{"d":"M7 21h10"}]],
    "swords": [["path",{"d":"m13 19 6-6"}],["path",{"d":"M14.5 17.5 3.586 6.586A2 2 0 013 5.172V3h2.172a2 2 0 011.414.586L17.5 14.5"}],["path",{"d":"m14.828 6.172 2.586-2.586A2 2 0 0118.828 3H21v2.172a2 2 0 01-.586 1.414l-2.586 2.586"}],["path",{"d":"m16 16 4 4"}],["path",{"d":"m19 21 2-2"}],["path",{"d":"m5 14 4 4"}],["path",{"d":"m5 21-2-2"}],["path",{"d":"M7.5 16.5 4 20"}]],
    "graduation-cap": [["path",{"d":"M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"}],["path",{"d":"M22 10v6"}],["path",{"d":"M6 12.5V16a6 3 0 0 0 12 0v-3.5"}]],
    "library": [["path",{"d":"m16 6 4 14"}],["path",{"d":"M12 6v14"}],["path",{"d":"M8 8v12"}],["path",{"d":"M4 4v16"}]],
    "puzzle": [["path",{"d":"M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"}]],
    "target": [["circle",{"cx":"12","cy":"12","r":"10"}],["circle",{"cx":"12","cy":"12","r":"6"}],["circle",{"cx":"12","cy":"12","r":"2"}]],
    "zap": [["path",{"d":"M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z"}]],
    "medal": [["path",{"d":"M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15"}],["path",{"d":"M11 12 5.12 2.2"}],["path",{"d":"m13 12 5.88-9.8"}],["path",{"d":"M8 7h8"}],["circle",{"cx":"12","cy":"17","r":"5"}],["path",{"d":"M12 18v-2h-.5"}]],
    "crown": [["path",{"d":"M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"}],["path",{"d":"M5 21h14"}]],
    "eye": [["path",{"d":"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"}],["circle",{"cx":"12","cy":"12","r":"3"}]],
    "book-open": [["path",{"d":"M12 5v16"}],["path",{"d":"M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z"}]],
    "trophy": [["path",{"d":"M10 14.66V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2"}],["path",{"d":"M14 14.66V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2"}],["path",{"d":"M17.916 10H19.5A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3"}],["path",{"d":"M4 22h16"}],["path",{"d":"M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z"}],["path",{"d":"M6.084 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3"}]],
    "award": [["path",{"d":"m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526"}],["circle",{"cx":"12","cy":"8","r":"6"}]],
    "flame": [["path",{"d":"M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4"}]],
    "hourglass": [["path",{"d":"M5 22h14"}],["path",{"d":"M5 2h14"}],["path",{"d":"M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"}],["path",{"d":"M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"}]],
    "star": [["path",{"d":"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"}]],
    "chart-column": [["path",{"d":"M3 3v16a2 2 0 0 0 2 2h16"}],["path",{"d":"M18 17V9"}],["path",{"d":"M13 17V5"}],["path",{"d":"M8 17v-3"}]],
  };
  // 设计稿额外用到的几个 Lucide 图标（同一套，同一笔宽）
  Object.assign(NODES, {
    "sun": [["circle",{"cx":"12","cy":"12","r":"4"}],["path",{"d":"M12 2v2"}],["path",{"d":"M12 20v2"}],["path",{"d":"m4.93 4.93 1.41 1.41"}],["path",{"d":"m17.66 17.66 1.41 1.41"}],["path",{"d":"M2 12h2"}],["path",{"d":"M20 12h2"}],["path",{"d":"m6.34 17.66-1.41 1.41"}],["path",{"d":"m19.07 4.93-1.41 1.41"}]],
    "settings": [["path",{"d":"M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"}],["circle",{"cx":"12","cy":"12","r":"3"}]],
    "arrow-down-up": [["path",{"d":"m3 16 4 4 4-4"}],["path",{"d":"M7 20V4"}],["path",{"d":"m21 8-4-4-4 4"}],["path",{"d":"M17 4v16"}]],
    "plus": [["path",{"d":"M5 12h14"}],["path",{"d":"M12 5v14"}]],
    "volume-2": [["path",{"d":"M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"}],["path",{"d":"M16 9a5 5 0 0 1 0 6"}],["path",{"d":"M19.364 18.364a9 9 0 0 0 0-12.728"}]],
    "database": [["ellipse",{"cx":"12","cy":"5","rx":"9","ry":"3"}],["path",{"d":"M3 5V19A9 3 0 0 0 21 19V5"}],["path",{"d":"M3 12A9 3 0 0 0 21 12"}]],
    "sliders": [["path",{"d":"M21 4h-7"}],["path",{"d":"M10 4H3"}],["path",{"d":"M21 12h-9"}],["path",{"d":"M8 12H3"}],["path",{"d":"M21 20h-5"}],["path",{"d":"M12 20H3"}],["path",{"d":"M14 2v4"}],["path",{"d":"M8 10v4"}],["path",{"d":"M16 18v4"}]],
    "grid": [["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}],["path",{"d":"M3 12h18"}],["path",{"d":"M12 3v18"}]],
    "clock": [["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 6v6l4 2"}]],
    "eye-off": [["path",{"d":"M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"}],["path",{"d":"M14.084 14.158a3 3 0 0 1-4.242-4.242"}],["path",{"d":"M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"}],["path",{"d":"m2 2 20 20"}]],
    "shield": [["path",{"d":"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"}]],
    "x-circle": [["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"m15 9-6 6"}],["path",{"d":"m9 9 6 6"}]],
    "pause": [["rect",{"x":"14","y":"4","width":"4","height":"16","rx":"1"}],["rect",{"x":"6","y":"4","width":"4","height":"16","rx":"1"}]],
    "file-text": [["path",{"d":"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"}],["path",{"d":"M14 2v4a2 2 0 0 0 2 2h4"}],["path",{"d":"M10 9H8"}],["path",{"d":"M16 13H8"}],["path",{"d":"M16 17H8"}]],
    "type": [["path",{"d":"M4 7V4h16v3"}],["path",{"d":"M9 20h6"}],["path",{"d":"M12 4v16"}]],
    "globe": [["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"}],["path",{"d":"M2 12h20"}]],
    "moon": [["path",{"d":"M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"}]],
  });

  const NS = "http://www.w3.org/2000/svg";
  function icon(name, cls) {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    for (const [k, v] of Object.entries({ fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(k, v);
    svg.setAttribute("class", "ic" + (cls ? " " + cls : ""));
    for (const [tag, attrs] of NODES[name] || []) {
      const n = document.createElementNS(NS, tag);
      for (const k of Object.keys(attrs)) n.setAttribute(k, attrs[k]);
      svg.appendChild(n);
    }
    return svg;
  }

  const PIECES = "pieces/";
  const pieceURL = (code) => `url("${PIECES}${code}.svg")`;

  /* ---------- 棋盘：data-fen / data-last / data-check / data-corner / data-arrow / data-coords ---------- */
  function sqName(f, r) { return "abcdefgh"[f] + (r + 1); }
  function renderBoard(el) {
    const size = +(el.dataset.n || 8);
    const flip = el.dataset.flip === "1";
    const rows = (el.dataset.fen || "8/8/8/8/8/8/8/8").split(" ")[0].split("/");
    const grid = [];
    for (const row of rows) {
      const out = [];
      for (const ch of row) {
        if (/\d/.test(ch)) for (let i = 0; i < +ch; i++) out.push(null);
        else out.push((ch === ch.toUpperCase() ? "w" : "b") + ch.toLowerCase());
      }
      grid.push(out);
    }
    const last = el.dataset.last ? [el.dataset.last.slice(0, 2), el.dataset.last.slice(2, 4)] : [];
    const check = el.dataset.check || "";
    const sel = el.dataset.sel || "";
    const corners = Object.fromEntries((el.dataset.corner || "").split(",").filter(Boolean).map((s) => s.split(":")));
    const coords = el.dataset.coords !== "none";
    const frag = document.createDocumentFragment();
    for (let ri = 0; ri < size; ri++) {
      for (let fi = 0; fi < size; fi++) {
        const r = flip ? ri : size - 1 - ri;      // rank index 0 = rank 1
        const f = flip ? size - 1 - fi : fi;
        const gridRow = flip ? size - 1 - ri : ri;
        const name = sqName(f, r);
        const d = document.createElement("div");
        const dark = (f + r) % 2 === 0;
        d.className = "sq" + (dark ? " d" : "") + (last.includes(name) ? " last" : "") + (check === name ? " check" : "") + (sel === name ? " sel" : "");
        const p = grid[gridRow] && grid[gridRow][f];
        if (p) { const i = document.createElement("i"); i.className = "pc"; i.style.backgroundImage = pieceURL(p); d.appendChild(i); }
        if (coords && fi === 0) { const c = document.createElement("span"); c.className = "co rank"; c.textContent = r + 1; d.appendChild(c); }
        if (coords && ri === size - 1) { const c = document.createElement("span"); c.className = "co file"; c.textContent = "abcdefgh"[f]; d.appendChild(c); }
        if (corners[name]) { const c = document.createElement("b"); const [txt, kind] = corners[name].split("|"); c.className = "corner" + (kind ? " " + kind : ""); c.textContent = txt; d.appendChild(c); }
        frag.appendChild(d);
      }
    }
    el.appendChild(frag);
    if (el.dataset.arrow) drawArrows(el, el.dataset.arrow.split(","), flip);
  }
  function drawArrows(el, list, flip) {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 8 8");
    svg.setAttribute("class", "arrows");
    const c = (s) => { const f = s.charCodeAt(0) - 97, r = +s[1] - 1; return flip ? [7 - f + .5, r + .5] : [f + .5, 7 - r + .5]; };
    for (const mv of list) {
      const [x1, y1] = c(mv.slice(0, 2)), [x2, y2] = c(mv.slice(2, 4));
      const len = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / len, uy = (y2 - y1) / len;
      const head = .28, w = .085;
      const ex = x2 - ux * head, ey = y2 - uy * head;
      const line = document.createElementNS(NS, "line");
      Object.entries({ x1: x1 + ux * .2, y1: y1 + uy * .2, x2: ex, y2: ey, stroke: "var(--arrow)", "stroke-width": w, "stroke-linecap": "round" }).forEach(([k, v]) => line.setAttribute(k, v));
      const tri = document.createElementNS(NS, "polygon");
      const px = -uy, py = ux, hw = .17;
      tri.setAttribute("points", `${x2 - ux * .08},${y2 - uy * .08} ${ex + px * hw},${ey + py * hw} ${ex - px * hw},${ey - py * hw}`);
      tri.setAttribute("fill", "var(--arrow)");
      svg.append(line, tri);
    }
    el.appendChild(svg);
  }

  /* ---------- 着法：<span class="san">Nxe5</span> → 棋子小图 + 其余 ---------- */
  function renderSAN(el) {
    const t = el.textContent.trim();
    const m = /^([KQRBN])(.*)$/.exec(t);
    if (!m) return;
    el.textContent = "";
    const f = document.createElement("i");
    f.className = "fig";
    f.style.backgroundImage = pieceURL("w" + m[1].toLowerCase());
    el.append(f, m[2]);
  }

  /* ---------- 曲线：data-series（0–100，白方胜率）, data-marks（序号:级别）, data-cursor ---------- */
  function renderCurve(svg) {
    const ys = svg.dataset.series.split(",").map(Number);
    const W = +(svg.dataset.w || 360), H = +(svg.dataset.h || 96);
    const n = ys.length - 1;
    const X = (i) => (i / n) * W, Y = (v) => H - (v / 100) * H;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("preserveAspectRatio", "none");
    const pts = ys.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`);
    const mk = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); svg.appendChild(e); return e; };
    if (svg.dataset.mid !== "0") mk("line", { class: "mid", x1: 0, x2: W, y1: H / 2, y2: H / 2 });
    mk("path", { class: "area", d: `M0,${H} L${pts.join(" L")} L${W},${H} Z` });
    mk("path", { class: "line", d: `M${pts.join(" L")}` });
    if (svg.dataset.cursor) {
      const i = +svg.dataset.cursor;
      mk("line", { class: "cursor", x1: X(i), x2: X(i), y1: 0, y2: H });
    }
    // 菱形与光标手柄画在 HTML 层（不被 preserveAspectRatio 拉伸）
    const host = svg.parentElement;
    for (const m of (svg.dataset.marks || "").split(",").filter(Boolean)) {
      const [i, kind] = m.split(":");
      const d = document.createElement("i");
      d.className = "diamond " + kind;
      d.style.left = (X(+i) / W * 100) + "%";
      d.style.top = (Y(ys[+i]) / H * 100) + "%";
      host.appendChild(d);
    }
    if (svg.dataset.cursor) {
      const i = +svg.dataset.cursor;
      const k = document.createElement("i");
      k.className = "knob";
      k.style.left = (X(i) / W * 100) + "%";
      k.style.top = (Y(ys[i]) / H * 100) + "%";
      host.appendChild(k);
    }
  }

  /* ---------- 进度环 ---------- */
  function renderRing(el) {
    const v = +el.dataset.value, max = +el.dataset.max;
    const r = 26, C = 2 * Math.PI * r;
    el.insertAdjacentHTML("afterbegin",
      `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="${r}" class="track"/>` +
      `<circle cx="32" cy="32" r="${r}" class="val" stroke-dasharray="${(v / max) * C} ${C}" transform="rotate(-90 32 32)"/></svg>`);
  }

  function hydrate() {
    document.querySelectorAll("[data-icon]").forEach((s) => { if (!s.firstChild) s.appendChild(icon(s.dataset.icon, s.dataset.iconClass)); });
    document.querySelectorAll(".board[data-fen]").forEach(renderBoard);
    document.querySelectorAll(".san").forEach(renderSAN);
    document.querySelectorAll("svg.curve[data-series]").forEach(renderCurve);
    document.querySelectorAll(".ring[data-value]").forEach(renderRing);
    document.querySelectorAll("[data-piece]").forEach((e) => { e.style.backgroundImage = pieceURL(e.dataset.piece); });
    // 预览用：?theme=day
    const t = new URLSearchParams(location.search).get("theme");
    if (t) document.documentElement.dataset.theme = t;
  }
  hydrate();
})();
