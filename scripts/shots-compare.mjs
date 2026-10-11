#!/usr/bin/env node
/**
 * v11-0-plan S: the screenshot set beside the base branch's, for people to
 * look at (not a pixel gate). Writes <out>/compare.html: every shot the head
 * took, the base's of the same name to its left, the ones only one side has
 * marked as such. checks.yml's screenshots job uploads it with both sets.
 *
 *   node scripts/shots-compare.mjs <base dir> <head dir> <out dir>
 */
import fs from "fs";
import path from "path";

const [base, head, out] = process.argv.slice(2);
if (!base || !head || !out) { console.error("usage: shots-compare.mjs <base> <head> <out>"); process.exit(2); }
const list = (d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith(".png")).sort() : []);
const b = new Set(list(base)), h = list(head);
const names = [...new Set([...h, ...b])].sort();
fs.mkdirSync(out, { recursive: true });
const rel = (d, f) => path.relative(out, path.join(d, f)).split(path.sep).join("/");
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const rows = names.map((n) => {
  const cell = (d, has) => has ? `<a href="${esc(rel(d, n))}"><img loading="lazy" src="${esc(rel(d, n))}" alt=""></a>` : "<p>—</p>";
  return `<section><h2>${esc(n)}${b.has(n) ? "" : " · new"}${h.includes(n) ? "" : " · gone"}</h2>` +
    `<div class="pair">${cell(base, b.has(n))}${cell(head, h.includes(n))}</div></section>`;
}).join("\n");
fs.writeFileSync(path.join(out, "compare.html"), `<!doctype html><meta charset="utf-8"><title>Screenshots: base | head</title>
<style>body{font:14px system-ui;margin:16px;background:#1b1b1d;color:#ddd}h2{font-size:14px;font-weight:600}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}img{width:100%;border:1px solid #444}p{color:#888}</style>
<h1>base | head</h1>
${rows}
`);
console.log("compare.html: " + names.length + " shots (" + h.length + " head, " + b.size + " base)");
