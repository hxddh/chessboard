# 国际象棋 Chessboard

国际象棋 — Native SDK WebView + Canvas，支持 macOS 与 Windows。**GPLv3**（为后续集成 Stockfish 引擎预留）。

复用 [goban](https://github.com/hxddh/goban)（五子棋）打磨出的整套架构：Native 壳、Canvas 渲染、
侧栏/复盘/主题 UI、双平台 CI、无头浏览器回归测试。

## 下载

[Releases](https://github.com/hxddh/chessboard/releases) 页任选：

| 平台 | 产物 | 说明 |
|------|------|------|
| macOS（Apple Silicon） | **Chessboard-macOS-arm64.zip** | 解压后 `open ~/Applications/Chessboard.app`；首次右键「打开」过 Gatekeeper |
| Windows（x64） | **Chessboard-Windows-x64.zip** | 解压后运行 `Chessboard/chessboard.exe`；需 WebView2 运行时（Win10/11 一般预装） |

## 怎么玩（v1.2）

| 操作 | 说明 |
|------|------|
| **教学模式** | 侧栏「模式 → 教学」：**零基础 32 课**互动课程 —— 认识棋盘摆法 → 六种棋子走法+王的禁区(**每个棋子多套练习:绕障碍/吃子路线/精确落点**) → 子力价值/吃子保护/救受攻的子/捉双/**串击/闪击** → 将军应将(走/挡/**吃**)/**牵制**/将死/逼和/易位/吃过路兵/升变/和棋方式/记谱法 → **杀型积木(双车阶梯杀/闷杀/后车绞杀)** → 开局三原则 + **学者杀完整引导局(含防守要点)** → **王兵残局(护送升变)**·后杀王·车杀王实战（**先热身再实战**;引擎陪练降为入门强度,可悔棋/提示）；连错两次自动标答案,「演示」按钮可**随时重看解法**,进度可**重置**,毕业一键进入人机·入门 |
| **做题练习** | 侧栏「模式 → 做题」：**一步杀 / 两步杀 / 三步杀 / 吃子 / 战术母题 / 开局 / 复习**七类题库(51 题)（底线杀、闷杀、肩章杀、阿拉伯杀、升变杀、弃后引杀、双车赶王…）；答错回退并**说明黑方如何化解**;「答案」画正解箭头;杀王题接受任何可强制将死的替代解;吃子题选净得子力最多的一吃;战术母题(串击/闪将)强制得子;开局题执白照谱背 38 条主流线路;**答错或看答案的题自动进「复习」,做对即移出**；进度持久 |
| 走子 | **点击**或**拖拽**均可（拖动时棋子跟随指针）;走子有**滑动动画** |
| 提和 | 棋谱区「提和」：双人双方确认即和；人机由引擎按局面评估接受/拒绝 |
| 人机对弈 | 默认与 **Stockfish 18** 对弈；侧栏可选难度（入门 Elo 1320 · 进阶 1700 · 困难 2200 · 极限满强度）与执子（白/黑，选黑自动翻转视角） |
| 双人对弈 | 侧栏「模式 → 双人」同屏轮流走子；**人机/双人均可开棋钟**（每方 3/5/10 分钟；超时判负，**对方无子力将杀时按 FIDE 判和**） |
| 点击走子 | 点选己方棋子 → 高亮合法落点（空格圆点 / 吃子圆环）→ 点目标格 |
| 规则 | 完整合法性：将军/将死/逼和、王车易位、吃过路兵、升变（**弹窗选后/车/象/马**）、50 步/三次重复/子力不足和棋（后两者自动判和，休闲约定） |
| 提示 | **H** / 顶栏「提示」引擎满强度推荐一着，棋盘上画箭头 |
| 认输 | 棋谱区「认输」结束本局（人机模式计入统计） |
| 开局 | 侧栏自动显示当前开局名称（内置主流开局 ECO 库，复盘时跟随局面） |
| 分析 | 引擎逐步评估整局：局势曲线 + `?!` `?` `??` 失着标注 + **引擎主变**（跟随复盘位置）；「重下」从任意一手继续对弈 |
| 复盘 | 着法列表（SAN）点击跳转；← → / Home / End；● 回到最新 |
| 棋谱 | 复制 / 导出 / **粘贴导入** PGN（导出含**标准七标签与结果记号**；支持**从指定局面开始**的 `[FEN]` 棋谱,复盘/分析/重下均正确）；复制当前局面 FEN |
| 翻转 | **F** / 顶栏「翻转」切换黑白视角 |
| 悔棋 / 新局 | **Z** / **N**（有棋时确认）；人机模式悔棋会同时收回引擎回着 |
| 侧栏 | **Tab** 开关；主题 木/夜/日/纸 · 音效开关 |
| 存档 | 自动保存（含棋钟余时与认输状态），重开恢复 |
| **成就** | 侧栏「成就」：12 枚徽章从教学/做题/对局进度自动解锁(规则通关、战术之眼、屠龙、身经百战…) |

## 规则引擎

局面合法性由 vendored [chess.js](https://github.com/jhlywa/chess.js) 0.13.4（BSD-2-Clause）判定——
不自研规则。`src/web/js/chess.js` 顶部注明了从 ESM 到经典脚本的机械转换（zero:// 方案下 WebView
只验证过经典脚本加载）。

## 对弈引擎

[Stockfish.js](https://github.com/nmrugg/stockfish.js) 18 lite-single（GPLv3，单线程 + lite NNUE，
约 7MB），vendored 于 `third_party/stockfish/`。zero:// 方案不能加载 worker 脚本也不能 fetch 打包
文件，因此构建时由 `scripts/gen-engine-src.mjs` 把 loader 文本与 wasm base64 生成为
`engine-src.js` 全局量，运行时 `engine.js` 用 Blob worker + `postMessage` 传 wasm 启动引擎——
全程零 URL 解析。难度用 UCI `UCI_LimitStrength/UCI_Elo`（1320–3190）限强，「极限」为满强度。

## 路线

- **后续**：题库持续扩容、更多残局 drill、多语言
- **iOS / Android**：可行性评估见 [`docs/MOBILE-EVAL.md`](docs/MOBILE-EVAL.md)（结论：可做，先 spike，不建议作为下一正式版直接上架）

## 开发

```bash
cd ~/chessboard
./scripts/package.sh   # 同步 frontend → 单测 → 编译 → 打包 → 安装
```

```
src/web/
  index.html · styles.css
  js/chess.js      # 规则（vendored chess.js 0.13.4, BSD-2-Clause）
  js/pieces.js     # 标准(cburnett)棋子 SVG 矢量集（CC BY-SA 3.0）
  js/openings.js   # 主流开局 ECO 库（SAN 前缀匹配,单测校验合法性）
  js/lessons.js    # 零基础教学课程 32 课（单测逐课校验 FEN/解法/目标）
  js/puzzles.js    # 题库 51 题:杀王/吃子/战术母题(求解器证明强制)/开局
  js/achievements.js # 成就徽章(纯派生自统计/教学/做题进度)
  js/engine.js     # Stockfish Blob worker 管理 + 难度分档
  js/engine-src.js # 生成物（gitignored）：loader 文本 + wasm base64
  js/host.js       # Native / localStorage 门面
  js/board.js      # 棋盘 Canvas 渲染 + 命中测试
  js/audio.js      # 离线合成音效
  js/app.js        # UI 编排
src/main.zig
assets/           # 应用图标(骑士标,assets/logo.svg 为源)
third_party/stockfish/   # Stockfish.js 18 lite-single（GPLv3）
scripts/gen-engine-src.mjs · test-chess.mjs
```

测试：`node scripts/test-chess.mjs`

## 许可

GPLv3（见 LICENSE）。vendored chess.js 保留其 BSD-2-Clause 版权头；vendored Stockfish.js
为 GPLv3（`third_party/stockfish/COPYING.txt`）；棋子矢量图形（`js/pieces.js`）来自
Wikimedia Commons 标准棋子集（作者 Cburnett / Rfc1394，CC BY-SA 3.0，经 cm-chessboard 整理）。
