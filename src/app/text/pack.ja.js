/**
 * The interface in Japanese — the page dictionaries, the explainer and the
 * opponents — in one chunk that text/lang.js fetches with `import()` when the
 * language is chosen; the first paint carries Chinese only. The content's
 * words (content/words.ja.js) are a chunk of their own, fetched with 学.
 * @module text/pack.ja
 */
import play from "./play.ja.js";
import learn from "./learn.ja.js";
import explain from "./explain.ja.js";
import lines from "../opponents/lines.ja.js";

export default { play, learn, explain, lines };
