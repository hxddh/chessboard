/**
 * UI localisation skeleton.
 *
 * Scope is deliberately the app *chrome* — buttons, section headings, status
 * lines and the settings panel. The teaching content (lessons.js, puzzles.js,
 * openings.js) stays Chinese for now: translating 36 lessons of prose is a
 * content project, not a wiring one, and shipping half-translated lessons
 * would be worse than shipping none.
 *
 * Static markup opts in with `data-i18n` (text) / `data-i18n-title` (tooltip)
 * attributes; dynamic strings call `t(key)`. Unknown keys fall back to the
 * zh-CN string, and then to the key itself, so a missing translation degrades
 * to readable text instead of blank UI.
 * @module i18n
 */
(function (global) {
  const DICT = {
    "zh-CN": {
      "lang.name": "中文",
      "chrome.hint": "提示", "chrome.undo": "悔棋", "chrome.flip": "翻转", "chrome.new": "新局",
      "chrome.panel": "侧栏", "chrome.answer": "答案", "chrome.thinking": "思考中",
      "side.game": "对局", "side.mode": "模式", "side.difficulty": "难度", "side.color": "执子",
      "side.clock": "棋钟", "side.look": "外观", "side.theme": "主题", "side.sound": "音效",
      "side.coach": "失着提醒", "side.autoflip": "自动翻转", "side.language": "语言",
      "side.moves": "棋谱", "side.stats": "统计", "side.ach": "成就",
      "side.learn": "教学", "side.puzzle": "做题", "side.editor": "编辑局面",
      "mode.ai": "人机", "mode.pvp": "双人", "mode.learn": "教学", "mode.puzzle": "做题",
      "diff.beginner": "新手", "diff.easy": "入门", "diff.normal": "进阶",
      "diff.hard": "困难", "diff.extreme": "极限",
      "color.white": "执白", "color.black": "执黑",
      "clock.off": "关",
      "theme.wood": "木", "theme.night": "夜", "theme.day": "日", "theme.notebook": "纸",
      "act.analyze": "分析", "act.deep": "精析", "act.stop": "停止", "act.retryHere": "重下",
      "act.pgnCopy": "PGN", "act.export": "导出", "act.paste": "粘贴", "act.open": "打开",
      "act.fen": "FEN", "act.loadFen": "载入 FEN", "act.editor": "编辑局面",
      "act.offerDraw": "提和", "act.claimDraw": "判和", "act.resign": "认输",
      "act.clearSave": "清除存档", "act.collapse": "收起", "act.reset": "重置", "act.clear": "清零",
      "act.cancel": "取消", "act.ok": "确定", "act.load": "载入", "act.start": "开始对局",
      "act.restart": "重来", "act.demo": "演示", "act.next": "下一课",
      "act.puzzleRetry": "重做", "act.puzzleNext": "下一题",
      "turn.white": "白方走子", "turn.black": "黑方走子", "turn.check": "将军！",
      "vs.white": "白", "vs.black": "黑", "vs.versus": "对", "vs.p1": "玩家 1", "vs.p2": "玩家 2",
      "st.thinking": "引擎思考中…", "st.replay": "复盘", "st.mateWhite": "将死 · 白方胜",
      "st.mateBlack": "将死 · 黑方胜", "st.stalemate": "逼和 · 和棋",
      "st.insufficient": "子力不足 · 和棋", "st.drawAgreed": "协议和棋 · 和棋",
      "st.claimThreefold": "判和 · 三次重复", "st.claimFifty": "判和 · 50 回合无吃子无动兵",
      "st.autoFivefold": "五次重复 · 自动判和", "st.autoSeventyfive": "75 回合无进展 · 自动判和",
      "st.claimable": "可判和", "st.resignWhite": "白方认输 · 黑方胜", "st.resignBlack": "黑方认输 · 白方胜",
      "st.flagDraw": "超时 · 和棋(对方无子力将杀)", "st.flagWhite": "超时 · 黑方胜", "st.flagBlack": "超时 · 白方胜",
      "st.learn": "教学模式", "st.puzzle": "做题练习", "st.lessonDone": "🎉 课程完成", "st.puzzleDone": "✅ 解出 · 下一题",
    },
    en: {
      "lang.name": "English",
      "chrome.hint": "Hint", "chrome.undo": "Undo", "chrome.flip": "Flip", "chrome.new": "New",
      "chrome.panel": "Panel", "chrome.answer": "Answer", "chrome.thinking": "Thinking",
      "side.game": "Game", "side.mode": "Mode", "side.difficulty": "Level", "side.color": "Side",
      "side.clock": "Clock", "side.look": "Appearance", "side.theme": "Theme", "side.sound": "Sound",
      "side.coach": "Blunder alerts", "side.autoflip": "Auto-flip", "side.language": "Language",
      "side.moves": "Moves", "side.stats": "Stats", "side.ach": "Achievements",
      "side.learn": "Lessons", "side.puzzle": "Puzzles", "side.editor": "Edit position",
      "mode.ai": "Engine", "mode.pvp": "2 players", "mode.learn": "Learn", "mode.puzzle": "Puzzles",
      "diff.beginner": "Beginner", "diff.easy": "Easy", "diff.normal": "Normal",
      "diff.hard": "Hard", "diff.extreme": "Max",
      "color.white": "White", "color.black": "Black",
      "clock.off": "Off",
      "theme.wood": "Wood", "theme.night": "Night", "theme.day": "Day", "theme.notebook": "Paper",
      "act.analyze": "Analyse", "act.deep": "Deep", "act.stop": "Stop", "act.retryHere": "Replay from here",
      "act.pgnCopy": "PGN", "act.export": "Export", "act.paste": "Paste", "act.open": "Open",
      "act.fen": "FEN", "act.loadFen": "Load FEN", "act.editor": "Edit position",
      "act.offerDraw": "Offer draw", "act.claimDraw": "Claim draw", "act.resign": "Resign",
      "act.clearSave": "Clear save", "act.collapse": "Collapse", "act.reset": "Reset", "act.clear": "Clear",
      "act.cancel": "Cancel", "act.ok": "OK", "act.load": "Load", "act.start": "Start game",
      "act.restart": "Restart", "act.demo": "Demo", "act.next": "Next lesson",
      "act.puzzleRetry": "Retry", "act.puzzleNext": "Next puzzle",
      "turn.white": "White to move", "turn.black": "Black to move", "turn.check": "Check!",
      "vs.white": "W", "vs.black": "B", "vs.versus": "vs", "vs.p1": "Player 1", "vs.p2": "Player 2",
      "st.thinking": "Engine thinking…", "st.replay": "Replay", "st.mateWhite": "Checkmate · White wins",
      "st.mateBlack": "Checkmate · Black wins", "st.stalemate": "Stalemate · Draw",
      "st.insufficient": "Insufficient material · Draw", "st.drawAgreed": "Draw agreed",
      "st.claimThreefold": "Draw claimed · threefold repetition", "st.claimFifty": "Draw claimed · 50-move rule",
      "st.autoFivefold": "Fivefold repetition · automatic draw", "st.autoSeventyfive": "75-move rule · automatic draw",
      "st.claimable": "draw claimable", "st.resignWhite": "White resigned · Black wins", "st.resignBlack": "Black resigned · White wins",
      "st.flagDraw": "Flag fall · draw (no mating material)", "st.flagWhite": "Flag fall · Black wins", "st.flagBlack": "Flag fall · White wins",
      "st.learn": "Lessons", "st.puzzle": "Puzzles", "st.lessonDone": "🎉 Lesson complete", "st.puzzleDone": "✅ Solved · next puzzle",
    },
  };

  const FALLBACK = "zh-CN";
  let lang = FALLBACK;

  function available() {
    return Object.keys(DICT).map((id) => ({ id, name: DICT[id]["lang.name"] }));
  }

  function setLang(id) {
    lang = DICT[id] ? id : FALLBACK;
    return lang;
  }

  function getLang() { return lang; }

  function t(key) {
    const table = DICT[lang] || DICT[FALLBACK];
    if (key in table) return table[key];
    const base = DICT[FALLBACK];
    return key in base ? base[key] : key;
  }

  /** Apply translations to every [data-i18n] / [data-i18n-title] in `root`. */
  function apply(root) {
    const scope = root || (typeof document !== "undefined" ? document : null);
    if (!scope) return;
    scope.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    scope.querySelectorAll("[data-i18n-title]").forEach((el) => {
      el.setAttribute("title", t(el.getAttribute("data-i18n-title")));
    });
  }

  global.ChessI18n = { t, apply, setLang, getLang, available, DICT };
})(typeof window !== "undefined" ? window : globalThis);
