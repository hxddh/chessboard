# 25.1 · 修补：25.0 之后的外部审查线索，逐项核实

写于 2026-11-26。依据是一份针对 25.0.0 的外部审查线索（七组）。规矩照旧：线索不直接当结论，每条先对着代码核实、能复现的复现，再写**结论**、**根因与连带面**、**做什么**、**验收**。

不加界面，不改存档格式（`store.session.openedAt` 是会话内的状态，不落盘）。

## 1 · 逐项核实

| # | 线索 | 结论 | 根因与连带面 |
|---|---|---|---|
| 1a | `review/analysis.js` 后台完成分析时引用 `done` | **成立** | `done` 在全仓没有任何声明。窗口不在前台时分析一结束就抛 `ReferenceError`：系统通知从来没发出去（24.0 写进说明的「完成了会通知你」在后台这一支从没成立），错误进 errlog。前台那一支不读它，所以所有前台测试都是绿的 |
| 1b | `scope.mjs` 下线旧作用域检查后的盲区 | **成立** | 1.25 把 `scope-check.mjs` 退役，理由是「打包能解析即无自由变量」——这对 import 成立，对全局读取不成立：ES 模块读一个没人声明的名字，esbuild 当它是全局，照样打包。全仓重扫（见下）后**只有 `done` 一处**，没有别的同源遗漏 |
| 2a | `host.js` 隐藏时不轮询 | **部分成立** | 门本身是对的（隐藏的页面不该在用户看不见时换棋盘）。缺的是另一半：没有人把窗口叫回来。Windows 第二次启动只写队列、`AllowSetForegroundWindow`，真正的 `chess_win_raise()` 要等主实例的页面来取队列时才调——最小化的窗口页面是 hidden，不取，于是文件在队列里干等、屏幕上什么都不动。macOS 同理：程序坞里的窗口（最小化）或 ⌘H 隐藏的应用，Finder 送来的文档也停在队列里 |
| 2b | `open-queue.txt` 读写删并发 | **成立** | ① 两个转交进程各自 `length()` 后在同一偏移写，后写的覆盖先写的（资源管理器多选打开是每个文件一个进程，正是同时）；② 取队列是「读→删」，两步之间追加进来的一行随文件一起删掉；③ 一次取出超过 8 条时多出的被 `PendingOpen.add` 静默丢弃，文件已删 |
| 2c | CLI 相对路径 | **成立** | `chessboard.exe game.pgn`（控制台里）传的是相对路径，`openPathAllowed` 只收绝对路径，静默拒绝。资源管理器总是传全路径，所以双击不受影响 |
| 2d | `openPathAllowed` 路径规则 | **部分成立（同源新增一处）** | 线索点到的规则本身（扩展名、绝对、点开头的路径段、设备名、WebDAV）都在。核实时另发现：Windows 上盘符之后的 `:` 没拦——`C:\x\a.txt:s.pgn` 是 a.txt 的备用数据流，不是 .pgn |
| 2e | `app.js openPaths` 异步导入顺序 | **成立** | 上棋盘那一份 `importPgnText` 没有 await：其余文件进库和它的确认框、选局对话框同时跑；取消或被拒的文件照样记进「最近打开」；它的失败没人接。另：多选打开若被 2b 拆成几次取走，每次的第一个都会上棋盘；这一条按「一次取走的为一次请求」处理，见 F5 |
| 3a | 打开未完结的外部 PGN 触发 AI 走子 | **成立** | `importPgnText` 末尾调 `maybeEngineTurn()`，而后者只看 `mode === "ai"`。对弈模式下双击、拖入、粘贴一份没下完的棋，轮到引擎那方时引擎就接着走——仓库已经把「分析一局里引擎接着走」当缺陷修过（Codex on #113/#114），这条路径漏了。已完结的不受影响（`adoptHeaderResult` 让 `appGameOver()` 为真） |
| 3b | 棋谱库回放污染持久化设置 | **部分成立** | `loadLibraryEntry` 把 `mode` 改成 `pvp` 并 `saveSettings()`——这和「分析一局」一致，且有 e2e 断言它（`test-review-e2e` A1），不算污染。真正的污染是 `humanColor = entry.side` 一起落盘：打开一局你执黑下的棋，下一盘和电脑下就默认执黑。另外 `importPgnText` 里那次 `maybeEngineTurn` 发生在改 `pvp` 之前，引擎已经开始想，靠随后的 `invalidateEngine()` 才作废 |
| 3c | 复盘错判玩家视角 | **部分成立** | 「这局里谁是你」在仓库里有两个**有意不同**的答案，线索把它们当成了一个。展示：对弈模式下粘贴或打开的棋就是「你和这位对手的棋」，总结用对手的口吻、关键时刻先列你的（9.0 M2、14.0 B，都有 e2e 断言）。落盘：只有本机战绩里的棋才收错题（10.0，Codex on #113：粘贴的棋按上次执子方收题，一半收的是对手的错）。这个分工是对的——展示错了下一局就没了，错题收错了会留在书里。真正的毛病是两处站错了边：引擎应着按「展示」判（于是 3a），而「复盘这局」的落点（11.0，Codex on #116）按「落盘」判，落在对手的 ?? 上，而同屏关键时刻卡先列的是你的。两条规则各自散写在七八个地方，没有名字 |
| 4a | `readInfo` 对 bound 行 | **成立** | `bestMoveInner` 不读 `lowerbound/upperbound` 的分数，`readInfo`（复盘、后台 lane、无限分析共用）照单全收：fail-high/low 的边界值覆盖上一条精确值。按节点数停下的搜索若正好停在重搜中，复盘拿到的就是边界值 |
| 4b | Maia 护栏档在低剩余时间 | **成立** | 有 Maia 的档位走 `tier = { depth: 8, … }`，把前面按时钟算好的 `ceil` 整个丢掉；护栏档（normalplus、hardminus）还要对网络给的每一步做 MultiPV 深度 8。时钟只剩几秒时这一步的耗时不受时钟约束 |
| 4c | `setOptions({hash})` 与在途 `analyze()` | **成立** | 改 Hash 时清了缓存，但改之前已发出的搜索结束后照样 `rememberEval` 写回——旧引擎的答案在新设置下继续被当缓存命中 |
| 5a | 复盘重试与错题本判题尺度 | **成立** | 25.0 把重试改成按胜率（`WIN_MISTAKE` 10 个百分点），错题本与 tac/win 谜题的 `verifyAlt` 仍按 `Review.MISTAKE` 100 厘兵。同一局面同一步：复盘里「对」，错题本里「不够好」（胜局 +5.85 对 +7.15）。`retry.js` 的注释还写着「和错题本同一条规则」 |
| 5b | 引擎未惰性启动时判题 | **成立** | 训练页从不启动引擎。错题本 / 谜题里走了另一步好棋，`verifyAlt` 见引擎没就绪直接返回 `null`，调用处把 `null` 当错：记一次错、进复习队列、影响等级分。复盘重试（从棋谱库打开、带存储分析的局）同样只说「判断不了」——其实 `ChessEngine.analyze()` 自己会惰性启动 |
| 6 | `jsonStringFieldRaw` 键名匹配 | **部分成立** | 它取的是第一个 `"key"`，哪怕那是前一个字段的值；`jsonFieldValue`（数字、布尔字段用的）会跳过后面不跟冒号的匹配。后果是「字段被当成没有」（请求被拒或取默认值），不会读到错的值——值后面只能跟 `,` `}` `]`。现有调用点（`txn`、`path`、`key`、`title`/`name`、`lang`、`site`/`game`/`user`）按页面实际的字段顺序都碰不到，只有用户名恰好叫 `game` 之类才会，属于脆弱而非已发生 |
| 7a | `ci.mjs` 被注释行绕过 | **成立** | `release.yml` 的注释里有一句 `` `npm run test:engine:sample` ``，`/npm run test:engine:sample/.test(releaseWf)` 因此为真，「逐条比对」那一支根本不跑。被掩盖的是：**`test-coach.mjs` 在 `test:engine:sample` 里，却不在发布的任何一个作业里**。同一段的 e2e 清单检查也读全文（含注释），同样可被注释满足 |
| 7b | Chess.com 历史月份 | **成立** | 首次同步只往回看 3 个月份。三个月里只有 15 局、却要了 100 局，只拿到 15；而此后每次同步都从库里最新一局往后走，更早的那些再也取不到。Lichess 首次同步是「最新的 N 局，不论多早」，两站行为不一 |
| 7c | README / 依赖清单 / 工作流新鲜度 | **部分成立** | README「路线」还指向 v24-0 计划、写着「24.x 的候选」；发布头图注释写 engine ×8（实为 9，加上 coach 后 10）；`deps-inventory.json` 查于 11-13，playwright 已到 1.65.1（清单记 1.65.0）。Stockfish npm 19.0.1、Zig 0.17.1 已在清单里且建议不变，这一版不升级（升级按 v8-1-plan F1 单独提交） |

## 2 · 做什么

| # | 做什么 | 验收 | 落地 |
|---|---|---|---|
| F1 | `analysis.js`：提示语算一次，`toast` 与 `Host.notify` 读同一个 `done` | 下条检查；`test-review-e2e` | ✅ |
| F2 | `scope.mjs` 恢复自由变量检查，不加第二个解析器：esbuild 的 `define` 只替换**没有声明绑定**的名字，于是把每个模块里出现的每个词都定义成标记，输出里剩下的标记就是自由名字；减去浏览器与 JS 内建全局（Node 独有的 `process`/`Buffer`/`require` 等不算） | 204 个模块 0 个自由名字；把 `done` 改回去，检查报 `free: done (review/analysis.js)` 并失败 | ✅ |
| F3 | Windows：队列在文件锁下追加；取队列用非阻塞锁，**清空而不是删除**，放不下的行写回文件留给下一次；相对路径在转交进程里按它自己的当前目录变成绝对路径（主实例 `noteLaunchArgs` 同理）；转交进程自己把同一个 exe 的窗口还原并调到前面（`chess_win_wake_instance`，按进程映像全路径认，不碰同名的别的程序、不碰从属对话框）。`openPathAllowed` 拒绝盘符之后的 `:` | `zig build test`：相对路径解析、点目录仍被拒、队列超过 8 条时余下的按序留到下一次、备用数据流被拒；`zig build -Dplatform=windows` 交叉编译通过 | ✅ |
| F4 | macOS：收到打开文档事件时，若应用被隐藏就取消隐藏、把程序坞里的窗口还原（激活本就是 LaunchServices 的事） | 只能真机看：见 `manual-check.md` | ✅（待真机） |
| F5 | `openPaths` 搬进 `io.js`（app.js 的行数线）：上棋盘那份 await，只有真的上了棋盘才记「最近打开」。第一稿加过「上一次打开后 3 秒内到的整批进库」，`test-persist-e2e` 当场红：一秒之后有意打开的第二份也被送进了库——两次请求和一次被拆开的请求，靠时间分不出来，已删。F3 的锁让一次取队列拿走当时在队里的全部，多选打开绝大多数在一次里到 | `native-bridge` 静态检查改为认 `if (await importPgnText(…)) Host.addRecentDocument(p)`；`test-persist-e2e` 全过 | ✅ |
| F6 | `app-state.js` 给两条规则各起一个名字、各写一处：`youSide`（展示：对弈模式、非分析棋盘）与 `ownSide`（落盘：再加「非导入，或本机战绩」）。关键时刻卡与「复盘完成 · N 个」计数、错题清单、评语、开局书核对、「人会怎么走」、「复盘这局」落点读 `youSide`；挖题与**引擎应着**读 `ownSide`。两个按需加载的块（关键时刻卡、人会怎么走）从参数拿，不把 app-state 复制进块里。第一稿把展示也收紧到 `ownSide`，`test-review-e2e` 的 9.0 M2、14.0 B、19.0 T2、T4 五条当场变红——那是有意的产品行为，第一稿错了，已改回 | `trainer.mjs`：两条规则各在一处，`maybeEngineTurn` 读 `ownSide`，复盘模块里没有「`mode === "ai"` 配 `humanColor`」的散写；`test-review-e2e` 全过 | ✅ |
| F7 | `loadLibraryEntry` 只把棋盘转到你那一方，不再改并保存 `humanColor` | 引擎应着已由 F6 拦住；`test-library-e2e` | ✅ |
| F8 | `engine.js`：bound 行只在这一路还没有任何值时才收；Maia 档的深度 8 搜索也受时钟上限（扣掉网络已用的时间）；缓存加一个代数，改 Hash 时加一，之前发出的搜索结束后不写回 | `test-engine-e2e`、`test-engine-flows-e2e` | ✅ |
| F9 | `Mistakes.judgeAlt` 改为复盘的尺度（胜率掉 < `WIN_MISTAKE`），复盘重试也调它——一条规则；`loss` 仍是厘兵，给提示语用 | `trainer.mjs`：+7.15 对 +5.85（130 厘兵）判对；均势下 130 厘兵仍判错；黑方同理 | ✅ |
| F10 | 冷启动：`verifyAlt` 与复盘重试不再因「还没启动」就放弃，`analyze()` 会把引擎启动起来；只有已经启动失败的才说「判断不了」。判断不了的一步撤回、不记错、不进复习队列（`puzzleUnjudged`，放在 `puzzle-mine.js`：`puzzles.js` 在 1000 行线上） | `test-trainer-e2e` | ✅ |
| F11 | `jsonStringFieldRaw` 用 `jsonFieldValue` 定位 | `zig build test`：`{"title":"name","name":"a.pgn"}` 取到 a.pgn；`{"user":"game"}` 里没有 `game` 字段 | ✅ |
| F12 | `ci.mjs` 只读工作流里的命令（去掉注释）；`release.yml` 的引擎矩阵补上 `node scripts/test-coach.mjs` | 把注释里那句留着、矩阵里删掉一条，检查变红；`test-coach.mjs` 本机跑通 | ✅ |
| F13 | Chess.com 首次同步往回走到凑够 N 局或 24 个月为止（和后续同步同一个上限，`SYNC_DEADLINE_MS` 本来就是按 24 个月定的） | `zig build test`：首次同步在 9 局 < 20 时继续往回问 2026/06，那个月不存在就停在已拿到的 9 局 | ✅ |
| D | 版本 25.1.0；README 的「改了什么」与「路线」；CHANGELOG 收下 25.0.0；依赖清单的查询日期与 playwright 最新版 | `readme` 检查 | ✅ |

## 3 · 门禁余量与减重思路

- **首屏包**：819,171 → 819,396 字节（线 820,000 不放宽，余 604）。`openPaths` 从 app.js 搬进 io.js 不增不减；`youSide` 替掉五六处各写一遍的判断，几乎抵掉了新增的检查与注释之外的代码。
- **app.js**：4,769 → 4,756 行（线 4,777）。**trainer/puzzles.js** 999 行（线 1,000），所以新函数放在 `puzzle-mine.js`。
- **下一步该还的**（25.0 说过要还回 815,000，这一版没碰，理由是修补不该同时做搬迁）：按首屏包里各模块的实测体积（未改名的压缩），最大的几块是**内容而不是代码**——`lessons.js` 约 158 KB、`openings.js` 27 KB、`puzzles.js` 25 KB、`classics.js` 22 KB。课程正文已经是块（`chunk-lessons-body.js`），课程目录与任务还在首屏；`classics.js` 的名局已有 `classics-more` 一块，剩下的同理可以挪。比 25.0 设想的「复盘重试面板 / 评估曲线做成块」划算：那两块每帧都要用，而内容只在打开对应页面时才用，挪出去不用改任何绘制路径。建议 25.x 先做 `classics.js` 和 `openings.js`（约 49 KB，一次就够还到 815,000 以下），课程目录放到最后，因为今天页的「继续」卡在首屏就要读它。

## 4 · 没做的

- 只玩 Chess960 的月份：增量同步若 24 个月里没有一局标准棋，`since` 不前进，下一次还是同一段。罕见，要在页面侧记住「已走到哪个月」，改存档格式，不在修补里做。
- Stockfish 19.0.1、playwright 1.65.1、Zig 0.17：见依赖清单，单独提交。
- 真机：F3（Windows 最小化时再双击、资源管理器多选打开）与 F4（macOS 程序坞里的窗口）只能在真机上看，清单补在 `manual-check.md`。

## 5 · 25.1 之后的复核（2026-11-26）

又一份线索，针对 25.1.0 与在途的 #140。照旧先对着代码（含 Native SDK 0.11.1 的 AppKit 宿主源码）核实。

| # | 线索 | 结论 | 机制与影响 |
|---|---|---|---|
| R1 | #140 的截图预热在轮询循环里同步执行 | **成立** | `scenario()` 在 `app.ready()` 之后才进 `pages` 的循环，页面大约 2 秒后报 `shot:home`、开始数 5 秒。循环里的预热是 `execFileSync`：冷启动照样要付几秒，窗口还没建好时返回 `none`、下一轮再试；这几秒里 Node 读不到报告，页面已经在后台数完停留。冷启动只是换了个地方落进停留窗口，最坏时 01-home 整张截不到。#140 的 CI 是绿的，只因那台 runner 不冷 |
| R2 | macOS `close_policy = "hide"` 关窗后再从访达打开 | **成立** | SDK 的 `windowShouldClose:` 对 hide 策略调 `hideWindowWithId:` → `orderOut:`。窗口既不是 `isMiniaturized`，应用也不是 `isHidden`，只是不在屏幕上，页面 hidden、不取队列。程序坞图标走 `applicationShouldHandleReopen:` 把它叫回来，而打开文档事件不走这条路。25.1 只处理了最小化与 ⌘H 两种 |
| R3a | 读秒时 Maia 那一步 | **部分成立** | 网络推断实测每步约 60 ms（`docs/measured.json` human），`2000` 是超时上限，不是固定耗时。但首次加载、worker 失灵时，`H.load` 与 `H.policy` 可以等满几秒，不受时钟约束 |
| R3b | MultiPV 候选分不过滤 bound / 空分 | **部分成立** | Stockfish 只在搜了 3 秒以上时才打印 bound 行，深度 8 的护栏搜索平常碰不到；但 25.1 给它加了 movetime 截断，截在重搜中间时，最后一行可能是 bound。bound 仍是真实分数的一侧界，不是乱数，影响小；规则应和 `readInfo` 一致 |
| R4 | `scope.mjs` 的 `$` 与 `n in globalThis` | **成立** | 词法正则不含 `$`，`$x` 这种自由名字扫不到（esbuild 的 `define` 本身认 `$`）。放行规则读的是 Node 自己的全局：Node 22 已带 `fetch`、`WebSocket`、`navigator`、`crypto`，`node -e` 下还有 `fs`、`path`、`url`；同进程里先跑的测试也可能往上挂东西。读一个页面里不存在的名字（如 zero:// 不提供的 `fetch`）会被放过 |
| R5 | 门禁余量 | 见下 | 这一批改动后首屏包 819,719（线 820,000，余 281）；`trainer/puzzles.js` 没碰，仍 999 行 |

### 做了什么

| # | 做法 | 验收 |
|---|---|---|
| R1 | 预热挪到启动被测应用之前：对本进程（没有窗口）截一次，冷启动付清、必然失败、不碰页面时序；循环只截真截图。耗时记进报告的 `shotWarm` | `test/automation.mjs`：预热在启动之前、循环里只有一处截图 |
| R2 | `openDocuments:` 在没有窗口在屏幕上时，向宿主的应用代理问一次 `applicationShouldHandleReopen:hasVisibleWindows:NO`——和点程序坞图标同一条路，宿主自己的策略隐藏集合与窗口状态跟着变 | 真机：`manual-check.md` 25.1 第 4 条补上红色按钮 / ⌘W；CI 的 macOS 编译 |
| R3a | 计时对局里，Maia 那一步（取块、加载、推断）限在时钟上限的一半之内，超过就由该档的 Stockfish 那一行出棋，加载在后台继续；不计时的对局照旧等首次加载 | `test-engine-e2e`、`test-engine-flows-e2e` |
| R3b | 候选分用 `readInfo` 的规则：bound 或无分的行不覆盖已有的一行 | 同上 |
| R4 | 放行表写死：语言自带的全局取自新建的 `vm` 上下文（不含 Node、不含宿主），宿主的逐个列出；词法正则含 `$` | 反证：往一个模块里加 `$probe` 与 `fetch`，两个都报出来；`test-engine.mjs` 另补两条行为测试（Hash 改动后的旧结果不进缓存、bound 不覆盖精确分），在 25.0 的 engine.js 上都是红的 |

### 门禁与下一版

这一批不碰训练页，首屏只多 343 字节（`engine.js` 的两处），所以**先修、减重单独做**。余量只剩 281 字节，下一个往首屏加代码的改动之前必须先还：

1. **首屏还账（第一件）**：名局 `classics.js`（未改名压缩约 22 KB）合进已有的 `classics-more` 按需块——它已经有「到了再补齐」的机制（`More.total`、`onReady`），要改的是 `CLASSICS` 被同步读的几处（训练页目录、今天页、猜着）。`openings.js`（27 KB）被六个模块同步引用，牵涉开局训练与浏览器，放第二步。两步做完约 49 KB，回到 815,000 以下。
2. **`trainer/puzzles.js` 的 1,000 行线**：999 行，下一处改动前先把 `verifyAlt` 之后的判题分支（tac/win/mine 三种回应）挪进 `puzzle-mine.js`。
3. **截图门禁改成握手**：现在是「页面停 5 秒，驱动程序尽量在 5 秒内截」。改成页面报 `shot:x` 后等驱动程序回一个确认（`app.send`）再翻页、超时才算失败——时序不再靠猜。
4. **Windows 多选打开被拆成两次取走**：偶尔两局先后上棋盘。要么原生侧在转交进程里多等一小会儿再唤醒，要么页面在一次「唤醒」里只认第一批为上棋盘的——需要先在真机上看到它发生。
5. **Chess.com 只下 960 的月份**：增量同步走满 24 个月没有标准棋时 `since` 不前进。要在页面侧记住「已走到哪个月」，改存档格式。
6. **依赖**：Stockfish 19.0.1、playwright 1.65.1 单独升；Zig 0.17 等 SDK 支持。
7. **真机**：25.0 与 25.1 两节都还没走过，下一版发布前补走。
