# 6.0 计划：对标顶级国际象棋应用

> **状态：评审完成，待开工。** 本文件承接 [`refactor-plan.md`](./refactor-plan.md)（2.0，已全部完成）
> 与 [`design-constraints.md`](./design-constraints.md)（不可回退的既有判断），只安排 6.0 的内容与顺序。
> 评审基线：`main @ cf40a6f`（5.2.1），2026-09-18。四路只读评审（编排层 / 规则与引擎层 /
> 原生壳与交付 / 内容与 UX）加本机复核。静态测试全绿；浏览器 E2E 在评审容器里跑到棋盘套件
> 30 条断言零失败后被中断，其余以 CI 双引擎矩阵为准。

---

## 0 · 标杆是什么

「顶级」不是一个形容词，是一张表。对标对象取五个，各取它最强的一面：

| 产品 | 它定义了哪条标准 |
|---|---|
| Lichess | 分析板（变着树 · 多线 · 箭头圈）· 题目评级与用户评级 · 开局浏览器按局面识别 · 无障碍 |
| chess.com | 复盘按**胜率差**分类失着与精准度 · 课程有进阶 · 预走 |
| Chessable | 时间型间隔重复（到期日 · 每日量 · 遗忘曲线）· 开局按树背而不是按线背 |
| Lucas Chess | 桌面应用的完整性：引擎参数可调 · 多套棋子与棋盘 · 训练模块之间互通 |
| En Croissant | 现代桌面壳：签名分发 · 自动更新 · 对局数据库 · 本地引擎管理 |

**6.0 的定义**：上表每一行至少拿下一项，且不丢掉本仓库已经领先的部分（求解器级题库验证、
FIDE 判和、实测入档、三语齐平、键盘走子、reduced-motion 分档）。

---

## 1 · 5.2.1 与标杆的差距

### 1.1 已核实的缺陷（进 5.2.2 补丁，不等 6.0）

每条都核到了具体位置；第一条在 node 里复现过。

| # | 缺陷 | 位置 | 影响 |
|---|---|---|---|
| D1 | **导出 PGN 双结果记号**。`game.pgn()` 在头部有 `Result` 时已把记号写在着法末尾（chess.js 1533），`pgnForExport()` 再拼一次 `result`；且导入时 `resigned` 被清零，`gameResultToken()` 只能给 `*`。导入 `[Result "1-0"] … 1-0` 再导出得到 `1. e4 e5 2. Nf3 1-0 *` | app.js `pgnForExport` / `importPgn` | 文件在严格解析器下不合规；导入的胜负丢失 |
| D2 | **七个档案读取器空 catch**：`loadSettings` `restoreSave` `loadLearnState` `loadMines` `loadDrills` `loadStats` `loadAchSeen` `loadSlots`。JSON 损坏或版本不符即静默回退为空档，下一次自动保存把原数据覆盖 | app.js | 唯一会造成**不可逆**数据丢失的路径；persist.js 只闩锁写失败，不报读损坏 |
| D3 | **引擎无自愈**：`waitFor` 超时不发 `stop`、无 `terminate` / 重建、`init()` 失败后 `worker` 不置空所以 `isReady()` 恒 true | engine.js 138–190 | 一次挂起等于本次会话引擎报废 |
| D4 | **写入超限的文案说错**：`writeTextFile` 超 384 KiB 抛 `InvalidRequest`，`exportTextFallback` 报「文件对话框不可用，已复制到剪贴板」 | main.zig 144–147 · app.js `exportTextFallback` | 用户以为存了文件 |
| D5 | **读屏用户听不到任何着法**：`announce()` 只播光标/选中/预览，从不输出 SAN；引擎应手（`animateReply`）与 ← → 复盘导航不写 `#board-live` | app.js 6581–6670 | 键盘能下棋，盲人仍不能玩 |
| D6 | **发布清单保留开发 origin** `http://127.0.0.1:5173` 并授予全部桥命令 | app.zon `allowed_origins` | 应由 `gen-manifest.mjs` 在发布清单里剔除 |
| D7 | **手动触发 build-\* 时 SDK 用 `latest`**：input 默认值是 `"latest"`，`|| '0.8.1'` 只在空串时回退 | build-macos.yml 16/43 · build-windows.yml 121/149 | 与注释「see release.yml for why this is not latest」自相矛盾 |
| D8 | **全局单字母快捷键无可编辑元素守卫**：只靠 `#fen-input` 自己 `stopPropagation` | app.js 7623–7680 | 再加任何输入框就会触发 z/n/h/f |
| D9 | `exportPgn` 与 `exportLearning` 逐行重复（原生对话框 → Blob 下载 → 剪贴板兜底） | app.js 5462–5490 · 7322–7350 | 抽成一个 `exportText()` |
| D10 | 12 处静态 import 的死兜底（`ChessDialog \|\| {...}`、`I18n ? :`、`ChessPgn ?`） | app.js 59/83/85/308/4518/5807 | 误导读者以为模块可选，无焦点管理的降级对话框看似可达 |
| D11 | `loadStats()` 无缓存，一次 `renderStats()` 反序列化 500 局 blob 5–6 次；开局界面每次 `sync()` 再 parse 4 次 | app.js 3721→3883→4012→4050→4191 · 6312 | 长期用户的记录页会卡 |
| D12 | `build.zig` 的 `frontend-install` / `frontend-build` 步骤 `npm --prefix frontend`，仓库没有 `frontend/` | build.zig 135–142 | `zig build run / dev / package` 本地不可用 |

### 1.2 结构性差距（这才是 6.0 要做的）

按「用户装不上 → 用户丢数据 → 用户用不出高级功能 → 用户练不上去」的顺序。

**交付与数据（En Croissant 那一行）**

- macOS 仅 adhoc 签名、无公证；Windows 完全未签名；只发 zip。macOS 15+ 下载的 adhoc 应用通常直接提示「已损坏」。
- 全部用户数据在 `zero://app` 的 WebView localStorage：路径不可控、不可备份、清站点数据即全丢、配额 5–10 MB 而对局历史每局存完整 PGN。「学习数据导出」不含 `save / settings / stats / slots`。
- 桥命令接受任意绝对路径读写（main.zig 250–275），未绑定到对话框刚返回的路径；页面无 CSP。当前 `innerHTML` 为零所以攻击面小，但这不是安全默认。
- Zig 侧代码在 PR CI 上**不编译**；5.0–5.2 三个版本对话框失效、Esc 失效都是这个盲区的产物。
- 引擎不懒加载：9.7 MB base64 以同步 `<script>` 阻塞首屏，主线程常驻字符串 + ArrayBuffer 约 17 MB。
- 无自动更新、无 .pgn 文件关联、无系统深色模式跟随、无 Intel Mac。
- 菜单栏、窗口标题、Dock 名硬编码中文。
- GPLv3 合规：应用内无许可 / 关于 / 源码入口，产物不含 LICENSE；棋子素材 CC BY-SA **3.0** 与 GPLv3 不兼容且无界面署名。

**分析板（Lichess / chess.com 那两行）**

- 历史是线性数组：导入丢 RAV 与 NAG（chess.js 1757–1767），PV 棋子片只能预览不能保存，无「从此处试走再回主线」。
- 无右键箭头与圈，无预走，无盲棋。
- 复盘用厘兵阈值（`?! 50 / ? 100 / ?? 300`）。自己量过：120 ms 快扫下 `?!` 两遍重合率 39%，且抬阈值无趋势（design-constraints 缺陷 23）。结论「不动」是诚实的，但它等于承认三分之一以上的 `?!` 不可复现。业界用**胜率差**正是因为它在残局与均势局面的稳定性更好，也让「精准度」与在线平台同名同义（缺陷 22 至今只是改了名）。
- 复盘固定 MultiPV 1 + 固定 movetime，无多线、无无限分析、无评估缓存（教练 / 提示 / 求和判断重复算已扫局面）；Hash / Threads / MultiPV 全不可调。
- 开局识别只按标准起局 + 195 条 SAN 前缀（app.js 1066–1075），转换顺序与 FEN 起局无法分类。
- `load_pgn` 的已知失败形状：`;` 行注释含 `?` 整局失败、头部与着法间无空行失败、`0-0` 数字零失败；`[FEN]` 导入只过 `validate_fen`，不查王数（两王 / 无王可进对局）。
- Chess960 零支持。

**学习系统（Chessable / chess.com 那两行）**

- 没有题目评级，没有用户评级。168 道手写题三档推导难度，无法「按棋力出题」，也给不出一个能看涨的数字。
- `srs.js` 是「答错入队、连对两次出队、按连对数排序」，无到期日、无间隔、无每日量。作者选按次数不按日历的理由成立（离线应用开得不规律），但那是对「一次倒出」的规避，不是对遗忘曲线的建模。
- 题量 168 vs Lichess 400 万；无导入管线（`grep -ri lichess src scripts` 为空），扩容全靠手写过求解器。tac / win 的唯一性只靠人工，只有 23 道 real 经引擎验证。
- 开局训练 119 条固定主线，无分支树、无对手随机变着、无按频率加权。
- 72 课全部面向零基础到初级；母题练习只有 21 题，练完即无处可去（lessons.js 16–20 自述）。

**测试（本仓库自己的标准）**

- `test-chess.mjs` 里 161 处对 app.js **源码文本**的正则断言：锁定实现而非行为，是重构的最大阻力也是虚假安全感来源。
- 规则测试无 perft、无被钉住的过路兵、无易位穿将、无 KB vs KB 同异色；上游 chess.js 0.13.4 靠信任。
- PGN 导入导出、复盘 PNG 导出、学习数据导入导出、对话框焦点陷阱、故障横幅、原生菜单命令没有任何行为测试。
- `test-novice / test-strength / test-analysis` 不在任何工作流；`test-novice / test-analysis / test-mines` 没有一条 assert。
- `sync()` 仍是三切片全量 commit，`draw()` 每次画三遍、`syncSettingsUI` 跑三遍（app.js 4820–4881）；store 重构在 P1.3 停在「10 处收窄，55 处仍全量」，之后没再推进。

**视觉可访问性与本地化**

- `font-size` 76 处全 px、0 rem，无应用内缩放、无 `prefers-contrast` / `forced-colors` / `prefers-color-scheme`。
- 复数硬拼 14 处（`{0} moves`），日期用系统 locale 不跟应用语言，`<title>` 恒中文。
- 单一棋子集、无音量、坐标不可关。

---

## 2 · 6.0 做什么

一个大版本一件事：**把线性对局升级为可保存的分析树，并让产品在系统层面可信任。**
分四个阶段，前两个是地基（用户几乎看不见），后两个是产品本体的代际升级。

### Q0 · 补丁与护栏（1–2 周 · 5.2.2）

1. 修 D1–D12。D1、D2、D5 各带一条**行为**测试（导入再导出往返一致；写入一段坏 JSON 后启动必须出现横幅且原值仍在 localStorage；引擎应手后 `#board-live` 含 SAN）。
2. Zig 进 PR CI：`checks.yml` 加一个 `zig build` + `zig build test` 作业（macOS runner，不打包）。
3. 规则门禁：perft 进 `test-chess.mjs`（起始局面 d4、kiwipete d3、position-3 d4、position-5 d3，与标准值比对），再补被钉住的过路兵、易位穿将 / 过被攻击格、升变吃车易位权、KB vs KB 同色与异色、KNN vs K 各一例。
4. **源码正则断言开始退役**：登记册做法，`test-chess.mjs` 记下当前 161 条，只减不增；每退一条必须有一条行为断言接替。
5. `test:engine` 进 release 流水线全量（不只 openings / tactics），`test-novice / test-analysis` 加上下限 assert。

### Q1 · 地基（3–4 周 · 无可见变化，除首屏更快）

1. **存储落原生文件**。用户数据目录下一份 `chessboard.json`（macOS `~/Library/Application Support/Chessboard/`，Windows `%APPDATA%\Chessboard\`），写临时文件再 rename，启动时校验 schema 并保留上一份 `.bak`。localStorage 只做一次性迁移来源。全量导出 / 导入覆盖十个键。读损坏 → 横幅「档案损坏，已保留副本」，**绝不**回退为空档后覆盖。
2. **桥收紧**。`readTextFile / writeTextFile` 只接受原生侧刚由对话框或拖放签发的一次性路径句柄；`index.html` 加 CSP（`default-src 'self' zero:; worker-src blob:; img-src data:` 等）；`gen-manifest.mjs` 在发布清单里剔除 `127.0.0.1`。
3. **引擎懒加载与自愈**。wasm 作为 `native package --assets` 里的独立文件由桥按需读入二进制，`engine-src.js` 退役，首屏不再同步解析 9.7 MB 字符串。`waitFor` 超时发 `stop`，二次超时 `terminate` 并重建；`isReady()` 反映真实状态。评估缓存按 `positionKey` 记最近 N 个局面的 `(depth, score, best)`，教练 / 提示 / 分析共用。
4. **`sync()` 收完**。剩余 55 处按 P1.3 的 AST 方法收窄到实际写的切片；`draw()` 只订阅一次。验收：走一步棋 `draw()` 恰好一次（e2e 计数）。
5. **签名与分发**。Developer ID + notarization + stapling；Windows Authenticode；产出 `.dmg` 与 `.msix`（保留 zip）。自动更新走 Sparkle / MSIX 内建通道或最低限度的「启动时查 Releases，有新版本提示」。`.pgn` 文件关联（Info.plist `CFBundleDocumentTypes`、Windows 注册表）+ runner 处理 open-file 事件。
6. **壳层三语**。菜单、窗口标题、Dock 名随界面语言；`InfoPlist.strings`。应用内「关于」：版本、GPLv3、源码链接、Stockfish / chess.js / 棋子素材署名。棋子素材切到 CC BY-SA 4.0 版本或 lichess 的 MIT / CC0 集。
7. **app.js 拆第二批**：档案读取器归 `persist.js`，导入导出归 `io.js`，`renderReportCanvas` 归 `report.js`，键盘与 announce 归 `a11y.js`，原生命令归 `native-commands.js`。目标 app.js < 4000 行。

### Q2 · 分析板（4–6 周 · 用户可见的那一次升级）

1. **历史改树**。`game.js` 新模块：节点 = `{san, fen, comment, nags, children[]}`，主线是第一个孩子。五道门（`gameMove / gameUndo / gameLoad / gameLoadPgn / gameReset`）不变，新增 `gameBranch / gamePromote / gameDelete`。着法表渲染树（Lichess 样式：主线一行，变着缩进括号）。keyed 增量更新扩到着法表的变着行。
2. **PGN 往返无损**。自写 PGN 解析器替换 `load_pgn`（chess.js 只做合法性）：RAV 嵌套、NAG、`{}` 与 `;` 注释、头部转义引号、无空行、`0-0`、多局。导出写回变着与 NAG，80 列折行只切在 token 边界。验收：`assets/pgn-corpus/` 里 20 份公开棋谱库样本（含 TWIC 片段、lichess 导出、ChessBase 导出）往返后语义相等。`[FEN]` 导入走 `ChessEditor.validate`。
3. **PV 存为变着**、**从此处试走**（试走自动开变着，「回主线」一键）。
4. **右键箭头与圈**（右键拖 = 箭头，右键点 = 圈，Shift / Alt 换色），存进节点注释的 `[%cal]` / `[%csl]`，导入 lichess 导出时能画出来。
5. **复盘改胜率差**。`review.js` 新增 `winPct(cp)` 映射（lichess 公式或 Stockfish WDL），失着分类按胜率降幅（`?! 5 / ? 10 / ?? 20` 个百分点起步），精准度按胜率差算。旧厘兵阈值与 `scanNoise` 数据保留在 `measured.json` 作为对照，新阈值同样先 `--record` 再定：**验收是 120 ms 快扫下 `?!` 两遍重合率 ≥ 60%**（现 39%）。做不到就写明做不到并回退。
6. **多线与无限分析**。MultiPV 1–5 可调，「持续分析」模式跟随复盘游标，深度与节点数可见；Hash / Threads（lite 单线程构建先只暴露 Hash）进设置。
7. **开局识别按局面**。ECO 全库（~3 000 行）以局面 zobrist 查表，转换顺序与 `[FEN]` 起局都能认；侧栏开局名与 PGN `ECO / Opening` 头同源。
8. **预走**（人机与双人）、**盲棋**（棋子隐藏，坐标与播报保留）、坐标可关、音量滑杆。

### Q3 · 学习系统（3–4 周 · 可与 Q2 后半并行）

1. **评级**。每道题一个评级，用户一个 Glicko-2（题目侧同样更新）。选题按 ±150 区间。现有 168 题的初始评级由「首选领先次优的分差 + 解长 + 首着是否安静着」离线估算，之后由用户数据校正。
2. **题库管线**。`scripts/import-puzzles.mjs`：从 Lichess puzzle DB（CC0）按母题与评级区间抽样 → 走现有求解器门禁（m 类穷举、tac / win 子力摆动、real 引擎唯一性）→ 生成 `puzzles-lichess.js`。目标 6.0 出厂 2 000 题，每个母题 ≥ 100 题、每 200 分评级段 ≥ 50 题。手写 168 题保留为「精选」。
3. **SRS 加时间维度**。保留「连对两次毕业」，新增到期日（SM-2 简化版：间隔 1 → 3 → 7 → 21 天）与每日复习上限；离线多日回来按上限分摊，不一次倒出。「今天的训练」读到期数而不是队列长度。
4. **开局改树**。119 条线合并为按 ECO 的树，背谱时对手按分支权重随机变着；「接实战」从任意叶子出发。
5. **课程进阶**。中级 24 课（战术组合 · 典型残局 · 兵型与计划），每课接同母题题目；10 局带解说的经典对局作为「读棋」模块。
6. **可访问性补齐**。`font-size` 全部改 rem，应用内字号三档；`prefers-color-scheme` 跟随（可关）；`prefers-contrast` 高对比变体；复数用 `Intl.PluralRules`，日期用应用语言的 `Intl.DateTimeFormat`；`document.title` 随语言。

---

## 3 · 明确不做

- **不自研规则引擎**。chess.js 留下做合法性，perft 门禁保证它。
- **Chess960 放 7.0**。它要动规则库、编辑器、引擎选项三层，和分析树同版会失控。
- **不做在线对弈、账号、云同步**。这是本地应用，En Croissant 也不做。
- **不做多窗口、Linux、Intel Mac**，除非 Q1 全部落地后仍有余量。Linux 分支在 build.zig 里是模板遗留的死代码，先删。
- **不上完整 NNUE 双网**：7 MB 的 lite 单线程是 zero:// 约束下的合理选择，6.0 只把它懒加载。

---

## 4 · 顺序为什么不能换

- 没有 Q0 的行为测试与 Zig CI，Q1 动存储与桥就是在盲区里改最危险的两处。
- 没有 Q1 的原生文件存储，Q2 的变着树会把配额撞得更快，Q3 的 2 000 题进度会丢得更疼。
- 没有 Q1 的 `sync()` 收窄，Q2 的树状着法表每走一步重画三遍会肉眼可见地卡。
- 没有 Q2 的胜率差，Q3 的错题挖掘仍在挖三分之一噪声。
- 没有 Q2 的 PGN 无损往返，Q3 的题库管线导入的注释与变着无处安放。

---

## 5 · 每个阶段的验收

| 阶段 | 验收（每条都是可写成断言的） |
|---|---|
| Q0 | 导入 → 导出往返结果记号唯一且与输入一致；写入坏 JSON 后启动出横幅且原值仍在；perft 四组数字对上；`checks.yml` 含 zig 作业；源码正则登记数只减不增 |
| Q1 | 数据文件存在于用户目录且 `.bak` 在；桥拒绝未签发路径（单测）；`index.html` 含 CSP 且 e2e 无 CSP 违规；首屏到可交互 < 1 s（引擎未加载）；走一步棋 `draw()` 恰一次；`spctl --assess` 与 `codesign --verify` 通过；菜单三语；关于面板含许可与署名 |
| Q2 | 20 份 PGN 样本往返语义相等；变着可建 / 升主线 / 删；箭头圈进出 `[%cal]`；`?!` 重合率 ≥ 60%；MultiPV 3 时三条线可见；转换顺序的开局能认；预走在对手走完后 ≤ 1 帧执行 |
| Q3 | 用户评级随对错移动且方向正确（单测）；每母题 ≥ 100 题、每 200 分段 ≥ 50 题（内容测试）；离线 14 天回来当日复习量 ≤ 上限；开局对手在同一分支点两次出不同着；`font-size` 中 px 为 0；`Intl.PluralRules` 覆盖全部 14 处 |

## 6 · 工期与风险

单人推进约 **12–16 周**。Q0 一到两周即可发 5.2.2。Q1 是最不显眼也最不能省的一段：
它把三个「用户会因此卸载」的问题（装不上、丢数据、启动慢）一次清掉。

**最大的风险仍是丢掉已有判断。** `design-constraints.md` 的 8 节约束在 6.0 全部继续有效；
Q2 改胜率差**不是**推翻缺陷 23 的结论，而是换一个量：厘兵阈值在噪声里无论切哪里都不稳，
是量出来的；胜率差是否更稳，也要先量再定，`measured.json` 加 `winPctNoise` 一节，方法与
`scanNoise` 相同。

第二个风险是 **161 条源码正则**。它们锁住的是 2.0 到 5.2 每一次修复的形状，Q1 拆模块、
Q2 改树都会大面积撞上。登记册「只减不增、退一补一」是唯一不丢护栏的退法；一次性删光
和一次性全保留都是错的。

---

## 附 · 评审保留的东西

以下是本仓库已经领先的部分，6.0 任何改动都不得退步（大多已有断言）：

- 题库求解器级验证（m 类穷举强制杀、def 的 `saves` 计数、draw 以逼和 / 重复收尾）
- FIDE 判和算术与 pin-aware 的重复 key（`fide.js`）
- 实测入档：`measured.json` 由脚本 `--record` 写入，README 与注释引用它，单测对账
- 错题挖掘与修订（`mistakes.js`：预算不浅于原预算才能改判）
- `app.js` 零 `innerHTML`、零汉字字面量
- 键盘走子 + `#board-live`、七个对话框焦点陷阱、reduced-motion 只停位移动画
- 设计约束登记册（裸色值 / token 刻度 / 键唯一 / 每键有人读）
- 文档纪律：每个数字有出处，每条约束有理由，每个缺陷保留原文

---

## 7 · 落地记录（6.0.0）

按 §2 的编号逐条对账。「完成」指代码在、测试在；「部分」写明差在哪。

| 项 | 状态 | 说明 |
|---|---|---|
| Q0.1–Q0.5 | 完成 | D1–D12 全修；perft 五组与规则边界进 `test-chess.mjs`；zig 作业进 `checks.yml`（已绿）；登记册 161 → 124 只减不增；release 跑全量 `test:engine` |
| Q1.1 存储 | 完成 | `persist.js` 镜像到 `chess.appdataWrite`（原子写带 .bak），`recover()` 以更新的一方为准；全部数据导出导入；隔离键与启动横幅 |
| Q1.2 桥收紧 | 完成 | `chess.issuePath` 签发表；点文件与系统目录拒绝；CSP；发布构建剔除 dev origin |
| Q1.3 引擎 | 完成 | `engine-src.js` 由 engine.js 首次需要时注入；超时 stop、两次 terminate 重建；评估缓存；Hash / MultiPV / infinite |
| Q1.4 sync() | 完成 | `commitAll` 一次通知（draw() 每次一遍）；只写单切片的 24 处改 `store.commit(切片)`，其余 32 处确实同时写 game 与 session，保留全量 |
| Q1.5 签名分发 | **未做** | Developer ID / notarization / Authenticode / msix 都要证书（用户决定暂不做）；启动查更新与 dmg 产物已做 |
| Q1.6 壳层三语 | 完成 | 菜单与标题随语言（重启生效）、关于面板、LICENSE 与 Stockfish COPYING 进产物；棋子素材署名写在关于面板 |
| Q1.7 app.js 拆分 | **部分** | `report.js`（报告导出图）与 `persist.js`（档案键形状、stats 迁移）已拆；`io.js / a11y.js / native-commands.js` 未拆，app.js 9.1k 行，未达 < 4000 —— 剩余三块与 124 条源码守卫强耦合，留到 6.1 随守卫退役一起做 |
| Q2.1–Q2.4 | 完成 | `game-tree.js` + `pgn-parser.js`，26 份语料往返；变着 / 升主线 / 删 / 注释 / NAG；箭头圈进出 `[%cal]/[%csl]`；PV 存变着、试走回主线 |
| Q2.5 胜率差 | 完成 | `?!` 重合率 32% → 67%（`measured.json` `winPctNoise`），阈值 5 / 10 / 20 |
| Q2.6 多线 | 完成 | MultiPV 1–5、持续分析、Hash；Threads 不暴露（lite 单线程构建） |
| Q2.7 开局识别 | 完成 | `eco.js` 3810 局面按 `positionKey` 查表 |
| Q2.8 | 完成 | 预走、盲棋、坐标开关、音量 |
| Q3.1 评级 | 完成 | Glicko-2，168 题初始评级按推导难度；选题按 ±150（有评级记录后启用） |
| Q3.2 题库管线 | **部分** | `import-puzzles.mjs` + `puzzle-gate.mjs` 管线完成并有样本测试；本机不可达 `database.lichess.org`，**未实际抽样入库**，「每母题 ≥ 100 题」的验收未达 |
| Q3.3 SRS | 完成 | 到期日 1 → 3 → 7 → 21 天，每日上限 20，离线多日按上限分摊 |
| Q3.4 开局树 | 完成 | `opening-tree.js`，对手按分支权重随机变着 |
| Q3.5 课程 | 完成 | 中级 24 课三语（24 个局面经 Stockfish 复核）；10 局名局读棋 |
| Q3.6 可访问性 | 完成 | rem 三档、跟随系统、高对比 / 强制色、`Intl.PluralRules` 与 `Intl.DateTimeFormat` |

