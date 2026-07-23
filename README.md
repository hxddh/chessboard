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

## 怎么玩（v0.6）

| 操作 | 说明 |
|------|------|
| **教学模式** | 侧栏「模式 → 教学」：**零基础 21 课**互动课程 —— 认识棋盘摆法 → 六种棋子走法+王的禁区（吃星任务）→ **子力价值与吃子保护** → 将军/将死/逼和/易位/吃过路兵/升变/**和棋方式/记谱法** → 后杀王·车杀王实战（引擎陪练,可悔棋/提示）；连错两次自动标出答案,进度自动保存,毕业一键进入人机·入门 |
| 人机对弈 | 默认与 **Stockfish 18** 对弈；侧栏可选难度（入门 Elo 1320 · 进阶 1700 · 困难 2200 · 极限满强度）与执子（白/黑，选黑自动翻转视角） |
| 双人对弈 | 侧栏「模式 → 双人」同屏轮流走子；可开**棋钟**（每方 3/5/10 分钟；超时判负，**对方无子力将杀时按 FIDE 判和**） |
| 点击走子 | 点选己方棋子 → 高亮合法落点（空格圆点 / 吃子圆环）→ 点目标格 |
| 规则 | 完整合法性：将军/将死/逼和、王车易位、吃过路兵、升变（**弹窗选后/车/象/马**）、50 步/三次重复/子力不足和棋（后两者自动判和，休闲约定） |
| 提示 | **H** / 顶栏「提示」引擎满强度推荐一着，棋盘上画箭头 |
| 认输 | 棋谱区「认输」结束本局（人机模式计入统计） |
| 开局 | 侧栏自动显示当前开局名称（内置主流开局 ECO 库，复盘时跟随局面） |
| 分析 | 引擎逐步评估整局：局势曲线 + `?!` `?` `??` 失着标注；「重下」从任意一手继续对弈 |
| 复盘 | 着法列表（SAN）点击跳转；← → / Home / End；● 回到最新 |
| 棋谱 | 复制 / 导出 / **粘贴导入** PGN（导出含**标准七标签与结果记号**）；复制当前局面 FEN |
| 翻转 | **F** / 顶栏「翻转」切换黑白视角 |
| 悔棋 / 新局 | **Z** / **N**（有棋时确认）；人机模式悔棋会同时收回引擎回着 |
| 侧栏 | **Tab** 开关；主题 木/夜/日/纸 · 音效开关 |
| 存档 | 自动保存（含棋钟余时与认输状态），重开恢复 |

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

- **v0.7 做题练习**：内置战术题库 + 判定流程（与教学模式互补：教学学规则，做题练战术）
- 之后：拖拽走子、分析显示引擎主变、人机模式计时

## 开发

```bash
cd ~/chessboard
./scripts/package.sh   # 同步 frontend → 单测 → 编译 → 打包 → 安装
```

```
src/web/
  index.html · styles.css
  js/chess.js      # 规则（vendored chess.js 0.13.4, BSD-2-Clause）
  js/openings.js   # 主流开局 ECO 库（SAN 前缀匹配,单测校验合法性）
  js/lessons.js    # 零基础教学课程 21 课（单测逐课校验 FEN/解法/目标）
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
为 GPLv3（`third_party/stockfish/COPYING.txt`）。
