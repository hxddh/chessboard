# 25.0 计划与落地记录 · 一本账

依据：[review-24.0-and-v25-plan.md](review-24.0-and-v25-plan.md)（24.0.0 全面评估，2026-11-19）。

**owner 的决定（2026-11-19）**：
1. 不单发 24.1：评估 6.1 的 F1–F12 并进 25.0；
2. Windows 单实例，双击的文件转给已开的窗口；
3. 复盘重试按胜率判，理由只说真的应着；
4. 第一盘的种子 rd 200 → 150；
5. 主题「一本账」，范围按评估 6.2，「对手用时像人」放进来；
6. 失着提醒移到棋盘下沿；
7. 真机核对：这一版不走。

沿用 24.0 的节奏：做完、CI 全绿就发。不加页面，存档格式不变。

---

## 1 · 落地

### 24.0 没说对的（评估 6.1）

| # | 做了什么 | 在哪里 | 验收 |
|---|---|---|---|
| F1 | 「认输按负计」只在你认输时写；电脑认输的胜局不写 | `opponents-ui.js`（`resigned === humanColor`）、`today-page.js`（再看 `result === "loss"`） | 代码核对（评估 2.1 P1 已对源码复核） |
| F2 | 带按钮的提示条自己到时收起，也走 `dismissToast()`，排着的那句说出来；排着的话 12 s 内有效（原来 3 s，比带按钮的提示条本身还短） | `notices.js` | 现有 e2e（失着提醒期间设预走）全过 |
| F3 | 一次打开几个 .pgn：第一个上棋盘，其余进棋谱库 | `app.js` `openPaths` | `test-persist-e2e`：一次三个，三个都读 |
| F4 | 页面在可见时每 1.5 s、拿到焦点时去取待打开的文件：macOS 前台时从 Dock 打开不用再切窗口 | `host.js` `onOpenFiles` | `test-persist-e2e`：没有焦点事件，两秒内载入 |
| F5 | **Windows 单实例**：命名互斥量；后来的启动把路径写进 appdata 的 `open-queue.txt`、`AllowSetForegroundWindow` 后退出；已开的那个取文件时读掉队列并把窗口提到前面 | `win_chrome.c`、`main.zig`（`forwardLaunchArgs` / `takeOpenQueue`）、`bridge.zig` | CI 两平台 `zig build` / `zig build test` 与真 WebView 场景全绿。**真机未走**（owner 决定） |
| F6 | CI：离线装旧镜像的包失败、改走 apt 时，用这次下载的全集重建缓存目录（不再把装不上的旧包带进新键） | `scripts/ci-browser-deps.mjs` | 代码核对；要等下次换镜像才走到 |
| F7 | 复盘重试按胜率差判（`Review.winPctDrop` < `WIN_MISTAKE`，和复盘标记同一把尺子）；对方的应着只在吃子、将军时点名；走对的就是引擎那一步时不再列「引擎的最佳」 | `review/retry.js` | `test-review-e2e` A4 改为断言不再列；`test-engine-flows-e2e` 重试两条全过 |
| F8 | 课程完成时清掉上一次走错的反馈（反馈的键带上「完成」） | `trainer/lessons.js` `fbAt` | `test-content-e2e` 全过 |
| F9 | 定级后配的对手用该档自己的人设与风格（`solid` 档是雷米，不再叫 Stockfish；英文对话框也就有一张选中的卡） | `app.js` `onPlaced` | 代码核对 |
| F10 | 看过答案的谜题，状态行写「看过答案 · 下一题」（新键 `st.puzzleSeen`）；新对局对话框还没有对局分时写定级的暂定水平（`ng.placedRating`）；终局条只挂对局成就 | `app.js`、`opponents-ui.js`、`game-end.js` | 静态测试；e2e 全过 |
| F11 | 打开的路径：拒 WebDAV 形式的 UNC 主机（`\\host@SSL\…`）与设备名（`CON.pgn`、`COM1\…`）；普通网络共享照旧可开 | `bridge.zig` `openPathAllowed` / `isDeviceName` | `bridge.zig` 单测五条新断言；本机用 Zig 0.16 单独跑过这段规则与测试 |
| P7 | 第一盘的种子 rd 200 → 150：定级 1375 认输一盘掉约 100 分（原来约 170） | `opponents-lazy.js` | `fileRating` 实算 |

### 一本账（评估 6.2）

| # | 做了什么 | 在哪里 | 验收 |
|---|---|---|---|
| L2 | 「复盘完成」的提示条数的就是关键时刻卡片那张表（`Grade.keyMoments`，同一方），说「N 个关键时刻」（新键 `msg.analysis.doneMoments`，删 `doneBad`） | `review/analysis.js` | F4 文案对照表改为新说法；e2e 全过 |
| L1（部分） | 「首答」同一题错过之后再错（看答案重做）不再记第二次；谜题面板写「这一类已解 x/N」，不再像总数 | `trainer/puzzle-rating.js`、三语 `pz.solvedCount` | `test-trainer-e2e`「重开再答错，主题和总评级都不再算第二次」 |
| L3 | 错题回到复习时，是刚错的那题就说「复习：刚才那题再来一次」（`pz.smart.again`）；第二次提示画出答案时收掉第一次的「再按一次看答案」 | `trainer/puzzles.js`、`trainer/puzzle-hint.js` | `test-trainer-e2e` 认新说法 |
| L4 | 吃子任务走了不吃子的着法，不说题目写死的「吃它会……」，说通用的「没达成目标」；课文「去「模式 → 做题」」改为「去「谜题」」（三语）；「说明」改叫「重看课文」；从长列表选课后滚到任务卡 | `trainer/lessons.js`、`lessons*.js`、`index.html` | `test-content-e2e`、`test-trainer-e2e` 全过 |
| N12 | 「一盘赢棋被逆转」不从开局算（第 7 回合起的峰值） | `review/moments.js` | 代码核对 |
| — | **对手用时像人**：不计时的对局里，停顿 = 档位下限 × 系数：只有一步 ×0.4、应将 ×0.6、回吃 ×0.55、开局前 10 半回合 ×0.55；其余按着法数、可吃子数、子力失衡加长；按 FEN 取确定的 ±15% 抖动；夹在 0.35–1.7 倍。580 个局面的平均约 1.02 倍。计时对局（`thinkPlan`）不变，着法不变，失着提醒后的等待不变 | 新文件 `think-time.js`（在对手分块里，不进首屏）、`engine.js` 一行、`opponents-chunk.js` | `scripts/test/opponents.mjs` N13：三档上只有一步 / 应将快于复杂中局，均值在 ±15% 内，同一 FEN 同一停顿；`test-engine-flows-e2e` 全过 |

**没做的**（评估里提过、这一版不做）：
- **L1 的大半**：没有做成一个 `tally.js` 让六处都读它；只修了「首答」重复计数和「已解」的口径说明。今天页「题」是作答次数（过了目标只写数字，18.0 R6 的设计），和「已解」不是同一个量，没有改。
- **L5 今天页**：「今天的目标完成了」旁边仍可能有「先清复习」（计划卡在目标完成后照样给下一步）；课程页打开的那课和今天推荐的那课不一定是同一课。
- **L6 骨架**：回合状态机没做；首屏包没有还到 815,000（现在 817,836，线仍是 818,000）。要把复盘重试或评估图拆成按需加载的分块，牵动棋盘每一帧的绘制，这一版不动。
- N17（复盘后「新对局」在屏外）、N19（深色下自己吃到的子对比度低）、W14、W16、W17、W5 的口径说明：留给 25.x。
- 谜题的难度在答错后会变（同一题 1615 → 1666）：这是题目自己的等级分在动，设计如此，没有改。

## 2 · 预算

- `app.js`：4,769 / 4,777 行（24.0 是 4,765）。
- `trainer/puzzles.js`：999 / 1,000 行（新加的一处并进了已有的一行）。
- 首屏包：817,836 / 818,000 字节。打开文件的轮询收成一个定时器才回到线下；对手用时的逻辑在对手分块里。

## 3 · 测试

- `npm run test:static`：24 个文件全过（本机）。
- `test-persist-e2e`（本机）：全过，含新加两条。
- CI 见 PR #138。

## 4 · CI

见 PR #138。
