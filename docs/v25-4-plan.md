# 25.4 — 全栈修补与零复杂度的产品打磨

基线 `v25.3.0`（`01558f1`）。一个交付周期，不拆版本。每条线索先对照源码核实再改，发现更深的根因就一起改。约束：不加顶层导航、模式、常驻按钮或浮层；`app.js` ≤ 4,777 行；`bundle.js` ≤ 808,000 B；三语 i18n 齐全；存档向后兼容；`sdk-diff` 一致。

## 0 · 腾空间

- 局面编辑器与 FEN 弹窗的逻辑挪进 `editor-ui.js` → `chunk-editor.js`，在任一入口第一次点开时载入。规则仍在 `editor.js`，导入路径首屏要用。
- FEN 弹窗的打开、填值和按键守卫留在 `app.js` 同步执行。刚拆出时，E2E 在分块到达前读输入框，读到的是空串（test-persist-e2e 抓到）。
- 结果：`app.js` 4,756 → 4,584 行；`bundle.js` 806,403 → 800,727 B（拆分后），合入全部修补后 807,006 B。

## 1 · 缺陷（核实结论与改法）

| # | 线索 | 结论 | 改法 / 回归测试 |
|---|---|---|---|
| 1a | 学习模式内热切段被劫持 | 成立：`learnSeg()` 先看棋盘上已有的课，等待中的目标段被盖住 | 拆成 `boardSeg()` / `learnSeg() = pendingSeg() \|\| boardSeg()`；点回原段即取消；进阶课分块纳入 `learnRuns` 号（test-lessons-adv、test-content-e2e） |
| 1b | 冷启动不恢复学习段 | 成立 | `startLearn(store.ui.trainSeg)`；`shell.js` 空闲时读存下的段（test-content-e2e） |
| 1c | `chunk.js` 失败卡死 | 成立 | 失败移除 `<script>`，`CHUNK_MS` 超时拒绝并清理，迟到的 onload 无害（test-lessons-adv） |
| 2a | 早期清库不彻底 | 成立 | `libDb` 未就绪时删除 IndexedDB `chessboard.games`；`removed` 里的 `lib*`/`rep*` 分片跳过 `shardsKnown`，直接清 manifest 与文件（test-persist、test-library-e2e） |
| 2b | 配额满阻断镜像；`restoreAll` 撕裂 | 成立 | 缓存拒写仍入内存与镜像队列，manifest 标得比缓存新；`restoreAll` 先写缓存，失败全部回滚，`io.js` 停下并提示（test-persist） |
| 3a | Hash 未下发；`onTimeout` 换类型清零 strikes | 成立 | `uciok` 后发 Hash，`setOptions` 改为下次对局搜索前发；不同类型的超时也计第二次（test-engine） |
| 3b | 极度读秒越过 `ceil` | 成立 | Maia 时限上限 `ceil − 20`；`thinkPlan` 给出 `most`，`pace` 不超过它；engine.js 兜底夹到 `ceil` |
| 3c | 中止复盘打不断 `engine-bg.js` | 成立 | `ChessEngine.cancel(true)` 只切复盘自己的搜索；切掉的结果不进缓存 |
| 3d | `exploitsPin`、`lineTargets` | 成立 | 要求被牵制子按几何能走、抬走后露王；串击后方子力 ≥ 3（test-motif 单测） |
| 3e | `review-pass` 深算失败置 `deep[i]` | 成立 | 不再置位，也不在后续轮次重试 |
| 3f | `review-grade` tags/grades 冲突；`seconds[i] == null` | 成立 | 带 `?!/?/??` 的着不再评「仅此一着/妙着/谱着」；缺 `seconds` 不当成 0 |
| 3g | `human-line` 重复局面、终局空跑 CNN | 成立 | 历史回溯到半回合钟清零处；终局不跑网络 |
| 4a | `forwardLaunchArgs` 未建目录；`takeOpenFiles` 毒丸 | 成立，根因更深：路径已标记签发、待处理列表却没清空，之后每次都失败 | 先建 `appdata_dir`；列表先清空，逐条用 `jsonAppendName`，写不下的单条丢弃；`jsonFieldValue` 只走顶层（Zig 测试） |
| 4b | `httpGet` 截断；Chess.com 抗限流 | 成立 | 多读 1 字节判截断；Lichess 丢弃未闭合的尾局，Chess.com 报 `too_large`；Keep-Alive、429 + `Retry-After` 有界退避、每月独立 Arena；中途失败停在该月并标 `partial`，前端照常导入并提示 |
| 4c | WebView2 `NewWindowRequested`、`get_Source` 失败回退 | 成立 | 拦截新窗口（遵循 `external_links = deny`）；读不到来源时丢弃消息（SDK 差异 B17） |
| 4d | `chess_lang_code_of` 越界读；`jsonFieldValue` 依赖字段顺序 | 成立 | 见上 |

## 2 · 产品（不加界面）

1. **对手节奏**：`think-time.js` 按局面伸缩 `pace`（唯一着、回吃快，复杂局面慢），由局面哈希决定、可复现，始终不超过 `most` 与 `ceil`。**低档基本盘**：`freeTakes` 列出能白吃、吃完不被一步杀的后或车，只在 temp > 1 的档位、正常抽样之后使用；21 档配置不变。
2. **教学温度**：课程与残局走错时，用 `explainMistake` 讲引擎反驳线说明了什么，不透露正解。**复盘高光**：每方三个关键时刻里保证至少一个好棋（唯一着、妙着、惩罚对方 `?/??` 的最佳着）。
3. **20 局真空**：`focus.js early()`：第 1 局列出收了几道错题；第 5 局起，同一母题至少两道时给出初步倾向并标「样本尚少」。复盘结束的提示在第 1 局、第 5 局各多说一句。20 局门槛不变（test/trainer.mjs）。
4. **一本账与首次打开**：本机复盘过的棋算进 20 局，诊断默认「全部」，本周重点读同一批棋（`diagAll` / `diagCount`）。「会走子」直接开下：按 900 暂定，记为 `placed.soft`，不冒充定级（对手页与「今天」都不把它当定级结果引用）；「常下棋」保留定级（test-board-e2e、test-trainer-e2e）。

## 3 · 验证

- `npm run build`；`node scripts/run-static.mjs`：24 个文件全部通过（合并后）。
- E2E（Playwright + Chromium）：结果见 PR 描述。
- `scripts/sdk-diff.mjs`、`test-sdk-diff.mjs`、`manifest-check.mjs` 通过。
- 未跑：`zig build test`（本环境不运行 Zig 工具链）、Windows 原生编译、`test-ladder.mjs`（需数小时）。真机项见 `docs/manual-check.md`「25.4 真机核对」。
