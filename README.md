# 国际象棋 Chessboard

国际象棋桌面应用，macOS 与 Windows，**GPLv3**。20.0 是一次重建：一条路——学一样，下一盘像人的棋。

- **学**：一张约 80 个技能的图，从「车怎么走」到「车兵残局的桥」；一个学习者模型决定下一件事——到期的复习、一个新技能、一盘对局或一个残局，穿插着来。定级会点亮你已经会的技能，你自己对局里的错会变成第二天的题。
- **下**：像人的对手（Maia-3 按等级分给出人会走的着法，Stockfish 收官），按人的节奏想、会认输；落子前的教练在你松手前提醒；复盘就在棋盘上，最多三处，讲的是「你这一步」。
- **我**：一个「你的水平」、一条成长曲线、下一阶段还差的技能、棋谱库（含一次性导入 PGN）。

中文、英文、日文三种语言。离线可用：分析用随包的原生多线程 Stockfish，起不来时退回 wasm 版。

**20.0 不读 19.0 及更早的存档、设置和进度**，装上就是一个新档案。要带走对局：先在 19.0 里「导出全部对局」，再在 20.0 的「我 · 棋谱库」里导入那份 PGN。

## 下载

[Releases](https://github.com/hxddh/chessboard/releases) 页：

| 平台 | 产物 | 说明 |
|------|------|------|
| macOS（Apple Silicon） | **Chessboard-macOS-arm64.zip** / **.dmg** | 把 `Chessboard.app` 拖进「应用程序」再打开。安装包目前只有临时签名（Developer ID 签名与公证在做，需要证书），第一次打开要在「系统设置 · 隐私与安全性」里允许 |
| Windows（x64） | **Chessboard-Windows-x64.zip** | 解压后双击 `Chessboard\bin\chessboard.exe`，放在哪个目录都可以（含 `Program Files`）。需要 WebView2 运行时（Win10/11 一般预装）；还没有代码签名，SmartScreen 会提示 |

## 怎么构建、运行和测试

需要 Node 26+（`npm ci` 只装 esbuild）。原生应用另需 Zig 0.16.0、Native SDK CLI（`npm install -g @native-sdk/cli@0.11.0`）和编原生 Stockfish 的 C++ 工具链。

```bash
npm ci

# 在浏览器里开发：src/app 原样以 ES 模块提供，改了刷新即可
npm run serve:app                  # http://127.0.0.1:8020/  （?engine=fake 用假引擎，?db=memory 用内存库）

# 前端构建：src/app → dist-app（esbuild，ESM 分包）→ frontend/dist（加上许可证）
npm run build

# 原生应用
scripts/build-stockfish.sh build/stockfish                  # 原生 Stockfish，一次
node scripts/gen-manifest.mjs macos                         # macOS：关窗即隐藏的派生清单
zig build run -Dmanifest=build/app.macos.zon -Dnative-sdk-path="$(npm root -g)/@native-sdk/cli"
scripts/package.sh                                          # macOS：打包、装进 ~/Applications

# 测试
npm test                           # = 下面三项
npm run test:static                # 单测、内容核对、工作流、sdk-diff、清单、钉住的版本、图标（并行，约 40 秒）
npm run test:app:e2e               # Chromium 里的整套行为测试（首帧、每步开销、三语、对局、复盘、学、导入……）
npm run test:visual                # 每个页面三种尺寸的截图对照基线；接受改动：node scripts/test-visual-e2e.mjs --update
zig build test -Dnative-sdk-path=… # 原生壳的单测
```

没有 Playwright / Chromium 时浏览器测试打印「跳过」；`E2E_REQUIRED=1`（CI 里）跳过即失败。

CI（`.github/workflows/`）：`checks.yml` 在每个 PR 上跑上面全部，外加 Zig 壳（macOS、Windows）；改到对手、Maia-3、引擎服务时跑「每个对手都收得了官」；改到原生一侧时调 `build-macos.yml` / `build-windows.yml` 打出两个平台的安装包、自检、跑自动化场景。`release.yml` 就是 `checks.yml` 全量 + 发布，没有只在发布时才跑的检查（`scripts/ci-check.mjs` 守着）。

## 结构

```
src/app/          20.0 的界面（ADR 0002）：路由、信号、组件；棋盘是组件
  core/           纯逻辑：规则（chess.js 0.13.4 + FIDE 判和）、复盘数学、讲解的事实、对手、教练
  learn/          技能图、学习者模型（事件的投影）、FSRS 调度、今日一课
  services/       db（原生 SQLite / IndexedDB，同一套契约）、引擎服务（原生 Stockfish / Maia-3 / wasm）
  content/        技能、练习局面、课文（scripts/gen-skills.mjs 生成，勿手改）
  pages/ text/ styles/
src/*.zig         原生壳：窗口、菜单、对话框、SQLite、Stockfish 进程
data/v19/         19.0 的课、题、残局、开局、名局：gen-skills.mjs 从中挑选并重新证明，不进安装包
third_party/      Stockfish.js 19 lite（wasm 后备）、Maia-3 5M（fp16）
scripts/          构建、检查与生成脚本；scripts/app/*.test.mjs 是单测
docs/adr/         架构决定；docs/v20-0-plan.md 是这一版的计划与落地记录
```

## 许可

GPLv3（见 LICENSE）。vendored chess.js 保留其 BSD-2-Clause 版权头（`src/app/core/chessjs.js`）。Stockfish 为 GPLv3（`third_party/stockfish/COPYING.txt`；原生版的来源与改动见安装包里的 `licenses/stockfish-SOURCE.txt`）。人类着法模型 Maia-3（CSSLab/maia3，Monroe 等，ICLR 2026）的 5M 权重为 **AGPL-3.0**（`third_party/maia3/LICENSE` 与 `NOTICE`）：随包的是 `scripts/gen-maia3.py` 从原始 `maia3-5m.pt` 转出的 fp16 版，NOTICE 标明了改动，原始文件的地址与转换脚本就是它的源形式；GPLv3 §13 / AGPLv3 §13 允许两者组合分发，推理代码（`src/app/services/maia3/`）是本应用自己写的，仍是 GPLv3。界面字体 Inter 为 SIL OFL 1.1（`src/app/styles/fonts/Inter-OFL.txt`）。

棋子三套（`src/app/core/pieces/`），逐套核过许可：**Merida**（默认，Armando Hernandez Marroquin，取自 lichess-org/lila，GPLv2+）、**cburnett**（Colin M.L. Burnett，取自 lila，GPLv2+）、**经典**（同一设计的 Wikimedia Commons 重绘版，多重许可中取 GPL 一项）。

题目数据取自 [Lichess 题库](https://database.lichess.org/#puzzles)（**CC0 1.0**），每题的 id 就是 Lichess 题号，在此致谢。
