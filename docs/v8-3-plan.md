# 8.3 · 收账：Windows 与 CI 的门槛补齐，训练接上大题库

写于 8.2.1 发布当天（2026-10-07），规矩照旧：

- 每条写**依据**、**做什么**、**验收**；
- 发布前补**落地记录**，做到的和没做到的都逐条写。

8.3 的材料有三份：

1. **8.2 推到 8.3 的事**：v8-2-plan §9 的「没做到的」、8.2.0 发布说明「还没做的」、8.2.1 记录里的两条。
2. **依赖与 SDK 审计**（2026-10-07 重查，§1）。
3. **8.2.1 的教训**（§2）：一个影响全部 Windows 用户的问题，CI 绿了至少一个版本——原因是自检在一个「恰好有页面」的目录里启动应用。8.3 要把「CI 绿 = 用户能用」之间剩下的缝一条条找出来。

结论先说：**8.3 仍没有必须做的依赖升级**（SDK 0.10.2 未发布；Node 26 10-28 才进 LTS）。主线是收账：Windows 的自动检查升成门槛、阈值定下来、CI 墙钟回到目标以内；训练上把「看 N 步 / 盲走」接上 4 万题的 Lichess 题库，补齐对手阶梯最上面一级。新内容只提一项候选，等你拍板（§8 第 2 条）。

---

## 依据

1. **审计的方式**：
   - `scripts/deps-check.mjs`（npm 四项）、`git ls-remote --tags`（五个 Action）、PyPI `ziglang`、`nodejs.org/dist/index.json`；
   - vercel-labs/native 无 blob 克隆到 HEAD `fd96d9d3`（2026-10-06），`git log v0.10.1..HEAD` 逐条读标题，按 webview / windows / automation / bridge / dialog / restore / dpi / manifest 过滤。
2. **8.2.1 的排查**：Windows 的三次 CI 运行（8.2.0 两次彩排、分支上 run 37569752524 与 37571031877）、SDK 0.10.1 源码 `src/platform/windows/webview2_host.cpp`、`src/platform/macos/appkit_host.m`、`src/tooling/package.zig`。
3. **8.2 文档**：`docs/v8-2-plan.md` §6、§8、§9；`.github/release-notes/v8.2.0.md`、`v8.2.1.md`；`docs/measured.json`。

**这次的局限**：ziglang.org 与 codeberg.org 仍是代理 403，Zig 以 PyPI 镜像为准；vercel-labs/native 的 issue / PR 讨论看不到；没有 macOS / Windows 桌面。

---

## 0 · 结论先行

### 版本号：8.3

- **依赖**：没有要升的。SDK 仍是 0.10.1。
- **存档**：格式不变，SCHEMA 仍是 2。
- **9.0 的门槛不变**：换引擎形态、SQLite、SDK 1.0、Chess960、第四种语言。

### 8.3 的三个主题

| | 主题 | 一句话 |
|---|---|---|
| **V** | 验证 | Windows automation 升成门槛；两平台的阈值按实测收紧；打包自检再加一次「在 exe 自己的目录里启动」；排查其余按当前目录解析的相对路径；CI 墙钟连续三次 ≤ 15 分钟 |
| **T** | 训练 | 「看 N 步」「盲走」从 4 万题的 Lichess 题库按评级出题；「看 N 步」的接续着法改用引擎；阶梯最上面一级补到 300 盘；小 bug |
| **F** | 地基 | Node 26（10-28 进 LTS 后换 CI）；判长将的耗时定案；整句守卫的盲区与英文单复数；给上游的问题报告 |

---

## 1 · 依赖与 SDK 审计（2026-10-07）

| 依赖 | 钉的版本 | 最新 | 8.3 建议 |
|---|---|---|---|
| Native SDK `@native-sdk/cli` | 0.10.1 | 0.10.1（npm `latest`）；main 上 134 个未发版提交 | **等**。0.10.2 一出就单独开 PR |
| Zig | 0.16.0 | 0.16.0（PyPI） | 不动 |
| Stockfish | 19（lite 单线程 wasm） | 19.0.0 | 不动 |
| esbuild | 0.28.2 | 0.28.2 | — |
| Playwright | 1.63.0 | 1.63.0 | — |
| Node | 24（engines ≥ 24） | 24 LTS（10-20 转维护期）；26.10.0 Current，**10-28 进 LTS** | **见 §8 第 3 条** |
| actions/checkout · setup-node · upload-artifact · download-artifact · mlugg/setup-zig | v7 · v7 · v7 · v8 · v2 | 同 | — |

**SDK main 的 134 个提交**（2026-08-25 → 10-06）几乎全是把 SDK 自己的组件层、布局、渲染协调迁到编译式 TypeScript（scriptc）。按关键词筛出的修正里，与我们相关的只有 8.2 已记的 `#465`（macOS 更新器导出）；**没有一条碰 WebView2 的资源路径**——8.2.1 修的问题在上游 HEAD 上仍在（`assetFilePath` 未改）。

---

## 2 · 8.2.1 的教训与体检

**8.2.1 修的是什么**：WebView2 宿主按进程当前目录解析相对的页面目录；Windows 包的 exe 在 `bin\`、页面在 `resources\frontend\dist\`；双击启动读不到页面。CI 的打包自检在仓库根启动应用，那里有 `frontend/dist`，所以一直绿。

**由此要问的**：还有哪些地方，CI 的启动方式和用户的不一样？

| 差别 | 现状 | 8.3 |
|---|---|---|
| 当前目录 | 8.2.1 起自检与 automation 都在临时目录里启动 | 再加一次「当前目录 = exe 所在目录」（双击就是这样）——V1 |
| 其余相对路径 | `runner.zig` 的 `icon_path = "assets/icon.png"`、bridge.zig 里少数 `Dir.cwd()` 的用法，在 Windows 上同样按当前目录解析 | 逐个核对：用得到就改成 exe 相对，用不到就删——V2 |
| 解压位置 | 只在 runner 的工作目录解压；用户可能放在 `Program Files`（不可写）或带中文、空格的路径 | WebView2 的用户数据目录在 exe 旁边，放进不可写目录会怎样没人试过——V2 记录，真机路线加一步 |
| 双击 vs 命令行 | 都是 CreateProcess，差别只在当前目录与环境 | 由 V1 覆盖 |

| 项 | 现状 | 问题 |
|---|---|---|
| 主包 | 907,245 / 预算 951,642（余 44,397）；8.2 自设上限 910,972 | 8.3 照 8.2 的办法，相对 8.2.1 再给 +10 KB |
| `app.js` | 5,754 行 = 上限 | 零余量 |
| Windows automation | 8.2.1 修好后已连续两次 30 项全过（分支 run 37571031877、8.2.1 彩排 run 37573325903） | 按 8.2 §9 M4 的规矩已满足「连续两次绿」，可以改成门槛 |
| 阈值 | 都还是 8.2 放宽的暂定值；实测离线很远（同步 p95 macOS 29 ms / Windows 10 ms，帧间隔 23 / 46 ms，阈值 500 / 1,000 ms） | 收紧 |
| CI 墙钟 | 15.9 / 16.6 分钟，未达到「连续三次 ≤ 15」；布局分片偶尔不出帧的根因没查；8.2 还遇到一次 runner 失联 | — |
| 真机记录 | 8.2 真机路线没人走过；上一次真机记录停在 5.2.0 | 8.2.1 证明了这条路线的价值：第 1 步就会发现空白页 |

---

## 3 · V：验证

### V1 打包自检加一次「在 exe 目录里启动」；Windows automation 升成门槛【S】

- **做什么**：
  - `selftest-app.mjs` 的两次启动：第一次在临时目录（8.2.1 起），第二次在 exe 自己的目录（双击时的当前目录）；macOS 照做（.app 里的可执行文件目录）。
  - Windows automation 去掉 `continue-on-error` 与「not a gate yet」，`release.yml` 的 `publish` 因而等它；test-chess 的守卫跟着改。
- **验收**：两平台发布构建与 automation 都绿；把 `resolveAssetRoot` 临时注释掉时，Windows 的自检两次都红（先红后绿）。

### V2 其余按当前目录解析的路径【S】

- **做什么**：列出 Windows 构建里所有相对路径的使用处（`icon_path`、`Dir.cwd()`、SDK 里拿相对路径的服务），逐个判定：
  - 运行时会读的 → 按 exe 目录解析，加 Zig 测试；
  - 运行时不读的 → 删掉或注明。
- **验收**：清单进 §9；每一处有结论。

### V3 阈值按实测收紧【S】

- **做什么**：两平台各有至少两次绿的报告后，`THRESHOLDS` 改为「实测最坏 × 5，向上取整到 50 ms」，同时保留绝对上限；R18 的预读时刻开始设门槛。
- **验收**：§9 记下每个阈值的来历（哪几次运行、最坏值）。

### V4 CI 墙钟连续三次 ≤ 15 分钟；布局分片不出帧的根因【M】

- **做什么**：
  - 按 `ci-wallclock.mjs` 记下的作业耗时，把最长的两组（webkit engine 10.3 分钟、webkit 布局分片）再分；
  - 布局分片：在看门狗兜底的地方打出不出帧时的合成器状态（`page.evaluate` 超时前的 rAF 计数、视口尺寸序列），先拿到三次现场再决定修法。
- **验收**：三次 PR 运行 ≤ 15 分钟（`measured.json ciWallClock` 的 `last3Under15` 为真）；根因写进 §9，修了就去掉看门狗以外的重试。

---

## 4 · T：训练

### T1 「看 N 步」「盲走」接上 Lichess 题库【M】

- **依据**：8.2 只从本地 1,148 道题里出题（盲走只有一步杀 57、两步杀 52），玩几组就重复。
- **做什么**：
  - 盲走：从 4 万题的 Lichess 题库按主题 `mateIn1` / `mateIn2` 选题，按玩家这个模式的评级取分段（与谜题页同一套评级分段与分块）；
  - 看 N 步：题面从题库按评级选；接续的 N 步照 8.2 先走题目自带的线（Lichess 题的解答线通常 2–6 个半回合），走完再由 T2 接着出；
  - 同一种子、同样作答仍得到同一组题（8.2 的约定不变）。
- **验收**：
  - 两个模式各抽 200 组种子，题目不重复率与评级分布记进 §9；
  - 主包增长 ≤ 1 KB（题库本来就在分块里）。

### T2 「看 N 步」的接续着法改用引擎【S–M】

- **依据**：8.2 先走题目自带的线；线走完后用启发式（`visual-modes.js` `pickMove`：吃子按子力加分、将军加分、走完会被吃的减分，再加一点种子随机），偶尔不像实战。
- **做什么**：线走完后的每一步改用复盘同一个定节点预算取引擎最佳着，生成题目时做、不在作答时做；同一种子仍得到同一组题（定节点搜索是确定的）。
- **验收**：抽 100 组，人读 20 组记进 §9；生成一组的耗时 ≤ 1 s（本机）。

### T3 阶梯最上面一级补到 300 盘【S（CI 时间）】

- **做什么**：派发 `ladder.yml`，`pairs=strongplus:extreme:300`；拟合结果与区间进 `measured.json` 与 §9。
- **验收**：「强力+」→「不限档」区间宽度 ≤ 15 个百分点。

### T4 小项【S】

- 名局猜着执黑时棋子上的手形光标；
- 英文「1 games」这类单复数（8.2 F4 留下的）。

### T5（候选，等拍板）残局训练营第二部【M–L】

- **依据**：残局训练营 60 个局面、59 个已查表，核对流程（本地 3–4 子表 + CI 上的在线 Syzygy）已经搭好，新增的成本主要在内容。
- **做什么**：再加 30 个：车兵残局（菲利多尔与卢塞纳之外的 10 个）、后对兵 6 个、轻子残局 10 个、兵残局 4 个；全部 ≤ 7 子、全部查表。
- **验收**：90 个全部查表一致；分块，主包 ≤ +1 KB。

---

## 5 · F：地基

### F1 Node 26【S】

- 10-28 Node 26 进 LTS 之后：CI 与 release 的 `node-version` 换成 26，`engines` 保持 `>=24`（本机用 24 的开发者不受影响）；`test-deps` 跟着改。在 10-28 之前不换。

### F2 判长将的耗时定案【S】

- 8.2 最坏 260–340 ms，评审要 ≤ 150 ms。再压预算会证明不出真长将；自写着法生成器主包放不下。
- **建议**：接受，把「≤ 350 ms（本机）」写进测试作为上限，防止以后变慢。见 §8 第 5 条。

### F3 整句守卫的盲区【S】

- 守卫加一条数据流规则：译文函数的返回值赋给变量后，该变量出现在 `+` 两边也算拼接；剩下的盲区照实写。

### F4 主包 8.3 上限【S】

- `BUNDLE_BYTES_AT_821`（8.2.1 实测）+ 10,000。

### F5 给上游的问题报告【S】

- 把 8.2.1 的根因写成 vercel-labs/native 的 issue 原文（复现步骤、`assetFilePath` 与 macOS 的差别、建议的修法：相对根按 exe 目录或 `resources\` 解析），放进本文附录，由你转交。
- 上游修了以后，`resolveAssetRoot` 可以删掉（留守卫测试）。

---

## 6 · 这一版不做的

- macOS 签名自动更新、签名与公证（缺证书）；透明标题栏（等上游）；
- 第二个引擎默认打开（要在 8 GB 真机上量内存）；
- 多线程引擎、SQLite、Chess960、第四种语言（9.0）；
- msix / 安装程序（SDK 的 Windows 安装程序还是「future work」）。

---

## 7 · 顺序与发布

| 里程碑 | 内容 | 说明 |
|---|---|---|
| **M1** | V1、V2、V3、F4、F5、T4 | 先把「CI 绿 = 用户能用」的缝补上 |
| **M2** | T1、T2、T3（派发即可，跑在后台）、T5（如果做） | 训练内容各自分块，可以并行 |
| **M3** | V4、F1（10-28 之后）、F2、F3、收尾、8.3.0 | SDK 0.10.2 如果在此之前发布，升级也放进这里 |

每个里程碑的流程照 8.2：并行开发 → 对抗性评审 → 合进开发分支、开 PR、跑 CI → release 彩排绿了才合并 → main 上正式发布。

---

## 8 · 需要你拍板的（2026-10-07 已定：「按建议来」）

| # | 决定 |
|---|---|
| 1 | 版本号 8.3 |
| 2 | 以收账为主，新内容做 T5 残局训练营第二部 |
| 3 | 10-28 Node 26 进 LTS 后 CI 换到 26，`engines` 保持 ≥ 24 |
| 4 | Windows automation 在 M1 升成门槛 |
| 5 | 判长将接受最坏约 350 ms，测试里守住 |
| 6 | 阶梯顶一级在 CI 上补到 300 盘 |
| 7 | Windows 资源路径的问题写成 issue 原文，交你转交上游 |
| 8 | 8.2.1 的 Windows 双击由你在真机上试；其余真机步骤没人走过的不挡发布 |

| 9 | （2026-10-07 新增，同日定为 a）阶梯顶一级：接受 58%，档位不改；README 与「不限档」的提示照实写 |

**第 9 条（T3 的结果引出的新问题）**：「不限档」只比「强力+」强 58%，低于台阶要求的 60–75%。三种做法：

- a. **接受并照实写**：顶上一级本来就是「不限」，和棋多压低了比分；README 与「对手」对话框的说明写清楚。不动任何档位。
- b. **把「强力+」调弱**（例如 2,500 → 1,200 节点），让它和「不限档」拉开；但「强力+」对「强力」现在是 70%，调弱后这一级会变窄，要再下几百盘重新标定两级。
- c. **给「不限档」更多时间**（1.2 s → 3 s）：更强，但每步等得更久，和棋压分的效应仍在，未必能到 60%。

**建议 a**。b、c 都要再下一轮对局，而且改的是玩家已经习惯的难度；58% 的原因是和棋，不是档位设反了。

原来的问题：


1. **版本号 8.3**：同意吗？
2. **范围**：以收账为主（V、T1–T4、F），新内容只做 **T5 残局训练营第二部**？还是不加新内容，或者你有别的想要的？
   - **建议**：做 T5。核对流程已经搭好，新增的主要是内容。
3. **Node**：10-28 Node 26 进 LTS 之后，CI 换到 26、`engines` 保持 ≥ 24？
   - **建议**：换。24 在 10-20 已转入维护期。
4. **Windows automation 升成门槛**：8.2.1 之后已连续两次绿。在 8.3 M1 去掉 `continue-on-error`，从此 Windows 的打包后检查挡发布。同意吗？
5. **判长将的耗时**：接受最坏约 350 ms 并在测试里守住，不再追 150 ms？
   - **建议**：接受。再快只能自写着法生成器，主包放不下。
6. **阶梯顶一级补 300 盘**：在 CI 上跑（64 片并行，墙钟几分钟到十几分钟）。同意吗？
7. **给上游的问题报告**：把 Windows 资源路径的问题写成 issue 原文交给你转交？
8. **真机**：8.2.1 发布后，能否先在 Windows 上做真机路线的第 1 步（双击 `Chessboard\bin\chessboard.exe`，看页面出来没有，约 2 分钟）？其余步骤照旧，没人走过的不挡发布。

---

## 9 · 落地记录

### M1

- **V1**：
  - `build-windows.yml` 的 automation 去掉 `continue-on-error` 与「not a gate yet」，`release.yml` 的 `publish` 从此等它；失败时的 summary 步骤随之去掉。test-chess 对两个平台的 automation 作业都要求「没有 continue-on-error、名字里没有 not a gate」。
  - `selftest-app.mjs`：第一次在本次临时目录里启动，第二次在可执行文件自己的目录里启动（双击时的当前目录；macOS 是 .app 的 Contents/MacOS）。都按绝对路径，都不在仓库里。test-chess 守着这两处。
  - **先红后绿**：在分支上临时让 `resolveAssetRoot` 直接返回（388b62b，随即还原），派发 build-windows（run 37578212790）：发布构建的打包自检**两次启动都在 120 秒内交不回结果**（第 2 次就是在 `bin\` 里启动，等于双击），automation 场景也红——8.2.0 的问题在 CI 上完整复现。
- **V2**（Windows 构建里按当前目录解析的相对路径，逐个下结论）：
  - 前端页面 `frontend/dist`：8.2.1 已改为 exe 相对。
  - 通知图标 `icon_path = "assets/icon.png"`：WebView2 宿主只在通知 / 托盘里用它（`loadNotificationIcon`，`LoadImageW(IMAGE_ICON, LR_LOADFROMFILE)`），路径接在当前目录后，而且 PNG 不能当 IMAGE_ICON 加载——更新检查的通知一直是系统默认图标。改为：`build-windows.yml` 把 `assets/icon.ico` 放进 `resources\icon.ico`，`main.zig` 按 exe 目录解析出绝对路径（`packagedResource`）；macOS 不变。
  - automation 的投递箱 `.zig-cache/native-sdk-automation`：故意按当前目录（驱动脚本的工作目录），只在 automation 构建里有，不改。
  - `bridge.zig` 的 `Dir.cwd()`：只用来对绝对的 appdata 路径建目录、改名，不受当前目录影响。
  - **记下、不改**：SDK 启动 WebView2 时不给用户数据目录，WebView2 默认放在 exe 旁边。把应用解压到不可写的目录（例如 `Program Files`）时，WebView2 可能建不起来。要改就得把现有用户的 localStorage / IndexedDB 搬到别处，风险比收益大；真机路线 Windows 段加一个可选步骤。
- **V3**：阈值按九次绿运行定（macOS 36850688751、36859018535、36860775645、37571034424、37573325903、37574917430；Windows 37571031877、37573325903、37574917430）：

  | 指标 | 九次最坏 | 8.2 暂定 | 8.3 |
  |---|---|---|---|
  | 同步期间 `wait` p95 | 50 ms（macOS） | 500 | 250 |
  | 同步期间 `wait` 最长 | 249 ms（macOS） | 2,000 | 1,250 |
  | 空闲 `wait` 最长 | 205 ms（Windows） | 2,000 | 1,050 |
  | 同步期间页面最长帧间隔 | 134 ms（macOS） | 1,000 | 700 |
  | R18 预读拿到摘要 | 3,365 ms（macOS；Windows ≤ 276） | 只记数 | 7,000 |

  时延取最坏 × 5、向上取整到 50 ms；预读是首屏时刻不是时延，取最坏 × 2。
- **F4**：主包上限改为 `BUNDLE_BYTES_AT_821`（907,245，8.2.1 与 8.2.0 相同）+ 10,000 = 917,245。
- **T3**：`ladder.yml` 在 main 上派发（run 37577271547，`pairs=strongplus:extreme:300`）。16 个作业全绿，300 盘新对局（引擎 4.63 小时）+ 5,441 盘沿用；「不限档」每步节点数中位 494,753（8.1 的测量机约 14 万，玩家的电脑约 50–60 万——runner 与玩家的机器相当）。
  - **结果**：「不限档」对「强力+」直接对局 58.3%（56.1–60.5），拟合 **58.2%（52.7–63.6）**。区间宽 10.9 个百分点，T3 的验收（≤ 15）达到；但这一台阶**低于 60–75%**，fit 的判定因此是 19/20 红（其余 19 个台阶都在 60–75% 内，阶梯单调）。8.1 的 64 盘读成 61%（50–71%），盘数多了才看清。
  - **为什么**：「强力+」每步 2,500 节点，「不限档」每步 1.2 s（约 50 万节点），节点数差约 200 倍，得分却只高 8 个点——到这个强度自对弈和棋多，得分被压向 50%。
  - 拟合后的 `measured.json` 由 run 上传为制品，但本会话下载制品的地址被代理拒绝（403），没有拿到；标定分只记在这里：不限档 2877 → **2859**（±86）、强力+ 2807 → 2809（±85），其余 19 档与 `measured.json` 现有的标定分逐个相同（已核对）。app 显示的等级分仍是 8.1 的表，差 18 分以内。§8 第 9 条定为 a：档位不改，README「怎么玩」与「不限档」的提示（三语）照实写上约 58%。
- **T4**：
  - 名局猜着执黑时没有手形光标：`app.js` `grabbableAt` 的 learn 分支把白方写死（`p.color === "w" && turn() === "w"`），猜着运行在 learn 模式里（`learn.gs`），猜黑方时永远是假；点击能走是因为猜着自己的 `click()` 用的是 `s.side`。改为 `me = learn.gs ? learn.gs.side : "w"`（行数不变，5,754）。review-e2e 在「黑胜的一局默认猜黑方」后悬停 b8 / b1：改前都是 `default`，改后黑子 `grab`、白子 `default`。
  - 英文单复数：沿用 `tf` 已有的 `{n:one|other}`（Intl.PluralRules），只改 `i18n-en.js` 的 16 个值（`stats.gamesN`、`lib.addedNone`、`pz.moveN`、`home.next.review` 等，运行时计数可能是 1 的）；计数有下限或是常量、带小数的兵数、占位符不是计数的都看过、不改。test-chess 新增一块：16 个键三语各渲染 1 和 2，英文逐字比对、中日等于直接替换（改前 2 项红）。
- **F5**：上游问题报告原文见附录 A。


### M2

- **T1（「看 N 步」「盲走」接上 Lichess 题库）**：
  - 沿用谜题页那套：`ChessPuzzleDb.bandFor(评级)` 选分段，`ensureBand` 按需载入 `chunk-lc-*.js`。看 N 步取本模式评级所在分段；盲走取「评级 − 150」所在分段（与盲走题目评级 +150 对应），该分段一步杀 / 两步杀不到 20 道时换到最近的够数分段（`bankBand`）。分段载不进来或题库索引不在，照 8.2 用本地题库。
  - 复习键：题库题末尾带分段（盲走 `id|band`，看 N 步 `id|N|seed|band`）；本地题与 8.2 相同。
  - 200 个种子 × 10 题：盲走 1000 / 1500 / 2000 → 不同的题 1,199 / 1,059 / 701（8.2 本地题库只有 109 道）；看 N 步 1,383 / 1,480 / 1,526（8.2：868）；所选题 2,000/2,000 落在所选分段内。
- **T2（看 N 步线走完后用引擎）**：每步 `Engine.analyze(fen, LOOK_BUDGET)`，`LOOK_BUDGET` = 复盘的 `SCAN_BUDGET`（200，90,000 节点），每次 `ucinewgame`；第一题开局时生成，之后每题在上一题答完时生成，作答时不搜。本机 Chromium 真引擎 100 组：每组中位 669 ms、p90 1,777 ms、最长 4,117 ms；每题中位 4 ms、p90 324 ms、最长 1,156 ms。**「一组 ≤ 1 s」没有全部达到**：高 N 的题自带线只有 3–5 步，剩下每步约 155 ms；玩家实际等的是单题。
- **T5（残局训练营第二部，60 → 90）**：王兵 12 → 16、车 12 → 22、轻子 12 → 22、后 12 → 18、理论和棋 12。17 个 3–4 子局面本地 Syzygy 查表（结论与唯一着与表一致）；13 个 5 子局面先用 Stockfish 16 深度 30 / 40 两次核对、标 `pend`（卡片写「查残局库的核对还没做」，新键 `eg.verPend`，界面键 1301 → 1302）；随后在开发分支上派发 verify-endgames.yml（run 37592070206，`only` = 这 13 个）：**13 个全部与目标一致，0 个不一致**，应答（category / verdict / DTZ / 保住结论的着法）照 8.2 M2 的格式写进 `docs/endgames-verified.json` 的 `lichess`（制品下载被本会话的代理拒绝，数据取自 run 日志的逐行输出），13 个改标 `tb`。现在 90 个里 89 个查过表，只剩 8 子的「三兵突破」。`pend` 的规则与卡片文字留着，test-endgames 借一个 5 子局面检查卡片。新内容追加在各主题末尾，进度按 id 记录不受影响。chunk-endgames.js 38.6 → 61.2 KB。
- **评审（对抗性，1 个代理）**：没有 P1。
  - P2-1：出一组看 N 步 / 盲走的异步回调没有令牌，晚到的一组会顶掉用户已经换去的模式或 run → 每次出题编号，任何一组开始或结束、模式改变、再点当前模式都作废未出好的那一组；出题期间按钮 `aria-busy`。
  - P2-2：8.2 存下的看 N 步复习键在 8.3 被引擎重建成另一道题（模拟 40 个中 35 个变、3 个变成 null 被删）→ 没有分段的键只按 8.2 规则重建，与 v8.2.1 的模块逐字节相同；题库题引擎这一步会终局时，这一层改用 pickMove。
  - P3-1：被取消的搜索最多重问 5 次；看 N 步的搜索固定 Hash 32 MB（`analyze(…, {hash})`；实测 168 个局面在 9 万节点下 Hash 16 / 32 / 128 的最佳着一处不差，固定只是让结果不随设置变）。固定 Hash 带出一个副作用（对局搜索不设 Hash，看 N 步之后会沿用 32）：协调时补上——分析用了别的 Hash 后，下一次对局搜索先把玩家的 Hash 设回（`engine.js` `foreignHash`；test-engine 先红后绿）。
  - P3-2：降级测试加 v8.2.1；8.2 开看 N 步 / 盲走时到期的题库题复习条目会被静默删掉（`puzzles.vis.bank` lost），其余字段全部保留；README「降级」写明。
  - P3-3：一组结束或出题被作废后不再排新的引擎搜索（已发出的那一次跑完为止）。
  - P3-4：四个残局的说明按局面和残局库改正（rp-saavedra 是从侧面沿横线将军；mi-b-vs-n 的 a7 是黑格、马从 c6 看着它；qu-h-draw 起始被 Qg2 将军，Kh6 / Kf6 之后 Qb2 占大斜线取胜；mi-n-vs-n 措辞）。


### M3

- **F2 判长将的耗时定案**（§8 第 5 条）：接受 8.2 的最坏耗时，加测试防止以后变慢。T6 样本 470 条都当成「失着后和棋」再读（8.2 评审的造法；8.2 用的 perp.mjs 不在仓库里），按 `forever()` 的记账方式数长将证明花掉的预算（攻方 n × n、被将军方 n × 40）：最多的是 pz:pUkFR 157,894（最后一次列着超过 100,000 才停），**上限 175,000**（+10%）。预算翻倍到 200,000 时最多 216,658，测试变红；改回来变绿。另取最费的五条，每条五次取最快的一次计时：本机最慢 161–217 ms，上限 350 ms；CI 上（静态测试也跑在 macOS / Windows runner）放宽到 1,050 ms——卡门槛的是确定性的计数，墙钟只是兜底。`motif.js` 没改，test-explain 约 +9 s。
- **F3 整句守卫的盲区**：守卫（`scripts/lib/i18n-concat.mjs`）在一个作用域里追译文的去向：后来才赋值的名字（追到声明它的块结束）、声明列表里的第二个名字、括号里的初值、抄给另一个名字（`const u = s`、`c ? s : t()`、`s || t()`），以及模板里的 `${s}`。红例加 6 种（改前全漏、改后全报），绿例加 5 种。在 src/web/js 上多报 0 处，没有模板要改，原有两条白名单不变。剩下的盲区照实写在守卫头注释：函数参数、对象属性和数组元素（如 game-end.js 的 `end.reason`）、嵌套表达式里的赋值、解构、只是包含译文的值、跨模块；被改写的名字仍当译文，只会多报。

- **V4 CI 墙钟与布局不出帧**（7bba81e）：
  - 抽样题库校验从 static (ubuntu) 移到自己的作业（static ubuntu 10.1–10.3 → 约 4.5 分钟）。
  - engine 组：engine flows 按场景切两片（`SHARD`，与布局套件同一个门）；engine + endgames 并进 review 组。sound + shell + trainer 拆成 sound + shell / trainer。布局套件 4 片 → 5 片。release.yml 的分组与 checks.yml 逐条相同（静态测试守着）。作业 32 → 39 个。
  - 账号同时只能跑 20 个作业，墙钟由排队决定：按 8.2 M3 的各作业时长排一遍，估计中位 14–14.5 分钟。「连续三次 ≤ 15 分钟」要等真实运行，8.3.0 发布时还没有三次记录。
  - 布局 5b 的量取按 400 ms 兜底时打一行 `FRAME-MISS`（场景、要的与页面收到的视口变化、rAF 数、可见性、焦点），作业摘要里按分片计数（含 0）。仅为取证，没改修法；根因留给下一版。

## 总结（8.3.0 发布时写）

- **做到的**：V1–V3（Windows automation 成为门槛、打包自检在 exe 目录启动、阈值收紧、通知图标）；T1 / T2（看 N 步、盲走接上 Lichess 题库与引擎接续）；T3（阶梯最上一级 300 盘，58%，档位不改）；T4；T5（残局 90 个，5 子 13 个在线查表全部一致）；F2（判长将耗时定案）；F3（整句守卫）；F4（主包 908,392 ≤ 917,245）；F5（附录 A）。
- **没做到的**：V4 的「连续三次 ≤ 15 分钟」未验证、布局不出帧根因未查；F1 Node 26 推到 10-28 LTS 之后；看 N 步一整组 ≤ 1 s 未达到（最慢约 4 s）；WebView2 用户数据目录不可写时的处理只写进真机路线；真机路线无人走过。
- **8.2 欠账**：8.2.0「还没做的」九条里，Windows automation、阶梯最上一级、判长将耗时、整句守卫、题库接入、引擎接续、名局猜着手形七条已结；SDK 0.10.2 与真机路线仍挂着，CI 墙钟仍差一步。

## 发布

- `v8.3.0` → （发布后补）

---

## 附录 A · 给 vercel-labs/native 的问题报告（原文，待转交）

> **Windows: relative WebView asset root is resolved against the process's current directory, so a packaged app launched from Explorer shows a blank window**
>
> **Version**: `@native-sdk/cli` 0.10.1; also present on `main` at `fd96d9d` (2026-10-06).
>
> **What happens**: `native package --target windows` lays the app out as `<out>\bin\<app>.exe` with the frontend in `<out>\resources\<dist>\`. The app hands the runtime the relative root from its manifest (`frontend.productionSource(.{ .dist = "frontend/dist" })`). On Windows, `webview2_host.cpp` `assetFilePath()` joins that root to the *process's current directory* (`CreateFileW` on a relative path). Double-clicking the exe in Explorer starts it with the current directory `bin\`, where no `frontend\dist` exists, so every asset request fails and the window stays blank. The macOS host resolves the same relative root inside the bundle's `Resources` (`appkit_host.m`), so the same app works there.
>
> **Why it is easy to miss**: anything that launches the exe from the project directory (a dev run, or a CI smoke test run from the checkout) finds the project's own `frontend/dist` and works.
>
> **Repro**: package any frontend app for Windows, then `cd <out>\bin && <app>.exe` (or double-click it) → blank window; `cd <out>\resources && ..\bin\<app>.exe` → works.
>
> **Suggested fix**: in the Windows host (or before calling it), resolve a relative asset root against the executable's directory — e.g. `<exe dir>\..\resources\<root>` when that exists, falling back to the current directory for dev runs — mirroring the macOS host's bundle lookup. The same applies to `icon_path` for notifications and the tray (`loadNotificationIcon` loads it relative to the current directory, and only as `IMAGE_ICON`).
>
> **Workaround we ship** (chessboard 8.2.1): at startup on Windows, if `<exe dir>\..\resources\frontend\dist\index.html` exists, pass that absolute path as the asset root.
