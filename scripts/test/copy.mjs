/**
 * Copy guards: no emoji in the interface, full-width punctuation in CJK.
 *
 * Part of scripts/test-chess.mjs, which runs every module here in order.
 */
import fs from "fs";
import path from "path";
import { assert, root, webJsFiles } from "./harness.mjs";

export async function run() {
  // 7.7 (v7-7-plan §7): no emoji in the interface. Emoji are the one kind of
  // glyph each platform draws in its own house style — the same badge was a
  // glossy picture on macOS and a flat one on Windows — so the achievements,
  // the ✅ / 🎉 / 👀 / ⚠️ in the messages and the 🔒 on a locked badge were
  // replaced by the Lucide line icons in icons.js. The scan covers the markup,
  // the stylesheet and every script the page ships (i18n strings included),
  // comments stripped. The chess symbols U+2654–265F are pieces, not emoji
  // (the promotion dialog and the editor palette draw with them), and are
  // excluded — although ♟ carries the pictographic property since Emoji 11.
  // v10-0-plan E5: the register that listed what was left is gone — none is the rule.
  {
    const web = path.join(root, "src/web");
    const files = ["index.html", "styles.css", ...webJsFiles(path.join(web, "js"))
      .filter((f) => f.endsWith(".js") && !["bundle.js", "engine-src.js"].includes(f)).map((f) => "js/" + f)];
    const found = new Map();
    for (const f of files) {
      const src = fs.readFileSync(path.join(web, f), "utf8")
        .replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      const hits = [...src.matchAll(/\p{Extended_Pictographic}/gu)].map((m) => m[0]).filter((c) => !/[♔-♟]/u.test(c));
      if (hits.length) found.set(f, [...new Set(hits)].join(""));
    }
    for (const [f, e] of found) console.error("  emoji in " + f + ": " + e);
    assert(found.size === 0, "the interface draws no emoji" + (found.size ? " — " + [...found.keys()].join(", ") : ""));
    // …and every achievement names an icon that exists
    const iconSrc = fs.readFileSync(path.join(web, "js/icons.js"), "utf8");
    const achSrc = fs.readFileSync(path.join(web, "js/achievements.js"), "utf8");
    const missing = [...achSrc.matchAll(/icon: "([^"]+)"/g)].map((m) => m[1])
      .filter((n) => !iconSrc.includes("\n    " + JSON.stringify(n) + ": [["));
    assert(missing.length === 0, "every achievement's icon is in icons.js" + (missing.length ? " — " + missing.join(", ") : ""));
  }

  // 5.1: the Chinese and Japanese copy uses full-width punctuation. One pass of
  // scripts/cjk-punct.mjs --fix converted 826 strings; this keeps the next
  // string honest without anyone having to remember the rule.
  {
    const { scan } = await import("../cjk-punct.mjs");
    const hits = scan(false);
    for (const h of hits.slice(0, 12)) console.error("  半角标点: " + h.file + ":" + h.line + " 「" + h.from.slice(0, 40) + "」");
    assert(hits.length === 0, "every Chinese and Japanese string uses full-width punctuation" +
      (hits.length ? " (" + hits.length + " to fix: node scripts/cjk-punct.mjs --fix)" : ""));
  }
}
