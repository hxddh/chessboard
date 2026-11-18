# 24.0 计划与落地记录 · 说对

依据：[review-23.0-and-v24-plan.md](review-23.0-and-v24-plan.md)（23.0.0 全面评估，2026-11-18）。

**owner 的决定（2026-11-18）**：
1. 不单发 23.0.1：评估 6.1 的 H1–H4 并进 24.0；
2. Windows DevTools 只在我们的构建里打补丁，不给上游提 issue；
3. 认输照旧按负计，写明；
4. 定级后保留好上手的对手，写明；
5. 主题「说对」，范围按评估 6.2；
6. 节奏：24.0 做完后不立即发——距 23.0（2026-11-14）至少两周（2026-11-28 起），并在真机上走一遍 `manual-check.md`「24.0 真机核对」再发；
7. `release` 环境暂时不设审核人。

不加页面，存档格式不变。

---

## 1 · 落地

| # | 做了什么 | 在哪里 | 验收 |
|---|---|---|---|
| H1′ | **双击 .pgn 打开这局棋**。评估初稿说是 23.0 的回归，落地前核对发现这条路从来没通过：SDK 没有「打开文件」事件，`main.zig` 不读 Windows 的启动参数，页面也没有订阅。现在：Windows 在 `main()` 读启动参数；macOS 在 `mac_chrome.m` 里于 `NSApplicationWillFinishLaunching` 时接管 `kAEOpenDocuments`，路径排进队列；新桥命令 `chess.takeOpenFiles` 取走并签发；页面在启动时与窗口回到前面时来取，和拖放走同一条导入。路径规则 `openPathAllowed`：绝对路径、`.pgn`、没有以点开头的组件；不再借用拖放的「主目录或可移动卷」规则（那会拒掉 iCloud、邮件附件、`C:\chess`、zip 的临时目录）。死代码 `forwardOpenFiles` 等删除 | `src/main.zig`、`src/bridge.zig`、`src/native/mac_chrome.m`、`host.js` `onOpenFiles`、`app.js` | `bridge.zig` 单测：iCloud / CloudStorage / Mail Downloads / `/Users/Shared` / `C:\chess` / `%TEMP%` / UNC 放行，点文件、`..`、相对路径、非 .pgn、`\\?\` 拒绝；待打开列表的上限。`test-persist-e2e` 两条：启动时取到一个、窗口回到前面再取一个。**真机**：`manual-check.md` 24.0 第 1–2 条 |
| H2 | **Windows 关 DevTools**：编译一份 `webview2_host.cpp` 的副本（Apache-2.0，文件头注明），`get_CoreWebView2` 之后在没有检查能力的构建里 `put_AreDevToolsEnabled(FALSE)`；`linkPlatform` 多一个 `inspect` 参数，与 runner 的 `webview_inspection` 同一规则 | `src/native/webview2_host.cpp`、`build.zig`；`docs/sdk-fork.json` B16 | `sdk-diff`（0.11.1）为空；`test-sdk-diff` 能还原四份上游文件；**真机**：24.0 第 3 条 |
| H3 | `confirmNative` 排队；「库满先问」期间持有导入锁；`noEvict` 的导入（18.0 存档槽迁移）满了就不导、不问 | `notices.js`、`library-page.js`、`save-slots.js` | `test-library-e2e`（库满三条）通过 |
| H4 | `noteClock` 按方去重；复盘播报按 `firstMover`；等待期间设预走写进 `#board-live` | `audio-lazy.js`、`review/moments.js`、`app.js` | `test-audio-e2e`；静态 |
| T1 | 看过答案：不写「解出！」、不画绿勾、不响胜利音，反馈卡用中性的「眼睛」（新键 `pz.answeredNext`）；答错提示按答案着法的性质（`pz.findMotifCapture` / `pz.findMotifQuiet`）；定级做对的题记为已解，今天的「题」计入定级的作答（`rhist` 的定级记录带 `n`） | `trainer/puzzles.js`、`trainer/puzzle-modes.js`、`today-page.js` | `test-trainer-e2e`、`test-board-e2e` |
| T2 | 第一盘从定级分数起算（`fileRating` 的 `seed`，rd 200）；今天页与「我的」写「暂定」，「我的」从第一盘起就有对局分；终局条认输时写「认输按负计」（`go.resignLoss`） | `opponents.js`、`opponents-lazy.js`、`today-page.js`、`me-page.js`、`opponents-ui.js` | `test-shell-e2e`、`test-engine-flows-e2e` |
| T3 | 复盘提示条只数自己的失着（与 `keyMoment()` 同一判断）；`hl.head` 写「和你水平相近的人」；重试中卡片不出「再试一次」；走对了不再列引擎同一步、不再讲原来的错 | `review/analysis.js`、`review/moments.js`、`review/retry.js` | `test-review-e2e`、`test-engine-flows-e2e`（「人会怎么走」两条改了文字） |
| T4 | 课程走错：check / mate / capture / safe 四类目标先说这一步实际做了什么（`lm.why.*` 五个键） | `trainer/lessons.js` `moveFact` | `test-content-e2e` |
| T5 | 提示条：带动作的那条在屏上时，普通告知不顶掉它，等它收起后 3 秒内再说 | `notices.js` | `test-engine-flows-e2e`「失着提醒」 |
| T6 | 新对局的五张卡在对话框打开时定下；定级结果卡改写（`run.placedSub`） | `opponents-ui.js` | `test-board-e2e`（定级文字一条改了） |
| T7 | 谜题面板：「这一类」在时顶上的「已解」不显示；没有分数的「等级分 —」不出现 | `trainer/puzzle-modes.js` | `test-trainer-e2e` |
| T8 | 今天页至少 6 次作答才说「弱项」；对局历史写对手名字 | `trainer/today.js`、`app.js` | `test-shell-e2e` |

**没做的**（评估里提过、这一版不做）：
- W11 的位置（提示条移出对手栏）：放置规则（`toast-place.js`）是 7.7 定的「不盖棋盘」，改它是版式决定，这一版只做了「不被顶掉」那一半。
- W5（精准度与平均失分的口径）：核对后是两种量法（胜率模型 vs 厘兵），不是错；说明口径留给 24.x。
- W8 只改了说法（owner 决定保留好上手的对手）。
- W12（对手用时与低档吃子）、W14（定级时的提示按钮与编号）、W16（棋盘右侧的两个数字）、「我的」页的课程进度：留给 24.x。
- 回合状态机：24.x。

## 2 · 预算

- `app.js`：4,765 / 4,777 行。
- 首屏包：量得约 815 KB；线从 815,000 挪到 818,000（`first-paint.mjs` `BUNDLE_BYTES_240`）。这一版没有往外搬代码，下一版还回来。
- `trainer/puzzles.js`：999 / 1,000 行。

## 3 · 测试

见 PR #136 与下面的 CI 一节。

## 4 · CI

见 PR #136。
