# 国际象棋 Chessboard

国际象棋桌面应用 —— Native SDK WebView + Canvas，支持 macOS 与 Windows，**GPLv3**。从零基础课程、谜题、残局到和 Stockfish 下棋、复盘、管理自己的棋谱，都在一块棋盘上。

## 下载

[Releases](https://github.com/hxddh/chessboard/releases) 页任选：

| 平台 | 产物 | 说明 |
|------|------|------|
| macOS（Apple Silicon） | **Chessboard-macOS-arm64.zip** | 解压得到 `Chessboard.app`，把它拖进「应用程序」（或 `mv Chessboard.app ~/Applications/`）再打开；首次右键「打开」过 Gatekeeper |
| Windows（x64） | **Chessboard-Windows-x64.zip** | 解压后双击 `Chessboard\bin\chessboard.exe`，从哪个目录启动都可以；解压到 `Program Files` 这类写不进去的文件夹也能打开。需 WebView2 运行时（Win10/11 一般预装） |

## 15.0.0 改了什么

**同样的事，少几个按钮、少几句话，叫法只有一种。** 14.0 修好了走查里的毛病；15.0 不加功能，把每一屏收拾干净：一屏一个主按钮，下棋时只露下棋用得着的，同一件事处处一个名字，收起面板也知道下一步做什么，启动和首屏再快一截。

**叫法只有一种。** 三种语言一起改，一共 80 条：引擎把下完的棋过一遍叫「复盘」，更细的那一遍是「精细复盘」，棋盘上实时的线叫「实时引擎」；开一盘新棋处处叫「新对局」，结束后叫「再来一盘」；同一个局面从头来叫「重来」，从这一手再试叫「再试一次」。「分析」「精析」「下一盘」「重做」这些说法不再出现（一条测试守着）。

**一屏一个主按钮。** 每个画面最多一个实心按钮：今天是「今天的训练」，棋谱是「导入」。今天页右上的三个按钮（复盘一局、为你出一题、新对局）收进一个 ⋯。下棋时面板只剩四个步进、提和、认输、复盘和 ⋯：「新对局」在对局中不出现（N 和 ⌘K 照旧），复制 PGN、导出 PGN、开局浏览器进 ⋯。双人对局下着时也不露复盘那一组。被收起的入口 ⌘K 都找得到。课名只在棋盘上方说一次。

**收起面板也有下一步。** 上课、做题、残局、名局猜着时把面板收起，棋盘下方是一条和对局结束时一个样子的结果条：这一步要做什么、走得对不对，以及一个实心的下一步（下一课、下一题；走错了还没解开时是「看提示」）。原来棋盘上方那行小字没了，上课时的棋盘和下棋一样大。提示在窗口有空的时候放在棋盘右下角，不再压着棋盘上下的那两条。

**少几句话。** 课文第一次展开，走过第一步就收起，留一个「说明」；复盘图例改成曲线的悬停提示；成就页只露离下一枚最近的那一个，15 枚收在下面。

**构图。** 新对局对话框：「更多选项」打开时 21 位对手按强度排成六行头像（新手、入门、进阶、中级、高级、最强），选中的那位写在下面；900 高的窗口全部展开不用滚动。开局前的对手卡在执子或棋钟不是默认时写出「执黑 · 10」。今天页「接下来」的字在小棋盘旁居中，没有对局时用和别处一样的空状态。回合编号的对比度到 4.5 : 1 以上。

**更快。** 首屏包 888,759 → 859,640 字节：开局的中文「思路」、中文开局家族与变例名移到用的时候才取的文件，走子列表那套棋子图精简了写法（看起来一样）。启动拆成两段：首帧之后最长的一段，今天页 142 → 87 ms、下棋 116 → 59 ms。

**工程。** CI 换到 Node 26；`app.js` 5,186 → 4,849 行（提示与确认框、训练条各自成文件）。

**存档**：读 14.0 的档案，格式没变。

计划、依据与落地记录见 [docs/v15-0-plan.md](docs/v15-0-plan.md)；更早各版「改了什么」在 [docs/CHANGELOG.md](docs/CHANGELOG.md)。

## 怎么玩（v15.0）

### 今天

应用打开就在这一页。最上面是**一件接下来最该做的事**，画在一块小棋盘上：没下完的对局、到期的复习、下一课……点「开始」就进去，「换一件事」换下一件。右上角 ⋯ 里是「复盘一局」「为你出一题」和「新对局」（直接和上次的对手开局）。旁边是今天的三项进度（一课、五题、一盘）和连续练习的天数；下面「继续」写着上次停在哪一课、哪个残局、哪一局名局，点一下回到那里；再往下是最近四盘对局（每盘带等级分变化，可直接复盘）和两个等级分的曲线。「接下来」下面是**本周重点**（棋谱库攒够二十局复盘才有）。「复盘一局」把别处下的棋直接带进复盘。全新安装时先问一句：没下过棋 / 会走子 / 常下棋，后两档做 6 道定级题。

### 下棋

和电脑下（中间七档是 **Maia**，其余是 **Stockfish 19**），或者双人同屏。**N**（菜单 ⌘N / Ctrl+N）开新对局对话框：选对手、棋钟、执子。对手是一条 21 档的阶梯，每档一个有名字、头像和开场白的角色，分数和卡片上写的一致；「更多选项」里还有陪练风格（标准 / 贪吃子 / 重原则 / 爱进攻）、3+2、5+3、30 分钟与自定义棋钟（含增秒）。点击或拖拽走子，键盘也能下（Tab 聚焦棋盘，方向键移动、回车落子）。**Z** 悔棋、**H** 提示（⌘⇧H）、**F** 翻转（⌘F）、← → / Home / End 在棋谱里走（⌘[ ⌘]）、**P** 开合侧栏（`⌘\`）。侧栏只有一页：开局前是对手卡（头像、名字、档位、战绩），下棋时只有棋谱、四个步进、提和、认输、复盘和 ⋯（复制 / 导出 PGN、开局浏览器在 ⋯ 里），结束后是复盘。开局名称跟着棋盘显示（内置 **195 条** ECO 库）。和棋按 FIDE：三次重复与 50 回合可声明，五次重复与 75 回合自动判和。下完棋的结果条上点「复盘这局」（复盘完停在你最重的那一手），或侧栏里点「复盘」（精细复盘在它的 ⋯ 里）：先看总结与关键时刻，再展开完整报告；任意一手可以「从这里续下」。复盘里写着开局在哪一步离开了你的开局书。**空白棋盘**（复盘一局里，或 ⌘K）：双方都由你走、引擎三条线，不计入战绩。

### 训练

学习和谜题合在这里，顶上四段：

- **课程**：**零基础 120 课**，按单元成卡、显示进度 —— 从认识棋盘、六种棋子、将死与和棋，到杀型、开局、中局思路、残局，再到中级的战术组合、典型残局、兵型与计划，以及进阶第三部的计算与局面型。课上走错两次自动标出答案，**R** 重来，**H** 看提示。课文走过第一步就收起，「说明」再打开；收起面板时，棋盘下方的条写着这一步要做什么和下一课。
- **谜题**：一个主按钮「为你出一题」，按你的复习欠账和错误率挑，旁边是复习；其余收在「更多练法」里：按类做题，六类：杀棋、战术、残局、防守、开局、我的错题（你自己对局里的 ? 和 ??，复盘后自动收进来、排进复习）—— 手写的战术题库 168 题、开局线路 119 条、引擎自弈挖出 980 题和 Lichess 的 4 万题按类合在一起，「下一题」找最接近你谜题等级分的那道；「按主题细分」里还有 28 个主题。开局类里，内置的开局题执白照谱背 **119 条**主流线路，每条附思路讲解；你自己开局书里的线（执白执黑都行）也归在这一类。「复习」写明到期几道；「挑战」是冲刺（3 分钟，错 3 题出局）和连胜；「专项」是看 N 步和盲走。**N** 下一题；**H** 提示，第一下圈出要动的子，第二下是答案。收起面板时，棋盘下方的条给出对错和「下一题」。
- **残局**：8.x 学习目录里排在名局之后的 90 个标准残局(王兵 16 / 车 22 / 轻子 22 / 后 18 / 理论和棋 12)，现在单独成段；每个一个目标（取胜或守和），和「全力」引擎下到出结果，走错的进复习。
- **名局**：40 局名局，「读谱 / 猜着」是一个开关 —— 读谱一步一步带注释；猜着是每一步先猜大师走什么，再按引擎算出的胜率差打分。

### 棋谱

你从外面带进来的棋都在这里。**棋谱库**：「导入到库」或「粘贴 PGN」收下一份 PGN 里的每一局（上限 1 万局，重复导入不翻倍），填上你在棋谱里的名字才认领；「从网站同步」取 Lichess 或 Chess.com 的对局（默认关，要先在设置·数据里允许联网，只发送用户名）；攒够二十局复盘后「看诊断」告诉你开局、中局、残局哪一段最该练。列表默认只露搜索，来源、日期、用时、局面等在「筛选」里。**对局历史**：本机下过的棋，点一局就回到棋盘。**我的开局书**：「从内置开局生成」一套体系，或导入执白 / 执黑的带变着 PGN；「开始背」、复习到期的着（菜单 ⌘⇧O / Ctrl+Shift+O）。**复盘一局**：粘贴 PGN 或 Lichess 链接，直接进复盘。**开局浏览器**：当前局面每一种走法的局数和胜负，来源可切「棋谱库」或内置的「高分棋手」（Lichess 2200+）。

### 我的

你自己的记录：统计、做题战绩、进步、练习日历、对局等级分曲线、跨局指标（化优为胜、逆境求生、时间紧时的失误率）、残局训练营的进度，以及离下一枚最近的成就（15 枚收在「全部 15 枚」里）。全新安装时这一页只说它会记下什么——去哪里练，看今天页。

### 设置

齿轮、⌘, / Ctrl+, 或菜单「设置…」，一处管全部。**通用**：语言（中文 / English / 日本語，1433 个界面键三语齐备）、外观（跟随系统 / 浅色 / 深色）、字号。**棋盘**：五种棋盘、边框、七套棋子、坐标、方向、盲棋。**声音**：音效、音量、音色（木质 / 经典）、触感反馈（macOS 触控板）。**对局**：失着提醒、自动翻转。**数据**：从网站同步、学习数据与全部数据的导入导出、清除。**高级**：引擎内存、引擎线数、实时引擎、人会怎么走、引擎箭头、存疑标注。

**⌘K**（Ctrl+K）命令面板：找课、残局、谜题主题、棋谱或一个动作。**?**（⌘/ / Ctrl+/）随时打开完整的快捷键表；任何对话框打开时，棋局的字母快捷键全部让路，Esc 一定关得掉。macOS 上关窗只是收起，⌘Q 退出；Windows 关窗就是退出。

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

21 档对手里，扎实到高级−这七档（1191–1908）由 [Maia](https://github.com/CSSLab/maia-chess)（GPLv3）走棋：lc0 格式的 6 块 × 64 通道残差网络，1100 / 1300 / 1500 / 1700 / 1900 五个分段，vendored 于 `third_party/maia/`。`src/web/js/human/` 自己解 protobuf、按 lc0 的 112 个输入平面编码（含 8 步历史）、前向计算，在 worker 里跑；权重和 Stockfish 一样由 `scripts/gen-maia-src.mjs` 生成为 `maia-<分段>.js` 全局量，第一次用到才加载。每档按温度从网络的分布里抽；中级+、高级−在抽之前用 depth 8 的 MultiPV（只搜网络的候选）去掉比最好那步差出阈值（450 / 315 厘兵）的着法。Maia 答不上来（权重缺失、worker 出错、2 秒没答）时，这一档退回它原来的 Stockfish 设置。阶梯每一档的分数由 `scripts/test-ladder.mjs` 的循环对局拟合（[`docs/measured.json`](docs/measured.json) `ladder`），「像不像人」由 `scripts/measure-human.mjs` 在 Lichess 公开库（CC0）的局面上量（`human`）。

其余各档用 UCI `UCI_LimitStrength/UCI_Elo` 限强，最上面几档按节点数满强度搜索，「全力」不限强。
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

13.0 的计划、依据与落地记录在 [docs/v13-0-plan.md](docs/v13-0-plan.md)；更早各版的计划也在 `docs/` 里（`v6-plan.md` … `v12-0-plan.md`），逐条写着做到了什么、没做到什么。

接下来：

- **Node 26**：10-28 进 LTS 后 CI 换到 26，`engines` 仍是 ≥ 24。
- **SDK**：上游发版就单独升（`scripts/sdk-diff.mjs`），不绑版本日期。
- **以后**：西班牙语（评估在 10.0 计划 §3，暂不做）、Chess960、研究 / 笔记本（13.0 计划里的 S、V，这一版没做）；Maia 换到更高或更低的分段（1100 以下仍是故意抽差的 Stockfish）。
- **跨版本还没做的**：签名与公证、msix、`.updates` 签名自动更新（都缺证书或密钥）；macOS 侧栏材质（要让 WebView 背景透明，只能在 Mac 真机上试）；木质音效的录音版（缺许可证合适的录音，`sounds/` 已留好入口）；残局训练营里 8 子的「三兵突破」超出任何残局表，只能用 Stockfish 核对；评估条的数字仍在条外（棋盘左边放不下）。

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
  js/i18n.js       # 界面文案字典 zh-CN / en / ja 各 1433 条(单测校验键完整、无漏译、
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
third_party/maia/        # Maia 1100–1900 的 lc0 权重（GPLv3）
```

## 许可

GPLv3（见 LICENSE）。vendored chess.js 保留其 BSD-2-Clause 版权头；vendored Stockfish.js
为 GPLv3（`third_party/stockfish/COPYING.txt`）；Maia 的权重为 GPLv3（`third_party/maia/LICENSE`，安装包里是 `licenses/maia-LICENSE.txt`）；界面的 Latin 字体 Inter 为 SIL Open Font License 1.1（`src/web/fonts/Inter-OFL.txt`，安装包里是 `licenses/Inter-OFL.txt`）；棋子矢量图形共七套，逐套核过许可，应用内「关于」面板列的是同样的作者与许可：

- **cburnett（默认，`js/pieces-cburnett.js`）**：作者 Colin M.L. Burnett，原样取自 lichess-org/lila 的 `public/piece/cburnett`，该仓库 COPYING.md 列其许可为 GPLv2+，本应用按 GPLv3 使用。
- **经典（`js/pieces.js`）**：同一套设计的 Wikimedia Commons 重绘版（作者 Cburnett / Rfc1394，经 cm-chessboard 整理）。原作以 GFDL / BSD / **GPL** / CC BY-SA 3.0 多重许可发布；本仓库按其中的 GPL 一项使用，与本应用的 GPLv3 相容（CC BY-SA 3.0 单独一项并不与 GPLv3 相容，4.0 才加入单向相容，所以写清楚取的是哪一项）。
- **Merida（`js/pieces-merida.js`）**：作者 Armando Hernandez Marroquin，原样取自 lila 的 `public/piece/merida`，COPYING.md 列为 GPLv2+。
- **Chessnut（`js/pieces-chessnut.js`）**：作者 Alexis Luengas，原样取自 lila 的 `public/piece/chessnut`；COPYING.md 列为 Apache 2.0，作者自己的仓库（LexLuengas/chessnut-pieces 的 LICENSE.txt）是同一份 Apache 2.0 全文。Apache 2.0 与 GPLv3 相容。
- **Fantasy / Celtic / Spatial（`js/pieces-fantasy.js` · `js/pieces-celtic.js` · `js/pieces-spatial.js`）**：作者 Maurizio Monge，原样取自 lila 的 `public/piece/{fantasy,celtic,spatial}`；COPYING.md 列为 MIT，作者仓库（maurimo/chess-art）的 LICENSE 是 MIT 全文，README 要求注明作者 —— 「关于」面板写了。MIT 与 GPLv3 相容。

同一张表里其余候选没有收：CC BY-NC-SA（限非商业，与 GPL 不相容）、「freeware」、AGPL 的不收；mpchess（表中写 GPLv3+，作者仓库却是 LPPL 1.3c）、shapes 与 Firi（作者仓库里没有许可文件，只有 lila 表里的一行）三套，来源与表不一致或无法从来源核实，也不收。

题库数据：`js/puzzles-lc-index.js` 与 `js/lichess/band-*.js` 由 `scripts/import-puzzles.mjs` 从 [Lichess 题库](https://database.lichess.org/#puzzles)（lichess.org 开放数据库，**CC0 1.0** 公有领域贡献）抽样生成：局面、解法、评级无许可义务，每题的 id 就是 Lichess 题号（`lichess.org/training/<id>`），在此致谢。原始的 `.csv.zst` 不进仓库；导入命令是 `node scripts/import-puzzles.mjs <本地路径>.csv.zst`（或已解压的 `.csv`）。
