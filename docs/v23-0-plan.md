# 23.0 计划与落地记录 · 稳

依据：[review-22.0-and-v23-plan.md](review-22.0-and-v23-plan.md)（22.0.0 全面评估，2026-11-13）。

**owner 的决定（2026-11-13）**：
1. 不单发 22.1：评估 §6.1 的内容并进 23.0 发。
2. 首次启动的回落语言：英文（页面与菜单栏一致）。
3. 审批与发布由 Claude 做。
4. 棋谱库满了：导入前先问。

范围就是评估 §6.1（S1–S5）加 §5A.7 的 S2′，再加上面第 2、4 条。§6.2 的 23.x 候选（回合状态机、提示条队列、增量存档、谜题面板、Maia-3 研究）不在这一版。不加页面，存档格式不变。

---

## 落地

| # | 做了什么 | 在哪里 | 验收 |
|---|---|---|---|
| S1 | **SDK 0.10.1 → 0.11.1**；跟上游 #690 的 `webview_inspection`：`build.zig` 的 `-Dwebview-inspect`（`?bool`），`runner.zig` 的 appInfo 不给时跟构建模式（Debug 开，ReleaseFast 关） | `build.zig`、`src/runner.zig`；四个工作流的 SDK 钉 | `manifest-check --sdk`（0.11.1）通过：AppInfo 的字段 runner 都在读；两平台 `zig build test`、`zig build` 与真 WebView 场景见下面「CI」 |
| S1 | `sdk-fork.json` 按 0.11.1 重新登记 | `docs/sdk-fork.json`、`docs/sdk-fork-notes.md` | `sdk-diff.mjs <0.11.1>` 为空；`test-sdk-diff`（带 0.11.1）能从我们的文件加登记表逐字节还原三份上游文件；31 组 180 块 |
| S2-1 | 首次启动的语言：页面 `detectLang` 不认识时回落英文（`FIRST_RUN_FALLBACK`；`FALLBACK_LANG` 仍是中文源）；mac / win 原生侧遍历首选语言列表，规则同页面 | `lang-ids.js`、`mac_chrome.m`、`win_chrome.c` | `i18n-ui` 单测：`[fr]` → en、`[fr, ja]` → ja、`[de, zh-TW]` → zh-CN、空 → en。原生侧只能在真机核对（`docs/manual-check.md`） |
| S2-2 | 等待期间设预走不再弹「已预走」，失着提醒留在屏上 | `app.js` `premoveClick` | `test-engine-flows-e2e`「失着提醒」：设预走之后提示仍在 |
| S2-3 | 「失着提醒」e2e 改成等对手真的应着（存档到第 6 个半着）再断言提示已收；补上 F4 的原验收「对手应着后预走被走出」 | `test-engine-flows-e2e.mjs` | 同上，新增两条 |
| S2-4 | 构建工作流：`build` 只读，上传发布件的是新的 `publish`（只在有 tag 时、不检出代码、只拿 `build` 的 artifact）；`paths` 加 `src/web/**`、`package*.json`、`bundle.mjs`、`sync-dist.mjs`；PR 的新推送取消旧的那次 | `build-macos.yml`、`build-windows.yml` | `scripts/test/automation.mjs` 改写：只有 `build` 传 Chessboard-* artifact，只有 `publish` 上传发布，`build` 只读，有 `concurrency` |
| S3 | 声音：补放设置出错不留下被拒绝的 promise；每个设置只留最后一次；取不到时 10 s 内不再重取 | `audio-lazy.js` | `test-audio-e2e` |
| S3 | 今天页「继续 / 从这里开始」：键写在元素上，切语言不再被改回 | `today-page.js` | `test-shell-e2e` |
| S3 | 「按定级暂定」只在真做过定级时 | `today-page.js` | `test-shell-e2e` |
| S3 | 课程同样的错连续两次，`#lesson-fb` 先清空再写，读屏再读一遍 | `trainer/lessons.js` | `test-content-e2e` |
| S3 | 复盘跳到第一处关键时刻时往 `#board-live` 写一句 | `review/moments.js` | `test-review-e2e` |
| S3 | `eco-lookup.js` 两段注释改成 B5 之后的说法；工作流注释 13 → 17 页 | — | — |
| S2′ X1 | 自研解析器读不了的文本，超过 64 KB 或括号嵌套超过 64 层就不交给 chess.js 的 `load_pgn`（它去变着是平方级） | `pgn.js` `legacyReadable`；`io.js`、`app.js` 两处调用 | `rules` 单测：2 万层嵌套被拦下 |
| S2′ X2 | 删掉没人调用的 `chess.writeTextFile` | `bridge.zig`、`host.js` | `manifest-check`：应用桥 16 → 15 个命令，且新加一条「不许再注册回来」；`test-persist` 的分块写入改用 appdata 那一对验证 |
| S2′ X3 | 系统「打开」送来的路径也过 `pathAllowed` | `bridge.zig` `appendIssuedPath` | `zig build test`（CI） |
| S2′ X4 | `stripResult` 不再用会回溯的正则 | `pgn.js` | `rules` 单测：8 万个空格 0 ms |
| S2′ X5 | 同步请求 `.redirect_behavior = .unhandled`：3xx 当作失败的状态码 | `sync.zig` | `zig build test`（CI） |
| X6 | 棋谱库满了先问会挤掉几局；取消则什么都不动（局面索引也收回） | `library-page.js`、新键 `lib.dropAsk`（三语） | `test-library-e2e` C1：1 万局的库再导 1 局，先问；取消后原样；确定后进 1 出 1 |
| S4 | lichess chess-openings c67912be → 3ba6b20：3,815 → 3,865 个局面；Mieses-Kotroc 改名 Mieses-Kotrč | `eco.js`（生成） | `test-eco`（无定名登记跟着改名） |
| S5 | 依赖清单更新到 2026-11-13 | `docs/deps-inventory.json` | `test-deps` |

**没做的**（评估里提过、这一版不做）：
- 3.1-7（WKWebView 下第一声可能静音）：要真机听，记进 `docs/manual-check.md` 等真机。
- 截图走查里的低优先级几条（命令面板底部提示压住最后一行、引擎起不来时复盘区没有「重试」、「人会怎么走」等 Maia 时的「…」）：留给 23.x。
- R03 / R04 / R05 / R11 / B07 / B12 这几笔 SDK lag：0.11.1 上游在这些地方和 0.10.1 相同，照原建议留到下一次升级一起还。

## 测试

- `npm run test:static`：24 个文件全过（本机，Node 22）。
- 浏览器 e2e（本机 Chromium，三路并行）：19 组都跑过，全过。`test-library-e2e` 第一次红在新加的「库满先问」读问句的选择器上（`.confirm-msg` 先碰到新局对话框里藏着的「会结束当前这盘」），改读 `#confirm-message` 后重跑通过。
- `zig ast-check`：改到的 Zig 文件本机过；编译与 `zig build test` 只在 CI 上（本机对 0.11.1 的编译被会话的安全检查拦下）。

## CI（PR #135）

- b0ae0b3（只有 S1）：`checks`、`build-macos`、`build-windows` 全绿：SDK 0.11.1 在两个平台上编过、单测过、真 WebView 场景过。
- eb6a04a：`zig (macos-latest)` 红在 `bridge.zig` 的命令计数单测（16 → 15，删 `chess.writeTextFile` 时漏改），e233271 修。
- e233271：`browser (chromium/webkit, game library)` 红在上面那个选择器（b443adf 修）；`panel layout 1/5` 红在首启语言：de-DE 原来断言回落中文，按 23.0 的决定改成英文（261f077）。
- 261f077：`checks`（三个系统的静态测试、Chromium 与 WebKit 两套浏览器 e2e、两平台 `zig build test` / `zig build`）、`build-macos`、`build-windows`（真 WebView 17 页）全绿。
