# 0001 · 代码用 ES modules 加载，大文件是真二进制

**状态**：已定（2026-11-06）。真机探针结果出来后在文末补记。

## 背景

- 到 19.0，按需加载靠 iife 分块：每个分块是一个设全局变量的脚本，由 `chunk.js` 插进页面，`lazy-content.js` 声明它；每个按需边界要同时维护 4 处（`bundle.mjs` 的 CHUNKS 条目、`*-chunk.js`、`*-lazy.js`、一条测试）。
- 理由是「zero:// 不能 fetch、不能用 ES modules、不能从 URL 起 worker」（`design-constraints.md`）。
- 因此 Maia 的五张网和 Stockfish 的 wasm 都被转成 base64 文本 JS：总包 24 MB，其中 Maia 11.6 MB（比原文件大 33%）、`engine-src.js` 2.4 MB。
- 20.0 的 A5 核查读了 SDK 0.10.1 与 0.11.0 的源码（v20-0-plan §10）：页面和资源同源，scheme 处理器按扩展名给 MIME（`.js/.mjs` → `text/javascript`、`.wasm` → `application/wasm`），没有任何东西挡住 module script、`import()`、`fetch` 或 `instantiateStreaming`。上面那条约束在源码里找不到依据。

## 决定

- 应用代码是 ES modules：`index.html` 只有一个 `<script type="module" src="js/main.js">`。
- 按需加载就是 `import()`。esbuild 照样打包，但输出 `format: "esm"` + `splitting: true`，按需边界由 `import()` 自然产生，不再手写 CHUNKS 表、shim 和 facade。
- 大文件是真二进制，用 `fetch` 读：
  - Stockfish：`.wasm`，`WebAssembly.instantiateStreaming`；
  - Maia-3 权重：fp16 二进制；
  - 残局库、题库分段：二进制或 JSON。
- `app.zon` 里 `spa_fallback` 关掉：缺失的文件必须是 404，不能被答成 200 的 `index.html`（否则读到的是坏数据）。
- CSP 加 `worker-src 'self' blob:`。
- Worker 用 `new Worker(new URL("…", import.meta.url), { type: "module" })`；如果真机探针表明某个平台拦截 Worker 请求，就退到「页面 fetch 字节 → blob URL → worker」。

## 后果

- `chunk.js`、`lazy-content.js`、所有 `*-chunk.js` / `*-lazy.js`、`gen-engine-src.mjs` / `gen-maia-src.mjs` 的 base64 输出、`bundle.mjs` 的 CHUNKS 表和对应测试，一起删掉。
- 总包预计 24 MB → 约 8 MB（Maia-3 一张 fp16 网约 10 MB 替换五张 11.6 MB 的文本网，wasm 不再膨胀 33%，原生引擎另算）。
- 首帧的门禁从「字节线」改成「首帧时间 + 首帧不执行的模块不在首帧里」（ADR 0005）。
- 风险：macOS 11 上的 Safari 14 对 module worker 支持不全；真机探针确认，必要时 Worker 走 classic + 手动加载。

## 不做的选择

- **继续 iife 分块，只是由一份清单自动生成 shim**：能少写手工代码，但保留了全局变量、文本化的二进制和 4 处同步，问题还在。
- **一个巨大的单文件包**：首帧会把课程、题库、名局都带上，违背「快」。
