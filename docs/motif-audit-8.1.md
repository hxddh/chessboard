# 母题精度抽样（v8-1-plan T6）

B3（`docs/coach-audit-8.0.md`）在 40 局上只量得出 4 个母题的精度：挂着的子、捉双、闪击、绝望子，其余 15 个一次都没被说出来。这一轮给 19 个母题每个至少 20 条真实对局里的样本，逐条判对错；错误率超过 5% 的母题照 B3 的规矩回退到只说子力得失（`explain.js MATERIAL_ONLY`）。

## 怎么量的

- **样本从哪来**：全是真实对局。
  - Lichess 谜题库（database.lichess.org，CC0，2026-09 的导出，6,100,952 行）。每一行是一盘真实对局里的局面，外加对局里真的走出的那一步（`Moves` 的第一步）——谜题就是从这步失着里生出来的。按 Lichess 主题各抽 600 行、全库均匀抽 6,000 行；稀有母题再按解法的形状（前三步谁在哪一格吃了什么、整题是不是杀）各抽 400 行。主题和形状只决定**试哪些行**：一行算不算某个母题的样本，看的是 app 自己说了什么，app 从不读 Lichess 的主题。
  - 仓库里的对局：`scripts/fixtures/corpus.mjs`（28 局）、`coach-games.mjs`（12 局低档引擎对局）、`src/sync-fixtures/` 里同步下来的 Lichess / Chess.com 样本。
- **app 怎么说**：照复盘的做法重跑。失着前后两个局面就是复盘要加深的位置（`review-grade.js deepTargets`），所以都按加深的预算搜：600 ms 当量 = 270,000 节点、MultiPV 3、每次先 `ucinewgame`，主变留 5 步（`review-pass.js`）；标成 `?` / `??` 的才算失着；`explain.js` 的调用和 `review/retry.js mistakeFacts()` 一样。句子说出了哪个母题（`explainMotif`），这一条就是那个母题的样本。
- **抽哪几条**：每个母题从说出它的全部案例里按固定种子取 25 条（仓库对局优先），不足 25 条的全取。
- **怎么判**：`scripts/lib/motif-oracle.mjs`。用 2,000,000 节点的深搜（app 的 7.4 倍，B3 的 oracle 是 7.5 倍）核对三件事：所说的那步棋站得住；母题的几何在棋盘上成立（这些事实在 oracle 里另写，不调用 `motif.js`）；「那步棋 + 深搜自己的后续」真的兑现了母题——吃到了母题说的那个子、或将死，并且得到了该得的子力。每个母题的规则写在下面各节的开头。整句（含「丢什么」「更好的是什么」）另用 B3 的 `coach-oracle.mjs` 判一遍，记在 `scripts/fixtures/motif-sample.json` 里，但错误率算的是母题。
- **人工复核**：oracle 判错的每一条都摆棋盘读过；判对的每个母题抽读 3 条。读下来推翻 oracle 的，写进 `motif-oracle.mjs HUMAN`，表里标「人工：」。

`node scripts/sample-motifs.mjs report --record` 把下表写进 `docs/measured.json` 的 `motifPrecision`；`scripts/test-explain.mjs` 读 `motif-sample.json`，核对回退名单就是表里超过 5% 的那些，且每条样本在现在的代码下仍说出（或不再说出）同一个母题。

## 结果

