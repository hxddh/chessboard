# 25.2 · 修补与还账

写于 2026-11-26。依据是 [v25-1-plan.md](v25-1-plan.md) §5（25.1 之后的复核与下一版事项）。owner 同日：「继续，都完成后就合入发布」。

不加界面，不改存档格式。

## 这一版做了什么

| # | 依据 | 做什么 | 验收 | 落地 |
|---|---|---|---|---|
| R1 | §5 R1：截图预热在轮询循环里同步执行，冷启动仍落进页面停留 | 预热挪到启动被测应用之前（#140） | `test/automation.mjs`；#140 的 Windows / macOS 自动化作业 | ✅ |
| R2 | §5 R2：macOS 红色按钮 / ⌘W 关窗（`close_policy = "hide"`，宿主 `orderOut:`）后从访达打开 .pgn | 打开文档时没有窗口在屏幕上，就走宿主的 `applicationShouldHandleReopen:`（#140） | CI 的 macOS 编译；真机见 `manual-check.md` | ✅（待真机） |
| R3 | §5 R3：读秒时 Maia 一步不受时钟约束；候选分收 bound 行 | 计时对局里 Maia 一步限在时钟上限的一半；候选分用 `readInfo` 的规则（#140） | `test-engine.mjs` 两条行为测试；引擎两组 e2e | ✅ |
| R4 | §5 R4：自由变量放行表依赖 Node 的全局；词法不含 `$` | 放行表写死；词法含 `$`（#140） | 反证：`$probe`、`fetch` 都报出来 | ✅ |
| B1 | §5 下一版第 1 条：首屏余 281 字节 | 十局名局（`classics.js`）从首屏挪进已有的 `chunk-classics-more.js`：`classics.js` 本身一字不改（测试仍以它为数据源），只换了谁引用它；目录先空，块到了按原来的顺序填（0–9，再 10–39）。打开名局段、今天页的名局卡在块到之前等它（与残局营同一个 `whenReady`），书签停在第 11–40 局时不再先落到第 10 局 | 首屏包 819,719 → 805,763 字节；`first-paint` 新线 808,000，并断言名局不在首屏；`test-content-e2e`（S3 名局）、`test-trainer-e2e`、`test-shell-e2e`、`test-layout-e2e` | ✅ |
| B2 | §5 下一版第 2 条：`trainer/puzzles.js` 999 / 1,000 行 | 错题本与 tac/win 题「换一步也行」的两份回应合成 `puzzle-mine.js` 的 `judgeOffered` | 989 行；`test-content-e2e` 的错题本冷启动两条 | ✅ |

## 没做、留着的（同 §5）

- `openings.js`（27 KB）按需加载：六个模块同步引用，牵涉开局训练与开局浏览器，单独做。
- 截图门禁改成握手；Windows 多选打开被拆成两次取走；只下 960 的 Chess.com 月份；Stockfish 19.0.1、playwright 1.65.1、Zig 0.17。
- 真机：25.0、25.1 与这一版的几条都还没走。
