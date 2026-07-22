# 国际象棋 Chessboard

国际象棋 — Native SDK WebView + Canvas，支持 macOS 与 Windows。**GPLv3**（为后续集成 Stockfish 引擎预留）。

复用 [goban](https://github.com/hxddh/goban)（五子棋）打磨出的整套架构：Native 壳、Canvas 渲染、
侧栏/复盘/主题 UI、双平台 CI、无头浏览器回归测试。

## 下载

[Releases](https://github.com/hxddh/chessboard/releases) 页任选：

| 平台 | 产物 | 说明 |
|------|------|------|
| macOS（Apple Silicon） | **Chessboard-macOS-arm64.zip** | 解压后 `open ~/Applications/Chessboard.app`；首次右键「打开」过 Gatekeeper |
| Windows（x64） | **Chessboard-Windows-x64.zip** | 解压后运行 `Chessboard/chessboard.exe`；需 WebView2 运行时（Win10/11 一般预装） |

## 怎么玩（v0.1）

| 操作 | 说明 |
|------|------|
| 点击走子 | 点选己方棋子 → 高亮合法落点（空格圆点 / 吃子圆环）→ 点目标格 |
| 规则 | 完整合法性：将军/将死/逼和、王车易位、吃过路兵、升变（暂默认为后）、50 步/三次重复/子力不足和棋 |
| 复盘 | 着法列表（SAN）点击跳转；← → / Home / End；● 回到最新 |
| 棋谱 | 复制 / 导出 / **粘贴导入** PGN；复制当前局面 FEN |
| 翻转 | **F** / 顶栏「翻转」切换黑白视角 |
| 悔棋 / 新局 | **Z** / **N**（有棋时确认） |
| 侧栏 | **Tab** 开关；主题 木/夜/日/纸 · 音效开关 |
| 存档 | 自动保存，重开恢复 |

## 规则引擎

局面合法性由 vendored [chess.js](https://github.com/jhlywa/chess.js) 0.13.4（BSD-2-Clause）判定——
不自研规则。`src/web/js/chess.js` 顶部注明了从 ESM 到经典脚本的机械转换（zero:// 方案下 WebView
只验证过经典脚本加载）。

## 路线

- **v0.2 引擎**：Stockfish WASM（GPLv3）接入 Blob worker + `UCI_Elo` 限强分档 + 提示
- **v0.3 玩法**：centipawn 复盘曲线 + 失着标注 + 做题练习 + 统计（沿 goban 剧本）
- 之后：棋钟、升变选择、开局名称（ECO）

## 开发

```bash
cd ~/chessboard
./scripts/package.sh   # 同步 frontend → 单测 → 编译 → 打包 → 安装
```

```
src/web/
  index.html · styles.css
  js/chess.js   # 规则（vendored chess.js 0.13.4, BSD-2-Clause）
  js/host.js    # Native / localStorage 门面
  js/board.js   # 棋盘 Canvas 渲染 + 命中测试
  js/audio.js   # 离线合成音效
  js/app.js     # UI 编排
src/main.zig
scripts/test-chess.mjs
```

测试：`node scripts/test-chess.mjs`

## 许可

GPLv3（见 LICENSE）。vendored chess.js 保留其 BSD-2-Clause 版权头。
