# 8.2 · 计算与看棋的训练，加上让「真机上是否可用」不再全靠人工

写于 8.1.0 发布当天（2026-09-30），规矩照旧：

- 每条写**依据**、**做什么**、**验收**；
- 发布前补**落地记录**，做到的和没做到的都逐条写。

8.2 的材料有三份：

1. **8.1 推到 8.2 的事**：
   - v8-1-plan §6 和 §8 第 6 条：进阶课程第三部、可视化与计算专项、名局猜着；
   - §9 落地记录里写明的偏离与没达标项；
   - release-notes「还没做的」。
2. **依赖与 SDK 审计**（2026-09-30 重查，§1）。
3. **产品与代码体检**（§2），包括：
   - 硬指标和守卫的余量；
   - CI 耗时；
   - 不稳定的测试；
   - 最大的几个文件。

结论先说：**8.2 没有必须做的升级**。所有依赖都已经是最新正式版，SDK 0.10.2 还没发布。所以 8.2 的主线在产品上：

- 补上两次推迟的训练内容；
- 把「打包后到底能不能用」这件事尽量交给 CI，不再只靠一份没人走过的真机清单。

---

## 依据

1. **审计的方式**：
   - `npm view … dist-tags time`；
   - 公开仓库的 `git ls-remote` 与浅克隆（vercel-labs/native 读到 HEAD `96943d4a`，2026-09-28，以及全部 `refs/pull/*/head`，最大号 #480）；
   - Node 的 `schedule.json`；
   - database.lichess.org 的 `Last-Modified`。
2. **读代码与实测**：
   - `test:static` 本机跑了一遍，263 s，全绿；
   - 主包在内存中重建了一次；
   - CI 各 run 的作业耗时由 GitHub API 取得；
   - 读了 `src/main.zig`、`src/runner.zig`、`build.zig`、`app.zon`，以及 `src/web/js` 下各模块。
3. **8.1 文档**：
   - `docs/v8-1-plan.md` §6、§8、§9；
   - `.github/release-notes/v8.1.0.md`；
   - `docs/manual-check.md`「8.1 真机清单」；
   - `docs/measured.json`。

**这次的局限**：

- **代理返回 403，下面几处没法核实：**
  - vercel-labs/native 的 issue 与 PR 讨论，以及 Releases 页（GitHub API 只开放本仓库）。所以「功能请求没有进展」这个结论只基于 git 看得到的代码与分支。
  - ziglang.org 与 codeberg.org。Zig 的版本以 PyPI 的 `ziglang` 镜像为准。
  - lichess.org、api.chess.com、tablebase.lichess.ovh。
- **没有 macOS 或 Windows 桌面。**

---

## 0 · 结论先行

### 版本号：8.2

- **依赖**：没有要升的，也没有破坏性变化。
- **存档**：格式不变，SCHEMA 仍是 2。开局书的线从 localStorage 搬进已有的 `chessboard.repertoire` 数据库（T4），这是它自己的数据库升一个版本，棋谱库不动。
- **布局**：不改布局不变式。
- **9.0 的门槛不变**：换引擎形态、棋谱库搬到 SQLite、SDK 1.0 带破坏性改动、Chess960、第四种语言。这些都不在 8.2 里。

### 8.2 的三个主题

| | 主题 | 一句话 |
|---|---|---|
| **V** | 验证 | 打包后的应用由 CI 自动走一遍能自动化的真机条目；真站应答、5 子残局在 CI 上核对；降级到 8.0 有自动测试；CI 有超时、墙钟回到目标以内 |
| **T** | 计算与看棋 | 进阶课程第三部；可视化与计算专项；名局猜着；开局书去掉 400 条上限；两种母题恢复 |
| **F** | 地基 | 新内容一律分块，主包余量不再每版少 40 KB；`trainer/puzzles.js` 与 `main.zig` 拆分；「经过这个局面」冷启动；整句模板 |

---

## 1 · 依赖与 SDK 审计（2026-09-30）

### 1.1 清单

| 依赖 | 钉的版本 | 最新 | 8.2 建议 |
|---|---|---|---|
| Native SDK `@native-sdk/cli` | 0.10.1 | 0.10.1（npm `latest`，2026-08-24）；main 上有 17 个未发版提交 | **等**。0.10.2 一出就单独开一个 PR 升级（M，要对照上游同步 `runner.zig` 和 `build.zig`） |
| Zig | 0.16.0 | 0.16.0 | 不动 |
| Stockfish | 19（lite 单线程 wasm） | sf_19；npm 19.0.0 | 不动。8.1 决定不升，今天也没有新版本 |
| chess.js | 0.13.4（vendored） | 1.4.0（2025-06-14，15 个月没有新版） | 不动。8.1 决定不升，没有新情况 |
| esbuild | 0.28.2 | 0.28.2 | — |
| Playwright | 1.63.0 | 1.63.0；1.64 只有每日 alpha | 1.64 发布后单独开一个 PR（S–M，布局基线可能随浏览器版本移动） |
| Node | 24（engines ≥ 24） | 24.21.0 LTS；26.10.0 Current | **见 §8 第 3 条** |
| actions/checkout · setup-node · upload-artifact · download-artifact · mlugg/setup-zig | v7 · v7 · v7 · v8 · v2 | v7.0.1 · v7.0.0 · v7.0.1 · v8.0.1 · v2.2.1 | — |
| Lichess 题库 | 2026-09-09 | 2026-09-09 | 10 月的导出出来后可以刷新（S，可选） |
| lichess-org/chess-openings | c67912be | c67912be | — |

**Node 有一个新情况**（8.1 决定「不升 Node」之后才有的事实）：

- 按 `schedule.json`，Node 24 在 2026-10-20 转入维护期，EOL 是 2028-04-30；
- Node 26 在 2026-10-28 进入 LTS。

所以 24 在 8.2 期间仍受支持，不是必须升。

### 1.2 SDK：main 上没有我们要的东西

- **0.10.2**：没有发布。准备发版的两个分支都停在 8 月。
- **main 上与我们沾边的提交有三个：**
  - `#465`：修正 macOS 优化构建丢失更新器导出的问题。只在开启签名更新器时才相关，而 8.1 决定不接。
  - `#464`：清单校验拒绝带通配符的外链白名单。我们的 `app.zon` 没有通配符，不受影响。
  - `#447`：从 update 打开外部链接。我们用不到。
- **两个功能请求**（v8-1-plan 附录：WebView 拖动区；zero:// 可配置响应头）：main 与 PR #444–#480 的 diff 里都搜不到相关代码。**没有进展。** 请求原文还在附录里，由你转交。
- **0.10.1 里仍没用上的能力：**
  - 签名更新器（8.1 决定不接）；
  - 公证（缺证书）；
  - 凭据存储（没有要存的 token）；
  - SQLite 与 record store（9.0 的事）；
  - 托盘；
  - `url_schemes` 深链接；
  - 多窗口；
  - 富剪贴板；
  - **automation server**：`build.zig:51` 有 `-Dautomation`，`runner.zig` 已经接好线，但没有任何 workflow 用过它。**V1 要用的就是它。**
- **要更正的清单（`docs/deps-inventory.json`）：**
  - GitHub 上已有 `v0.10.0` 和 `v0.10.1` 标签，v8-1-plan §1.2 写的「标签只到 v0.9.5」过时了；
  - 未发版的提交是 17 个，不是 22 个；
  - `addRecentDocument` 和 `showNotification` 其实已经在用，不该列在「没用上」里。

  这三处随这份计划一起改。

---

## 2 · 体检：8.1.0 之后的余量与风险

| 项 | 现状 | 问题 |
|---|---|---|
| 主包 `bundle.js` | 900,972 / 预算 951,642，余 50,670（5.3%） | 8.1 一个版本用掉约 39 KB（M1 时余 89,502）。三语课程或新训练模式放进主包，大概率撞线 |
| `app.js` | 5,873 行 = 上限 5,873 | 零余量，只许减不许增 |
| 界面键 | 1,279，三语齐全 | — |
| `test:static` | 263 s，3,934 条 ok | — |
| `checks.yml` | 24 个作业，**没有任何 `timeout-minutes`** | 卡住要等到 GitHub 默认的 6 小时。今天布局分片卡死了 57 分钟，靠 release.yml 的 60 分钟超时才停下 |
| PR 墙钟 | 8.0 F1 的目标是 ≤ 15 分钟（8.0 实测 13′41″）；8.1 没有记录 | chromium「lessons + review + engine」单个作业就要 21.8 分钟，已经超出目标 |
| 不稳定项 | 布局分片偶尔不出帧（今天加了看门狗止血，根因没查）；persist-e2e 的计时项偶尔红；棋谱库冷启动约四分之一的启动要 1.2–1.8 s（测试取三次里最快的一次） | — |
| 没达标的测量 | 「经过这个局面」可用 2,596 ms（没变快）；长将、困子的错误率 12%（已回退为只说子力）；阶梯顶一级只有 64 盘，区间 50–71% | — |
| 真机记录 | 8.1 的 R1–R19 一条也没记；上一次真机记录停在 5.2.0 | 同步、原生对话框、开局书数据库在打包后到底能不能用，没有人看过 |
| 大文件 | `trainer/puzzles.js` 1,825 行；`src/main.zig` 4,686 行，异步桥、同步、对话框、菜单都在这一个文件里 | SDK 每次升级都要在 main.zig、`runner.zig`（分叉）、`build.zig`（手抄）三处对 diff |

---

## 3 · V：验证

### V1 打包后的应用由 CI 自动跑一遍【M】

**依据**：

- R1–R19 里有一半说的是「打包后能不能用」，不是「看起来对不对」。例如：
  - 同步时窗口不卡（R6）；
  - 原生对话框能弹出、能取消、能写中文路径（R12–R16，写进的内容能读回）；
  - 开局书数据库在 WKWebView 上可用（R17）；
  - 冷启动预读（R18）。
- SDK 的 automation server 能在打包后的 app 上驱动界面、读回状态。我们编译进去了，只是没打开。

**做什么**：

1. **调研（S）**：读 SDK 0.10.1 的 automation 文档和源码，确认它能做什么：
   - 能不能点击、执行脚本、读 DOM 或状态？
   - 能不能在 macOS 和 Windows 的 CI 机器上无人值守地跑？

   结论写进 §9。**做不到就停在这里**，改做第 2 步的弱化版：打包自检多测几项。
2. **能做到的话**：`build-macos.yml` 和 `build-windows.yml` 各加一个 `-Dautomation` 的构建，跑一份脚本：
   - 同步：对着本地的假服务器（CI 上起一个），测窗口不卡、取到 k 局；
   - 原生对话框：能不能用 automation 应答要看调研结论，不能就只测命令注册与取消路径；
   - 开局书数据库写入、重启后读回；
   - 冷启动预读命中。
3. **改写真机清单**：每条改标「CI 已覆盖（哪个作业）」或「只能人看」。

**验收**：

- R1–R19 里至少有 8 条改由 CI 覆盖，并在两个平台上各跑绿一次；
- 剩下的真机清单缩成一份 30 分钟以内能走完的路线（§8 第 8 条）。

### V2 真站核对搬进 CI【S】

- **Lichess 的时间排序**：手动触发 `sync-samples.yml` 的 `lichess-since` 样本，把应答入库成夹具，给 Zig 和 JS 各加一条断言，核对 `sort=dateAsc` 真的是按时间正序。
  - 依据：v8-1-plan M2 评审修正 P2-2；当初只照文档写的。
  - §8 第 5 条已经批准过这个工作流，我这边直接派发。
- **5 子残局查表**：新建一个只能手动触发的 workflow，在 CI 上用 tablebase.lichess.ovh（或下载 5 子 WDL 表）重跑 `scripts/verify-endgames.py`，更新 `docs/endgames-verified.json`。
  - 目的：12 个 5 子以上的局面里，≤ 7 子的改由查表核对。
  - 依据：v8-1-plan T2；开发环境取不到这些表。

**验收**：夹具和 `endgames-verified.json` 入库。凡是结论和表不一致的局面，改掉或撤下。

### V3 降级到 8.0 有自动测试【S–M】

**依据**：release-notes「降级回 8.0」一节里有两件事没有测过：

- 战绩里的 `lad: 2`、`tc` 字段；
- 残局营进度 `eg`。

它们经 8.0 读写之后是否保留。

**做什么**：一个 e2e：

1. 按 `v8.0.0` 标签构建出旧包；
2. 用 8.1 的包写一份满档案，再用 8.0 的包读写同一份；
3. 回到 8.1 后逐字段比对。

**验收**：

- 丢字段的，要么修（给 8.0 已知会丢的字段在 8.1 里留一份备份），要么在 README 里照实写；
- 测试进 CI。

### V4 CI 超时与墙钟【S】

- `checks.yml` 每个作业加 `timeout-minutes`（按作业历史最长耗时的两倍取整）。
- 把 21.8 分钟的「lessons + review + engine」拆成两个作业。
- 记录 PR 墙钟，目标仍是 ≤ 15 分钟。
- 查布局分片偶发不出帧的根因：看门狗的兜底次数已经打进日志，攒几次 run 的数字再看。

**验收**：连续三个 PR 的墙钟都 ≤ 15 分钟，写进 `measured.json`。

---

## 4 · T：计算与看棋

三项训练内容都是**新分块**，不进主包（F1 的规矩）。

### T1 进阶课程第三部【L】

**依据**：v8-0-plan §6 推到 8.1，v8-1-plan §8 第 6 条再推到 8.2。现在 `lessons.js` 共 12 个 part、96 课，全是入门到中级。

**做什么**：

- 24 课，分两个 part：
  - **计算**：候选着、强制着优先、盘点对方的回答、算到安静局面为止；
  - **局面型**：好象与坏象、弱格与前哨、兵链的推进方向、何时换子。
- 每课 3–5 步，沿用现有课程格式；三语；和名局阅读一样放进分块。
- 每一步的「对」「错」都由引擎核对。沿用 T2 残局营的规矩：结论写进一份核对记录。

**验收**：

- 24 课全部在三种语言下走通（content-e2e）；
- 布局场景覆盖新 part；
- 主包增长 ≤ 2 KB（只有目录项和入口）。

### T2 可视化与计算专项【M–L，玩法需要你拍板】

**依据**：v8-0-plan §6、v8-1-plan §6。代码里还没有这项训练：6.0 的盲棋开关只是把棋子藏起来，不是一个训练模式。

**提议两个模式**（§8 第 2 条）：

1. **看 N 步后**：
   - 给一个题库局面，文字列出接下来的 N 步（N = 2 → 6，越做越长），棋盘不动；
   - 然后问一个问题：「现在谁能吃掉 e5 上的子？」或「白方下一步有将杀吗？走出来」；
   - 答案由 chess.js 推出，不需要引擎。
2. **盲走收官**：
   - 从题库里「一步杀 / 两步杀」的题开始；
   - 显示局面三秒后藏起棋子，你用坐标输入走法。

两个模式各有：

- 自己的评级（沿用 puzzle rating）；
- 记录进「我的」进度页；
- 答错的题进复习队列。

**验收**：

- 两种模式各有 e2e（含三语）；
- 题目生成是确定的，同一种子得到同一组题；
- 盲走模式可以全程只用键盘完成，读屏能读出题面。

### T3 名局猜着【M，计分规则需要你拍板】

**做什么**：

- 从 `classics.js` 的名局里选一方，每一步先让你猜，再显示实际着法；
- 计分：你的着和原着一样，满分；不一样，就按引擎给的胜率差扣分。评分口径复用复盘的分级（最佳、优秀、良好、失误……）；
- 引擎走定节点（与 8.0 B2 同口径），同一步每次给的分一样；
- 一盘结束时出一张卡：你和大师有几步一样、平均扣分、最大的一次偏差。

**验收**：

- 同一局同一种走法，两次计分相同；
- e2e 至少覆盖一整局名局（短局）。

### T4 开局书去掉 400 条上限【M】

**依据**：

- 开局书的线存在 localStorage 的档案头里，上限 `MAX_LINES = 400`（`repertoire.js:29`）；
- 按单着排期的卡片已经在 `chessboard.repertoire` 数据库里（8.1 T3）；
- 另有两条 T3 的已知限制：没有原生菜单项；「今天到期」只在重画时刷新。

**做什么**：

- 线的存储搬进 `chessboard.repertoire`，数据库版本升一级；
- 旧档案头里的线迁移过去之后保留一份，用于降级；
- 原生菜单加一项「开局书」；
- 「今天到期」每分钟检查一次，跨过午夜时刷新。

**验收**：

- 2,000 条线导入、复习、导出 PGN 再导回，逐节点相等；
- 8.1 的档案升级后什么都没丢；
- V3 的降级测试覆盖开局书。

### T5 长将与困子两种母题恢复【M】

**依据**：measured `motifPrecision` 中这两种的错误率是 12%，8.1 按规矩回退成只说子力得失。

**做什么**：

- 改 `motif.js` 的判定：
  - 长将要真的能重复（引擎确认，不只是连续将军）；
  - 困子要确认它所有的退路都会丢子。
- 用 `scripts/sample-motifs.mjs` 重新抽样（每种 ≥ 22 条），做 1,000,000 节点的深搜核对。

**验收**：两种的错误率都 ≤ 5% 才恢复；不到就维持回退，并在 §9 写明。

---

## 5 · F：地基

### F1 新内容一律分块；`trainer/puzzles.js` 拆分【S–M】

- 写成规矩，并由 test-chess 守住：**8.2 新增的训练内容和数据都不进主包**。主包相对 8.1.0 的增长上限是 10 KB（入口、界面键、调度）。
- `trainer/puzzles.js`（1,825 行）按玩法拆开：题库、冲刺与连胜、主题页。行为零改动，给 T2 的新模式留出位置。

**验收**：主包 ≤ 910,972 字节；拆分前后 trainer-e2e 全绿。

### F2 `src/main.zig` 拆分【M】

**依据**：

- `main.zig` 有 4,686 行；
- SDK 0.10.2 一发布就要升级，升级时要在它、`runner.zig`（分叉）、`build.zig`（手抄）三处对 diff；
- 0.8.0 出过手抄本漏文件的事故。

**做什么**：

1. 按职责拆成 `sync.zig`、`dialogs.zig`、`bridge.zig`、`menus.zig`，`main.zig` 只留入口与装配。
2. 给 `runner.zig` 和 `build.zig` 各写一份「与上游的差异」说明，并加一个脚本：拿上游的对应文件做 diff，只报告我们没登记过的差异。

**验收**：

- 62 个 Zig 测试照旧全过；
- 双平台打包自检全绿；
- 差异脚本在当前 SDK 上输出为空。

### F3 「经过这个局面」冷启动【M】

**依据**：v8-1-plan M4「没做的」：2,435 → 2,596 ms，没有变快。已知大头是启动时棋盘画布重复出帧，整局仍分页 `getAll`。

**做什么**：

- 先剖析：启动时出了几帧、为什么出这么多帧；
- 把重复出帧合并；
- 整局读取改为不排在帧后面。

**验收**：一万局时，从导航开始到「经过这个局面」可用 ≤ 1,500 ms（本机 headless Chromium，五次取中位数，不再取最快一次）。

### F4 整句模板【M】

**依据**：v8-0-plan §6 记了 25 处字符串拼接。这是做第四种语言的前提，8.1 没顺手做。

**做什么**：改成整句模板，并加一个静态守卫：界面文字不许用 `+` 拼接。

**验收**：守卫在当前代码上是绿的；把任何一处改回拼接，守卫当场红。

### F5 小项【S】

- 导出全部数据时，保存框弹出之前显示「正在准备…」（一万局约有几秒没有任何提示）。
- README「路线」补上 v8.1 链接；v8-1-plan §9「发布」补上标签提交号 `168acc2`。
- 阶梯顶一级：用 `ladder.yml` 把「强力+ → 不限档」补到 ≥ 300 盘，其余越界的台阶各补到 ≥ 200 盘（主要是 CI 时间）。不限档的定义不改，除非 §8 第 5 条另有决定。

---

## 6 · 这一版不做的

- **macOS 签名自动更新、签名与公证**：维持 8.1 的决定。如果改主意，前提是 SDK 带上 #465 修正，再加上证书。
- **透明标题栏**：阻塞在上游。
- **Windows 拖动区实验**：需要 Windows 真机，放进缩短后的真机路线里。
- **第二个引擎 worker 默认打开**：在 8 GB 的真机上量过内存再说。
- **多线程引擎、SQLite、Chess960、第四种语言**：这些是 9.0 的事。F4 只做第四种语言的前提。
- **同步推送、study 同步**：8.2 只核对拉取。

---

## 7 · 顺序与发布

| 里程碑 | 内容 | 说明 |
|---|---|---|
| **M1** | V2、V4、F1、F5、V1 第 1 步（调研），deps-inventory 的更正 | 先把 CI 和余量理顺，后面的内容都受益 |
| **M2** | T1、T2、T3 | 三项训练，各自分块，可以并行 |
| **M3** | T4、T5、F3、F4、V3 | 开局书存储迁移和降级测试放在同一个里程碑 |
| **M4** | V1 第 2–3 步、F2、收尾、8.2.0 | SDK 0.10.2 如果在此之前发布，升级也放进这里 |

每个里程碑的流程照 8.1：

1. 并行开发；
2. 对抗性评审，修正；
3. 合进开发分支，开 PR，跑 CI；
4. release 彩排（`rehearse=true`）绿了才合并；
5. 在 main 上正式发布。

---

## 8 · 需要你拍板的（2026-09-30 已定：「按照你的建议来」）

| # | 决定 |
|---|---|
| 1 | 版本号 8.2 |
| 2 | 「看 N 步后」和「盲走收官」两个模式都做 |
| 3 | Node 维持 24 |
| 4 | V1 用 SDK automation server 在 CI 上驱动打包后的应用 |
| 5 | a：不限档定义不改，只补盘数 |
| 6 | 名局猜着：和原着一样满分，否则按胜率差扣分 |
| 7 | 进阶课程第三部 24 课（计算 12、局面型 12） |
| 8 | V1 之后把剩下的真机清单缩成 30 分钟路线交给你；没人走过的条目不阻塞发布，照实写进发布说明 |

原来的问题：

1. **版本号 8.2**：同意吗？
2. **T2 的玩法**：「看 N 步后」和「盲走收官」两个模式都做？只做一个？还是你有别的想法？
3. **Node**：8.2 维持 24（受支持到 2028-04），还是 10-28 之后把 CI 换到 26、engines 保持 ≥ 24？
   - **建议维持 24**，9.0 或 8.3 再换。
4. **V1 用 SDK 的 automation server 在 CI 上驱动打包后的应用**：同意吗？这会在 macOS 与 Windows 的 CI 上多两个作业，每个大约 10 分钟。
5. **阶梯顶一级「不限档」**：
   - a. 定义不改，只补盘数（**建议**）；
   - b. 改为按节点搜。这样不再随机器快慢变强变弱，但在快机器上会比现在弱。
6. **T3 的计分**：「和原着一样满分，否则按胜率差扣分」可以吗？
7. **T1 课数**：24 课（计算 12、局面型 12）可以吗？
8. **真机**：V1 之后剩下的清单预计 30 分钟以内能走完。你能在 macOS 和 Windows 上各走一次吗？还是继续带着未记录的条目发布，照实写在发布说明里？

---

## 9 · 落地记录

（发布前补。）

### M1

#### M1 · V1 调研：SDK automation server 能不能在 CI 上驱动打包后的应用

**结论：能用，但只管得到原生那一半。**

- 它**不能**：在 WebView 里执行脚本、读 DOM、截 WebView 的图、应答原生对话框。
- 页面那一半（开局书数据库、冷启动预读、同步进度）仍然只能靠打包自检（`CHESS_SELFTEST`）。自检已经在两个平台的 runner 上跑绿。
- 所以第 2 步不是「换成 automation」，而是**两条通道合用**：
  - automation 从外面驱动：核菜单、注入菜单命令、调 `chess.*`、测主循环是否在转；
  - 自检场景在页面里做事，交回报告。
- §8 第 4 条照做，只是范围按下面收窄。

**证据（SDK v0.10.1 源码）**

- **协议是文件投递箱，不是 socket。**
  - `src/automation/protocol.zig`：`default_dir = ".zig-cache/native-sdk-automation"`，相对 app 的**当前目录**；命令排成 `command-<n>.txt`，最多 8 条，写方独占创建；`Action` 枚举就是全部动词。
  - `src/automation/server.zig`：`publish` 写 snapshot.txt / accessibility.txt / windows.txt；`takeCommand` 取最小序号并删掉文件，删除即确认；`publishBridgeResponse` 写 bridge-response.txt。
  - 分派在 `src/runtime/flow.zig` 的 `dispatchAutomationProtocolCommand`。
- **动词**：reload、wait、resize、screenshot、bridge、menu-command、shortcut、native-command、focus、profile、provenance、tray-action，以及 widget-*。widget-* 和 screenshot 只作用于 `gpu_surface` 画布视图，我们一个都没有。
- **`bridge <json>`** 以 origin `zero://inline` 走 `handleBridgeMessage`，和页面发起的请求是同一条路。
  - app.zon 的 `allowed_origins` 含 `zero://inline`，所以 `chess.*` 都能从外面调用。
  - 应答除了写进 bridge-response.txt，也会交给页面的 `window.zero._complete`。页面按 id 找不到就直接丢弃（`appkit_host.m` 的 `complete()`），没有副作用。
  - SDK 内置的 `native-sdk.command.*` 对这个 origin 返回 `permission_denied`（实测）。
- **`menu-command <id>`** 注入的平台事件就是真菜单发出的那个 `.menu_command`。
  - 路径：`dispatchCommand` → `main.zig` `onEvent` 的 `.command` 分支 → `emitWindowEvent("shortcut")` → 页面。
  - 唯一绕过的是 NSMenu 的按键匹配（⌘N 这类 key equivalent）。
- **snapshot 的内容**：
  - 头行 `ready=true protocol=0x… publisher_pid=…`；
  - 窗口；
  - WebView 视图，只有 `role="webview"`，没有 DOM；
  - app-menu 目录，每项带 command、key、modifiers。
- **SDK 自己写明做不到的**：`skill-data/automation/SKILL.md`「What automation cannot verify」列了 WebView 截图、任意 DOM 查询与点击、网络断言，并说「Do not use automation for exhaustive UI testing」。
- **原生对话框**：
  - macOS 是 `[NSOpenPanel runModal]` / `[NSSavePanel runModal]`（`appkit_host.m`），Windows 是 `IFileDialog::Show`（`webview2_host.cpp`），都是同步模态。
  - automation 没有对话框动词。面板是在我们的 bridge 处理函数里同步弹出的：就算模态循环里还有帧能重入、命令还能被取走，也没有任何动词能点「打开」或「取消」。
  - 所以对话框只能测它前后两段：命令注册、路径读写。面板本身留给人。**驱动脚本绝不能经 bridge 调 `chess.openPgn`，否则会把整次运行卡死。**
- **测「卡不卡」**：
  - `src/automation/watcher.zig` 起一个线程，每 5 ms 看一次队列；有命令就经平台线程安全的 `request_frame_fn` 要一帧（macOS 和 Windows 的 `root.zig` 都有），命令在这一帧被取走。
  - 所以**空命令 `wait` 的确认时延，就是主循环有没有在转**。这正是 R6「窗口不卡」从外面的量法。
- **CI 可行性**：
  - SDK 自己的 `.github/workflows/ci.yml` 在 `macos-14` 上跑 `zig build test-webview-smoke`（WKWebView + `-Dautomation=true` + bridge），证明 macOS runner 有 GUI 会话，automation 跑得通。
  - Windows 上 SDK 只在 wine 下跑画布冒烟，WebView2 + automation **没有先例**。不过 automation 是平台无关的 Zig（文件 IO 加 `request_frame_fn`），而我们 build-windows.yml 的自检已经证明 WebView2 窗口能在 windows runner 上起来。
- **发布包不能带 automation。** `-Dautomation` 是编译期开关，打开后应用会在当前目录建 `.zig-cache/`，并且任何能写这个目录的本地进程都能调 `chess.*`。
  - 所以 CI 测的是**同一份源码、同一清单、同一打包命令**出来的第二个二进制，不是逐字节的发布件。
  - 自检不一样，它测的就是发布件本身。

**本地实测（2026-09-30，Linux，Zig 0.16，SDK v0.10.1）**

- **null 平台构建**：`zig build -Dplatform=null -Dautomation=true` 通过。
  - null 平台只跑一帧就退出（`null_platform.zig` 的 `run`，`requested_frames = 1`），所以只能「启动前排好一条命令，退出后读结果」。
- **实测结果**：

  | 做了什么 | 结果 |
  |---|---|
  | 读 snapshot | `ready=true`，菜单 8 项与 app.zon 一致 |
  | `bridge chess.selftestMode` | `{"on":true}` |
  | `bridge chess.appdataPath` | 临时 HOME 下的路径 |
  | `bridge chess.openPgn` | null 平台没有对话框，返回 `{"error":"read_failed"}` |
  | `menu-command game.new` | 日志里出现 `platform.event menu_command` |
  | 连排两条命令 | 只取走一条（一帧一条） |

- **交叉编译**：`-Dautomation=true -Doptimize=ReleaseFast` 下，`aarch64-macos` 和 `x86_64-windows` 的 Zig 部分都编译通过。
  - 本机没有 macOS SDK，完整链接停在找框架那一步，和 automation 无关。另起了一份只编 object 的构建来验证，产物里有 `native-sdk-automation`。
  - 完整链接要在 runner 上做。
- **证明脚本 `scripts/automation-smoke.mjs`**：
  - `--null` 模式本地是绿的，四项 ready / menus / bridge / ack 都过；用不带 automation 的构建跑是红的（没有 snapshot）。
  - 活模式已经写好：等 ready、逐条发命令、发 20 次空命令测确认时延。它只能在 macOS / Windows runner 上跑，留给第 2 步。
  - 本地跑法写在脚本头注释里。

**R1–R19 归属**

| 条目 | 归属 | 怎么做 |
|---|---|---|
| R1、R2 | 人 | 看图标 |
| R3 | 人 | 看图标。可以顺手加一步 CI，只查 exe 里有没有图标资源 |
| R4、R4w | 人 | 标题栏与拖动区实验 |
| R5 | CI（部分） | 自检确认「允许联网同步」默认关；automation 驱动期间按 pid 查连接（macOS 用 `lsof -i -a -p`，Windows 用 `Get-NetTCPConnection -OwningProcess`）。WebView 的网络进程不在这个 pid 下，查不到 |
| R6 | CI | 假服务器慢速吐 100 局。自检场景在页面里发起同步，记下 rAF 最长间隔和「已取到 k」；automation 同时每 50 ms 发一次空命令测主循环。拖窗口这个动作本身不测 |
| R6a | CI | 假服务器记下请求：第二次要带 since；没有新局时要给出那句提示；Chess.com 只取上次以来的月份 |
| R7 | CI | 同 R6，换成 Chess.com 形状的假数据，其中放一局 Chess960，它必须被滤掉 |
| R8 | CI | 基址指到一个没人监听的端口 |
| R9 | CI | 假服务器回 404 |
| R10 | CI（真站） | Windows runner 上对 lichess.org 真取 max=3。HTTPS 加系统证书库只有真站能证明；V2 要求 runner 能出站。失败重试一次，仍失败只标黄、不挡发布 |
| R11 | CI | 假服务器回 429 |
| R12–R15 | CI 一半，面板留人 | CI 查两个原生文件命令已注册（自检的 `nativeIo` 已经在查）。再在自检模式下用测试缝把面板换成固定路径（中文目录、1 MB 以上、Windows 反斜杠、没写扩展名时补 .pgn），测读写这一半。留给人的是面板标题、取消、在 Finder / 资源管理器里选中、「最近使用」 |
| R16 | CI（面板除外） | 自检场景导入 1 MB 多局 PGN → 导出全部到固定路径 → 用新 profile 启动并导入 → 比对局数、开局书、残局进度 |
| R17 | CI | 自检加 repertoire 一项：第一次启动往 `chessboard.repertoire` 写一着，第二次启动读回，并且到期数大于 0。比对方式和现有的 `idb` 一样，靠两次启动 |
| R18 | CI（先只报数） | 第一次启动灌 300 局，第二次启动报告预读是否命中、列表首帧用了多久。runner 计时会抖，先只记录，连续三次绿之后再设门槛 |
| R19 | 人 | 60 fps 录屏逐帧看 |

- **CI 覆盖 11 条**：R5（部分）、R6、R6a、R7、R8、R9、R10、R11、R16、R17、R18，满足「至少 8 条」。
- **留给人的**：R1–R4w、R12–R15 的面板部分、R19，估计 20–25 分钟走完。
- **B 节菜单**：
  - automation 能核菜单目录，覆盖 B1 的「不是系统默认那一条」；
  - 能注入 `menu-command`，看页面有没有反应，覆盖 B2–B4 的命令路径；
  - 按键匹配（key equivalent）仍要人按一次。

**第 2 步设计**

1. **构建**：在 build-macos.yml / build-windows.yml 现有作业的自检之后加步骤，复用已有的 SDK checkout、node_modules 和 zig 缓存。
   - `zig build -Doptimize=ReleaseFast -Dautomation=true --prefix zig-out-auto`；
   - 再 `native package` 到 `dist-auto/`；
   - 这个产物不上传、不进 release。
2. **Zig 改动**（都小，都要单测；变量都只在 `CHESS_SELFTEST=1` 时生效，发布件的行为不变）：
   - **同步基址**：设了 `CHESS_SYNC_BASE=http://127.0.0.1:<port>` 时，`lichessUrl` / `chesscomArchivesUrl` 换掉 host 前缀。
   - **对话框**：设了 `CHESS_DIALOG_PATH` 时，`openPgn` / `saveText` 跳过面板，直接用这个路径。
   - **报告不退出**：`selftestReport` 现在写完就 `exit`。改成设了 `CHESS_SELFTEST_SCENARIO` 时写完不退出，由驱动脚本自己结束进程，这样同一次运行里还能继续发命令。
3. **页面**：新建模块 `selftest-scenarios.js` 跑命名场景。场景名由 `chess.selftestMode` 的应答带过来。app.js 已经到行数上限，只在 `runSelftest` 里留一个钩子。
   - 场景：`sync-lichess`、`sync-chesscom`、`sync-errors`、`repertoire`、`prefetch-seed` / `prefetch-read`、`data-roundtrip`、`menus`；
   - `menus` 场景：收到 shortcut 事件后报告局面变化。
4. **脚本**：`scripts/automation-smoke.mjs` 加 `--scenario`。
   - 起一个假服务器（node:http，读 `src/sync-fixtures/`，每局间隔 100 ms 慢慢吐；记下收到的请求；能回 404 / 429）；
   - 每个场景：启动 automation 构建 → 等 ready → 核菜单 → 同步进行时每 50 ms 发一次 `wait` 记确认时延 → 读页面报告 → 杀进程；
   - 要验证重启的场景，用同一个 profile 再起一次。
5. **判定**：
   - 主循环确认时延最长小于 500 ms；
   - 页面 rAF 最长间隔小于 250 ms；
   - k 单调增到 100；
   - 每个错误场景的提示文案都对。

   两个阈值要先拿两次 runner 实测记进本节，再定。
6. **耗时估计**：每个平台多 6–9 分钟，和 §8 第 4 条估的 10 分钟一致，建议 `timeout-minutes: 20`（V4）。
   - automation 构建和现有 ReleaseFast 构建同量级；
   - 打包不到 1 分钟；
   - 约 8 次启动，每次 10–20 s。
7. **风险与顺序**：Windows 上 WebView2 + automation 没有先例。第一轮只跑 `automation-smoke.mjs` 活模式，两个平台都绿了再加场景。
8. **不做**：
   - WebView 截图或 DOM：SDK 不支持。
   - 让面板自动应答：macOS 要辅助功能授权；Windows 的 UI Automation 可能可行，但没验证。而且做成了，多测到的也只是面板本身。
