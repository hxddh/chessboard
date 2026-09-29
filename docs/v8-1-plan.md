# 8.1 · 把 8.0 没做完的做完，把手里已有的 SDK 能力用起来

写在 8.0 的 M5（C1 数据库、C2 同步、C3 开局浏览器、A6 品牌）还在 `m5` 分支上合并、8.0.0 还没发布的时候。规矩照旧：

- 每条写**依据**、**做什么**、**验收**；
- 发布前补**落地记录**，做到的和没做到的都逐条写。

这一版有两个来源：

1. **8.0 §9 落地记录里写明的偏离、没过的验收和推到 8.x 的事**。8.0 是一个大版本，每个里程碑都诚实地记下了没做到的地方，这些是 8.1 最确定的待办。
2. **依赖与 SDK 的审计**。用户的要求是：底层组件和 SDK 有新版本的，下一版必须升级，并且把新特性、新能力用足。§1 是这次审计的结果，机器可读的清单在 `docs/deps-inventory.json`。

§1 的结论先说在前面：**这次没有需要大动的升级**。SDK、Zig、Stockfish、题库、大师对局库都已经是最新的正式版；真正的「新能力」不在新版本里，而在**我们已经钉住的 SDK 0.10.1 里还没用上的那部分**。所以 8.1 的主线是「用足」而不是「升级」。

8.0 的产品主张不变：**用户打开这个应用，能像打开 Lichess 或 Chess.com 一样，找到一整套下棋、训练、复盘、管理自己对局的东西，而且每一样都做得扎实。** 8.1 不加新支柱，只让 8.0 的三根支柱站稳。

---

## 依据

1. **8.0 计划全文**：
   - §6「这一版不做的」；
   - §9 M1–M4 的落地记录（main）；
   - M5 的落地记录（`git show m5:docs/v8-0-plan.md`）；
   - `m5:docs/manual-check.md` 的 A0 真机清单。
2. **依赖审计**（2026-09-29）：
   - npm registry：`npm view … dist-tags / time`；
   - 公开仓库的 `git ls-remote --tags`，SDK 仓库整个克隆下来读了 CHANGELOG、文档和源码；
   - Stockfish.js 的 npm 包下载后和仓库里的文件逐字节比对；
   - Playwright 与 esbuild 的发布说明；
   - database.lichess.org 的文件时间戳。
3. **读代码**：
   - `src/main.zig`、`src/runner.zig`、`build.zig`；
   - `app.zon`；
   - `.github/workflows/*.yml`；
   - `scripts/bundle.mjs`、`scripts/selftest-app.mjs`。

**这次审计的局限**：

- **网络策略拦截**（代理 403），下面三处**未能核实**：
  - ziglang.org 的官方下载索引、codeberg.org 上的 Zig 仓库。Zig 的最新版以 PyPI 的 `ziglang` 镜像为准。
  - lichess.org 与 api.chess.com。和 M5 一样，C2 的样本仍然没有和真实应答比对过。
- **GitHub releases API**：本会话只开放本仓库，所以 download-artifact v8、chess.js 1.x 的逐条发布说明没读到。标签是用 `git ls-remote` 核过的。
- **没有 macOS / Windows 桌面**：凡是「SDK 的这个能力在真机上表现如何」，都只读了源码和文档，没有跑过。

---

## 0 · 结论先行

### 版本号：8.1，不是 9.0

- **没有破坏性的升级**。可以升的只有 esbuild（补丁版）、Playwright（小版本）、两个 GitHub Action，外加一份 ECO 数据刷新。唯一的大版本升级候选是 chess.js 1.x，而它不值得升（§1.4）。
- **范围**：8.0 的收尾，加上几条原生能力。不改产品结构，不动存档格式的大版本（SCHEMA 仍是 2），不改布局不变式。
- **什么时候才需要 9.0**：下面任何一件发生，都够得上一个大版本：
  - 换引擎形态：原生多线程 Stockfish，或完整 NNUE（约 99 MB）；
  - 把棋谱库从 IndexedDB 搬到 SDK 的 SQLite；
  - SDK 出 1.0 并有破坏性改动；
  - 加 Chess960 或第四种语言。

  这些都不在 8.1 里。

### 8.1 的三个主题

| | 主题 | 一句话 |
|---|---|---|
| **N** | 原生能力用足 | 把 SDK 0.10.1 里已经有、我们没接的东西接上：异步桥、原生侧文件对话框、打包自检覆盖 IndexedDB、（可选）macOS 签名更新 |
| **F** | 地基收尾 | 依赖对齐；主包预算重新定规矩；8.0 没达标的两条硬指标（app.js ≤ 6,000 行、首启整份写入 ≤ 16 ms）；引擎调度器 |
| **T** | 训练与你的棋补完 | 阶梯上半段补档；§6 推过来的残局训练营与「你的开局书」；同步 2.0；诊断与导出算上本机对局 |

---

## 1 · 依赖与 SDK 审计

### 1.1 清单

| 组件 | 钉在哪里 | 现在 | 最新（2026-09-29） | 建议 |
|---|---|---|---|---|
| Native SDK（`@native-sdk/cli`，vercel-labs/native） | 四个 workflow 的 `SDK_VERSION` / `sdk_version`；`src/runner.zig`、`build.zig` 是 SDK 文件的分叉与手抄 | 0.10.1 | 0.10.1（npm latest，2026-08-24）；main 上另有 22 个未发版提交，HEAD `96943d4a`（2026-09-28） | **等 0.10.2 发布再升**；0.10.1 里没用上的能力 8.1 就用 |
| Zig | `build.zig.zon` `.minimum_zig_version`；三个 workflow 的 `mlugg/setup-zig version` | 0.16.0 | 0.16.0（PyPI 镜像，2026-04-15；官方索引未能核实） | 不需要 |
| Stockfish.js | `third_party/stockfish/`，`scripts/gen-engine-src.mjs` | 19 lite-single | npm `stockfish` 19.0.0（2026-09-15），**与仓库逐字节相同**；官方 sf_19（2026-09-05） | 不需要 |
| chess.js | `src/web/js/chess.js`（vendored，文件头） | 0.13.4 | 1.4.0（2025-06-14） | 不升 |
| esbuild | `package.json` / `package-lock.json` | 0.28.1 | 0.28.2（2026-08-08） | **8.1 升** |
| Playwright | `checks.yml`、`release.yml`（`npm install --no-save`） | 1.62.1（Chromium 151 / WebKit 26.5） | 1.63.0（2026-09-04，Chromium 153 / WebKit 26.6） | **8.1 升** |
| Node | 各 workflow `node-version`；`package.json engines` | 24 | 24.21.0 LTS；26.10.0 Current（未进入 LTS） | 不需要（26 进入 LTS 后再议） |
| actions/checkout | workflows | @v7；**`nightly.yml:31` 还是 @v5** | v7.0.1 | **8.1 改掉那一处 @v5** |
| actions/download-artifact | `release.yml` | @v7 | v8.0.1 | **8.1 升**（大版本，演练一次 release） |
| actions/setup-node、upload-artifact | workflows | @v7 | v7.0.0 / v7.0.1 | 不需要 |
| mlugg/setup-zig | workflows | @v2 | v2.2.1（@v2 已自动跟上） | 不需要 |
| Lichess 题库 | `src/web/js/lichess/*` 文件头 | 2026-09-09 | 2026-09-09（Last-Modified） | 不需要 |
| Lichess 大师对局 | `m5` 的 `explorer/masters-*.js`、`build-explorer.mjs` | 2026-08 | 2026-08（list.txt 第一行） | 不需要 |
| chess-openings（ECO） | `src/web/js/eco.js` 文件头 | `4b86227` | `c67912be`（2026-09-20，补了几条 E16 线） | **8.1 刷新数据** |
| 棋子图、字体 | `pieces-*.js`；系统字体栈 | M2 核过许可 | 无版本 | 不需要 |

### 1.2 Native SDK：已经最新，但我们只用了它的一小半

**版本事实**：

- npm 上 `@native-sdk/cli` 的 latest 就是我们钉的 0.10.1。GitHub 上的标签只到 v0.9.5，0.10.0 / 0.10.1 只发在 npm 上。
- main 上 0.10.1 之后有 22 个提交，还没有发版。和我们相关的有：
  - `#465`：优化构建的 macOS 链接保留更新器导出。我们的 release 用 `-Doptimize=ReleaseFast`，**开启更新器之前应该等这个修正发版**。
  - `#464`：清单校验拒绝带通配符的外链白名单。我们的 `app.zon` 没有通配符，不受影响。
  - 其余是 TypeScript 核心、画布滚动、iOS 与 Linux 的修正，和这个应用无关。

**0.10.1 里已经有、我们还没用的能力**（逐条读过源码与文档）：

| 能力 | 在 SDK 哪里 | 能解决 8.0 的哪件事 |
|---|---|---|
| **异步桥**：`bridge.AsyncHandler` + `AsyncResponder`；任意线程可以调用 `PlatformServices.wake_fn`，让平台循环在自己的线程上收到 `.wake` 事件 | `src/bridge/root.zig`、`src/runtime/async_bridge.zig`、`src/platform/types.zig` | C2 记着：「原生请求是同步的，会占住桥所在的线程（与检查更新相同）」。换成异步处理器，在工作线程里做 HTTP，收尾回到循环线程应答 |
| **原生侧文件对话框**：`PlatformServices.showOpenDialog / showSaveDialog` | `src/platform/types.zig:3298-3308` | F3 记着：「文件对话框的路径仍要经 `issuePath`：对话框是 SDK 内建命令，原生侧拿不到它的结果；彻底去掉要等 SDK 支持」。**其实不用等**：自定义命令 `chess.openPgn` / `chess.savePgn` 在 Zig 里直接弹框，路径不出原生层 |
| **签名更新器**（0.10.0）：Ed25519 签名的更新源、下载校验、原地替换、失败回滚、重启 | `docs/updates`；我们的 `runner.zig:68-76` 已经接好，`app.zon` 没有 `.updates` 块，所以现在是关的 | 8.0 §6「签名、公证与自动更新：仍然缺证书」。**更新不需要 Apple 证书**：ad-hoc 签名的包可以只走 Ed25519 这一条信任链。限制是只支持 macOS 的 system host，Windows 还不支持 |
| **公证**（0.10.1）：notarytool 钥匙串配置、DMG 装订 | CHANGELOG 0.10.1 | 仍然需要 Developer ID 证书，8.1 不做 |
| **最近文档**：`native-sdk.os.addRecentDocument` | 内建命令，默认拒绝，要写进策略 | 打开过的 .pgn 进 Dock /「文件」菜单的最近列表（小项） |
| **系统通知**：`native-sdk.os.showNotification` | 内建命令 | 可选的「今天的训练」提醒。**不建议做**：和「只在用户主动时打扰」的叙事冲突，只列在这里备查 |

**0.10.1 和 main HEAD 都还没有的**：

- **WebView 页面的窗口拖动区**：
  - macOS：`window-drag` 只接给了画布控件。`types.zig` 的注释写明 macOS 靠 `performWindowDragWithEvent:` 从实时指针手势发起，不走镜像；页面既不能声明可拖区域，也不能发起拖窗。**所以 A6 的透明标题栏在 8.1 仍然做不成**。
  - Windows：WebView2 宿主有按 view label 存的拖动区，`WM_NCHITTEST` 命中时返回 `HTCAPTION`（`webview2_host.cpp:2462-2486`）。原生侧给 `main` 设拖动区能不能对 WebView2 生效，要做实验。M5 结论里「Windows 上会让窗口拖不动」说的是只加 `hidden_inset`、不设拖动区的情况。
  - 文档互相矛盾：`native-ui` 页写 Win32 保留标准外框，`platform-support` 页写 Win32 会把标题栏条带交给应用。要以真机为准。
- **zero:// 的响应头**：asset scheme handler（`appkit_host.m:8475`）不发 COOP/COEP，所以页面拿不到跨源隔离，也就用不了 `SharedArrayBuffer`。多线程 wasm 引擎因此不可行。
- **Windows / Linux 的自动更新**。

**文档与源码不一致的一处**：bridge 文档写单帧 16 KiB，0.10.1 源码是 `max_message_bytes = max_result_bytes = 1 MiB`（`src/bridge/root.zig:5-7`）。我们的 `BRIDGE_FRAME_MAX` 按源码定，并有编译期断言，没有问题。

**升级的代价**（0.10.2 或以后）：

- `src/runner.zig` 是 SDK `app_runner` 的分叉，`build.zig` 是 SDK `build/app.zig` 的手抄本；0.8.0 出过「上游多了一个源文件，我们的手抄本没跟上」的事故（`release.yml` 的注释）。每次升级都要对照上游这两个文件的 diff。
- `manifest-check.mjs --sdk` 会抓出清单里没人读的键。

**建议**：8.1 不等 SDK，先把 0.10.1 里现成的能力用上（N1–N4）。0.10.2 一发布就单独一个 PR 升级，验收是双平台构建、打包自检、`zig build test` 全绿。

### 1.3 Stockfish：已经最新；换构建不划算

- 仓库里的 `stockfish-19-lite-single.{js,wasm}` 和 npm `stockfish@19.0.0` 里的同名文件 sha256 相同。官方 sf_19 发布于 2026-09-05，之后只有 dev 构建。
- sf_19 的发布说明写着：对 SF18 最多 +44 Elo，NNUE 架构与训练更新。我们在 7.x → 8.0 已经换过 19，档位标定（`measured.json` 的 `ladder`）用的就是它。
- 同一个包里的另外四种构建都不换：

| 构建 | 为什么不换 |
|---|---|
| lite 多线程（1.6 MB） | 要 `SharedArrayBuffer`，也就是跨源隔离；zero:// 不发 COOP/COEP（§1.2） |
| 完整 NNUE 单线程 / 多线程（约 99 MB） | 安装包从约 10 MB 涨到 100 MB 以上；对「比任何人类都强」的档位没有可感知的收益 |
| asm.js | 更慢、更弱 |

- **8.1 在引擎上要做的是调度，不是换引擎**：8.0 §6 推迟的「引擎调度器」，见 F4。

### 1.4 chess.js 0.13.4 → 1.4.0：不升

- 1.0 起是破坏性大改：API 全部改名为 camelCase，非法着法改为抛异常，用 TypeScript 重写。1.x 各小版本的逐条新增没能核实（上游仓库已经没有 CHANGELOG，releases API 不可用）。
- `src/web/js` 下约 13 个模块直接引用它。
- 热路径已经不靠它了：局面键在 `fide.js`，开局浏览器的回放是 `explorer/replay.js`（M5 实测比 chess.js 快 10–20 倍）。
- 升级的回归面很大，收益看不出来。继续 vendored，文件头照旧写明版本。

### 1.5 构建与测试工具

- **esbuild 0.28.2**：
  - 补丁版，两处修正：TS import 别名的 tree-shaking、CSS 压缩里的 `&`。
  - 我们 `minify: false`、不写 TS，**预期产物逐字节不变**。这本身就是验收。
  - 另外：这次审计发现 `bundle.mjs` 从来没开过 `minify`。它和主包预算直接相关，见 F2。
- **Playwright 1.63.0**：
  - 对我们有用的：WebKit 26.5 → 26.6，离 WKWebView 更近；Chromium 151 → 153；`Locator.visible()`；`ariaSnapshotJSON()`，可以替掉一部分手写的无障碍树断言；独立的 `reducedMotion` 选项。
  - 用不上的：test locks、报告器的新特性。我们只用库 API，不用 test runner。
  - 风险：浏览器版本一动，布局测量和截图基线可能跟着移动。所以单独一个 PR，两套引擎各跑全套。
- **Node**：24 仍是 LTS（24.21.0）。26 进入 LTS 以后再评估，那时要重跑一次题库导入的核对，因为 `import-puzzles` 依赖 Node 的 zstd。
- **GitHub Actions**：
  - `nightly.yml:31` 的 `actions/checkout@v5` 是遗漏，改成 @v7；
  - `download-artifact` v7 → v8 是大版本，变更说明未能核实。升级时用 workflow_dispatch 演练一次 release，证明两个平台的包都下载进了 `dist/`。

### 1.6 数据

- **题库、大师对局库**：都是最新一份，不动。大师树每月刷新没有意义：前 16 个半回合的分布一个月内几乎不变，刷新只会让安装包无谓地变。
- **ECO 表**：上游在我们取数之后合了一个 PR（#399，E16 的几条线）。重跑 `gen-eco`，同一个 PR 里跑 `test-eco` 和开局浏览器的「书」核对（1,011 个分支点）。

### 1.7 让这份清单不再过期

- `docs/deps-inventory.json` 是这次审计的机器可读版本，包括每一项钉在哪里、查的来源、日期和建议。
- 8.1 加一个 `scripts/deps-check.mjs`，放进 nightly。它读这份清单，对 npm 上能查的几项（SDK、esbuild、Playwright、stockfish）比较 latest；有新版时，nightly 的摘要里多一行，**不让 CI 失败**。
- 静态守卫：清单里的 `current` 与 workflow / package.json 里实际钉的版本一致。改版本忘了改清单，当场红。

---

## 2 · N：原生能力用足

### N1 异步桥：同步与检查更新不再占住桥线程【M】

**依据**：

- C2 的落地记录：「原生请求是同步的，会占住桥所在的线程（与检查更新相同），耗时要在真机上量」。A0 第 6 条要求在真机上记下窗口是否卡住。
- `checkUpdate`、`fetchGames` 现在都是同步处理器（`m5:src/main.zig:82-83`），在处理器里直接用 `std.http.Client` 发请求。Chess.com 最多要取三个月，也就是 1 + 3 个请求，串行完成。
- SDK 0.10.1 已经有 `AsyncHandler` 和跨线程的 `wake_fn`（§1.2）。
- C2 为了主包预算，只能「每次取最近 20 局、不设选择」。同步不再卡窗口以后，才值得加进度和选项（T4）。

**做什么**：

- `chess.fetchGames` 和 `chess.checkUpdate` 改为 `AsyncHandler`：
  - 处理器只校验参数、占一个槽位（上限 2 个，同时只允许一次同步、一次检查更新），然后起一个工作线程；
  - 工作线程做 HTTP，把结果放进带锁的完成队列，调用 `wake_fn`；
  - runner 收到 `.wake` 事件，在循环线程上排空队列，调用 `responder.success / fail`。
- 页面不用改协议：桥对页面仍然是一个 Promise。
- 超时：用独立的截止时间，而不是 `std.http` 的整体阻塞。`m5:src/main.zig:1354` 的注释写明 Zig 0.16 的 `fetch` 没有逐次超时。
- 应用退出时有未完成的请求：丢弃结果，不在退出路径上等网络。

**验收**：

- Zig 单元测试：
  - 两个请求并发时第三个被拒；
  - 工作线程的结果只在 wake 之后应答；
  - 退出时有未完成的请求不挂起。
- `test-sync-e2e`：打桩的桥延迟 3 s 应答，这 3 s 里棋盘能走子、翻谱不卡。页面层本来就是异步的，这一条防的是以后有人在页面上把它写成阻塞。
- 真机清单 A0 第 6 条改为：同步进行中拖动窗口、在棋盘上走一步，都不卡。

### N2 文件对话框在原生层完成，`issuePath` 只剩兼容用途【S–M】

**依据**：

- F3 把拖放路径改成由原生在 `files_dropped` 里签发，但「文件对话框的路径仍要经 `issuePath`」。理由是「原生侧拿不到它的结果」。
- 0.10.1 的 `PlatformServices.showOpenDialog / showSaveDialog` 就是给原生侧用的（`src/platform/types.zig:3298-3308`），这条理由已经不成立。
- `issuePath` 让页面可以请求签发任意路径（虽然有 `pathAllowed` 规则挡着），它是页面到文件系统最宽的一个口子。

**做什么**：

- 新增 `chess.openPgn`（打开对话框 → 原生读 → 返回文本和文件名，不返回路径）和 `chess.saveText`（保存对话框 → 原生写）。
- `host.js` 的导入 / 导出改走这两个命令。
- `native-sdk.dialog.openFile / saveFile` 从 `main.zig:46-47` 的内建策略里移除；`issuePath` 只留给旧页面，并在测试里断言新页面不再调用它。
- 顺手：打开过的 .pgn 用 `native-sdk.os.addRecentDocument` 进最近列表。它由原生侧在读成功后调用，页面不需要文件系统权限。

**验收**：

- 静态守卫：页面源码里没有 `zero.dialogs.openFile / saveFile`、没有 `issuePath` 调用；`main.zig` 的内建策略里没有这两条。
- Zig 单元测试覆盖：取消、超过 16 MiB、非 UTF-8 文件名。
- 真机清单新增两条：macOS / Windows 各导入、导出一次 PGN。

### N3 打包自检覆盖 IndexedDB、同步分块加载和原生对话框命令【S】

**依据**：

- C1 的「没验证的」：「打包后 WKWebView 用的是自定义 scheme，IndexedDB 在它上面能不能用，本地没法验证……需要在真机或 CI 的 WebKit 上确认」。
- F5 的偏离：「语言块用 `document.write` 同步加载，WKWebView 下只在 CI 的 WebKit 上验证过」。
- **其实 CI 上有真的 WKWebView**：`build-macos.yml` 在 macOS runner 上打包之后，会用 `scripts/selftest-app.mjs` 把打包好的应用启动两次（7.5 起）。现在的检查项是 engine、appdata、chunk、restart、sound，没有 IndexedDB。
- Playwright 的 WebKit 用的是 http(s) 源，覆盖不到 zero://；真正要回答的问题只有打包自检回答得了。

**做什么**：自检新增三项，都在 `app.js runSelftest` 里：

- `idb`：打开 `chessboard.library`，写一条带唯一标记的记录，读回。第二次启动时必须读到第一次写的标记，比较方式与 `restart` 相同。
- `chunkSync`：首帧前 `document.write` 出来的语言块确实已经执行。判断方法：首帧时 `I18N` 里已经有非中文字典。
- `nativeIo`：`chess.openPgn` / `chess.saveText` 这两个命令在策略里、能被调用。无人值守时不能真的弹框，所以只查它们注册了。

**验收**：

- `build-macos.yml` 和 `build-windows.yml` 的自检在两个平台上都通过这三项。
- 如果 `idb` 在 WKWebView 上**失败**：C1 已经有退路（`idbBackend` 返回 null，退回 localStorage），但那时一万局的上限达不到。这一项就从「验证」变成「修复」，改用原生分片（F3 的每键一文件）做主存储，工作量 L，另开一条。

### N4 macOS 签名更新（需要你拍板）【M】

**依据**：

- 8.0 §6：「签名、公证与自动更新：仍然缺证书」。现在的「检查更新」只告诉用户有新版本，要用户自己去下载、解压、替换。
- SDK 0.10.0 带了自己的更新器，不依赖 Sparkle：
  - Ed25519 签名的更新源；
  - 严格按顺序校验（签名 → bundle id / 架构 / 版本 → 只走 HTTPS → 大小与 SHA-256）；
  - 原地替换、失败回滚、重启。
- **ad-hoc 签名的包可以只用 Ed25519 这一条信任链**，不需要 Apple 证书。
- `runner.zig:68-76` 已经把 `update_feed_url / update_public_key / update_check_on_start` 接好了，只差 `app.zon` 的 `.updates` 块。
- 限制：只支持 macOS 的 system host，Windows 还不支持；安装目录要当前用户可写，不提权。
- **要等 SDK 发版**：main 上的 `#465` 修的正是「优化构建的 macOS 链接丢了更新器导出」，而我们的 release 用 ReleaseFast。

**做什么**（前提：你同意，并且 0.10.2 已发布）：

- `native update keygen` 生成一对密钥。私钥进仓库的 Actions secret，只在 `release.yml` 里用。
- `release.yml`：
  - 打出 macOS 的更新包（`native package` 的 updater 产物）；
  - 用私钥签更新源；
  - 更新源和包一起挂在 GitHub Release 上。
- `app.zon` 加 `.updates`：更新源 URL、公钥。**`check_on_start = false`**：与「只在用户主动时联网」一致，检查仍然由「关于 → 检查更新」触发。
- Windows 保持现状，只提示有新版本。

**验收**：

- 用一个 0.0.x 的演练标签在 macOS runner 上装旧版 → 检查 → 更新 → 重启 → 版本号变了。
- 篡改更新源的一个字节，更新被拒。
- 私钥不出现在任何日志和产物里，有静态守卫。

### N5 标题栏：8.1 仍不做，只做两件准备【S】

**依据**：§1.2。macOS 上页面没有办法声明拖动区域，这件事 SDK 0.10.1 和 main HEAD 都没有变。

**做什么**：

1. 向上游提一个功能请求：WebView 声明拖动区（或者一个从 mousedown 同步发起的 `startWindowDrag` 桥命令）。M5 的调研结论可以直接作为请求正文。
2. Windows 上做一个一天以内的实验：在只改 Windows 清单的构建里，原生侧给 `main` 视图设一条顶部拖动区，看 WebView2 上能不能拖。结论写进 manual-check A0 第 4 条。

**验收**：上游请求的链接、实验结论都写进落地记录。

---

## 3 · F：地基收尾

### F1 依赖对齐【S】

**做什么**：§1 里标「8.1 升」的几项，每项一个提交：

- esbuild 0.28.1 → 0.28.2；
- Playwright 1.62.1 → 1.63.0：`checks.yml` 和 `release.yml` 两处，外加 `release.yml` 注释里「everything else is pinned too (playwright 1.62.1 …)」的版本号；
- `nightly.yml` 的 checkout @v5 → @v7；
- download-artifact @v7 → @v8；
- 重新生成 ECO 表；
- 新增 `deps-check.mjs` 与清单一致性守卫（§1.7）。

**验收**：

- esbuild：升级前后 `bundle.js` 和各分块逐字节相同。不同就要解释。
- Playwright：两套引擎全套 e2e 全绿；布局测量有移动时写进落地记录，不能悄悄改阈值。
- download-artifact：一次演练 release（workflow_dispatch）证明两个包都进了 `dist/`。
- ECO：`test-eco` 与开局浏览器的「书」核对通过；分块大小的变化写进落地记录。

### F2 主包预算：重新定规矩【S，需要你拍板】

**依据**：

- 主包的余量在 8.0 里一路被挤到见底：
  - M4 把预算从 70% 放宽到 70.5%，上限 1,205,530 字节；
  - C3 合入时离预算只剩 4 字节，为此删了 6 个界面键；
  - C2 只剩 17 字节，同步的开关和对话框几乎全塞进分块，「取几局」的选项因为放不下文字而没做；
  - M5 合并时超出 410 字节，把诊断的三张图搬进 chunk-libdb.js 才回到预算内，现在剩约 6 KB。
- 预算的本意（M4 的落地记录）：「拦住整份语言内容被打回主包（每份约 200 KB）」。几百字节的新功能反复撞线，说明这条线在量一件它本来不管的事。
- `scripts/bundle.mjs` 从来是 `minify: false`：变量名、空白、注释都原样进包，包括大段解释「为什么」的注释。

**做什么**（三选一，见 §8 第 3 条）：

- **(a) 开压缩**：主包用 `minifyWhitespace` + `minifySyntax`，保留标识符，报错栈仍然可读；`legalComments` 保持 inline。预算的基数改成「压缩后的 7.9.0」。
  - 前提：先查一遍 `test-chess.mjs` 里读 `bundle.js` 文本做匹配的断言，改成读源码或按符号定位（和 F4 的做法一致）。
- **(b) 预算改为语义规则**：取消字节比例，改为逐块的「这些内容不许回到主包」探针。F5 已经有逐块的 probe；再加一条总量上限 1.3 MB 防失控。
- **(c) 维持现状**：每次加功能都先从主包搬走等量代码。

建议 (a)：它能让余量回到几百 KB 这个量级，又不放弃「整份语言内容不回主包」这个本意。

**验收**：

- 选 (a)：压缩前后三种语言的全套 e2e 通过；DOMContentLoaded 前后对比写进落地记录；新预算写进 `measured.json`。
- 选 (b)：每个分块的 probe 都在，并且先红后绿验证过：把一块内容挪回主包时守卫要变红。

### F3 8.0 没达标的两条硬指标【M】

**依据**：

- **app.js 行数**：8.0 定的是「结束时 ≤ 6,000 行」，M5 合并后是 6,707 行（`APP_JS_LINE_CEILING = 6,707`）。
- **首启整份写入**：`test-persist-e2e` 里 2 MB 档案「第一次启动整份写入，主线程最长一段 ≤ 16 ms」没过：C1 分支实测 17–35 ms，不含 C1 的开发分支也是 25–48 ms。「一次普通保存」那一项通过。
- **一万局重启到可用约 4.3 s**，大部分花在 IndexedDB 的 `getAll()` 上。

**做什么**：

- **app.js**：沿用 F4 的做法再拆两块，每个 PR 只搬一个模块，行为零改动。候选是 `game-controller`（对局流程、悔棋、续下）和 `io`（导入导出、剪贴板），8.0 F4 本来就点过这两个名字。
- **首启写入**：先用性能剖析确认最长那一段是什么（base64 编码、JSON 序列化，还是清单写入），再分片或让出主线程。
- **棋谱库冷启动**：
  - 头里存一份轻量的列表摘要（id、对手、日期、结果、ECO），先画列表；
  - 局面索引和整局在后台分页读取；
  - 搜索在索引到达之前先按摘要筛。

**验收**：

- app.js ≤ 6,000 行，上限随之下调。
- 2 MB 首启整份写入，主线程最长一段 ≤ 16 ms，在 CI 上连续 5 次通过。
- 一万局重启到列表可见 ≤ 1.5 s，到搜索可用 ≤ 4.5 s（不比现在差）。数字写进 `measured.json` 的 `libraryDb`。

### F4 引擎调度器【M】

**依据**：

- 8.0 §6：「调度器排在 8.0 的最后一步；如果 B2 落地后『分析中走一步』的等待仍然 > 1 s，就提前做」。8.0 没做，也没量过 B2 之后的等待。
- 同时抢同一个引擎的越来越多：
  - B2 让分析一局从 9.9 s 变成 19.8 s（精析约 39 s）；
  - C1 让棋谱库上限变成一万局，「分析剩下的 N 局」可以排上几个小时；
  - C2 同步进来的对局都在分析队列里。
- 换多线程引擎不可行（§1.3），所以只能在调度上下功夫。

**做什么**：

1. **先量**：在 `test-engine-flows-e2e` 里加一段，后台批量分析进行中，人机对局走一步，量引擎应手的等待。
2. **调度器**：
   - 三级优先队列：对局与提示 > 当前局面的持续分析 > 后台批量分析；
   - 高优先级到来时，对低优先级的搜索发 `stop`，结果丢弃并重排；
   - 批量分析以「一步」为单位，抢占后从断点接着做，已经分析的步不重算。
3. **第二个 worker**：只给后台批量分析用，内存上限可配。wasm 实例约 20–40 MB，要在 8 GB 的机器上实测。默认关，由量出来的数字决定开不开。

**验收**：

- 后台分析中走一步，引擎应手等待 ≤ 1 s（p90）。
- 抢占后的批量分析结果与不抢占时逐步相同：`go nodes` 是确定的（B2）。
- `winPctNoise` 仍然 100% 一致。

---

## 4 · T：训练与你的棋补完

### T1 对手阶梯上半段补档【M】

**依据**：

- B4 的偏离：新手 → 扎实的 5 个台阶都在 60–75%；初级往上的 5 个台阶有 4 个不在区间内：

| 台阶 | 强者得分 |
|---|---|
| 扎实 → 初级 | 88% |
| 1450 → 1575 | 78% |
| 1575 → 中级 | 55% |
| 中级 → 高级 | 82% |
| 高级 → 满强度 | 97% |

- 原因是 Stockfish 的 `UCI_Elo` 档实测间距不均匀：1575 实测 1662，2200 实测 1994。落地记录写的是「大约要十几档，放到 8.x」。
- 风格只加在 4 个胜率档上：给 `UCI_Elo` 档加风格，档位会偏移几百分。

**做什么**：

- 不再按名义 `UCI_Elo` 均匀取点，改为按实测反推：用 `ladder` 段的 Bradley–Terry 拟合，找出让相邻两档期望得分落在约 68% 的 `UCI_Elo` 设定。
  - 预计初级与满强度之间要 8–10 档；
  - 满强度与高级之间用限深度或限节点补 1–2 档。
- 角色：新档沿用「一档一个角色」。角色、台词进 `chunk-opponents.js`，不进主包。
- 新对局对话框里档位多了，改成按段分组（入门 / 进阶 / 高手），不加主包文字。这条受 F2 影响。

**验收**：

- 整条阶梯相邻两档强者得分都在 60–75%，单调。自对局盘数与引擎时间写进 `measured.json` 的 `ladder`。
- `test-strength` / `test-novice` 按新档位重新标定。
- 老档案里记着旧档位 id 的对局，等级分重放结果不变，有迁移测试。

### T2 残局训练营【M–L】

**依据**：8.0 §6：「残局训练营（约 60 个标准残局），以及残局库的调研：放到 8.1」。现有内容：基础残局八课、王兵、后杀王、车杀王、双象杀王、卢塞纳、菲利多尔、后对车。

**做什么**：

- **60 个标准残局**，按主题分组：王兵、车兵、轻子、后，以及理论和棋。
  - 每个残局是一个局面，加一个目标（胜或守和），和引擎对下到结果。
  - 引擎用满强度。残局里「会不会走」没有中间档，削弱只会教错。
- **判定**：
  - 局面 ≤ 7 子时，正确性的依据写进每条内容的来源注释；
  - 核对用的是离线的 Syzygy 表查询结果，**只在生成内容时用，应用里不带残局库**。
- **残局库调研的结论写进本计划**：不带（3–5 子的 Syzygy 就要约 1 GB）。
- 进度进「我的」页。复习沿用 `srs.js`，走错的残局进复习队列。

**验收**：

- 60 个局面的结论（胜 / 和）与离线查表一致，有测试。
- 每个残局都能用引擎的最佳着走完并达到目标，有测试。
- 三语文案不截断，内容在按需分块里。

### T3 你的开局书：编辑、按单着排期复习、在浏览器里标「我的」【L】

**依据**：

- 8.0 §6：「开局书在应用内编辑，并按单着排期复习（Chessable 式）：依赖 C1 的存储和 C3 的浏览器，放到 8.1」。现在两个前提都有了。
- C3 的偏离：「书」指的是应用内置的开局书（`openings.js`），不是用户自己的开局书。
- `repertoire.js` / `repertoire-ui.js` 现在能做到的是「按线练」。

**做什么**：

- **编辑**：在分析板或开局浏览器里，「加进我的开局书（白方 / 黑方）」。
  - 按局面存，换序也能合并，局面键用 `ChessFide.positionKey`，和 C3 相同；
  - 存进 C1 的 IndexedDB，新表 `repertoire`，同样镜像进原生分键存储。
- **按单着排期**：每个「轮到我方走」的节点是一张卡，SM-2 或复用 `srs.js`，只练到期的着。
- **开局浏览器**：用户开局书里有的着法标「我的」，和内置的「书」区分开。
- **从棋谱库反推**：「你在这个局面常走的是 X，但你的开局书写的是 Y」。这是 C3 × C1 × T3 三者的交点，也是和 Chessable 的差异点。

**验收**：

- 导入 / 导出开局书为 PGN（带变着），往返逐节点相等。
- 排期单元测试：用固定时钟，到期和不到期逐条核对。
- 开局浏览器的「我的」标记与开局书逐着一致，有测试。
- 老的 `repertoire` 数据无损迁移，有迁移测试。

### T4 同步 2.0【M，依赖 N1】

**依据**（C2 的落地记录）：

- 两家的样本是**照公开文档手写的**，没有和真实应答逐字比对。本次审计的环境仍然被拦截（§依据）。
- 每次固定取最近 20 局，不设选择（主包放不下选项文字）。
- 没有增量：「库里已有的会跳过」，但仍然要把 20 局都取回来。
- 不自动分析。

**做什么**：

- **真实样本**：加一个只能手动触发的 workflow（`workflow_dispatch`）。它在 GitHub 的 runner 上，用一个公开的知名账号，向两家各取一次，把原始应答存成测试夹具，提交成 PR 供人审。之后单元测试用真实夹具。
  - 这是项目第一次从 CI 向第三方网站发请求。只在手动触发时发、只读公开数据，但仍需拍板（§8 第 5 条）。
- **增量**：
  - Lichess 用 `since=`（上次同步的最后一局时间）；
  - Chess.com 按月份的归档，只取上次以来的月份。
  - 「上次同步」按网站和用户名记在 `sync` 键里。
- **选项**：取「上次以来的全部，最多 N 局」，N 可选 20 / 50 / 100。选项的文字进 chunk-sync，不进主包（F2 做完后可以放宽）。
- **进度**：N1 之后请求是异步的，对话框显示「已取到 k 局」。
  - Lichess 的 NDJSON 本来就是流；
  - Chess.com 按月份报进度。
- **同步后分析**：可选「同步完就开始分析」，默认关，排在调度器（F4）的最低优先级。

**验收**：

- 真实夹具下的解析单元测试：两家各一份，含 Chess960 或变体被过滤的例子。
- 增量同步第二次只取新局，打桩测试逐次断言请求的 URL。
- 同步 100 局，窗口始终可操作，与 N1 的验收一起在真机上做。

### T5 诊断、导出算上本机对局【S–M】

**依据**（C1 的偏离）：

- 「诊断和后台分析仍然只算导入的棋……把它们也算进『你在别处下的棋』，会改变 7.x 这些数字的含义」。
- 「本机的棋不进『导出 PGN』」。
- 「本机的棋没有用时标签」，用时筛选对它们无效。

**做什么**：

- 诊断页加来源开关「导入的 / 本机 / 全部」，默认仍是「导入的」，所以 7.x 的数字含义不变。
- 「导出 PGN」可以选择带上本机对局。导回时按 `[LibId]` 识别为本机来源，不产生副本。
- 战绩开始记录时控（新对局写 `TimeControl`）。旧的本机对局按对局时的设置补标；推不出来的不标。

**验收**：

- 来源开关下三种统计与手算一致，用固定对局做单元测试。
- 带本机对局导出 → 清空 → 导回，逐局相等且来源仍是「本机」。

### T6 小项与真机清单【S】

- **母题精度抽样**：B3 的 19 种母题里只有 4 种有抽样精度。用 C1 的一万局库和同步来的真实对局再抽一轮，每种至少 20 条；达不到 ≤ 5% 错误率的母题，照 B3 的规矩回退到只说子力得失。
- **题库题进复习队列**：B1 的偏离，「题库题计入评级，但不进复习队列，因为它所在的分块在读复习队列时不一定已经载入」。改为复习队列只存 id，到期时先等对应的分块（和 `withIndex` 同样的做法）。
- **60 fps 逐帧检查**：A5 没做，因为本环境没有录屏。放进真机清单。
- **真机清单 A0 跑一遍**：
  - 第 1–3 条：图标；
  - 第 4 条：标题栏，连同 N5 的 Windows 实验；
  - 第 5–11 条：同步；
  - 再加 N1、N2、N4 的新条目。

  这些是 8.0 发布前就该跑、却只能交给真机的东西。**8.1 发布前必须有一次完整记录。**

---

## 5 · 随时可以带进任何一步的小修正【S】

- `release.yml` 注释里「playwright 1.62.1」随 F1 一起改，并由 §1.7 的一致性守卫盯住。
- bridge 帧大小的注释（`main.zig:442-455`）改为引用源码常量，不引用 SDK 文档：文档写的是 16 KiB，与源码不一致（§1.2）。
- `app.zon` 的 `version` 仍是 7.9.0（`build.zig.zon`、`package.json` 同样）。8.0.0 发布时要一起改，建议加一条「三处版本号一致」的守卫。
- C1 的「Safari 15.0–15.3 没有 BroadcastChannel」：WKWebView 的最低系统版本要写清楚。`bundle.mjs` 的 `target` 是 `safari15`；如果最低支持的 macOS 已经带 Safari 16+ 的 WebKit，就把 target 提上去，这条限制自然消失。先查 SDK 0.10.1 要求的最低 macOS 版本。

---

## 6 · 这一版不做的（推到 8.2 或以后）

- **进阶课程第三部**（计算、局面型，24–36 课）：8.0 §6 原说放 8.1。三语文案的工作量和 T2、T3 撞在一起，8.1 放不下，推到 8.2。
- **可视化与计算专项练习、名局猜着**：8.2（与 8.0 §6 相同）。
- **Chess960、让子棋**：9.0 以后。
- **第四种界面语言，以及 25 处字符串拼接改为整句模板**：拼接改造可以在 F3 拆分时顺手做，语言本身不在 8.1。
- **透明标题栏**：等 SDK（N5）。
- **公证**：SDK 已经支持（0.10.1），仍然缺 Developer ID 证书。
- **Windows 自动更新**：SDK 不支持。
- **多线程或完整 NNUE 引擎、原生 Stockfish 进程**：§1.3；属于 9.0 量级。
- **棋谱库搬到 SDK 的 SQLite**：SDK 0.9.0 起有 SQLite 记录存储，是 IndexedDB 在 WKWebView 上万一不可用时（N3）的正解，但工作量 L、会动存档格式。N3 证明 IndexedDB 可用，就不做。
- **chess.js 1.x**：§1.4。
- **系统通知提醒**：§1.2，与叙事冲突。

---

## 7 · 顺序与发布

8.0.0 先发布：M5 合进 main，A0 真机清单至少跑完图标和同步那几条。8.1 在 8.0.0 之后开工，分四个里程碑：

| 里程碑 | 内容 | 为什么排在这里 |
|---|---|---|
| **M1 地基与原生** | F1 依赖对齐，F2 预算定规矩，N3 打包自检，N2 原生对话框，§5 小修正 | N3 回答「IndexedDB 在 WKWebView 上能不能用」，答案决定 C1 要不要返工；F2 决定后面每一项有没有地方放 |
| **M2 引擎与同步** | N1 异步桥，F4 调度器，T4 同步 2.0，T5 本机对局 | T4 依赖 N1；T4 带进来的对局会压到引擎上，F4 要先到位 |
| **M3 训练** | T1 阶梯补档，T2 残局训练营，T3 你的开局书，T6 的母题抽样与复习队列 | 内容量最大，放在地基稳了之后；T3 依赖 C1 的存储和 C3 的浏览器（8.0 已有） |
| **M4 收尾** | F3 硬指标，N4 签名更新（如果同意、且 SDK 0.10.2 已发布），SDK 升级（如已发布），T6 真机清单 | 行数与性能指标最后收口；更新器和 SDK 升级都要等上游 |

**SDK 0.10.2 什么时候发都不阻塞 M1–M3**；发布了就在当时的里程碑里单独一个 PR 升级。

每个里程碑合并前都要做到（沿用 8.0）：

- Codex 评审清零；
- 贴 2× 截图的前后对比；
- 新的测量写进 `measured.json`；
- 本计划的落地记录补上这一段；
- `deps-inventory.json` 与实际钉的版本一致。

---

## 8 · 需要你拍板的（2026-09-29 已定）

**决定**：

1. 版本号定为 **8.1**。
2. SDK 策略同意：先用 0.10.1 现成的能力，0.10.2 发布后单独升级。两个上游功能请求的正文写在附录，由你转交；本会话只能访问本仓库。
3. 主包预算选 **(a)**：开压缩、保留标识符，预算基数重算。
4. macOS 自动更新**暂时不做**。N4 移到 §6「这一版不做的」。
5. 真实样本：用只能手动触发的 CI 工作流取（`sync-samples.yml`，PR #90）。取回后先用来核对 8.0 的 C2 解析测试，再作为 T4 的测试夹具。
6. 进阶课程第三部推到 **8.2**，同意。
7. 引擎第二个工作进程**默认关**，同意。
8. chess.js、Node、Stockfish **维持现状**，同意。

以下是当时列出的问题原文。


1. **版本号**：叫 8.1（本计划的建议：没有破坏性升级，范围是 8.0 收尾加原生能力），还是按「8.0 之后下一个大版本」叫 9.0？
2. **SDK 升级策略**：
   - 8.1 不等上游，先用 0.10.1 现成的能力（N1–N3）；0.10.2 一发布就单独一个 PR 升上去（要双平台构建和打包自检全绿）。同意吗？
   - 要不要向上游（vercel-labs/native）提「WebView 声明拖动区」和「zero:// 可配响应头」两个功能请求？前者是透明标题栏的唯一出路，后者是多线程引擎的前提。
3. **主包预算（F2）**：
   - (a) 开 esbuild 的空白与语法压缩（保留标识符），预算基数随之重算；
   - (b) 取消字节比例预算，改为逐块的「不许回主包」探针，加 1.3 MB 总量上限；
   - (c) 维持 70.5%，每加一个功能先搬走等量代码。

   建议 (a)。
4. **macOS 自动更新（N4）**：
   - 用 SDK 自带的更新器，ad-hoc 签名 + Ed25519 更新源，挂在 GitHub Release 上；
   - 私钥放在仓库的 Actions secret 里；
   - 默认不在启动时检查，只由用户点「检查更新」触发；
   - Windows 仍然只提示。

   做不做？如果做，私钥由谁保管、丢了怎么办（丢了等于所有已装的旧版再也收不到更新，只能手动装一次新版）？
5. **CI 向第三方网站发请求（T4 的真实样本）**：一个只能手动触发的 workflow，用公开账号向 Lichess、Chess.com 各取一次公开对局，存成测试夹具。这是项目第一次在 CI 里访问第三方网站。能接受吗？或者你在自己的机器上跑一次、把应答发给我也可以。
6. **进阶课程第三部推到 8.2**（8.0 §6 原说 8.1）：同意吗？
7. **引擎第二个 worker（F4）**：默认关，量过内存和收益再决定。同意这个默认吗？
8. **不升级的几项**：chess.js 留在 0.13.4；Node 留在 24，26 进 LTS 后再议；Stockfish 不换完整 NNUE（约 99 MB）。同意吗？

---

## 9 · 落地记录

（发布前补全。）

### M1（F1、F2、§5、N2、N3 及其评审修正）

**与计划的偏离**

- N2：计划写「`issuePath` 只留给旧页面」。评审（P2-1）改为整个删掉：页面总是同一个二进制里打包的前端，没有能连到这个壳的「旧页面」，留着它只是留着页面到文件系统最宽的口子。`APP_COMMANDS` 12 个，没有 `COMPAT_COMMANDS`；`manifest-check` 在 `main.zig` 代码里、页面源码里（任何引号、模板字符串、拼接）见到 `issuePath` 都报红。`pathAllowed` 只剩一个用处：拖进窗口的路径。
- N2：保存命令叫 `chess.saveText`（计划写 `chess.savePgn`）：学习数据、全部数据和复盘图 PNG 也走它。对话框里亲手挑的文件是玩家自己的选择，不再过 `pathAllowed`（manual-check J5 相应改成拖放）。
- N2 评审 P3-5：玩家在保存框里输入的名字没有扩展名时，原生侧按建议文件名补上（Windows 的对话框不设默认扩展名）；补出来的名字只作为新文件创建，已有同名文件时照玩家输入的原名写，不替换对话框没问过的文件。
- F3「首启整份写入」提前到 M1。先剖析（Chromium 跟踪 + 采样）：`test-persist-e2e` 读到的 150–200 ms 大半不是主线程在干活。这一段从第一次刷盘写完清单的应答算起，到 `bootLibrary → Persist.touchUnlisted` 的第一次调桥为止；中间是两个任务（7 ms，和棋谱库搬进 IndexedDB 的一次 `put` 循环 34–45 ms），其余时间都在空等 IndexedDB。修了三处。
  - 量法：应答所在的任务一结束就收口，下一个定时器、帧、IndexedDB 事件开始，或者随应答投递的一条消息先到，都算结束。
  - `library-db.js putSliced`：每个任务最多 put 6 ms，下一片从上一片最后一个请求的 success 里接着排，仍是同一个事务，要么全进、要么全不进。
  - `host.js textSource`：长文本先数 UTF-8 长度，再按 256 KiB 一段用 encodeInto 边编边发。原来要先把 2 MB 整个 encode（7–10 ms），再在同一个任务里算第一段的 base64。协议和盘上格式都没变，main.zig 本来就接受任意长度的段。
  - 本机 Chromium 实测（`measured.json persistFirstWrite`）：旧量法下 155–199 ms。新量法、旧代码：最长一段 11.5 ms，一个任务里连着 put 35.6 ms。修正后连续 5 次：最长一段 3.6–8.9 ms，连着 put 6.0–6.1 ms，全部通过。
  - 新增两项断言：persist-e2e 的「一个任务里连着 put ≤ 16 ms」，改之前是 27–36 ms；test-persist 的「从不一次编码超过一段」，改之前一次编码 2,097,169 字符。
- N2 评审 P3-4：分段打开的大文件，第一段记下大小和修改时间，之后每段先比对，变了就答 `open_lost`（页面显示「无法读取文件」）；后续段答超限时显示「文件超过…」，不再笼统说读不了。

**已知限制**

- 导出（P3-2）：`chess.saveText` 先把全部字节分段送到原生侧，收齐才弹保存框。导出全部数据时一万局约 28 MB，要先传完约 56 段才看到对话框，这几秒里没有「正在准备」之类的提示——现有界面键里没有合适的一条，这一版不为它加键。协议不改：先弹框再传，取消就得丢掉已经传了一半的状态，反而更复杂。
- 修改时间的精度取决于文件系统：FAT/exFAT 的 U 盘是 2 秒，同样大小、2 秒内被改写的文件认不出来。

**只有 CI 或真机能确认的**

- Zig：本地用 0.16.0 在 null 平台上跑通 `zig build test`（49 项），并为 x86_64-windows、aarch64-macos 交叉编译过测试；真正在 macOS / Windows 上跑是 `checks.yml` 的 zig 作业。
- 原生对话框真的弹出、取消、导入导出一次 PGN、保存后在文件夹里显示、进 Dock / 跳转列表：manual-check A1、J4。Windows 保存框补扩展名只有真机看得到。
- `idb` / `chunkSync` / `nativeIo` 在 zero:// 上的 WKWebView 与 WebView2：`build-macos.yml` / `build-windows.yml` 的打包自检。
- 打包自检两次启动共用一个临时 HOME（Windows 另加 APPDATA）：应用自己的数据目录跟着走；WKWebView 的 localStorage / IndexedDB（在真实用户的 ~/Library 下）和 WebView2 的数据目录（SDK 不指定，在 exe 旁边）不跟着走，本地运行仍会在那里留下自检标记和英文界面设置。CI runner 起始为空，不受影响。

---

## 附录 · 给 SDK 上游的两个功能请求（由你转交 vercel-labs/native）

### 请求一：WebView 内容声明窗口拖动区

> **Feature request: let WebView content define window drag regions (for `titlebar = "hidden_inset"`)**
>
> We ship a desktop chess app on native 0.10.1 (Zig shell + a single WebView). We would like the macOS transparent title bar (`titlebar = "hidden_inset"`) with our own toolbar drawn in the page. Today that leaves the window impossible to drag: `window-drag` is only wired to canvas controls, and on macOS a drag has to be started from the live pointer gesture with `performWindowDragWithEvent:` (per the comment in `types.zig`). A page cannot declare a draggable region, and it cannot start a drag either.
>
> Either of these would unblock it:
> 1. **Declarative regions**: honour CSS `app-region: drag` / `no-drag` (or `-webkit-app-region`) in the WebView, as Electron and WebView2 do, or accept a list of rectangles from the page over the bridge. On Windows the WebView2 host already keeps per-view drag regions and answers `WM_NCHITTEST` with `HTCAPTION`.
> 2. **Imperative start**: a bridge command such as `window.startDrag()` that, when called synchronously from a `mousedown` handler, calls `performWindowDragWithEvent:` with the current event on macOS, and sends `WM_NCLBUTTONDOWN` / `HTCAPTION` on Windows.
>
> Without this, `hidden_inset` cannot be used by apps whose UI is all web content.

### 请求二：zero:// 可配置响应头（跨源隔离）

> **Feature request: configurable response headers for the app scheme (enable cross-origin isolation)**
>
> The asset scheme handler (`zero://`, e.g. `appkit_host.m` around the asset handler) serves app files without `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy`. Pages therefore never become cross-origin isolated, `SharedArrayBuffer` is unavailable, and multi-threaded WebAssembly (for us: the threaded Stockfish build) cannot run.
>
> A small option would do, e.g. in `app.zon`:
> `.scheme_headers = .{ .{ "Cross-Origin-Opener-Policy", "same-origin" }, .{ "Cross-Origin-Embedder-Policy", "require-corp" } }`
> applied to every response of the app scheme on macOS (WKURLSchemeHandler) and Windows (WebView2 `WebResourceRequested`).
