# iOS / Android 版本评估（基准 v1.2.0）

> 评估对象：当前仓库 `chessboard`（Native SDK WebView + Canvas，已发 macOS / Windows）。
> 结论先行：**可以做，但不建议作为下一正式版直接上架**；建议先做「模拟器/模拟器可玩」的 spike，再决定是否单独立项。

## 一句话结论

| 平台 | Native SDK 成熟度 | 对本项目（WebView 壳 + JS 棋盘） | 建议 |
|------|-------------------|----------------------------------|------|
| **iOS** | Experimental（模拟器已验证；真机 archive 需手签） | 可行：WKWebView 跑现有 `frontend/dist` | 先 spike，再谈 TestFlight |
| **Android** | Experimental（模拟器已验证；debug APK 可装；上架签名自管） | 可行：系统 WebView 跑同一套前端 | 先 spike；minSdk 30 / 仅 arm64 |

桌面（macOS · Windows）仍是成熟面；移动端整条链路在 SDK 侧标为 **experimental**，API/工具仍可能变。

## 现状盘点（桌面已有 vs 移动缺口）

### 已具备、可直接复用

- **规则 / 教学 / 做题 / 成就 / 开局库**：纯 JS，与壳无关（`chess.js` · `lessons.js` · `puzzles.js` · `achievements.js`）。
- **棋盘交互**：已用 Pointer Events + `touch-action: none`，拖拽走子在触屏上理论可用（未做真机验收）。
- **窄屏布局种子**：`@media (max-width: 820px)` 侧栏改 overlay，棋盘仍占满舞台。
- **引擎方案**：Stockfish 18 **lite-single**（单线程 + Blob Worker + `wasmBinary` 直灌）——刻意避开 SharedArrayBuffer / 多线程，对移动 WebView 兼容性友好。
- **存档**：`localStorage` 门面（`host.js`），WebView 内可用；不依赖桌面文件系统主路径。
- **图标**：`assets/icon.png` 已是 1024²，SDK 打包可生成 iOS asset catalog / Android mipmap。

### 明确缺口

| 缺口 | 说明 |
|------|------|
| **壳与清单** | `app.zon` 仅 `.platforms = .{ "macos", "windows" }`；`build.zig` 的 `PackageTarget` 无 ios/android；CI 只有 macOS / Windows。 |
| **SDK 路径差异** | 桌面：一等公民 system WebView 宿主。移动：成熟的是 **canvas host-tier**；**WebView 内容区走 embed / mobile-shell**（UIKit·Android 头栏 + WKWebView / Android WebView），不是把 `platforms` 改两行就完事。 |
| **真机与上架** | iOS 签名 / TestFlight / App Store；Android 上架密钥与 AAB —— SDK 明确留作手动步骤。Android 当前声明：**minSdk 30、仅 `arm64-v8a`**。 |
| **手机 UI** | 顶栏塞满「提示/悔棋/翻转/新局/侧栏」；侧栏 284px 桌面信息密度；大量键盘捷径（H/Z/N/F/Tab）；无 safe-area / 横竖屏 / 底部手势条策略。 |
| **桌面专属能力** | PGN 导出走 `saveFileDialog` + `revealPath`；导入可依赖剪贴板 / 拖放。移动需改为分享表 / 系统文件选择 / 应用内文本框。 |
| **包体与冷启动** | Stockfish wasm ~7MB，再经 base64 打进 `engine-src.js`（CI 要求 >5MB）。手机首次加载与内存压力需实测；后台杀进程后引擎要能重建。 |
| **音频** | `AudioContext` 合成音效；iOS 需用户手势后 `resume()`，否则静音。 |
| **许可与商店** | 应用 **GPLv3** + 内嵌 Stockfish（GPLv3）。上架可行，但须满足商店对开源披露/源码可得性的要求；与「闭源商业壳」路线不兼容。 |

## Native SDK 能提供什么（对照官方矩阵）

依据 [Platform Support](https://native-sdk.dev/platform-support) / [Packaging](https://native-sdk.dev/packaging) / [Embedded App](https://native-sdk.dev/embed)（评估时点）：

| 能力 | iOS | Android | 对本项目含义 |
|------|-----|---------|--------------|
| `native package --target ios\|android` | 生成完整 Xcode 工程，可 `xcodebuild archive` | 生成宿主工程并打出 debug APK | 壳可脚手架，非「即发商店包」 |
| 模拟器 / 模拟器验证 | ✓ | ✓ | spike 验收面 |
| 真机 / 上架 | 签名手动；设备工作流非 toolkit 全托管 | 商店签名与 AAB 手动；当前一 ABI | 发布链路自建 |
| WebView 工作区 | WKWebView（embed 示例） | Android WebView（embed 示例） | 与现有 `zero://` + bridge 模型同族 |
| safe-area / 键盘 / Back | 宿主负责，经 `on_chrome` / resize | 同左；系统 Back → `mobile.back` | 前端要认 insets；侧栏应对 Android Back |
| 文件对话框 / 托盘 / 多窗口 | 移动端无桌面同级能力 | 同左 | PGN 导出/导入要改交互 |

**重要分叉**：若把棋盘重写成 SDK **原生 canvas-scene（Zig Model/Msg）**，可走 host-tier 的 `native dev --target ios|android`；那等于重写产品，**不在本评估推荐范围内**。本项目应坚持 **复用现有 Web 前端**，走 **mobile WebView shell**。

## 三条路线比较

### A · Native SDK mobile WebView shell（推荐主路径）

用 SDK 的 iOS/Android embed / package 宿主，把现有 `frontend/dist` 塞进 WKWebView / Android WebView；Zig 侧保留 bridge（读写文本若仍需要；存档可继续 localStorage）。

- **优点**：与 goban/chessboard 架构一致；引擎 Blob 方案已为 zero:// 打磨；长期可跟 SDK 移动宿主演进。
- **代价**：要改 `app.zon` / 打包脚本 / CI；补手机布局与系统手势；接受 experimental 波动。
- **风险**：中。主风险在 SDK 移动 WebView 宿主与桌面 bridge 能力差、以及真机引擎冷启动。

### B · 薄壳包装前端（Capacitor / 自写 WKWebView·WebView Activity）

丢弃或旁路 Zig 壳，只发布 Web 资源。

- **优点**：商店工具链成熟、资料多。
- **代价**：两套壳（桌面 Native SDK vs 移动 Capacitor）；`ChessHost` bridge、生命周期、安全策略分叉；违背「复用 goban 整套架构」的产品选择。
- **风险**：中高（长期维护分叉）。仅当 A 的 spike 证明 SDK 移动 WebView 不可用时再考虑。

### C · 等 SDK WebView 成为与桌面同级的 mobile host-tier

- **优点**：最少自维护宿主代码。
- **代价**：排期不可控；桌面功能继续涨，移动债更大。
- **建议**：不阻塞 spike；不作为「何时开工」的闸门。

## 建议分期

### Phase 0 · Spike（不发版、不进商店）

目标：模拟器上能 **开局、走子、引擎回着、教学一课、做题一题、杀进程后存档恢复**。

1. 用当前 SDK：`native package-ios` / `package-android`（或官方 `examples/ios` · `examples/android` 壳）挂上本仓库 `frontend/dist`。
2. 验证：Blob Worker + wasm 初始化；`localStorage`；Pointer 拖拽；侧栏 overlay；Android Back 关侧栏。
3. 记录：冷启动到引擎 ready 的耗时、峰值内存、横屏是否可用。
4. 产出：本文件追加「Spike 结果」小节 + 是否进入 Phase 1 的 go/no-go。

### Phase 1 · 可玩移动版（内测）

仅在 Phase 0 通过后：

- 手机布局：安全区、底栏/顶栏触控目标、侧栏改为 sheet、弱化键盘依赖。
- PGN：分享 / 粘贴板 / 系统文件选择器；去掉对 `revealPath` 的依赖。
- 音频：首次点击棋盘时 unlock AudioContext。
- 生命周期：`app:deactivate` 时停钟、落盘；回前台恢复。
- CI：可选 job 打 iOS archive artifact / Android debug APK（不上架）。

### Phase 2 · 商店向（单独立项）

- Apple / Google 账号、签名、隐私清单、GPLv3 合规页。
- Android：评估 AAB、是否需要更多 ABI（若 SDK 仍仅 arm64，需写清设备覆盖）。
- 性能：引擎懒加载或压缩策略；低端机降为「无引擎 / 仅入门档」。
- 产品取舍：手机是否默认隐藏分析曲线等桌面密度功能。

## 明确不建议现在做的事

| 项 | 原因 |
|----|------|
| 下一正式版（v1.3）直接加 iOS/Android 下载入口 | SDK experimental + 未做 spike，发布面不可控 |
| 为移动重写 Zig canvas 棋盘 | 丢掉已验证的规则/教学/引擎集成，工作量是新品 |
| 先做联机 / 推送 / Game Center | 放大移动范围，与「本地教学+人机」核心无关 |
| 假设桌面文件对话框在手机可用 | SDK 移动矩阵无对等能力 |

## 与桌面路线的关系

- 桌面继续按既有节奏迭代（题库、残局、i18n 等）**不必等移动**。
- 移动若立项，优先 **共享 `src/web`**；壳与 CI 增量隔离，避免拖慢 macOS/Windows 发布。
- goban 同架构；chessboard 移动 spike 的结论可反哺 goban，反之亦然——但两仓各自评估，不绑死同一发版号。

## 验收口径（若做 Phase 0）

- [ ] iOS 模拟器：新局 → 拖拽走子 → 引擎回着 → 提示箭头
- [ ] Android 模拟器：同上 + 系统 Back 关闭侧栏且不退出进程（或行为符合预期并文档化）
- [ ] 教学任意一课可完成；做题任意一题可判定对错
- [ ] 杀进程重启后自动盘面恢复
- [ ] 引擎初始化失败时有可读错误，不白屏
- [ ] 记录包体、冷启动、内存数字，写入本文件

## 总评

| 维度 | 评分（主观） | 备注 |
|------|--------------|------|
| 技术可行性 | ★★★★☆ | 前端可移植性高；SDK 有真实移动宿主与打包命令 |
| 工程就绪度 | ★★☆☆☆ | 清单/CI/UI/文件桥均未接移动 |
| 商店就绪度 | ★☆☆☆☆ | 签名、合规、ABI、审核材料全无 |
| 推荐优先级 | **中低**（先 spike） | 桌面产品已完整；移动是扩张而非救命 |

**最终建议**：把「iOS/Android 版本」记为 **候选扩张项**，开一个不超过「可玩证明」范围的 Phase 0 spike；用数据决定是否单独立项 Phase 1。在此之前，正式 Releases 页维持仅 macOS / Windows。
