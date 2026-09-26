/**
 * 开局「变例」的中文名（7.8，v7-8-plan §6）—— 键是 lichess 开局表（eco.js）
 * 里名字冒号之后、按逗号切开的一段，例如 "Italian Game: Two Knights Defense,
 * Fried Liver Attack" 的 "Two Knights Defense" 与 "Fried Liver Attack"。键是
 * 表里的英文原名，是 id，不是给人读的文案 —— 与 openings-family-zh.js 同一个
 * 做法（设计约束「内容翻译表按 id 取」）。
 *
 * 收哪些不是猜的：scripts/test-eco.mjs 把本应用自己的数据 —— 开局书 195 条
 * 线的每一步、十盘经典对局、课程与题库里的局面 —— 逐一查表，数出仍显示英文
 * 的变例段各出现多少次，取前 60 段（同次数时按它在全表里出现的条数）。
 * 译名沿用开局书（openings.js）已有的写法；中文棋界没有通行叫法的不硬译，
 * 写在测试的 NO_ESTABLISHED_NAME 里，照旧显示英文。表外的段也照旧是英文。
 *
 * 「炸肝攻击」不在前 60 段里（本应用的数据里没有这盘棋），是计划点名的例子，
 * 单独收下。
 * @module openings-variation-zh
 */
  export const OPENING_VARIATIONS_ZH = {
    "Normal Variation": "常规变例",
    "Main Line": "主变",
    "Classical Variation": "古典变例",
    "Fianchetto Variation": "侧翼出象变例",
    "Queen's Knight Variation": "后马变例",
    "Normal Defense": "常规防御",
    "Symmetrical Variation": "对称变例",
    "Modern Variation": "现代变例",
    "Open": "开放变例",
    "Modern Variations": "现代变例",
    "Exchange Variation": "交换变例",
    "Evans Gambit": "埃文斯弃兵",
    "Modern Line": "现代走法",
    "King's English Variation": "王翼英国式",
    "Two Knights Defense": "双马防御",
    "Orthodox Defense": "正统防御",
    "Berlin Defense": "柏林防御",
    "Sämisch Variation": "萨米施变例",
    "Closed": "封闭变例",
    "Advance Variation": "前进变例",
    "Dragon Variation": "龙式变例",
    "Classical Defense": "古典防御",
    "Orthodox Variation": "正统变例",
    "Nimzowitsch Variation": "尼姆佐维奇变例",
    "Yugoslav Attack": "南斯拉夫攻击",
    "Czech Variation": "捷克变例",
    "Taimanov Variation": "泰马诺夫变例",
    "Normal Line": "常规走法",
    "Anti-Nimzo-Indian": "反尼姆佐-印度",
    "Fianchetto Attack": "侧翼出象攻击",
    "Giuoco Pianissimo": "极慢变例",
    "Spanish Variation": "西班牙变例",
    "Four Knights Variation": "四马变例",
    "Bishop's Gambit": "象弃兵",
    "Steinitz Variation": "斯坦尼茨变例",
    "Scheveningen Variation": "谢文宁根变例",
    "Alapin Variation": "阿拉平变例",
    "Four Pawns Attack": "四兵攻击",
    "Kieseritzky Gambit": "基泽利茨基弃兵",
    "Chigorin Variation": "契戈林变例",
    "Two Knights Variation": "双马变例",
    "Greco Gambit": "格列柯弃兵",
    "Accelerated Dragon": "加速龙式",
    "Gligoric System": "格利戈里奇体系",
    "Vienna Gambit": "维也纳弃兵",
    "Bernstein Defense": "伯恩斯坦防御",
    "French Variation": "法兰西变例",
    "Neo-Orthodox Variation": "新正统变例",
    "Prague Variation": "布拉格变例",
    "Evans Gambit Accepted": "接受埃文斯弃兵",
    "Falkbeer Variation": "法尔克比尔变例",
    "Winawer Variation": "维纳韦尔变例",
    "Tarrasch Variation": "塔拉什变例",
    "Fried Liver Attack": "炸肝攻击",
  };
