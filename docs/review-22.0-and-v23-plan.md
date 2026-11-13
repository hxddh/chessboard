# 22.0.0 全面评估 · 依赖新版本 · 下一步（22.1 / 23.0）建议

写于 2026-11-13，基于 main @ 3279fad（22.0.0）。上一份评估是 [review-21.0-and-v22-plan.md](review-21.0-and-v22-plan.md)，22.0 的计划与落地记录在 [v22-0-plan.md](v22-0-plan.md)。

owner 的要求：「全面 review 最新版本。另外底层所依赖的组件和服务，是否有新版本。新版本里哪些能力可以充分利用和引入。」之后：「可以。继续评估。」

这是一份评估与建议，本身不改代码。第 6 节是要 owner 拍板的事。

---

## 0 · 结论先行

| 方面 | 21.0 评估 | 22.0 | 一句话 |
|---|---|---|---|
| 规则与对弈正确性 | ★★★★★ | ★★★★★ | 没变 |
| 测试 | — | ★★★★☆ | 静态 24 个文件、浏览器 e2e 19 组本地全绿；但几条新断言测不出它要测的东西（3.1-3） |
| 易用 | ★★★☆☆ | ★★★★☆ | 复盘、今天页、课程的主次对了；谜题面板没动（计划里写明没做） |
| 前端架构 | ★★☆☆☆ | ★★☆☆☆ | `app.js` 4759 行；一个 `#toast` 承担约 110 种消息，22.0 的一个新毛病就出在这里（3.1-2） |
| 原生壳与 SDK | — | ★★★☆☆ | **发布件的 WKWebView 可以被 Web Inspector 打开**（SDK 0.10.1 无条件打开，见 2.1）；升 0.11.1 即修 |
| 依赖新鲜度 | — | ★★★★☆ | 大多由浮动标签自动跟上；真正要动的只有 SDK 0.11.1、chess-openings、Playwright 1.65 |
| 分发 | ★★☆☆☆ | ★★☆☆☆ | 没签名、没公证、没自动更新，仍卡在证书 |

**三个核心判断**：

1. **22.0 兑现了「从容」。** 复盘首屏就是第一处关键时刻、今天页说具体的事、定级是一张结果卡，截图里逐条看到了。代码层面的问题集中在**时效**这一条本身：预走会把失着提醒顶掉，首启菜单语言在非中日英系统上仍对不上。
2. **最该先做的不是功能，是一个安全默认值。** SDK 0.10.1 在 macOS 上无条件给 WKWebView 开 `inspectable` 和 `developerExtras`，所以每个发出去的版本都能右键「检查元素」、改页面、改存档。0.11.1 默认关、只在 Debug 开。这一条加上 22.0 的几个中等问题，够单独发一个 **22.1**。
3. **依赖没有「能大幅改善产品」的新版本。** Zig 0.17 被 SDK 拦着（而且要求 macOS 15+）；Stockfish 19.0.1 只换了构建，直接替换会让引擎起不来；chess.js 1.x 迁移面太大；Maia-3 是 AGPL 的 PyTorch 模型，没有浏览器版。值得引入的能力都比较小，见第 2 节。

---

## 1 · 这次评估做了什么

| 项目 | 做法 | 结果 |
|---|---|---|
| 静态测试 | `npm run test:static`（本机 Node 22，Linux） | 24 个文件全过，106 s |
| 浏览器 e2e | 19 组，Chromium 1243（Playwright 1.63 驱动，`E2E_REQUIRED=1`） | **19 组全过**。前 8 组一次跑完；第一次整串跑到 review 组时撞上 30 分钟的后台时限被杀，其余 11 组分三路并行重跑，全过 |
| 截图走查 | `scripts/shots.mjs`，Chromium，37 张（四种窗宽、四种主题、三语） | 第 4 节 |
| 22.0 改动的代码审查 | `git show 3279fad` 的 54 个文件逐个读，能对上源码的才记 | 第 3 节 |
| 原生壳编译 | `pip install ziglang==0.16.0`，`zig build -Dplatform=null` 对 SDK 0.10.1 | 编过 |
| 依赖新版本 | npm / PyPI / nodejs.org / `git ls-remote` / `curl -I database.lichess.org` / 上游 CHANGELOG 与源码 | 第 2 节 |
| SDK 0.10.1 → 0.11.1 | 两个 npm 包解开对读；`scripts/sdk-diff.mjs` 对 0.11.1 跑 | 2.1 |

**局限**：
- 没有真机、没有 WebKit 实测（本机只有 Chromium）、没有声音。
- **没有用 SDK 0.11.1 编译或跑 `zig build test`**：这一步要编译并执行刚从 npm 下载的代码，被会话的安全检查拦下了，没有绕过。所以「现有 fork 不改就能编过 0.11.1」是读源码得出的判断，没有实测。
- 截图走查用的是空桩引擎、没有 Maia 权重，所以引擎相关的屏（复盘的「人会怎么走」、终局条的复盘区）显示的是退路状态。
- 和上次一样：没有使用统计，「很少用到」是估计。

---

## 2 · 依赖：新版本与可以引入的能力

查于 2026-11-13；`docs/deps-inventory.json` 上次是 2026-10-08。

| 依赖 | 仓库 | 最新 | 对这个应用有用的新东西 | 建议 |
|---|---|---|---|---|
| **Native SDK**（`@native-sdk/cli`） | 0.10.1 | **0.11.1**（2026-11-09；0.11.0 是 10-13） | `webview_inspection`；macOS 按窗口设配色；快捷键按键盘布局解析。见 2.1 | **22.1 升** |
| Zig | 0.16.0 | 0.17.1（2026-11-05） | LLVM 22、COFF 链接器增强（交叉编 Windows 更顺）、macOS 27 头文件 | **不能升**：SDK 0.11.1 的 `pinned_zig_version` 仍是 0.16.0，只认 0.16.x。另外 0.17 的 std 把最低 Darwin 提到 15，`build.zig` 声明的是 macOS 11 |
| Stockfish.js | 19.0.0 lite-single | 19.0.1（2026-10-10） | 网络没变（nn-61e7af4bb97d），强度不变；只换了 Emscripten 6.0.9 和 worker 通信。wasm +58 KB | **不升**。新 glue 的 `module.exports` 不再接收 `wasmBinary`，`engine.js` 的启动方式会抛错、退去 fetch，而 zero:// 不能 fetch。没有新能力，白改启动代码 |
| Stockfish 多线程 / 完整 NNUE | — | 同包 | — | **不可行**：多线程要 SharedArrayBuffer（跨源隔离头，zero:// 不发）；完整网络约 99 MB |
| chess.js | 0.13.4（vendored） | 1.4.0（2025-06） | `attackers()`、`isAttacked()`、Zobrist `hash()`、null move、更好的 PGN 解析 | **不升**。API 全面改 camelCase，65 个文件引用（`in_checkmate` 67 处、`in_check` 44 处）。要用 Zobrist 或 attackers 时单独实现 |
| esbuild | 0.28.2 | 0.28.2 | — | 不用动 |
| Playwright | 1.64.0 | 1.65.0（2026-11-05；Chromium 158） | 动作会等元素不再 `inert` | **单独一个 PR 升**。应用在 `a11y.js`、`shell.js`、`app.js`、`native-commands.js` 用了 `inert`，被遮住的点击会从立刻操作变成超时，要专门跑一轮 |
| Node.js | 26（浮动） | 26.13.1 LTS（2026-11-10） | 只有安全修复 | `node-version: 26` 已自动跟上；只更新清单 |
| Actions（checkout / setup-node / artifact / cache / setup-zig） | v7 / v7 / v7·v8 / v6 / v2 | v7.0.1 / v7.1.0 / v7.0.2·v8.0.2 / v6.1.0 / v2.2.1 | 无关 | 浮动主版本已跟上 |
| Runner 镜像 | macos-26、windows-2025、ubuntu-latest | — | macOS 14 镜像已于 11-02 退役（我们没用）；ubuntu-latest 以后迁 26.04 | 不用动 |
| **lichess chess-openings** | c67912be（09-20） | 3ba6b20（2026-11-05） | 增 56 行、删 6 行；C12 的名称与变体之间改用「:」；Mieses-Kotrč 改名 | **22.1 刷新**（`gen-eco --refresh`），成本低；改名会动已显示的开局名，看一遍 `test-eco` |
| Lichess 题库 | 2026-10-02 导出 | 2026-11-01 导出 | 新题，评分有漂移 | 可选，下次按同参数重抽 |
| Lichess 标准库 | 2026-08 | 2026-10 | — | 不用（清单已说明每月刷新没有意义） |
| Maia | 1100–1900（2021 权重） | Maia-1 没有新权重；Maia-2 v0.11.0 多了 Rapid / Blitz（PyTorch）；**Maia-3**（2026-05，transformer，5M / 23M / 79M，**AGPL-3.0**，只有 PyTorch） | Maia-3 覆盖更宽的分段，可能更「像人」 | **不升**。要自己导出 ONNX、加 onnxruntime-web 或手写前向；AGPL 与本仓库 GPLv3 的组合要另行评估。作为 23.x 的研究项（6-5） |
| lc0 两张表 | v0.30.0 | v0.32.1 / v0.33.0-rc0 | 和 `kIdxToMove`、策略映射无关 | 不用 |

### 2.1 · Native SDK 0.10.1 → 0.11.1

0.11.0 / 0.11.1 的大头是 TypeScript 编译视图、画布和 markup 的 TS 化，都属于 `sdk-fork-notes.md` 里我们不用的 B03。和这个应用有关的：

| 变化 | 性质 | 碰到我们哪里 | 建议 |
|---|---|---|---|
| **`AppInfo.webview_inspection`**（#690）。AppKit 只在它为 true 时开 `inspectable` 与 `developerExtrasEnabled`，默认 false；上游 runner 规则是 Debug 开、`-Dwebview-inspect` 可覆盖 | **行为变化 + 安全修复**。0.10.1 是无条件开（`src/platform/macos/appkit_host.m:8487/8499`，本次对读确认） | `src/runner.zig` 的 appInfo（R08 那一块）、`build.zig` 的 `buildOptionsModule` | **立即采纳**。不跟的话，升级后 Debug 下也没有检查器 |
| macOS 按窗口设配色 `setWindowColorScheme`（#691） | 新增 | `src/native/mac_chrome.m` 现在设的是 `NSApp.appearance`（B14） | 以后：可替掉 B14 里管外观的那部分；透明标题栏和拖动条仍要自己做 |
| 快捷键按当前键盘布局解析（#743） | 改进 | `app.zon` 的 Escape `.shortcuts` 绕路 | 绕路先留着，真机复核后再决定 |
| 全局快捷键、合成键盘输入（#744、#745） | 新增 | — | 不用 |
| `RunOptions.legacy_data_directory`、file_roots 6→7、`setupSessionRecorder` 新参数 | 上游内部 | R01 / R02 / R03 的锚点 | 只更新登记 |
| schema 只多 `assets.fonts` | 新增 | — | 不用 |
| 网页拖动区、Windows Mica / 由应用指定的深色标题栏、`LSHandlerRank`、运行时改菜单与标题、文件对话框新接口、签名 / 公证 / msix / 更新 | **都没有** | B14、B15、`add-pgn-doctype.sh`、R07、R09、R12 | 照旧保留我们的做法 |

**登记表要改的一处事实**：`sdk-fork-notes.md` B15 写「SDK 0.10.1 的 Windows 主机不设 DWM 属性」，不准确。SDK 的标准标题栏会**跟随系统**写 immersive dark mode（`applyStandardTitlebarColorScheme`）；系统切换深色模式时它会重写，盖掉我们按棋盘主题设的值。0.10.1 就已经这样，0.11.1 没变。

**`sdk-diff.mjs` 对 0.11.1**：退出码 1。
- `runner.zig`：13 条登记过的差异不再匹配（R07、R08×2、R01、R03×4、R02），10 个未登记块。
- `build.zig`：17 条不再匹配（B03×2、B01、B02×5、B05×3、B06、B13、B11×2），16 个未登记块；上游 `build/app.zig` 从 2895 行涨到 3191 行。
- 原因几乎都是锚点上下文被上游新增的 TS markup、scriptc、`-Dwebview-inspect` 挤动了，**我们分叉的那几段本身没有被改**。真正要跟的只有 `webview_inspection`。
- 平台的 C / ObjC 源文件、框架、系统库与 0.10.1 完全相同，所以链接层不用动。

**lag 账**（R03、R04、R05、R11、B07、B12）在 0.11.1 上游与 0.10.1 相同，照 `sdk-fork-notes.md` 原定建议还即可。

---

## 3 · 22.0.0 代码审查

### 3.1 · 要修的

| # | 级别 | 位置 | 问题 | 修法 |
|---|---|---|---|---|
| 1 | 中 | `src/native/mac_chrome.m:186`、`src/native/win_chrome.c:85`；对照 `src/web/js/lang-ids.js:32` | **首启菜单语言与页面仍可能不一致**（F5 要修的正是首启）。原生侧只看第一个首选语言，不是 zh / ja 一律英文；页面 `detectLang` 遍历整张列表，都不认识时回落 **zh-CN**。法语系统：页面中文、菜单英文；`[fr, ja]`：页面日文、菜单英文。CI 跑在英文系统上测不到 | 原生侧照 `detectLang` 遍历 `preferredLanguages` / `GetUserPreferredUILanguages`，回落值和页面一致；或者两边都回落 en（改页面回落值要 owner 定，见 6-3） |
| 2 | 中 | `src/web/js/app.js:3149`（`premoveClick` 的 `toast(msg.premove.set)`），与 `game-controller.js:376` 共用 `#toast` | **等待期间点预走，失着提醒和它的「悔棋」按钮被顶掉**。F4 放开了等待期间的预走，可正是这 4 秒里用户最需要那个按钮 | 等待期间设预走只画黄箭头、不弹提示条；根上是 C 组的提示条队列（5.2） |
| 3 | 中 | `scripts/test-engine-flows-e2e.mjs:466-468` | **F1 / F4 的断言测不出它要测的**：「对手应着后提示已收掉」紧跟在预走点击之后，而预走提示本身就会盖掉失着提醒，所以 F1 的收起逻辑坏了它也照样通过；只等 400 ms，没确认对手真的应着；计划 F4 的验收是「预走被走出」，测试只看黄箭头 | 拆成两条：不设预走，等 `sanHistory` +1 后断言提示已无；设预走，断言预走被走出 |
| 4 | 中 | `.github/workflows/build-macos.yml:26-63`、`build-windows.yml` 同处 | **PR 触发的真 WebView 作业**：同仓库分支的 PR 上 `build` 作业带 `contents: write` 跑 PR 自己的代码，并现装一个不做哈希校验的 SDK；`paths` 不含 `src/web/**`、`package*.json`、`scripts/bundle.mjs`，前端打包的回归（如 22.0 新增的 `chunk-audio.js`）仍要到发版才第一次进真 WebView；没有 `concurrency`，反复推送会重复占 macOS runner | PR 事件走只读变体（上传拆成单独作业）；补路径；加 `concurrency: { group: …-${{ github.ref }}, cancel-in-progress: true }` |
| 5 | 低 | `src/web/js/audio-lazy.js:19-27` | 分块到了、补放先前的设置时若抛错（例如 `AudioContext` 构造失败），`S.asked` 成了被拒绝的 promise，此后每次 `call` 都是一次未处理的 rejection，触发故障条 | 补放循环 try / catch |
| 6 | 低 | `src/web/js/audio-lazy.js:37-43` | 分块一直取不到时，`S.booked` 已为 true，`noteClock` 每跳一次都推进 `S.kept`，队列无上限；每个 play 又重新插一次 `<script>` | `kept` 每个键只留最后一次；失败后退避 |
| 7 | 低（待确认） | 同上 | 启动后约 1.5 s 内的第一声，`AudioContext` 在 promise 回调里创建，不在用户手势的调用栈里；WKWebView 可能让它保持 suspended | 真机听一次；必要时在第一次 pointerdown 上 `resume()` |
| 8 | 低 | `src/web/index.html:772` + `today-page.js:193` | 「继续」标题写死了 `data-i18n="today.continue"`；切换语言时 `I18n.apply` 把「从这里开始」改回「继续」，要等下一次进今天页才改回 | 去掉这个 `data-i18n`，或 `applyLanguage` 里调 `renderContHead` |
| 9 | 低 | `today-page.js:246` | 「按定级暂定」只看 `rhist` 非空：没做定级、只做过谜题的人也显示「暂定」，数字是谜题分 | 看 `puzzleState.placed` |
| 10 | 低 | `trainer/lessons.js:409` | 连续两次同样的错，`#lesson-fb` 文本不变，部分读屏不再播报（原浮条每次重建节点） | 先清空、下一帧再写 |
| 11 | 低 | `review/moments.js:93-104` | 复盘自动跳到第一处关键时刻时没有播报，读屏用户只觉得棋盘被移走了 | 跳转时往 live region 写一句 |
| 12 | 低 | `eco-lookup.js:228-231` 注释；两个构建工作流的注释 | 注释还是旧说法（「Giuoco Piano 保留英文」「13 pages」），与 B5 和现在的 17 页矛盾 | 改注释 |

### 3.2 · 核对过、没有问题的

- 等待定时器：悔棋、新局、认输、切模式都会在 100 ms 内收掉提示；`undo` 经 `invalidateEngine` 清掉预走。
- `toast` 的 seq 所有权；F3 第三次按提示；`capPerGame` 堵住了 21.0 评估说的三种漏法。
- PR 事件下 `inputs.release_tag != ''` 为假，不会上传任何东西；D2 打包不再退回裸 exe。
- `audio-lazy.js` 的 `getVolume` / `getSoundSet` 变成了异步，核对过应用里没有同步读它们的调用方。
- mac / win 的原生实现本身。

---

## 4 · 截图走查（37 张，Chromium）

| 屏 | 看到的 | 判断 |
|---|---|---|
| 今天（1440、600） | 「接下来 · 学一节新课 · 第 1 课 · 棋盘与坐标」，下面「从这里开始」三张卡，各写「还没开始」 | A2 生效。**「今天」卡标题与第一行之间仍空一大块**；1440 下页面下半仍是空的（21.0 评估 2.2-6，22.0 的 B6 只做了一半） |
| 复盘（1440） | 关键时刻在曲线上方；全盘无失着时一句「全盘没有哪一步让胜率明显下滑」 | A1 生效 |
| 复盘（1440） | 「1500 分的人：」后面跟一个「…」，Maia 取不到时要等 6 s 才收起整行 | 低。等待态可以不写标题、只在有答案时出现 |
| 终局（1024 en） | 结果条「You won · Checkmate · Your level 1506 (provisional)」+「First win」+「Play again」 | B1、B7 生效；「暂定」写清了 |
| 终局（1024 en，引擎起不来） | 复盘区只有一行灰字「Engine failed to start」，没有重试 | 低。截图用的是空桩，但这是真实的退路文案：给一个「重试」 |
| 课程（1440 en） | 任务卡在课文下面、两个按钮上面；「Restart」「Next lesson」一样重 | A3 生效；按钮同重是计划里明写留给 A7 的 |
| 谜题（1440 zh） | 面板依次：已解 0/57、题目、重来 / 下一题、谜题等级分 1500 暂定、复习、这一类（一步杀 0/57、等级分 —、首答） | **「0/57」说了两遍**；「等级分」也出现两次（大的 1500 与「这一类」里的 —）。计划里写明 A4 的摘要化没做 |
| 命令面板（1440 ja） | 底部提示行压在最后一个结果行上 | 低，列表底部留出提示行的高度即可 |

总体：**22.0 改的那几屏都对了**；还没对的集中在谜题面板和今天页的留白，都是计划里写明「没做」的那几条。

---

## 5 · 架构与工程

### 5.1 · 现状

- `app.js` 4759 行；靠「行数上限」逼拆模块，再用 `d` 依赖对象和晚绑定的转发函数传进去，耦合是隐式的。
- 一个 `#toast` 约 110 种消息，不同来源互相覆盖；22.0 加的 seq「所有权」是局部补丁，3.1-2 就是它没盖住的那种。
- 相当多「测试」是对源码文本的正则（`scripts/test/trainer.mjs`、`real-gate.mjs` 等）：锁住代码长什么样，不是行为；重构会误报，换个写法又能绕过。
- e2e 里有大量固定的 `waitForTimeout`（400 ms、2600 ms），既慢又会掩盖竞态（3.1-3 即一例）。整串 e2e 在本机单路超过 30 分钟。
- `docs/` 51 份，计划与评估逐版累积；代码注释里大量「22.0 F1 / 21.0 T2」这类版本叙事，已经出现过期（3.1-12）。
- 本机 Node 22 照样能跑全部检查，但 `package.json` 写着 `engines >= 26`。不是问题，只是说明这条约束没有被任何东西执行。

### 5.2 · 建议（按收益排）

1. **回合状态机**（21.0 评估的 C2，22.0 没做）：轮到你 / 教练在看 / 等你反悔 / 对手在想 / 终局，一个可取消的定时器；`coachHold`、`premove`、`hint`、`engineThinking` 从它派生。3.1-2 这类问题从根上消失。
2. **提示条队列**：带优先级与来源的队列，或分区（棋盘上方的局面类、右下的系统类）。失着提醒这类「有动作的」优先于「已预走」这类「告知的」。
3. **e2e 去掉固定等待**：改等条件（`waitForFunction`）；把 19 组按 `e2e-shard.mjs` 默认分片，本地 3 路并行。
4. **源码正则测试逐步换成行为测试**：先从改动最频繁的 `trainer.mjs` 开始，新加的守卫不再写成正则。
5. **注释只写现在的行为与原因**，版本叙事挪进 CHANGELOG；每个大版本的计划文档定稿后不再被代码注释引用。

---

## 6 · 下一步建议

### 6.1 · 22.1：「稳」（建议先发，存档不变）

| # | 做什么 | 验收 |
|---|---|---|
| S1 | **SDK 0.11.1**（Zig 留 0.16.0）：跟 `webview_inspection`（`build.zig` 加 `-Dwebview-inspect`，`runner.zig` 的 appInfo 加字段）；还 R03、R04、R05、R11、B07、B12 的 lag 账；更新 `sdk-fork.json` 锚点直到 `sdk-diff` 输出为空；改正 B15 的说明；三个工作流与 `release.yml` 的 SDK 钉 0.11.1 | `sdk-diff` 为空；`manifest-check --sdk`；两平台 `zig build test`；真机：**发布件右键没有「检查元素」**、Debug 有；Escape、标题栏外观、PGN 关联照旧 |
| S2 | 3.1 的 1–4 | 3.1-1：`main.zig` 的映射单测加 `[fr]`、`[fr, ja]`；3.1-2、3.1-3：拆开后的两条 e2e；3.1-4：工作流静态检查 |
| S3 | 3.1 的 5–12 | 各自的 e2e 或单测；7 号真机听一次 |
| S4 | chess-openings 刷新到 3ba6b20 | `test-eco`；三语开局名截图 |
| S5 | `deps-inventory.json` 更新到本节的结论（Stockfish 19.0.1 记「不升」并写明原因） | `test-deps` |

Playwright 1.65 单独一个 PR，不进 22.1：它改的是测试驱动，不该和产品改动混在一个版本里验。

### 6.2 · 23.0 的候选主题（供讨论，不急着定）

22.0 计划里写明留下的，加上这次看到的：

- **骨架**：回合状态机 + 提示条队列（5.2 的 1、2）+ 增量存档（21.0 评估的 C4）。用户看不见，但之后每一个「时效」类的改动都会便宜很多。
- **谜题面板**：A4 摘要化（「0/57」和等级分不说两遍），A7 全应用一屏一个主按钮。
- **教学**：T4（讲解覆盖率）、T9（低档收官）、B3（课程走错讲你那一步）。
- **对手**：Maia-3 研究项。先量三件事再决定做不做：导出 ONNX 后的体积（5M 版本约 21 MB）、onnxruntime-web 在 zero:// 下能否加载（和 Stockfish 一样的 Blob worker 方案）、AGPL-3.0 与 GPLv3 合并分发的义务。

---

## 7 · 要你拍板的

1. **先发 22.1「稳」**（6.1，推荐）：主要是因为发布件能被打开 Web Inspector。还是并进下一个大版本？
2. **SDK 0.11.1 的 Zig 约束**：Zig 留 0.16.0（推荐，SDK 只认 0.16.x）。Zig 0.17 要求 macOS 15+，将来 SDK 换 0.17 时，macOS 11–14 的用户怎么办，那时再定。
3. **首启语言的回落值**（3.1-1）：页面在系统语言不是中、英、日时现在回落中文。推荐**改成英文**（菜单本来就回落英文，法语、德语用户看英文比看中文更可能看得懂）；或者保持中文、让原生侧跟着回落中文。
4. **Stockfish 19.0.1 不升**（推荐）：强度和网络都没变，只换构建，升了要改启动代码。等有新网络或修复再一起做。
5. **Maia-3**：要不要在 23.x 立一个研究项（只量体积、加载与许可，不进产品）？
6. **证书**：没有新消息就继续等。签名、公证、自动更新仍卡在这里。
7. **`release` 环境的审核人**：22.0 加了 `environment: release`，要你在仓库 Settings → Environments 里把自己设成审核人才真的拦得住，这一步 Claude 做不了。现在设了吗？

---

## 附录 · 原始记录

- 本机环境：Linux，Node v22.23.4，Chromium 1243（Playwright 1.63 驱动），Zig 0.16.0（PyPI `ziglang`）。
- 浏览器 e2e：`test-board`、`audio`、`clock`、`walk`、`shell`、`trainer`、`content`、`persist` 一次跑完；`review`、`library`、`explorer`、`sync` / `repertoire`、`selftest`、`layout`、`engine` / `engine-flows`、`endgames`、`perf` 分三路重跑，全部退出码 0。`selftest` 日志里的 `engine boot failed: … CompileError` 是它自己的「坏引擎」用例。
- SDK 对读：`npm pack @native-sdk/cli@0.10.1` / `@0.11.1`，以及 `vercel-labs/native` 的 v0.11.1 标签；`toolchain.zig` 的 `pinned_zig_version = "0.16.0"`。
- Stockfish 19.0.1：`npm pack stockfish@19.0.1` 后比对，lite-single 的 wasm 1,787,571 → 1,845,971 字节、js 21,415 → 28,230 字节，网络文件名不变。
- 截图在评估时的临时目录里，没有进仓库；22.1 落地时由 `scripts/shots.mjs` 重新出前后对比。
