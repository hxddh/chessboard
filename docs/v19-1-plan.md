# 19.1 · 修补：存档、对手、复盘、今天页

写于 2026-11-08。依据是 [19.0 全面评估](review-19.0-and-v20-plan.md) 第 5 节 F 组，范围由 owner 定为「按建议来」（同日）。规矩照旧：每条写**依据**、**做什么**、**验收**，以及**落地记录**。

不加界面，不改存档格式。

| # | 依据 | 做什么 | 验收 | 落地 |
|---|---|---|---|---|
| F1 | 评估 D1：`persist.js:641` 恢复失败时没有封住镜像，下一次写入把没恢复进缓存的键从原生 manifest 里删掉；提示是「文件损坏」 | 失败时 `blockMirror()`，返回 `"unrestored"`；提示走已有的存储失败横幅 | `scripts/test/persist.mjs` 11c：返回 `unrestored`、0 次镜像写入、数据文件里那一项还在。旧代码下三条都红 | ✅ |
| F2 | 评估 D2：Maia worker 出错后不重置，之后每步等满超时；init 超时不 terminate | `reset()`：terminate、revoke、清 pending 与已载入的网络；下一次请求重新 boot，权重从分块加载器的记忆里取，不再读第二遍脚本 | `scripts/test/human-worker.mjs`：出错后下一步立即用新 worker 答出；init 超时的 worker 被 terminate。旧代码下两条红 | ✅ |
| F3 | 评估 D3：三处 `createObjectURL` 从不 revoke，后台分析 lane 每次重启漏一份 | Stockfish：主 worker 与所有 lane 共用一个 URL（`engine.js` `workerUrl`）；Maia：在 `reset()` 里 revoke | `test-engine-e2e` 全过；human-worker 单测数 revoke | ✅ |
| F5 | 走查：两次严重失误时总结写「只有一次严重失误」，同屏表格是 2 | `verdictKey`：≥ 2 次是「严重失误偏多」，正好 1 次才是「只有一次」 | `scripts/test/tools.mjs` 新增一条 | ✅ |
| F6 | 走查：定级 1675 后，今天页「继续」的课程卡仍是「第 1 课 · 棋盘与坐标」（18.0 R3 只改了「接下来」） | 已定级、还没学完一课时，课程卡用 `ChessPlanner.lessonFrom` | `test-shell-e2e`：定级 1675 的档案，课程卡是第 51 课「开完局之后」 | ✅ |
| G4 | 评估 4.2-3、4.3：页面错误只弹提示，真机上不留痕 | `errlog.js`：未捕获的错误与 rejection 合并写入 appdata 键 `errlog`（`profile/errlog.json`，最近 30 条）。用已有的 `chess.appdataWrite`，**不改原生代码** | `scripts/test/errlog.mjs`：合并写入、保留上次的、只留最新 30 条、写失败不抛 | ✅ |
| D-README | 评估 4.2-1：README 教「右键打开」，macOS 15 起不管用 | README、`manual-check.md` A1 改成「系统设置 → 隐私与安全性 → 仍要打开」 | `readme` 检查照旧过 | ✅ |

## 核对后撤回的两条

评估 4.2 第 4、5 条（发布版响应自检变量、Windows 卷判断），实施前核对代码后撤回，理由写在评估文档里。原生代码这一版不改。

## 没做、移到 20.0 的

走查里的这几条要先查清原因，和 20.0 M2（复盘与对局里的教练）一起做：
- 刷新后复盘落点（40/40）与第一张卡（1/3）不一致；
- 今天页「课」一栏显示 14 没有目标（没复现条件）；
- 刚下完一盘，开局浏览器仍说「棋谱库是空的」；
- 走查说「定级结束没有结果页」：代码里有结果行（`run.placed`），走查截图对不上，待真机复核。

## 测试

见 PR 描述与 CI。首屏包 824,253 → 826,087 字节（线 827,000 不放宽；余量只剩 913 字节，20.0 R2 前要先挪出去一块）。
