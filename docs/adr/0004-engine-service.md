# 0004 · 引擎服务：界面只发请求

**状态**：已定（2026-11-06）。

## 背景

- 19.0 的算棋分散在 `engine.js`（Stockfish wasm、对手各档、复盘的多遍搜索）、`human/`（Maia-1 五个分段，在 worker 里）和若干调用方里；调用方知道背后是谁。
- 单线程精简版 NNUE 约 450 节点/毫秒、深度 15 左右；最轻一级的「?!」两次分析一致只有 39–67%，讲解的深度和准确都卡在这里（v20-0-plan §4）。
- zero:// 没有 COOP/COEP，没有 SharedArrayBuffer，wasm 多线程做不了（v20-0-plan §10 A5）。
- SDK 没有给 WebView 应用起长驻子进程的接口；`fx.spawn` 只写一次 stdin（4 KiB 上限）。
- Maia-3-5M：一张网覆盖所有等级分，单线程每次评估 8–27 ms，许可证可用（v20-0-plan §10 P1）。

## 决定

- **一个 `EngineService`**，界面只发请求、拿结果：
  - `analyse(fen, { lines, budget })` → 多条线与评估
  - `bestMove(fen, opponentProfile)` → 对手的着法与思考时间
  - `humanMoves(fen, rating)` → 这个等级分的人会怎么走（分布）
  - `review(game)` → 复盘结果（可流式）
  - `tablebase(fen)` → 残局库判定
- **后端**：
  1. **原生 Stockfish**：Zig 壳在 `main.zig` 里自己管进程——`std.process.spawn` 接 stdin/stdout 管道（Windows 加 `create_no_window`）、一个读线程、经现有的异步桥（N1，`sync.zig` 那一套）把 UCI 输出流式送回网页。完整 NNUE、线程数 = 核数、大哈希。
  2. **Maia-3-5M**：自写 JS + wasm SIMD 前向计算，在 worker 里跑；权重是 fp16 二进制（ADR 0001）；有对着 PyTorch 原版的一致性测试。
  3. **wasm Stockfish**（19.0 那一个）：原生进程缺失、启动失败或崩溃时的后备；用户只看到一句「分析会慢一些」。
  4. **残局库**：3–4 子随包；5 子可选下载。
- **对手是一个 profile**：等级分、风格、思考节奏、收官和认输的规则；由服务决定用 Maia 还是 Stockfish，界面不知道。

## 后果

- 每个平台多带一个 Stockfish 可执行文件，要和应用一起签名、公证（E2）。
- 阶梯（21 档）在 Maia-3 + 原生 Stockfish 上重新对下标定；`test-strength` 和新的收官测试进 PR 检查（v20-0-plan §7 E3）。
- 测试里可以给服务换一个假后端，界面测试不必起真引擎。

## 不做的选择

- **wasm 多线程**：要跨源隔离头，SDK 两个平台都不给。
- **onnxruntime-web 跑 Maia-3**：能用（27 ms/次），但多带 11 MB 的 wasm；自写前向更小，且只有一种网络结构要支持。
