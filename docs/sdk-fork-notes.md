# 与 SDK 上游的差异（runner.zig、build.zig）

v8-2-plan F2。这个仓库有两份从 Native SDK 抄来、再自己改过的文件，外加一份原样抄来的：

| 我们的 | 上游（SDK 仓库 / npm 包里同一路径） | 关系 |
|---|---|---|
| `src/runner.zig` | `src/app_runner/root.zig` | 0.1.0 时分叉，之后手动跟 |
| `build.zig` | `build/app.zig` | 手抄本，只留这个应用用得到的 |
| `src/window_placement.zig` | `src/app_runner/window_placement.zig` | 8.2 M4 起原样抄入（runner.zig 的恢复窗口要它，见 R15），登记表里没有差异 |

每次升 SDK 都要拿新上游和这两个文件对 diff。0.8.0 就栽在这里：上游多编了一个源文件（`gpu_surface_renderer.cpp`），手抄本没跟上，Windows 构建链接失败（`release.yml` 的注释）。直接看 diff 是 174 块、三千多行，几乎全是有意的，真正要看的那几行淹在里面。

所以现在：

- **`docs/sdk-fork.json`** 登记每一处已知差异：上游原文、我们的文本、前后几行上游原文作锚点。按内容找位置，不按行号，上游在别处加减行不影响。
- **本文**按组说明每处差异为什么存在。每组一个编号（R01…、B01…），JSON 里每一块都标着它属于哪一组。
- **`scripts/sdk-diff.mjs`** 把登记过的差异套到上游文件上，再和我们的文件比。剩下的就是没登记的：上游的新改动，或者我们自己没登记的改动。
  - 登记过的差异如果在上游找不到原文（上游改了我们分叉的那一段），也会报出来，并给出那段上游原文前后的变化。
  - 全部登记时什么也不打印，退出码 0；有没登记的，打印出来，退出码 1；找不到 SDK 文件，退出码 2。

## 怎么用

```sh
node scripts/sdk-diff.mjs <SDK 目录>      # SDK 仓库或 npm 包；也可设 NATIVE_SDK_PATH / SDK_PATH
node scripts/sdk-diff.mjs <SDK 目录> --suggest   # 另外把每个没登记的块打印成可粘贴的登记项
```

- 对 0.10.1（我们钉的版本）输出为空。
- `checks.yml` 的 zig 作业拿 npm 装好的 SDK 跑它，所以登记表和钉住的 SDK 不会悄悄脱节。
- `scripts/test-sdk-diff.mjs`（`test:static`，离线）：
  - 从我们的文件和登记表反推出上游原文，确认跑一遍为空；
  - 再往反推出的上游里加一行，确认恰好报出那一块；
  - 改掉登记过的一行上游原文，确认报出是哪一组；
  - 本文缺了一组的说明时，确认会报出来。

## 升 SDK（0.10.2 起）的做法

1. 装新版 SDK，跑 `node scripts/sdk-diff.mjs <新 SDK>`。
2. 每一个报出来的块，二选一：
   - **采纳**：把上游的改动抄进 `runner.zig` / `build.zig`。抄完这一块就不再报。
   - **不采纳**：用 `--suggest` 打印出登记项，粘进 `docs/sdk-fork.json`，填上所属的组（或新开一组），并在本文写明理由。
3. 「登记过的差异不再匹配」：说明上游改了我们分叉的地方。看它给出的上游前后变化，决定跟不跟。跟完以后，把那一项的 `up` / `before` / `after` 改成新上游的原文。
4. 把 `docs/sdk-fork.json` 的 `sdk` 改成新版本号，直到脚本输出为空。
5. `manifest-check.mjs --sdk` 和双平台构建照旧要绿。这个脚本只管这两个文件，不管 SDK 其余部分。

## 三类差异

- **ours**：我们有意改的，理由写在下面。
- **unused**：上游有、这个应用用不到的功能，整段不抄。理由是「清单没声明、代码不调用」。
- **lag**：分叉之后上游又改了，我们还没跟。
  - 不是有意保留的，是已知的欠账。
  - 每一条都写了影响，以及 0.10.2 升级时的建议。
  - 登记它们是为了让脚本的输出只剩真正的新东西，不是认可它们。

## src/runner.zig ↔ src/app_runner/root.zig

| 组 | 类 | 内容与理由 |
|---|---|---|
| R01 | unused | **记录库、SQLite、钥匙串、文件访问根目录**。<br>上游按 app.zon 的 `capabilities` 在 comptime 决定开不开 `RecordStore` / `RelationalStore` / 凭据，并给 `file_access` 算出应用目录。<br>我们的清单不声明 `store` / `sqlite` / `credentials`，存档走自己的 `chess.appdata*`（v7-plan §7.1），所以这些分支、`relational_migrations` 导入和 `resolved_options` 都不抄。 |
| R02 | unused | **会话录制与回放**（`NATIVE_SDK_SESSION_RECORD/REPLAY`）、**启动计时**（`launch_timing.lap`）。<br>这些是 SDK 的确定性回放与性能诊断工具，服务于画布应用。我们是 WebView 应用，用不上。<br>同一块里有我们加的 `publishRuntime`（R07）。 |
| R03 | lag | **平台对象的分配**。<br>上游 0.10 起用 `createWithOptions` 在堆上建平台包装、`destroy` 按闩锁释放：工作线程的 channel wake 拿着包装的地址，被放弃的 wake 可能在栈帧退出后才执行。我们还是栈上的 `initWithOptions` / `deinit`。<br>影响：我们自己的异步桥（v8-1-plan N1）在 `onStop` 里先 `close()`，等进行中的 wake 返回（有上限）；`main()` 在有工作线程未归时直接 `exit`。这条路径已经防住了。剩下的风险只在 SDK 自己的 channel wake 上，我们不用那条路。<br>建议：0.10.2 升级时照上游改。 |
| R04 | lag | **trace 过滤**。<br>我们：在 `StdoutTraceSink` 里过滤，写进日志文件的不过滤；`-Dtrace=events`（默认）时什么都打。<br>上游：`FilteredTraceSink` 包住扇出后的全部输出；events 档只留 `runtime.event`。<br>影响：开发时 stdout 更吵，发布件不受影响。<br>建议：0.10.2 时跟上游。 |
| R05 | lag | **Runtime 的三项设置**：<br>· `max_image_pixel_bytes`：读 app.zon `images`，我们没有这一段，取 Runtime 默认值，和上游不声明时相同；<br>· `gpu_surface_frame_diagnostics = false`：我们不传，Runtime 默认 true，但我们没有 gpu_surface 视图，无影响；<br>· 退出时 `runtime.deinit()`：归还字体和媒体纹理，我们不调用。进程随即退出，只少一次释放。<br>上游另有 `pub const app_assets`，我们不用。<br>建议：0.10.2 时跟上游，代价很小。 |
| R06 | ours | **安全策略从 app.zon 读**：`.security` / `.permissions`，以及外链放行列表。`RunOptions.security` 是可空的，null 表示用清单。<br>同时在 exe 里滤掉 `http://` 开发 origin，除非 `-Ddev-origins`（v6-plan D6）。<br>1.20 之前 main.zig 手写一份 origin 列表，和清单两份并存。<br>`manifest-check.mjs` 第 2 节守着「不许传空字面量盖掉清单」。 |
| R07 | ours | **`RunOptions.runtime_slot`**（v8-1-plan N2）。<br>桥处理函数拿不到 Runtime，而 `chess.openPgn` / `chess.saveText` 要用它在原生侧弹文件对话框。runner 在 `run` 之前把 Runtime 填进这个槽，结束时清空。 |
| R08 | ours | **只有注释与字段顺序不同**。<br>`AppInfo` 里 `declares_tray`、`dock_visible`、更新源三项写了我们为什么接上；`icon_path` 的上游注释没抄。行为与上游相同。 |
| R09 | ours | **窗口标题跟启动语言**（Q1.6）。<br>调用处给的 `window_title` 是启动语言的标题；app.zon 的 `.title` 是中文的。Runtime 初始化后没有改标题的接口，所以在这里覆盖第一个窗口的标题。 |
| R10 | unused | **场景优先应用的 `.shell` 启动窗口**。<br>上游从 `.shell.windows[0]` 读启动窗口的外观，以及 `RunOptions` 里直接给的 `default_frame` / `restore_*` / `initial_placement`。另外还有主题包 `theme` / `theme_accent`。<br>我们的窗口全部来自 app.zon `.windows`，没有 `.shell`，也不用画布主题，所以这几段都不抄。 |
| R11 | lag | **窗口 `.show`**。<br>我们读 app.zon 窗口的 `show` 键（`immediate` / `on_first_present`）；上游 0.10.1 读 `initially_hidden`（布尔）。app.zon 两者都没写，结果都是 immediate。<br>同一块里有我们给 `initial_placement` 和 0.6.2 新字段写的注释。<br>建议：0.10.2 时改成上游的键名，`manifest-check` 会检查键名有人读。 |
| R12 | ours | **`MenuStorage` / `fromManifest` 是 pub**（Q1.6）。<br>非中文启动语言时，main.zig 要据此做一份本地化菜单；它的测试也要拿清单菜单和翻译表对照。 |
| R13 | lag | **辅助函数的先后顺序与措辞**。分叉时的旧排版，没有跟上游重排。<br>`windowLabel` 等函数位置不同、几处注释措辞不同，`manifestStringField` 没有上游的 null 分支（app.zon 没有写 null 的字符串字段）。<br>`dock_visible` 的编译期报错是我们改成中文的。<br>行为相同。 |
| R14 | ours | **上游自己的两个测试不抄**。它们断言的是 SDK 测试用清单里的值（`example.com` 的更新源、`app.refresh` 命令）；拿我们的 app.zon 编译会失败。<br>web 层的三个判断（`manifestHasWebContent` / `manifestWebDeclaration` / `webLayerEnabled` 与编译期检查）放在文件末尾，内容与上游相同，注释略短。 |
| R15 | ours | **恢复窗口位置**（8.2 M4 起照上游；F2 登记时是 lag）。<br>上游：`window_placement.applySavedWindow` 换上保存的 frame，同时把 `initial_placement` 标成 `.restored`。8.1 及以前我们只换 frame，`initial_placement` 留在 `.default`。<br>8.1 实际表现：SDK 的 `AppInfo.inferLegacyExplicitOrigin` 把原点不为 (0,0) 的 `.default` 当成写死的位置（`.explicit`），所以位置多半是碰巧回来的；保存在 (0,0) 的窗口仍是 `.default`，macOS 主机把它居中到主屏（`appkit_host.m` 的 `centerOnPrimary`）。F2 登记时写的「每次都居中」漏看了这层推断。另外 `.explicit` 与 `.restored` 在 macOS 上换算外框、夹进屏幕的方式不同（后者按最终标题栏换算），只有走 `.restored` 才是上游测过的那条路。<br>现在：`prepareStateStore` 与上游逐行相同，`window_placement.zig` 原样抄入（`files` 里第三对，`sdk-diff` 同样盯着）。剩下的差异只有文件末尾我们自己的测试：用 null 平台走一遍「首次启动 → 保存 → 再启动」，断言主机拿到 `.restored`（原点 (140,90) 与 (0,0) 各一次），并顺带跑 `window_placement.zig` 自带的测试。修之前这条测试是红的（拿到 `.explicit`）。<br>真机核对：`docs/manual-check.md`「8.2 真机路线（30 分钟）」macOS 第 6 步（X1）。 |

## build.zig ↔ build/app.zig

| 组 | 类 | 内容与理由 |
|---|---|---|
| B01 | ours | **SDK 按路径引用**。<br>`-Dnative-sdk-path`（默认是 npm 全局安装的 `@native-sdk/cli`；CI 也是 npm 装的）加上 `nativeSdkPath()`。上游 `build/app.zig` 是给 zig 包依赖用的，用 `dep.path()`。<br>两种写法引用的是同一批源文件。`manifest-check.mjs --sdk` 逐个核对平台源文件、系统库、框架都在。 |
| B02 | ours | **一个应用自己的 `build()`**。<br>上游是给别的应用调用的构建库：`addApp` / `addAppArtifacts` / `addMobileLib`，还有 `native test` 的分析对象、`model-contract`、`appModule`。我们直接写一个 `build()`，模块装配只有 runner 与 main 两个。<br>上游文件头的说明与几个 import 也随之不要。 |
| B03 | unused | **TypeScript core、服务进程、移动端库、终端会话、SQLite 源码**。<br>上游按应用目录里有没有 `src/core.ts` 等决定编译 TypeScript core、ScriptC 运行时、服务进程归档、iOS/Android 库、ghostty 终端，以及 `sqlite3.c`。<br>这个应用一样都没有。 |
| B04 | ours | **`PlatformOption` 的 `null` 写成 `@"null"`**。抄写时的写法，两者在 Zig 0.16 里等价。 |
| B05 | ours | **构建选项**：<br>· `-Dmanifest`：macOS 用派生清单，只多 `close_policy`；<br>· `-Ddev-origins`：见 R06；<br>· `-Dpackage-target`；<br>· `BuildOptionValues` / `buildOptionsModule`：开发 exe 与打包 exe 各一份，只差 `dev_origins`；<br>· `optimizeMode` 让 run/dev 默认 Debug、package 默认 ReleaseFast。 |
| B06 | ours | **`frontend-build` / `dev` / `package` 步骤**。<br>`frontend/dist` 由 `scripts/sync-dist.mjs` 从 `src/web` 同步（D12）；`zig build dev` 走 `native dev`；`zig build package` 走 `native package`，并把同一个 SDK 路径传给 CLI。<br>上游对应的是服务进程安装与 TypeScript 测试模块。 |
| B07 | lag | **链接搜索路径的位置**。<br>上游把框架路径、库路径、rpath 抽进 `addPlatformLinkSearchPaths`，好让 TypeScript 应用的缓存对象与最终链接共用。我们写在 `linkPlatform` 里，内容相同。<br>同一块里，`linkPlatform` 上方关于 `-fno-sanitize=builtin` 的说明我们没抄（只是注释，标志本身两边一样）。 |
| B08 | ours | **只有注释不同**。<br>为什么链 CoreMedia / ScreenCaptureKit / CoreVideo、iphlpapi / ws2_32 / advapi32、Direct2D / DirectWrite，Windows 子系统，WebKitGTK / WebView2 存根。我们的注释写的是这个应用为什么也要链它们，上游的写的是功能。 |
| B09 | ours | **Windows exe 嵌入 SDK 的应用清单**（8.2 M4 起照上游；F2 登记时是 lag）。<br>`exe.win32_manifest = assets/native-sdk.manifest`：那份清单声明通用控件 v6 和「按显示器 DPI 感知（PerMonitorV2，旧系统退到 `dpiAware true/pm`）」。8.1 及以前没有它，进程对 DPI 不感知，缩放不是 100% 的显示器上 Windows 把整个窗口按位图拉伸，文字和棋盘发虚；原生消息框也是旧样式。<br>现在：注释与上游逐字相同，差异只剩 SDK 路径的写法（`nativeSdkPath(…)` 对 `dep.path(…)`，同 B01）。交叉编译的 PE 里多了一个 `.rsrc` 节，只有一项 `RT_MANIFEST` #1（1,752 字节，与 SDK 文件逐字节相同）；修之前 exe 没有资源目录，图标随包放在旁边（`native package` 的 `app-icon.ico`），不在 exe 里，所以没有图标、版本信息可被挤掉。<br>`manifest-check.mjs --sdk` 加了一条：SDK 的 `build/app.zig` 嵌的清单文件，我们也得嵌。<br>真机核对：`docs/manual-check.md`「8.2 真机路线（30 分钟）」Windows 第 6 步（X2）。 |
| B10 | ours | **CEF 的复制与检查脚本**：排版不同，macOS 缺件时多打印几行提示。我们不用 Chromium 引擎，这几段只在 `-Dweb-engine=chromium` 时生效。 |
| B11 | ours | **从 app.zon 推断 web 层**。<br>我们用一个只读 web 相关字段的精简解析（`@embedFile("app.zon")`），自己写 `resolveWebLayer` / `parseWebEngine` / `parseWebLayer`。<br>上游用 `web_layer_contract`，并顺带读权限、`persist`、服务包、图片预算、更新开关等，那些只服务于 B03 和 R05 里我们没有的功能。<br>上游「更新与 Chromium 引擎不能同时开」的配置期检查也在这一组：我们两者都没开。 |
| B12 | lag | **x86_64 强制 LLVM 后端**（`useLlvmWorkaround`）。<br>Zig 0.16 的自研 x86_64 后端会错编 SysV 调用约定里浮点参数多的 C 函数，只影响 x86_64 的 Debug 构建。我们的发布件是 ReleaseFast（本来就走 LLVM）；Windows 是另一套调用约定；macOS 发布件是 arm64。<br>影响：只可能出现在 x86_64 Linux/macOS 的 Debug 开发构建上。<br>建议：0.10.2 时照抄（一行）。 |
| B13 | ours | **`zig build test` 另跑 runner 模块的测试**（8.2 M4）。<br>`src/runner.zig` 是独立模块（`runner_mod`），应用的测试二进制以 `main.zig` 为根，从来不跑它里面的测试。R15 的测试与 `window_placement.zig` 自带的测试要在 runner 模块里才拿得到 `prepareStateStore`，所以加一个以 `runner_mod` 为根的测试。上游对应的是 `native test` 的分析对象，见 B05。 |

## 数字（登记于 0.10.1）

- **28 组，174 块**：ours 17 组、unused 4 组、lag 7 组（8.2 M4 把 R15、B09 两组 lag 修成 ours，加了 B13；F2 登记时是 27 组：ours 14、unused 4、lag 9）。
- **runner.zig**：15 组，93 块，上游 882 行对我们 369 行。
- **build.zig**：13 组，81 块，上游 2,539 行对我们 394 行。
- **window_placement.zig**：没有差异。
  - 其中 B02、B03 两组占了上游的 2,045 行：上游是给所有应用用的构建库，我们只是一个应用。
