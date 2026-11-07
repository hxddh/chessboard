/**
 * Three languages (ADR 0002 文案, v20-0-plan §6 S4): every key of every
 * Chinese dictionary is in the English and the Japanese one, with the same
 * {placeholders}, and nothing extra; the content's words (content/words.*.js)
 * cover every prompt, retry, name, idea and lesson; English has no Chinese
 * left in it; the packs plug into the page dictionaries; the first-run guess
 * and the setting.
 *
 * A key added to a *.zh.js without its en and ja fails here — add all three.
 */
import { createText } from "../../src/app/lib/text.js";
import { LANGS, systemLang, usePack, setLang, getLang } from "../../src/app/text/lang.js";
import { playText } from "../../src/app/text/play.js";
import { learnText } from "../../src/app/text/learn.js";
import { oppText, sayLine } from "../../src/app/opponents/lines.js";
import { localItem, lessonOf } from "../../src/app/content/words.js";
import { explainMove, explainText } from "../../src/app/core/explain.js";
import { ITEMS } from "../../src/app/content/practice.js";
import { LESSONS } from "../../src/app/content/lessons.js";
import { SKILLS } from "../../src/app/content/skills.js";
import { OPPONENTS } from "../../src/app/core/opponents.js";
import { settingsActions, SETTINGS_DEFAULT } from "../../src/app/state/settings.js";
import uiEn from "../../src/app/text/pack.en.js";
import uiJa from "../../src/app/text/pack.ja.js";
import * as wordsEn from "../../src/app/content/words.en.js";
import * as wordsJa from "../../src/app/content/words.ja.js";
import playZh from "../../src/app/text/play.zh.js";
import learnZh from "../../src/app/text/learn.zh.js";
import explainZh from "../../src/app/text/explain.zh.js";
import linesZh from "../../src/app/opponents/lines.zh.js";

// a language as text/lang.js holds it once 学 has fetched its words
const packEn = { ...uiEn, items: wordsEn.ITEMS, lessons: wordsEn.LESSONS };
const packJa = { ...uiJa, items: wordsJa.ITEMS, lessons: wordsJa.LESSONS };
const PACKS = { en: packEn, ja: packJa };
const ZH = { play: playZh, learn: learnZh, explain: explainZh };
const HAN = /[㐀-鿿]/;
const KANA = /[぀-ヿ]/;
const holes = (s) => [...new Set(String(s).match(/\{\d\}/g) || [])].sort().join(" ");

/** Keys missing, extra, or with other placeholders, between a zh dictionary and a translation. */
function compare(name, zh, tr, out) {
  for (const k of Object.keys(zh)) {
    if (!(k in tr)) out.push(name + ": no " + JSON.stringify(k));
    else if (typeof zh[k] !== typeof tr[k]) out.push(name + ": " + k + " is a " + typeof tr[k] + ", zh a " + typeof zh[k]);
    else if (typeof zh[k] !== "string") continue;
    else if (holes(zh[k]) !== holes(tr[k])) out.push(name + ": " + k + " has {" + holes(tr[k]) + "}, zh {" + holes(zh[k]) + "}");
    else if (!tr[k] && zh[k]) out.push(name + ": " + k + " is empty");
  }
  for (const k of Object.keys(tr)) if (!(k in zh)) out.push(name + ": " + JSON.stringify(k) + " is not in the Chinese");
}
const report = (a, out, what) => a.ok(out.length === 0, what + " (" + out.length + "):\n  " + out.slice(0, 40).join("\n  "));

export default function (test) {
  test("text: every page dictionary key in en and ja, same placeholders, nothing extra", (a) => {
    const out = [];
    for (const [lang, p] of Object.entries(PACKS)) {
      for (const d of Object.keys(ZH)) compare(d + "." + lang, ZH[d], p[d], out);
    }
    report(a, out, "dictionaries out of step — add the key to all three languages");
  });

  test("text: every opponent's name, note and lines in en and ja", (a) => {
    const out = [];
    for (const [lang, p] of Object.entries(PACKS)) {
      compare("lines." + lang, linesZh, p.lines, out);
      for (const id of Object.keys(linesZh)) if (p.lines[id]) compare("lines." + lang + "." + id, linesZh[id], p.lines[id], out);
    }
    for (const o of OPPONENTS) if (!linesZh[o.id] || !linesZh[o.id].name) out.push("lines.zh: no name for " + o.id);
    report(a, out, "opponent lines out of step");
  });

  test("text: the content's words — every prompt, retry, name, idea and lesson in en and ja", (a) => {
    const out = [];
    for (const [lang, p] of Object.entries(PACKS)) {
      for (const it of Object.values(ITEMS)) {
        for (const k of ["prompt", "retry", "name", "idea"]) {
          if (!it[k]) continue;
          const w = p.items[it.id] && p.items[it.id][k];
          if (!w) out.push(lang + ": " + it.id + " has no " + k);
          else if (lang === "en" && HAN.test(w)) out.push("en: " + it.id + " " + k + " has Chinese: " + w);
        }
      }
      for (const [id, l] of Object.entries(LESSONS)) {
        const w = p.lessons[id];
        if (!w || !w.title || !Array.isArray(w.text) || w.text.length !== l.text.length) out.push(lang + ": lesson " + id + " missing or a different number of paragraphs");
      }
    }
    report(a, out, "content words out of step — run node scripts/gen-skills.mjs");
  });

  test("text: English has no Chinese and no full-width punctuation; Japanese is not left in Chinese", (a) => {
    const out = [];
    const strings = (o, at = "") => Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [[at + k, v]] : v && typeof v === "object" ? strings(v, at + k + ".") : []));
    for (const d of ["play", "learn", "explain", "lines"]) {
      for (const [k, v] of strings(packEn[d])) {
        if (HAN.test(v) || /[，。：；！？（）「」、]/.test(v)) out.push("en " + d + "." + k + ": " + v);
      }
      const zh = d === "lines" ? linesZh : ZH[d];
      const zhFlat = Object.fromEntries(strings(zh));
      for (const [k, v] of strings(packJa[d])) {
        // a sentence the same in both is an untranslated one (names, SAN and "Stockfish" aside)
        if (v.length > 3 && v === zhFlat[k] && HAN.test(v)) out.push("ja " + d + "." + k + " is the Chinese: " + v);
        if ((v.match(/[\u3400-\u9fff]/g) || []).length >= 8 && !KANA.test(v)) out.push("ja " + d + "." + k + " has no kana: " + v);
      }
    }
    report(a, out, "untranslated strings");
  });

  test("text: every skill has a name and a why in all three", (a) => {
    const out = [];
    for (const s of SKILLS) for (const k of ["sk." + s.id, "sk." + s.id + ".why"]) {
      if (!learnZh[k]) out.push("zh: no " + k);
      for (const [lang, p] of Object.entries(PACKS)) if (!p.learn[k]) out.push(lang + ": no " + k);
    }
    report(a, out, "skill names");
  });

  test("text: the packs plug into the page dictionaries, the lines and the content", async (a) => {
    a.equal(getLang(), "zh", "Chinese until a language is set");
    a.equal(playText()("bar.yourTurn"), "轮到你");
    a.equal(oppText("pip", "name"), "皮普");
    const lessonZh = LESSONS[Object.keys(LESSONS)[0]];
    a.equal(lessonOf(Object.keys(LESSONS)[0], lessonZh), lessonZh);
    try {
      usePack("en", packEn);
      a.equal(playText()("bar.yourTurn"), "Your move");
      a.equal(learnText()("learn.today"), "Today's lesson");
      a.equal(playText()("piece.q"), "queen", "the explainer's words are in every page's dictionary");
      a.equal(sayLine("pip", "hello"), "Pip: I just learned how the knight moves!");
      a.equal(oppText("vera", "drawn"), "A draw — nicely played.", "a line it does not have falls back to its language's shared one");
      const it = ITEMS["ls:rook:0"];
      a.ok(!HAN.test(localItem(it).prompt) && localItem(it).fen === it.fen, "an item's prompt in English, its position untouched");
      a.ok(!HAN.test(lessonOf("rook", LESSONS.rook).text[0]), "a lesson in English");
      // the explainer, end to end, in English: 1.e4 d6 2.Qg4?? — the c8 bishop takes the queen
      const r = explainMove("rnbqkbnr/ppp1pppp/3p4/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2", "Qg4", { kind: "coach" });
      const en = explainText(r, playText(), { extra: true });
      a.ok(/queen/.test(en) && !HAN.test(en), "the explainer speaks English: " + en);
      usePack("ja", packJa);
      a.equal(playText()("reason.stalemate"), "ステイルメイト");
      a.equal(sayLine("pip", "hello"), "ピップ：ナイトの動き方、覚えたばかりなんだ！");
      const ja = explainText(r, playText(), { extra: true });
      a.ok(/クイーン/.test(ja), "…and Japanese: " + ja);
      // createText falls back to the Chinese for a key a dictionary lacks
      a.equal(createText({}, { x: "中" })("x"), "中");
    } finally {
      await setLang("zh");
    }
    a.equal(playText()("bar.yourTurn"), "轮到你", "and back");
  });

  test("text: the first-run guess from the system's locales", (a) => {
    a.deepEqual(LANGS, ["zh", "en", "ja"]);
    a.equal(systemLang({ languages: ["ja-JP", "en"] }), "ja");
    a.equal(systemLang({ languages: ["en-US"] }), "en");
    a.equal(systemLang({ languages: ["zh-TW"] }), "zh");
    a.equal(systemLang({ languages: ["fr-FR", "en-GB"] }), "en", "the first one we have");
    a.equal(systemLang({ languages: ["fr-FR"] }), "zh", "none of ours: the source");
    a.equal(systemLang({ language: "ja" }), "ja");
    a.equal(systemLang(null), "zh");
  });

  test("text: the language is a setting like the others", (a) => {
    const s0 = { settings: SETTINGS_DEFAULT };
    a.equal(SETTINGS_DEFAULT.lang, "zh");
    a.equal(settingsActions["settings.set"](s0, { key: "lang", value: "ja" }).settings.lang, "ja");
    a.throws(() => settingsActions["settings.set"](s0, { key: "lang", value: "fr" }), "an unknown language is refused");
    a.equal(settingsActions["settings.load"](s0, { lang: "en" }).settings.lang, "en");
    a.equal(settingsActions["settings.load"](s0, { lang: "xx" }).settings.lang, "zh", "a bad saved value is left out");
  });
}
