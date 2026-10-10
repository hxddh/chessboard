# 国际象棋 Chessboard

国际象棋桌面应用 —— Native SDK WebView + Canvas，支持 macOS 与 Windows，**GPLv3**。从零基础课程、谜题、残局到和 Stockfish 下棋、复盘、管理自己的棋谱，都在一块棋盘上。

## 下载

[Releases](https://github.com/hxddh/chessboard/releases) 页任选：

| 平台 | 产物 | 说明 |
|------|------|------|
| macOS（Apple Silicon） | **Chessboard-macOS-arm64.zip** | 解压得到 `Chessboard.app`，把它拖进「应用程序」（或 `mv Chessboard.app ~/Applications/`）再打开；首次右键「打开」过 Gatekeeper |
| Windows（x64） | **Chessboard-Windows-x64.zip** | 解压后双击 `Chessboard\bin\chessboard.exe`，从哪个目录启动都可以；解压到 `Program Files` 这类写不进去的文件夹也能打开。需 WebView2 运行时（Win10/11 一般预装） |

## 9.0.0 改了什么

**功能几乎没加，界面重新收拾了一遍。** 8.x 一路加下来的东西都还在，但设置散在四处、新局有七个入口、谜题一屏二十个按钮。9.0 把它们收成五个去处和一处设置，每件事只有一个家。

**不兼容 8.x 的存档。** 9.0 的存档换了新的格式（SCHEMA 3）和新的存储位置，不读 8.x 的档案，也不迁移：装上 9.0 后，战绩、谜题与课程进度、棋谱库、开局书、复习队列都从零开始；8.x 用「导出全部数据」存下的文件，9.0 也不认。8.x 里为旧版本留的兼容代码、旧题库分块（约 1.5 MB）一并删掉了。

**五个去处 + 设置。** 左侧图标栏（窄窗口是顶部一行）只有今天、下棋、训练、棋谱、我的，外加齿轮「设置」，名字处处一致；原生菜单「前往」里也是这五个（⌘1–5 / Ctrl+1–5），「设置…」是 ⌘, / Ctrl+,。学习和谜题合成「训练」；对局历史从「我的」挪到「棋谱」。

**一处设置。** 原来的偏好设置窗口、侧栏的「设置」页签都没了，换成一个设置页，左侧六类：通用、棋盘、声音、对局、数据、高级。「这一局」的选择（对手、执子、棋钟）只在新对局对话框里，下次会记住。

**新对局一屏放下。** 当前档位附近的 8 张对手卡、4 个常用棋钟（无棋钟 / 5 / 10 / 15+10）和执子；展开「更多选项」看全部 21 位，4 种陪练风格、其余棋钟和自定义也在里面。

**设计语言 v2。** 4 种按钮、两层不透明表面、两级标题、6 档字号、每套主题一个强调色；虚线框和框中框全部去掉。打包了 Inter（OFL）作为 Latin 字体，排在中日文字体之前，中英混排不再一边粗一边细。界面上不再出现「UCI_Elo」「MultiPV」「置换表」这类实现细节；最强一档叫「全力」，评级统一叫「对局等级分」「谜题等级分」。

**棋盘是主角。** ☰ 并进棋盘上方的玩家栏，宽窗口不再留一条空顶栏，棋盘更大；学习、谜题页也有这条栏（写课名或题目的等级分）。**终局不再盖住棋盘**：结果改成棋盘下沿的结果条（宽窗口在棋盘旁一栏），写比分、原因和等级分变化，「复盘这局 / 再来一盘」就在条上；这一局解锁的成就是条上的小徽章，不再弹 toast。

**复盘分两层。** 先是一句总结和关键时刻，每个都能在棋盘上再试一次；精准度、分级表、胜率曲线组成的完整报告收在后面，要看再展开。

**窄窗口能下棋了。** 宽度 ≤ 900 时棋盘在上、抽屉在下，抽屉三档吸附：收起 / 一半 / 九成，拖把手或点一下切换；760 宽也能看全 64 格。

计划、依据与落地记录见 [docs/v9-0-plan.md](docs/v9-0-plan.md)；更早各版「改了什么」在 [docs/CHANGELOG.md](docs/CHANGELOG.md)。

## 怎么玩（v9.0）

### 今天

应用打开就在这一页。最上面是**一件接下来最该做的事**，画在一块小棋盘上：没下完的对局、到期的复习、下一课……点「开始」就进去，「换一件事」换下一件。旁边是今天的三项进度（一课、五题、一盘）和连续练习的天数；下面「继续」写着上次停在哪一课、哪个残局、哪一局名局，点一下回到那里；再往下是最近四盘对局（每盘带等级分变化，可直接复盘）和两个等级分的曲线。全新安装时先问一句「我是新手，从零开始学 / 我会下棋，直接开局」。

### 下棋

和 **Stockfish 19** 下，或者双人同屏。**N**（菜单 ⌘N / Ctrl+N）开新对局对话框：选对手、棋钟、执子。对手是一条 21 档的阶梯，每档一个有名字、头像和开场白的角色，分数和卡片上写的一致；「更多选项」里还有陪练风格（标准 / 贪吃子 / 重原则 / 爱进攻）、3+2、5+3、30 分钟与自定义棋钟（含增秒）。点击或拖拽走子，键盘也能下（Tab 聚焦棋盘，方向键移动、回车落子）。**Z** 悔棋、**H** 提示（⌘⇧H）、**F** 翻转（⌘F）、← → / Home / End 在棋谱里走（⌘[ ⌘]）、**P** 开合侧栏（`⌘\`）。侧栏只有一页：棋谱、复盘、本局操作；底部工具行固定五格（开局浏览器、复制、导出……其余在「更多」）。开局名称跟着棋盘显示（内置 **195 条** ECO 库）。和棋按 FIDE：三次重复与 50 回合可声明，五次重复与 75 回合自动判和。下完棋的结果条上点「复盘这局」，或侧栏里点「分析」（精析在它的 ⋯ 里）：先看总结与关键时刻，再展开完整报告；任意一手可以「从这里续下」。

### 训练

学习和谜题合在这里，顶上四段：

- **课程**：**零基础 120 课**，按单元成卡、显示进度 —— 从认识棋盘、六种棋子、将死与和棋，到杀型、开局、中局思路、残局，再到中级的战术组合、典型残局、兵型与计划，以及进阶第三部的计算与局面型。课上走错两次自动标出答案，**R** 重来，**H** 看提示。
- **谜题**：一个主按钮「为你出一题」，按你的复习欠账和错误率挑；下面按类做题，六类：杀棋、战术、残局、防守、开局、我的错题 —— 手写的战术题库 168 题、开局线路 119 条、引擎自弈挖出 980 题和 Lichess 的 4 万题按类合在一起，「下一题」找最接近你谜题等级分的那道；「按主题细分」里还有 28 个主题。开局类里，内置的开局题执白照谱背 **119 条**主流线路，每条附思路讲解；你自己开局书里的线（执白执黑都行）也归在这一类。「复习」写明到期几道；「挑战」是冲刺（3 分钟，错 3 题出局）和连胜；「专项」是看 N 步和盲走。**N** 下一题，**H** 看答案。
- **残局**：8.x 学习目录里排在名局之后的 90 个标准残局(王兵 16 / 车 22 / 轻子 22 / 后 18 / 理论和棋 12)，现在单独成段；每个一个目标（取胜或守和），和「全力」引擎下到出结果，走错的进复习。
- **名局**：40 局名局，「读谱 / 猜着」是一个开关 —— 读谱一步一步带注释；猜着是每一步先猜大师走什么，再按引擎算出的胜率差打分。

### 棋谱

你从外面带进来的棋都在这里。**棋谱库**：「导入到库」收下一份 PGN 里的每一局（上限 1 万局，重复导入不翻倍），填上你在棋谱里的名字才认领；「从网站同步」取 Lichess 或 Chess.com 的对局（默认关，要先在设置·数据里允许联网，只发送用户名）；攒够二十局分析后「看诊断」告诉你开局、中局、残局哪一段最该练。列表默认只露搜索，来源、日期、用时、局面等在「筛选」里。**对局历史**：本机下过的棋，点一局就回到棋盘。**我的开局书**：导入执白 / 执黑的带变着 PGN，「开始背」、复习到期的着（菜单 ⌘⇧O / Ctrl+Shift+O）。**开局浏览器**：当前局面每一种走法的局数和胜负，来源可切「棋谱库」或内置的「大师」。

### 我的

你自己的记录：统计、做题战绩、进步、练习日历、对局等级分曲线、跨局指标（化优为胜、逆境求生、时间紧时的失误率）、残局训练营的进度，以及 15 枚成就。全新安装时这一页是一张入口卡片：上第 1 课、做一道战术题、和引擎下一局。

### 设置

齿轮、⌘, / Ctrl+, 或菜单「设置…」，一处管全部。**通用**：语言（中文 / English / 日本語，1381 个界面键三语齐备）、外观（跟随系统 / 浅色 / 深色）、字号。**棋盘**：五种棋盘、边框、七套棋子、坐标、方向、盲棋。**声音**：音效、音量、音色（木质 / 经典）。**对局**：失着提醒、自动翻转。**数据**：从网站同步、学习数据与全部数据的导入导出、清除。**高级**：引擎内存、分析线数、持续分析、引擎箭头、存疑标注。

**?**（⌘/ / Ctrl+/）随时打开完整的快捷键表；任何对话框打开时，棋局的字母快捷键全部让路，Esc 一定关得掉。macOS 上关窗只是收起，⌘Q 退出；Windows 关窗就是退出。

## 规则引擎

局面合法性由 vendored [chess.js](https://github.com/jhlywa/chess.js) 0.13.4（BSD-2-Clause）判定——
不自研规则。`src/web/js/chess.js` 顶部注明了从 ESM 到经典脚本的机械转换（zero:// 方案下 WebView
只验证过经典脚本加载）。

chess.js 之上,`js/fide.js` 补齐它不做的比赛规则判定：三次重复与 50 回合是**可声明**和棋（art.
9.2/9.3）而非自动结束,五次重复 / 75 回合才自动判和（art. 9.6）；超时是否算输由「能否将杀」而非
子力数量决定（art. 6.9）。复盘分析对每个局面用的是**同一套判定**而不是 chess.js 的 `game_over()` ——
后者在三次重复和 50 回合就返回 true，照它记分会把还能继续的局面一律记 0，把局势曲线拉到轴上，
并且带偏其后每一步的失误分类与准确率。重复计数比较的是**可走着法**而不是 FEN —— FEN 只要有兵走两格就写上吃
过路兵格,哪怕没有兵能吃,直接比字符串会把同一个局面算成两个（`1.e4 e5 2.Nf3 Nf6 3.Ng1 Ng8
4.Nf3 Nf6 5.Ng1 Ng8` 就会漏判）,因此只有真正存在合法吃过路兵时才保留该权利。

## 对弈引擎

[Stockfish.js](https://github.com/nmrugg/stockfish.js) 19 lite-single（GPLv3，单线程 + lite NNUE，
wasm 1.79 MB），vendored 于 `third_party/stockfish/`。zero:// 方案不能加载 worker 脚本也不能 fetch 打包
文件，因此构建时由 `scripts/gen-engine-src.mjs` 把 loader 文本与 wasm base64 生成为
`engine-src.js` 全局量，运行时 `engine.js` 用 Blob worker + `postMessage` 传 wasm 启动引擎——
全程零 URL 解析。页面 CSP 的 `script-src` 带 `'wasm-unsafe-eval'`：blob worker 继承这份策略，没有它 WebView2 与 WKWebView 都拒绝编译 wasm（由 `test-engine-e2e` 守着）。

21 档对手里，中间各档用 UCI `UCI_LimitStrength/UCI_Elo`（1320–3190）限强，最上面几档按节点数满强度搜索，「全力」不限强。
最下面的「新手」和「休闲」等手工削弱档不靠 UCI 选项：Stockfish 的 `UCI_Elo` 下限是 1320，比真正的初学者高得多，
而实测 Skill Level 1 仍有约 27 ACPL。所以这几档改为**浅层 MultiPV 搜索 + 候选抽样**
（会主动取差着，但绝不放弃已算出的杀棋），靠 `worstBias` 调档：新手 0.15、休闲 0.12 且候选更少（8 个 vs 10 个）。
界面上不写这些名词，只写对手名和一个分数。

强度不用 ACPL 背书 —— ACPL 说不清「初学者赢不赢得了」。`scripts/test-novice.mjs` 直接对下：
一个只会「不一步送子」的随机机器人，100 盘对新手得分率 **56%**、对休闲 **41%**，对再往上的四档依次 30% / 12% / 8% / 4%，对 1320 一档几乎为零（5 轮 × 20 盘；一场 20 盘的样本标准差：新手 11.2、休闲 9.6）。
这些数与各档的平均失分都来自 [`docs/measured.json`](docs/measured.json)，由
`node scripts/test-novice.mjs --record` / `test-strength.mjs --record` 写入；单测校验本文与
`engine.js` 的注释引用的是同一份数，`test-novice.mjs` 的判定区间必须等于记录里的均值 ±3σ —— 重测过却没改区间，会当场红。
`scripts/test-strength.mjs` 另按满强度评估量每档的平均失分。抽样走固定种子，但参照评估是按时间搜的，所以**它逐位复现不了**——
断言因此写成带容差的「档位之间不许实质倒挂」加各档绝对上下限，而不是两个噪声均值之比。

## 路线

9.0 的计划、依据与落地记录在 [docs/v9-0-plan.md](docs/v9-0-plan.md)；更早各版的计划也在 `docs/` 里（`v6-plan.md` … `v8-4-plan.md`），逐条写着做到了什么、没做到什么。

接下来：

- **Node 26**：10-28 进 LTS 后 CI 换到 26，`engines` 仍是 ≥ 24。
- **10.0 / 以后**：原来写给 9.0 的技术项 —— 换引擎形态、SQLite、SDK 1.0、Chess960、第四种界面语言；另有命令面板（⌘K）与首启定级问卷。
- **跨版本还没做的**：签名与公证、msix、`.updates` 签名自动更新（都缺证书或密钥）；macOS 透明标题栏（等 SDK）；残局训练营里 8 子的「三兵突破」超出任何残局表，只能用 Stockfish 核对；评估条的数字仍在条外（棋盘左边放不下）。

真机走查的清单在 [docs/manual-check.md](docs/manual-check.md)。

## 开发

前置条件（`package.sh` 只面向 macOS，其余脚本跨平台）：

| 需要 | 用来做什么 | 没有会怎样 |
|------|-----------|-----------|
| Node 24+ | 跑 `scripts/` 下的全部检查与代码生成 | 什么都跑不了 |
| `npm ci`（唯一依赖:esbuild） | 把 `src/web/js` 的 ES 模块打成 `js/bundle.js` | 页面加载不出来:index.html 只加载这一个脚本 |
| Zig 0.16.0 | 编译 `src/*.zig`（`package.sh` 从 `~/.native/toolchains/zig-0.16.0` 找） | 只能改前端，编译不了 |
| Native SDK CLI（`@native-sdk/cli`） | `native package` 打出 `.app` / `.exe` | 编译得出二进制，打不出安装包 |
| Playwright + Chromium / WebKit | `test:e2e` 里的浏览器 E2E（两个引擎各跑一遍）| 各自打印「跳过」并通过；发布流水线设 `E2E_REQUIRED=1`，那里跳过即失败 |

```bash
cd ~/chessboard
# macOS 专用:同步 frontend → 单测 → 浏览器检查 → 编译 → 打包 → 安装到 ~/Applications
./scripts/package.sh

# 不依赖 Zig / SDK 的部分,任何平台都能跑
npm test                           # = test:static + test:e2e,对应 CI 的 static 与 browser 两个 job(CI 另有 zig)
npm run build                      # 打包:src/web/js 下的 ES 模块 → js/bundle.js(生成物,不进 git)
npm run test:static                # 单测 + 清单,秒级(测试自己会按需构建)
npm run test:e2e                   # 浏览器 E2E(缺 Playwright 则逐个跳过)
npm run test:engine                # 引擎检查:开局/战术/新手档/强度/分析/挖题/母题,分钟级,不在 npm test 里
npm run shots                      # 全量截图(四种宽度、各主题、三语),改界面前后对照用

# 或者逐个跑
node scripts/test-chess.mjs        # 单测:规则、纯函数、内容、各种源码守卫(含本文引用的数字)
node scripts/manifest-check.mjs    # 清单声明的键 runner 真的在读 + 版本号一致
node scripts/test-layout-e2e.mjs   # 版式:从真实盒模型量截断、横滚、等宽、对齐、棋盘不被盖住
node scripts/test-engine-e2e.mjs   # 真启动 Stockfish:引擎起不起得来(其余都把引擎换成空桩)
node scripts/test-engine-flows-e2e.mjs  # 真 Stockfish 走一遍要引擎的功能:人机、提示、失着提醒、分析、棋谱库、教学对练
```

自动化够不到的那一半 —— 原生菜单、文件桥、窗口行为、真机三语 —— 在
[`docs/manual-check.md`](docs/manual-check.md)。

```
src/web/
  index.html · styles.css          # 样式按 docs/design-constraints.md 的设计语言 v2
  fonts/                           # Inter(OFL)Latin 可变子集 + 许可全文
  js/chess.js      # 规则（vendored chess.js 0.13.4, BSD-2-Clause）
  js/pieces-cburnett.js # 默认棋子:Colin Burnett 原版 cburnett（GPLv2+,见下）,随主包
  js/pieces.js     # 「经典」棋子:cburnett 的 Wikimedia 重绘版（多重许可,见下）;棋谱里的小棋子图形也取自它
  js/pieces-merida.js · pieces-chessnut.js · pieces-fantasy.js · pieces-celtic.js · pieces-spatial.js
                   # 其余五套棋子,各自一个按需加载的分块(许可见下；设置 → 棋盘 → 棋子)
  js/look.js       # 外观 × 棋盘 × 边框 × 棋子四个维度(纯函数)
  js/today-page.js # 「今天」页;主卡在 js/trainer/today.js,小棋盘在 js/mini-board.js
  js/me-page.js    # 「我的」页
  js/openings.js   # 主流开局 ECO 库（SAN 前缀匹配,单测校验合法性）
  js/lessons.js    # 教学课程 96 课:零基础 72 + 中级 24（单测逐课校验 FEN/解法/目标）
  js/lessons-adv.js # 进阶课程第三部 24 课:计算 12 + 局面型 12(连同 lessons-adv-en/ja.js 一起是按需分块
                   #   chunk-lessons-adv.js);每步的对错由 scripts/verify-lessons.mjs 问引擎,
                   #   记录在 docs/lessons-verified.json
  js/endgames.js   # 残局训练营 90 个局面与三语文字(按需分块 chunk-endgames.js);判定在 js/endgame-rules.js,
                   #   外壳在 js/trainer/endgames.js;结论的核对记录 docs/endgames-verified.json
  js/classics.js · classics-more.js # 名局 40 局(读谱与猜着共用);出处见 docs/classics-sources.md
  js/puzzles.js    # 题库 168 题:杀王/吃子/战术母题(求解器证明强制)/实战/防守/求和,另 119 条开局线路
  js/puzzles-mined.js # 引擎自弈挖出的题(scripts/mine-puzzles.mjs 生成;过同一套求解器门禁并经引擎复核)
  js/puzzle-db.js  # Lichess 题库:主包只带 js/puzzles-lc-index.js 的计数索引,题目按 200 分一段
                   #   各一个按需加载的分块(js/lichess/band-NNNN.js → chunk-lc-NNNN.js)
  js/fide.js       # FIDE 和棋算术:重复计数 / 6.9 将杀子力判定 / 局面是否已终局(纯函数,单测覆盖)
  js/pgn.js        # PGN 文本工具:多局切分 / 标签 / 摘要 / 起始局面(纯函数,单测覆盖)
  js/i18n.js       # 界面文案字典 zh-CN / en / ja 各 1381 条(单测校验键完整、无漏译、
                   #   tooltip 与 aria-label 全接线;句子一律整句模板 tf(),不拼碎片)
  js/lessons-en.js # 教学课文英文全译 96 课(仅文案;局面与解法仍只来自 lessons.js)
  js/library*.js   # 棋谱库:模型(library.js)、查询与索引、IndexedDB、列表页与本机棋局
  js/repertoire*.js # 我的开局书
  js/review.js     # 对局回顾:准确率/失误分布/关键时刻(纯函数,单测覆盖);js/review/ 是界面
  js/srs.js        # 错题间隔重复:连续两次干净解出才毕业(纯函数,单测覆盖)
  js/engine.js     # Stockfish Blob worker 管理 + 难度分档
  js/engine-src.js # 生成物（gitignored）：loader 文本 + wasm base64
  js/host.js · persist.js # Native / localStorage 门面与存档(SCHEMA 3)
  js/board.js      # 棋盘 Canvas 渲染 + 命中测试
  js/audio.js      # 音效：两套（木质 / 经典），一个接口
  js/native-commands.js # 快捷键表与原生菜单命令(单测与 app.zon 对照)
  js/app.js        # UI 编排(bundle 的入口:import 图从这里出发)
  js/bundle.js     # 生成物（gitignored）：以上 ES 模块打成的单个经典脚本
  js/chunk-*.js    # 生成物：按需分块 —— ECO 表、英/日文、挖掘题、棋子、Lichess 题段……
src/*.zig          # 原生壳:菜单、对话框、存档桥、同步、窗口位置
assets/            # 应用图标(骑士标,assets/logo.svg 为源)
third_party/stockfish/   # Stockfish.js 19 lite-single（GPLv3）
```

## 许可

GPLv3（见 LICENSE）。vendored chess.js 保留其 BSD-2-Clause 版权头；vendored Stockfish.js
为 GPLv3（`third_party/stockfish/COPYING.txt`）；界面的 Latin 字体 Inter 为 SIL Open Font License 1.1（`src/web/fonts/Inter-OFL.txt`，安装包里是 `licenses/Inter-OFL.txt`）；棋子矢量图形共七套，逐套核过许可，应用内「关于」面板列的是同样的作者与许可：

- **cburnett（默认，`js/pieces-cburnett.js`）**：作者 Colin M.L. Burnett，原样取自 lichess-org/lila 的 `public/piece/cburnett`，该仓库 COPYING.md 列其许可为 GPLv2+，本应用按 GPLv3 使用。
- **经典（`js/pieces.js`）**：同一套设计的 Wikimedia Commons 重绘版（作者 Cburnett / Rfc1394，经 cm-chessboard 整理）。原作以 GFDL / BSD / **GPL** / CC BY-SA 3.0 多重许可发布；本仓库按其中的 GPL 一项使用，与本应用的 GPLv3 相容（CC BY-SA 3.0 单独一项并不与 GPLv3 相容，4.0 才加入单向相容，所以写清楚取的是哪一项）。
- **Merida（`js/pieces-merida.js`）**：作者 Armando Hernandez Marroquin，原样取自 lila 的 `public/piece/merida`，COPYING.md 列为 GPLv2+。
- **Chessnut（`js/pieces-chessnut.js`）**：作者 Alexis Luengas，原样取自 lila 的 `public/piece/chessnut`；COPYING.md 列为 Apache 2.0，作者自己的仓库（LexLuengas/chessnut-pieces 的 LICENSE.txt）是同一份 Apache 2.0 全文。Apache 2.0 与 GPLv3 相容。
- **Fantasy / Celtic / Spatial（`js/pieces-fantasy.js` · `js/pieces-celtic.js` · `js/pieces-spatial.js`）**：作者 Maurizio Monge，原样取自 lila 的 `public/piece/{fantasy,celtic,spatial}`；COPYING.md 列为 MIT，作者仓库（maurimo/chess-art）的 LICENSE 是 MIT 全文，README 要求注明作者 —— 「关于」面板写了。MIT 与 GPLv3 相容。

同一张表里其余候选没有收：CC BY-NC-SA（限非商业，与 GPL 不相容）、「freeware」、AGPL 的不收；mpchess（表中写 GPLv3+，作者仓库却是 LPPL 1.3c）、shapes 与 Firi（作者仓库里没有许可文件，只有 lila 表里的一行）三套，来源与表不一致或无法从来源核实，也不收。

题库数据：`js/puzzles-lc-index.js` 与 `js/lichess/band-*.js` 由 `scripts/import-puzzles.mjs` 从 [Lichess 题库](https://database.lichess.org/#puzzles)（lichess.org 开放数据库，**CC0 1.0** 公有领域贡献）抽样生成：局面、解法、评级无许可义务，每题的 id 就是 Lichess 题号（`lichess.org/training/<id>`），在此致谢。原始的 `.csv.zst` 不进仓库；导入命令是 `node scripts/import-puzzles.mjs <本地路径>.csv.zst`（或已解压的 `.csv`）。
