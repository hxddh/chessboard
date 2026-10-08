# 8.4 · 换新工具、补齐 Windows 的最后一个坑、名局扩充（候选）

写于 8.3.0 发布次日（2026-10-08），规矩照旧：

- 每条写**依据**、**做什么**、**验收**；
- 发布前补**落地记录**，做到的和没做到的都逐条写。

8.4 的材料有三份：

1. **8.3 推到 8.4 的事**：v8-3-plan §9「总结」的「没做到的」、8.3.0 发布说明「还没做的」。
2. **依赖与 SDK 审计**（2026-10-08，§1）。这次有两个新版本，都实测过。
3. **CI 的实测**：8.3 V4 之后的四次运行（§2），以及布局不出帧的取证结果。

结论先说：

- **依赖**：
  - **Playwright 1.64 可以升**，本地三组 e2e 全绿、耗时持平。
  - **Node 26 在 10-28 进 LTS**，正好在这一版里。
  - **Zig 0.17.0 今天发布，但这一版升不了**：SDK 0.10.1 和上游 main 都编不过。我们自己的 build.zig 在 0.17 下也有约 20 处要改。
- **收账**：8.3 只写进真机路线、没改的「WebView2 用户数据目录在不可写目录时」，找到了一个不用搬现有用户数据的改法（V1）。「看 N 步」一整组 ≤ 1 s 接着做。
- **新内容**：只提候选，等你拍板（§8 第 2 条）。

---

## 依据

1. **审计的方式**：
   - `scripts/deps-check.mjs`（npm 四项）；`nodejs.org/dist/index.json`；PyPI `ziglang`；
   - vercel-labs/native 拉到 HEAD `4160b4f3`（2026-10-07），读 `fd96d9d3..HEAD` 的 13 个提交标题，读 `build.zig.zon` 的 `minimum_zig_version`。
2. **Zig 0.17 与 Playwright 1.64 的试装**：都在独立工作树里，`--no-save` 安装，没有提交。
   - Zig：PyPI wheel 解压到 scratch。对照组 0.16.0 下 `zig build test -Dplatform=null` 79/79 通过。
   - Playwright：1.63.0 与 1.64.0 各跑一遍 board、clock、layout（95 个场景）。
3. **CI**：
   - checks.yml 运行 37599608272、37602854002、37606746082、37608436651 的作业时长（`ci-wallclock.mjs --from`）；
   - 40 个「panel layout」作业的完整日志（MCP `get_job_logs`），搜 `FRAME-MISS`。

**这次的局限**：

- ziglang.org 与 codeberg.org 仍是代理 403，Zig 0.17 的改动是从它自带的 std 源码里读出来的，不是发布说明；
- 本地浏览器只有 Chromium 141，Playwright 1.64 自带的 Chromium 156 / WebKit 27.2 只能在 CI 上验；
- 没有 macOS / Windows 桌面。

---

## 0 · 结论先行

### 版本号：8.4

- **存档**：格式不变，SCHEMA 仍是 2。
- **9.0 的门槛不变**：换引擎形态、SQLite、SDK 1.0、Chess960、第四种语言。
- **Zig 0.17 也归 9.0**：要和支持它的 SDK 一起换，见 §1。

### 8.4 的三个主题

| | 主题 | 一句话 |
|---|---|---|
| **D** | 依赖 | Playwright 1.64；Node 26（10-28 之后）；Zig 0.17 只做调查记录，不升 |
| **V** | 验证与 Windows | WebView2 用户数据目录不可写时退到 `%LOCALAPPDATA%`；CI 墙钟收尾（webkit 系统依赖不再每次从 apt 下）；布局不出帧的取证扩到发布彩排 |
| **T** | 训练 | 「看 N 步」一整组 ≤ 1 s；新内容候选：名局猜着 10 → 40 局、Lichess 题库刷新 |

---

## 1 · 依赖与 SDK 审计（2026-10-08）

| 依赖 | 钉的版本 | 最新 | 8.4 建议 |
|---|---|---|---|
| Native SDK `@native-sdk/cli` | 0.10.1 | 0.10.1（npm `latest`）；main 又多 13 个提交，HEAD `4160b4f3` | **等**。13 个提交全是把 SDK 自己的组件层、布局、渲染搬到 TypeScript，与我们无关 |
| Zig | 0.16.0 | **0.17.0**（PyPI，2026-10-08） | **不升**，见下 |
| Playwright | 1.63.0 | **1.64.0**（2026-10-07） | **升**（D1） |
| Node | 24（engines ≥ 24） | 26.11.1 Current，**10-28 进 LTS**；24 于 10-20 转维护期 | **CI 换 26**（D2，8.3 §8 第 3 条已定） |
| Stockfish | 19（lite 单线程 wasm） | 19.0.0 | — |
| esbuild | 0.28.2 | 0.28.2 | — |

### Zig 0.17：为什么这一版不升

- **SDK 编不过**：0.10.1 和上游 main 的 `minimum_zig_version` 都是 0.16.0。在 0.17 下：
  - SDK 自己的 build.zig 先停在 `pathFromRoot`；
  - 越过之后是语法错误：数组乘法 `**` 被移除，0.10.1 里约 187 处、main 约 202 处；`errdefer |err|` 被移除，1 处；
  - 再往下是语义错误：`@typeInfo` 的 `.fields` 改名，约 170 处；`std.meta.Int` 被移除；编译模式枚举改成小写。
  - SDK 是 vendored 的，这些不该由我们改。
- **我们自己的量**：
  - build.zig 约 20 处：`.Debug` → `.debug`；`b.release_mode`、`b.sysroot`、`pathFromRoot`、`addPathDir` 都没了，路径改走 LazyPath，macOS 设 sysroot 那段要重写；`zon.parse.fromSliceAlloc` 改名。
  - src 至少 7 处 `**`：bridge.zig 4 处、sync.zig 3 处。SDK 后面的错误还看不到，实际可能更多。
- **0.16 与 0.17 没法同时兼容**：`.Debug` / `.debug` 两边互不认，所以不能先在 0.16 上把我们这边改好。

**做法**：

- §1 记下这份清单，`deps-inventory.json` 的 Zig 条目写 `upgrade-when-released`（等 SDK）；
- SDK 发出支持 0.17 的版本时，Zig 与 SDK 一起升，单独一个 PR——那多半是 9.0 的入口。

---

## 2 · CI 实测与 8.3 的账

| 项 | 现状 | 8.4 |
|---|---|---|
| CI 墙钟 | V4 之后四次：PR 17.4 分钟（与发布彩排同时跑）、**PR 14.8 分钟**；main 推送 17.8、18.4 分钟 | 还差两次 PR ≤ 15 才算「连续三次」 |
| 墙钟的下限 | 一次 PR 约 200 作业·分钟，账号同时 20 个作业，下限约 10 分钟；最长的单个作业 7.6–7.8 分钟（lessons、布局 1/5、4/5） | 余量够，问题在偶发的慢作业 |
| 偶发的慢作业 | main 的 webkit「board + clock」13.0 分钟，其中 `install playwright + webkit` 441 秒：apt 从 azure 镜像下 115 MB，275 kB/s。同批其他 webkit 作业这一步 31–53 秒 | V2 |
| 布局不出帧 | 8.3 加的 `FRAME-MISS` 在 40 个布局作业、约 4,300 次两帧量取里**一次都没出现**；8.2 那次是在发布彩排（run 36721702122）里 | V3 |
| WebView2 用户数据目录 | SDK 不设，WebView2 默认放在 exe 旁边；解压到不可写目录（如 `Program Files`）时可能起不来 | V1 |
| 「看 N 步」整组 | 最慢约 4 s，单题最慢约 1.2 s；目标一组 ≤ 1 s | T1 |
| 真机路线 | 没人走过（8.2 路线 + 8.2.1 双击 + 8.3 不可写目录） | 照旧不挡发布 |
| 主包 | 908,392 / 预算 951,642；8.3 自设上限 917,245 | 8.4 相对 8.3.0 再给 +10 KB |

---

## 3 · D：依赖

### D1 Playwright 1.63 → 1.64【S】

- **依据**：本地 1.63 / 1.64 各跑一遍：

  | 套件 | 1.63.0 | 1.64.0 |
  |---|---|---|
  | board | 270.2 s | 267.6 s |
  | clock | 51.5 s | 51.7 s |
  | layout（95 场景） | 1,529 s | 1,536 s |

  两版都没有弃用警告。1.64 的破坏性改动（设备描述符带 `screen`、隐藏 iframe 里的元素算隐藏、两条 test runner 的）我们都用不到。
- **做什么**：单独一个 PR（v8-1-plan F1 的规矩）：
  - workflows 里 6 处 `playwright@` 加 release.yml 注释 1 处；
  - `deps-inventory.json` 的条目，写上浏览器版本 Chromium 156.0.8078.4 / WebKit 27.2。
- **验收**：CI 上 chromium、webkit 全部浏览器作业绿；布局截图类的阈值不放宽。

### D2 Node 26【S】（10-28 之后）

- **做什么**：
  - CI 与发布构建的 `setup-node` 换成 26；`engines` 保持 ≥ 24；
  - 本地照常能用 24：静态测试在 24 上跑一遍。
- **验收**：全部作业绿；墙钟不变差（`ci-wallclock`）。
- 如果 10-28 前就要发布，D2 推到 8.4.1。

### D3 Zig 0.17 调查记录【S】

- 只写 §1 与 `deps-inventory.json`，不改代码。

---

## 4 · V：验证与 Windows

### V1 WebView2 用户数据目录：exe 旁边写不进去时，退到 `%LOCALAPPDATA%`【S】

- **依据**：
  - WebView2 在没有指定用户数据目录时，用 exe 旁边的 `<exe 名>.WebView2`；
  - 它也认环境变量 `WEBVIEW2_USER_DATA_FOLDER`（微软的文档如此），要在创建环境之前设好；SDK 0.10.1 不传目录，所以这个环境变量就是决定值。这一点要在 CI 的 Windows runner 上先证实。
  - 8.3 没改，是怕要搬现有用户的数据。可是现有用户能用，说明他们的目录可写——**只在写不进去时才换地方**，就碰不到任何现有用户。
- **做什么**：
  - `main.zig` 在 `resolveAssetRoot` 旁边加一步，只在 Windows 上：
    - 试着在 exe 目录建、删一个探测文件；
    - 失败、且环境变量没被设过时，把 `WEBVIEW2_USER_DATA_FOLDER` 设成 `%LOCALAPPDATA%\Chessboard\WebView2`。
  - 应用自己的存档本来就在每用户的数据目录（`chessboard.json`），不受影响。
  - 不改 SDK。
- **验收**：
  - Zig 测试覆盖「可写 / 不可写 / 已设环境变量」三种；
  - Windows automation 加一次「把包解压到只读目录再启动」：用 `icacls` 去掉写权限，打包自检两次启动都交回结果；
  - 先红后绿：临时去掉这一步时，这次启动红。

### V2 CI 墙钟收尾：webkit 的系统依赖不再每次从 apt 下【S–M】

- **做什么**（二选一，先量再定）：
  - a. webkit 作业跑在 Playwright 官方容器 `mcr.microsoft.com/playwright:v1.64.0-noble` 里，系统依赖已经装好；
  - b. 缓存 apt 下载的 `.deb`（`actions/cache`，键是 Playwright 版本）。
- **验收**：
  - webkit 作业「装依赖」这一步 p95 ≤ 60 s（以十次运行计）；
  - `measured.json ciWallClock` 的 `last3Under15` 为真（连续三次 PR ≤ 15 分钟）。

### V3 布局不出帧：取证扩到发布彩排，满一个版本没再出现就收起看门狗之外的重试【S】

- **做什么**：
  - release.yml 的布局分片同样在作业摘要里写 `FRAME-MISS` 计数（现在 checks.yml 才有）；
  - 8.4 期间所有运行汇总一次。
- **验收**：§9 写下这一版的总次数。
  - 是 0：8.2 那次记为没能复现，看门狗保留，结案；
  - 不是 0：照现场的 rAF 数、可见性、焦点定修法。

---

## 5 · T：训练

### T1 「看 N 步」一整组 ≤ 1 s【M】

- **依据**：8.3 的接续着法改由引擎给（90,000 节点 / 次），一组 10 题最慢约 4 s，单题最慢约 1.2 s。答题时在后台预算下一题，所以单题等待的中位只有 4 ms。慢在哪里还没剖析，猜是开始一组时的第一题，以及换 N 后作废重算，要先量。
- **做什么**（先剖析再选）：
  - 开始一组时只同步算第一题，其余题按需在后台算；
  - 引擎接续的结果按 `题 id | N | 种子` 缓存进会话；
  - 节点预算按 N 分档：N 小时接续着法少，可以给更少的节点，但必须证明出的题与 8.3 相同——同种子同答案同一组题的承诺不能破。
- **验收**：
  - 本机与 CI 上「开始一组到第一题出现」p95 ≤ 1 s；
  - 8.3 存下的种子重建出的题逐题相同（静态测试）。

### T2（候选，等拍板）名局猜着：10 局 → 40 局【M】

- **依据**：8.2 起名局猜着只有 10 局，是「学习」目录里最短的一节。计分只看大师原着和引擎，加局不碰算法。
- **做什么**：
  - 加 30 局 1950 年以前、已进入公有领域的名局，三语开场白各一段，按时代与风格分组；
  - 每局在 CI 上用 Stockfish 核对一遍「大师着与最佳差多少」，标出不该罚的着（例如大师着明显比引擎第一选择差、但历史上公认的那几步，评分照规则走，开场白里写明）；
  - 名局走分块，不进主包。
- **验收**：40 局三语齐备；布局 e2e 测最长标题与开场白不截断；核对记录进 `docs/`，改了局不重跑就红。

### T3（候选，等拍板）Lichess 题库刷新到 10 月的导出【S】

- **依据**：现在用的是 2026-09-09 的导出；Lichess 每月出新导出，题目的评级会随对局漂移。
- **做什么**：用同一套脚本重新抽 4 万题，保持分段与主题的配额。
- **验收**：每个评级分段、每个主题的题数与 8.3 相差 ≤ 5%；已在复习队列里的题，id 不在新库里的照常能打开（旧题留在一个小的「已在复习」分块里）。

---

## 6 · 这一版不做的

- **Zig 0.17 与新 SDK**（§1）；
- macOS 签名、公证、自动更新，透明标题栏（缺证书 / 等上游）；
- 第二个引擎默认打开（要在 8 GB 真机上量内存）；
- 多线程引擎、SQLite、Chess960、第四种语言（9.0）；
- msix / 安装程序。

---

## 7 · 顺序与发布

| 里程碑 | 内容 | 说明 |
|---|---|---|
| **M1** | D1、D3、V1、V2、V3 | Playwright 先单独合并，V2 在新版本上量 |
| **M2** | T1、T2 / T3（如果做） | 内容各自分块，可以并行 |
| **M3** | D2（10-28 之后）、收尾、8.4.0 | SDK 0.10.2 如果在此之前发布，也放进这里 |

每个里程碑的流程照 8.3：并行开发 → 对抗性评审 → 合进开发分支、开 PR、跑 CI → 发布彩排绿了才合并 → main 上正式发布。

---

## 8 · 需要你拍板的（2026-10-08 已定：「按照你的建议来」）

| # | 决定 |
|---|---|
| 1 | 版本号 8.4 |
| 2 | a：T2 名局 10 → 40 局、T3 题库刷新都做 |
| 3 | Zig 0.17 这一版不升，等支持它的 SDK 一起换 |
| 4 | Playwright 1.64 在 M1 单独一个 PR 升 |
| 5 | V1：只在 exe 目录写不进去时，WebView2 用户数据目录放到 `%LOCALAPPDATA%\Chessboard\WebView2` |
| 6 | 8.4.0 若在 10-28 前就绪就先发，D2 Node 26 进 8.4.1 |
| 7 | 真机照旧不挡发布 |

原来的问题：


1. **版本号 8.4**：同意吗？
2. **新内容**：T2 名局 10 → 40 局、T3 题库刷新，做哪个？
   - a. 两个都做；
   - b. 只做 T2；
   - c. 只做 T3；
   - d. 都不做，只收账。
   - **建议 a**：T3 是 S，几乎白送；T2 是 8.2 留下的最薄的一节。
3. **Zig 0.17**：这一版不升，等 SDK 发出支持 0.17 的版本再和 SDK 一起换（多半是 9.0）？
   - **建议**：等。SDK 编不过，我们不改 vendored 的 SDK。
4. **Playwright 1.64**：在 M1 单独一个 PR 升？
   - **建议**：升。
5. **V1 的做法**：只在 exe 目录写不进去时，才把 WebView2 的用户数据目录放到 `%LOCALAPPDATA%\Chessboard\WebView2`，现有用户不受影响？
   - **建议**：同意。这也是 8.3 附录 A 给上游那份报告之外，我们自己能做的那一半。
6. **Node 26 的时间**：8.4.0 如果在 10-28 之前就绪，先发 8.4.0、D2 推到 8.4.1？还是等到 10-28 之后一起发？
   - **建议**：先发，D2 进 8.4.1。不为一个 CI 版本号压住已经做完的东西。
7. **真机**：照旧不挡发布。8.3.0 在 Windows 上双击试一下，仍然是最有价值的两分钟。

---

## 9 · 落地记录

### M1

- **D1 Playwright 1.63 → 1.64**：checks.yml 4 处、release.yml 2 处与注释 1 处，`deps-inventory.json` 条目改为 `done-8.4`（Chromium 156.0.8078.4 / WebKit 27.2）。`test-deps` 通过。CI 验收见 PR。
  - 第一次 CI：webkit 布局 5/5 的「T1 对手分段」报三段不等宽（133.41 / 134.00 / 134.00）。原因是刚点过的一段还在 `:active { transform: scale(0.97) }` 的回弹过渡里（0.12 s），WebKit 27.2 在 100 ms 时还没放完；同场景其他段都是 134.00。改为量之前等这几个按钮的过渡结束（`getAnimations().finished`），阈值不变；本机 Chromium 跑这一场景通过。
- **D3 Zig 0.17**：`deps-inventory.json` 的 Zig 条目 latest 0.17.0、`upgrade-when-released`，note 写 §1 的清单。没改代码。
- **CI 墙钟**：8.4 计划的 PR 检查（#107，run 37720801820）12.8 分钟，最长 webkit lessons 8.0 分钟。
- **V1 WebView2 用户数据目录**：
  - **确认**：SDK 0.10.1 `webview2_host.cpp` 的 `createChildWebView` 调 `CreateCoreWebView2EnvironmentWithOptions(nullptr, nullptr, nullptr, …)`，不传用户数据目录，所以 `WEBVIEW2_USER_DATA_FOLDER` 就是决定值。
  - **改动**：`main.zig` 在 `resolveAssetRoot` 之后、runner 之前加 `resolveWebView2UserData()`，只在 Windows 上：
    - 在 exe 目录建、删一个 `.chessboard-write-probe-<pid>`，出任何错都算写不进去；
    - 写不进去、环境变量没设过、有 `%LOCALAPPDATA%` 时，建好 `%LOCALAPPDATA%\Chessboard\WebView2`，用 kernel32 `SetEnvironmentVariableW` 设进本进程的环境块（loader 读的就是它；`std.process.Environ` 只是拷贝）。
    - 判断抽成纯函数 `webview2UserDataFallback`。Zig 测试 79 → 84：可写、不可写、已设、没有 `%LOCALAPPDATA%` 四种，加探测本身一条。没改 SDK。
  - **CI**：`build-windows.yml` 的 build 作业在原自检之前加「self-test the packaged app from a read-only folder」（6 分钟上限）：
    - 拷一份 `dist/Chessboard` 到 `RUNNER_TEMP`，`icacls /deny "<用户>:(OI)(CI)(WD,AD)"`；
    - 先证明写文件确实失败，再跑两次启动的打包自检；
    - 之后要求 `%LOCALAPPDATA%\Chessboard\WebView2` 里有数据、`bin\` 旁边没有 `*.WebView2`。
    - 不用整个 `W`：它含 `SYNCHRONIZE`，打开文件夹要用。
  - **守卫**：`test-chess.mjs` 查 `main()` 在 runner 之前调这一步，查这个步骤在原自检和打包 zip 之前，并且带 `icacls`、写入探测、自检和两项目录检查。
  - **先红后绿**：把 `main()` 里的 `app_state.resolveWebView2UserData();` 注释掉推一次，这个步骤应当红；静态守卫也会红。
  - **还要在 CI 上证实**：
    - 这个步骤绿；
    - 先红那一次真的红，并记下红在哪：自检超时，还是只有 `%LOCALAPPDATA%` 检查没过；
    - runner 账户上 deny 确实生效（步骤自己会查）。
  - **CI 结果（2026-10-08）**：
    - 第一次（run 37726044424）红在准备上：只对 runner 用户的 deny 没挡住写入（`bin\write-probe.txt` 写进去了）。改为对 Everyone（S-1-1-0）deny，`/T` 写到每个文件夹和文件（bfc3cdc）。
    - 绿（run 37726755301）：`bin\` 拒绝新建文件；两次启动都交回自检报告；WebView2 的数据在 `C:\Users\runneradmin\AppData\Local\Chessboard\WebView2`。
    - 先红（run 37727593248，临时提交 281e1a5 让 `resolveWebView2UserData` 一进来就返回）：两次启动都在 1 秒内退出，日志 `dispatch.error "CreateFailed" event="app_start"`、`error: CallbackFailed`，没有自检报告。也就是说，**8.3 以前，解压到不可写目录时应用根本起不来**（不只是页面空白）。临时代码随即删掉。
    - 另一次「先红」（ae1d7c4，把调用注释掉）在单元测试那步就被静态守卫拦下，没走到这一步——守卫本身也算证明过了。
  - 本机只有 Linux：Windows 路径交叉编译通过（`-Dtarget=x86_64-windows`，null 与 windows 平台都试了），没有跑过。
- **V2 webkit 系统依赖不再每次从 apt 下（选 b，缓存）**：checks.yml 的 browser、shots 与 release.yml 的 browser 不再 `install --with-deps`，改成五步：装 playwright 并算缓存键 → `actions/cache/restore@v6` → 「system packages for <引擎>」（`scripts/ci-browser-deps.mjs install`）→ 只在缓存没命中且这次真从 apt 下了包时 `actions/cache/save@v6` → 只下浏览器。键是装上的 Playwright 版本 + 引擎 + runner 镜像（`ImageOS` / `ImageVersion`），版本从 node_modules 读回、不另抄。判断用 Playwright 1.64 自带的 `install-deps --dry-run`（`apt-get install -s`，离线、不要 sudo）：不缺就跳过 apt（chromium 通常如此）；缺就把缓存的 .deb 当本地文件装，装时不给软件源（否则同版本的包 apt 会改从镜像下，本机实测 182 个全被重新下载），装完再查一遍；仍缺或装不上就退回原来的 `playwright install-deps`，apt 下载放进自己的目录、复制出来给缓存存。本机（Ubuntu 24.04）实测：从 apt 装 211 个 .deb、106 MB、45.9 s；清掉后从缓存装 19.5 s、零下载；缓存缺一个包时报警告退回 apt、不存。没选容器（a）：所有测试会改成 root、镜像自己的字体（布局套件量文字）、每个作业拉约 2 GB、/dev/shm 只有 64 MB，改动的不止装依赖这一步。`actions/cache` 进依赖清单，`test-deps` 认子 action（`actions/cache/restore@v6`）；test-chess 守卫三处都是这五步、没有 `--with-deps`、键随版本 / 引擎 / 镜像变。**CI 要确认**：①第一次运行（缓存空）各 webkit 作业日志出现 `system packages from apt` 且有一个作业存上缓存（其余作业的「Unable to reserve cache」只是警告）；②之后的运行出现 `system packages from cache`、这一步 ≤ 60 s，十次运行算 p95；③chromium 出现 `from image`；④`/var/cache/apt/archives` 之外的下载目录在 runner 上确实留下 .deb（日志 `apt downloaded N .deb` 的 N > 0）；⑤runner 镜像每周换版本时键会变，那一次是缓存未命中，计 p95 时算进去。
- **V3 发布彩排的 FRAME-MISS 计数**：查下来 release.yml 本来就有——计数是 test-layout-e2e.mjs 退出时自己往 `$GITHUB_STEP_SUMMARY` 写的（lib/frame-watch.mjs），两个 workflow 跑分片的步骤一样，§2 说「现在 checks.yml 才有」不对。这次把它写明并守住：两个 workflow 的那一步加注释，test-chess 核对两边跑套件的步骤逐字相同、都在 runner 上直接跑（没有 container、没有覆盖 `GITHUB_STEP_SUMMARY`）。另加 `scripts/frame-miss-tally.mjs LOG…`：从存下来的作业日志里数 `FRAME-MISS` 行（日志行首带时间戳），给 8.4 收尾时的汇总用。**CI 要确认**：下一次发布彩排里每个布局分片（两个引擎 × 5 片）的作业摘要都有「layout shard i/5: N 次」一行。

### M2

- **T1 「看 N 步」第一题 ≤ 1 s**：先量（本机 Chromium、真引擎、冷启动的新页面）。新的一组（没有复习题）第一题看 2 步，题库 1400 分段 4,007 道里自带的线 1,718 道 3 步、1,627 道 5 步，**一次都不搜**：点下去到第一题中位 217 ms、p95 395 ms（12 次；同页第二组 84 / 109 ms）。慢的是**复习题打头**的一组：看 5–6 步的题库键要搜 1–3 次，前面还要等引擎冷启动（点下去之后 400–1,100 ms 才 ready），中位 1,255 ms、p95 2,097 ms（20 次）。整组里每题的构建（node 里同一个 Stockfish，20 组）中位 7 ms、p95 691 ms、最长 1,139 ms，每次搜索约 196 ms——答题时已在后台算好下一题，等的只是第一题。
  - 改法：答错时把这道题用到的引擎着法跟着复习键记下（`vis.look.eng`，键 → 「局面标签:UCI」，标签是整个 FEN 的 FNV-1a），复习时先用记下的、没有才搜；搜索是局面的纯函数，所以出的是同一道题。会话内按键缓存建好的题（64 道）；第一题出来后引擎在后台启动，第一题就是没记着法的 8.3 复习键时与分段一起启动。学习文件 / 同步合并 `eng` 取并集；复习键离开队列时一并删除。搜哪些局面、节点预算、Hash 都没改；出题循环原样提到 `lookNth`。
  - 之后：新的一组中位 253 ms、p95 369 ms（30 次；同页第二组 81 / 142 ms）；带着引擎着法的复习题打头中位 194 ms、p95 318 ms（20 次，**0 次搜索**，页面出的线与 node 里 Stockfish 出的逐题相同）。**8.3 存下的、还没在 8.4 里答错过的题库复习键照旧要搜**：中位约 1.2 s、p95 约 1.6 s（20 次）；答错一次后就带上着法。
  - 测试：test-chess 用手写题库扮成题库题、FEN 的纯函数当引擎，跑 4 个种子 × 3 种答题序列的整组 120 题，哈希与 v8.3.0 模块的结果相同；60 道题用记下的着法、不给引擎重建，逐题相同。test-trainer-e2e (l)：新的一组与带着法的复习题第一题 ≤ 1 s（CI 2.5 s，实测 200 / 166 ms），后者不发 `go`；8.3 的键答错后 `eng` 与 node 算的一致。test-learning：`eng` 合并。主包 908,392 → 908,463（learning.js 的合并）；chunk-visual.js 22.6 → 24.2 KB。
- **T2 名局猜着 10 → 40 局**：
  - **三十局**（1834–1948，全部在 1950 年以前）按时代分四组：浪漫时代 4 局（拉布尔多内–麦克唐奈、保尔森–莫菲、伯德–莫菲、楚克尔托特–布莱克本）、古典学派 9 局（奇戈林–斯坦尼茨电报赛、斯坦尼茨–奇戈林 1892 第 4 局、皮尔斯伯里–拉斯克 1896 与 1904、鲁宾斯坦–拉斯克、列维茨基–马歇尔、爱德华·拉斯克–托马斯、拉斯克–卡帕布兰卡 1914、尼姆佐维奇–塔拉什）、超现代派 7 局（博戈柳博夫–阿廖欣 1922、泽米施–尼姆佐维奇、雷蒂–卡帕布兰卡、卡帕布兰卡–塔尔塔科维尔、托雷–拉斯克、雷蒂–阿廖欣、阿廖欣–尼姆佐维奇）、世界冠军与苏联学派 10 局（苏丹·汗–卡帕布兰卡、门契克–尤伟、阿廖欣–拉斯克 1934、尤伟–阿廖欣 1935 第 26 局、博特温尼克–维德马尔、克雷斯–阿廖欣、博特温尼克–卡帕布兰卡、法因–博特温尼克、斯梅斯洛夫–科特瑙尔、博特温尼克–克雷斯 1948）。都是分出胜负的局，没有收和棋。
  - **着法来源**：没有凭记忆打谱。每局从 raw.githubusercontent.com 上的公开合集取来（多数是 rozim/ChessData 的 PgnMentor 镜像），再和至少一份别的合集逐着对照（JvR 赛事档案、Britbase、Chessly 的 classics/perle、greatgames、scoutfish 等）；有分歧的 11 局取多数一致的版本、终局多记少记的只收一致部分，逐条写在 `docs/classics-sources.md`。lichess.org、chessgames.com、pgnmentor.com 在代理下连不上，没有绕道。
  - **内容**：每局三语的对局者、赛事、一段开场白和 4–6 条注释（读棋原有十局 6–12 条不变）。数据在 `classics-more.js` / `-en` / `-ja`，三语同一个分块 `chunk-classics-more.js`（110,481 字节），学习目录第一次画出来以后才取（和残局训练营同一个做法）；主包只多了外壳 `trainer/classics-more.js` 和目录、开场白的几处接线。
  - **读棋也读得到**：分块到了以后三十局接在原来十局后面，读棋和猜着共用同一个按位置的目录（10–39），读棋第 0 步显示开场白；猜着在第一步猜之前显示开场白。这样做最简单也最一致——猜着卡上的「读棋」按钮本来就打开同一局。代价是读棋会显示这三十局的开局名：前 30 步多出 28 个变例段，24 段补了中日译名（`openings-variation-zh/ja.js`，中文表在主包里，约 1 KB），4 段登记为没有通行叫法（test-eco）。
  - **引擎核对**：`scripts/verify-classics.mjs`（lib/sf-node.mjs，深度 18，每个局面清空哈希，大师着用 `searchmoves` 单独打分），四十局 2,643 个半回合每一着比引擎第一选择，胜率差 ≥ 20（复盘的 ??）的记下来：30 处，三十局里 20 处。本机 4 个进程并行约 33 分钟（单进程合计约 2 小时），记录在 `docs/classics-verified.json`。计分规则不变（大师着满分，比大师好的着不扣分）；14 处在那一步的注释里写明「引擎首选……」（如 10...Qe7？之于爱德华·拉斯克–托马斯、22...Qb4？？之于克雷斯–阿廖欣、29...Qe7？之于博特温尼克–卡帕布兰卡），其余 6 处（激烈对攻里的来回、同一个错误的上一步）在测试里登记了原因。
  - **测试**：test-classics 改为 40 局——三语的注释位置相同、注释开头引的着法就是那一步实际走的、译文引同一步、日文扫描、全角标点；核对记录覆盖 40 局且着法与当前棋谱一致（改了局不重跑就红），每处标出的着法要么有注释、要么登记了原因。test-eco 把三十局的前 30 步也算进变例译名。test-review-e2e：目录 40 局按时代分 5 组、分块在目录画出后才取、第 11 局（黑胜）默认猜黑方、开场白三语、读棋第 0 步有开场白，全部通过。test-layout-e2e 的猜着场景（#92，`SHARD=93/200` 单独跑，本机 59 s）加了三语各自最长标题和最长开场白的那一局，1400×900 与 520×800 下卡片与 40 局目录都没有截断。
  - **主包**：908,392 → 910,477（+2,085：外壳与接线约 1.1 KB，变例中文名约 1 KB），在 8.3 的上限 917,245 与 8.4 的 918,392 之内。没有新界面键。
