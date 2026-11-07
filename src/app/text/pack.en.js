/**
 * The interface in English — the page dictionaries, the explainer and the
 * opponents — in one chunk that text/lang.js fetches with `import()` when the
 * language is chosen; the first paint carries Chinese only. The content's
 * words (content/words.en.js) are a chunk of their own, fetched with 学.
 * @module text/pack.en
 */
import play from "./play.en.js";
import learn from "./learn.en.js";
import explain from "./explain.en.js";
import lines from "../opponents/lines.en.js";

export default { play, learn, explain, lines };
