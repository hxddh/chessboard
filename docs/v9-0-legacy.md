# 9.0 §H 卸下历史：清单

2026-10-09 只读排查（`main @ 33d069b`）。9.0 不读旧存档、不迁移、不降级；下面是只为旧版本存在的东西。M1 逐条删，删完在 `docs/v9-0-plan.md` §9 记行数与字节数。

**合计（估算）**：src 约 1,200 行（直接删约 650，改写约 550、净删约 400）；scripts 约 2,400 行；数据约 3 MB（`lichess/old-*.js` 1,543,500 B 在 git 里，构建出的 `chunk-lc-old-*.js` 1,531,082 B）。

**不能直接删的三处**：
- `pickMove`（trainer/visual-modes.js 189–211）在没有引擎、或用本地题库出题时仍要用——只去掉「8.2 规则」的说法。
- `library-db.js migrate()` 同时是从原生分片恢复棋谱库的路径（library-page.js 453）——改名 `importRecords`，去掉 v1 备份。
- 旧题分块的**机制**（import-puzzles `droppedRows`）以后换题库可能还用得上——9.0 删掉数据，机制一并删；下次换库时再按需求设计。

---

## A · 直接删

| # | 什么 | 位置 | 服务 |
|---|---|---|---|
| 1 | 旧题数据 | `src/web/js/lichess/old-*.js`（11 个，13,562 行）；构建产物 `chunk-lc-old-*.js` | 8.0–8.3 的复习键 |
| 2 | `oldChunk` / `full()` / `ensureFull()` | puzzle-db.js 67–87、109；puzzle-book.js 350；visual-modes.js 515–522、573、576、622、669 | 同上 |
| 3 | 旧题导出 | import-puzzles.mjs 20–25、565–600、623–624、650–674、690–696（`--no-keep-old`）；bundle.mjs 69–71 | 同上 |
| 4 | 7.x 主题迁移 | look.js 5–11、61–72（`LEGACY_THEMES`）、76–89、103–105；`migrateLook` → `readLook` | 7.x |
| 5 | `themeId` / `followSystem` 双写 | app.js 396、1452–1454、1476、1479–1482；settings-ui.js 218 | 7.x |
| 6 | 旧题号表 | drills.js 55–155（`LEGACY_IDS`、`legacyIdMap`、`migrateIds`）；puzzle-book.js 286–330 | 1.21.3 以前 |
| 7 | 课程书签双写 | trainer/lessons.js 50–60（`l2`） | 8.0 / 8.1 只有 96 课 |
| 8 | stats v1 → v2 | persist.js 965、973–991（`migrateStats`） | 6.x |
| 9 | SRS 旧条目 | srs.js 48–55、61–75 | 1.6 / 6.0 以前 |
| 10 | 棋钟回填 | library-local.js 86–143（`saveClock` / `backfillTc`）；library-page.js 943–962、980 | 6.x–8.0 |
| 11 | 损失重算 | library-ui.js 126、130–158（`rescoreLosses`）；library-page.js 481、491、606、913 | 7.0 |
| 12 | 无分片清单 | persist.js 781–797（`touchUnlisted`）；library-page.js 998–1002；rep-page.js 227–230 | 8.0 dev |
| 13 | 整份 `chessboard.json` | bridge.zig 106–110、935–965、1006–1012、1623、1653；main.zig 312–319；host.js 653–680、855–856 | 6.x–7.x |
| 14 | 降级测试 | scripts/test-downgrade-e2e.mjs（733 行） | 降级 |
| 15 | 降级的 CI | checks.yml 197–202；release.yml 209–212（persistence 组只剩 test-persist-e2e） | 降级 |
| 16 | 训练测试里的旧键 | test-trainer-e2e.mjs (k) 1157–1260（`git show v8.2.1:`）、1362–1380、(l) 1386–1467、(g) 713–717；1088 只改措辞 | 8.2 / 8.3 |
| 17 | 存档迁移测试 | test-persist.mjs 头注释、347–500、660–672、965–990、1078–1125 | SCHEMA 1→2、7.x |
| 18 | 存档 e2e 的旧路径 | test-persist-e2e.mjs 898、977、1479–1572、1637–1700、1706–1767 | 7.x、8.0 dev |
| 19 | 棋谱库迁移测试 | test-library-db.mjs §7 240–400（恢复路径相关的几条保留） | 6.x–8.0 dev |
| 20 | 棋谱库 e2e 的旧路径 | test-library-e2e.mjs 278–320、1912–2070、2534–2558 | 7.0、8.0 |
| 21 | 棋钟回填测试 | test-library-local.mjs 174–202 | 6.x–8.0 |
| 22 | 学习测试的旧条目 | test-learning.mjs 144–149、588–623、976–980 | 1.6、8.0、旧题分块 |
| 23 | 开局书迁移与降级测试 | test-rep-book.mjs §5 197–250、§8 约 398–529；test-repertoire-e2e.mjs 190–225、633–690、716–756 | 6.x–8.1 |
| 24 | 旧主题行的断言 | test-shell-e2e.mjs 288–294 | 7.x |
| 25 | README | 降级条目与「降级」一节、test-downgrade 说明；逐版历史在 M4 重写 | — |

## B · 改写成更简单的

| # | 什么 | 现在 | 9.0 |
|---|---|---|---|
| 26 | `persist.js`（1,069 行） | `chess.v1.*` 键、`MIGRATIONS`、整份文件的旧模式（`perKey`、`clearLegacy`、`flushWhole`、`readLegacy`）；另两份硬编码键名在 library-sum.js:17、lazy-content.js:68 | 新命名空间、SCHEMA 3、无迁移；约 −150 行 |
| 27 | 开局书（rep-db / rep-lines / rep-page / rep-book） | 两个库 + cards 副本；头里给 8.0 / 8.1 留 400 条；`rep-v1:` / `rep-v2:` 备份 | 一个库；删掉 400 条头与叠回；约 −270 行 |
| 28 | 棋谱库（library-db / library-page） | v1 形状的头、`v1:` 备份、legacy / 只读模式、`mergeEntry` 的旧版规则 | `importRecords` 只做恢复；约 −80 行 |
| 29 | `visual-modes.js` | 没带分段的键按 8.2 规则；8.3 没有 `eng` 的键重新搜 | 只有 9.0 的键；约 −30 行 |

## C · test-chess.mjs 的登记册

| 登记 | 位置 | 判断 |
|---|---|---|
| `REGISTERED = 111`（app.js 源码文本登记） | 8163–8165 及前约 60 行 | 历史，删 |
| `APP_JS_LINE_CEILING = 5754` | 7936–7945 | 历史；app.js 重组后换 9.0 自己的上限 |
| `BUNDLE_BYTES_AT_830 + 10000` | 7037–7051 | 换成 9.0 的线（8.4.0 + 20 KB） |
| `BUNDLE_BUDGET = 1349847 × 0.705` | bundle.mjs 164–166 | 首屏预算是真约束；改写死的字节数，不再提 7.9.0 |
| `SNAP_83`（十二组看 N 步对 v8.3.0） | 7360–7420 | 和旧版比是历史，删；同种子同题的确定性检查保留 |
| pickMove「8.2 规则」 | 7318–7356 | 「没有引擎用规则」是真约束，改措辞 |
| 旧题号、SRS 旧条目、`migrated`、`migrateStats`、`SCHEMA` / `MIGRATIONS` | 3159–3214、3633–3635、5192、5316、5827 | 历史，随源码删 |
| firstRun 取自快照、色彩上限、不直接碰 storage | 5177–5190 等 | 真约束，保留 |
