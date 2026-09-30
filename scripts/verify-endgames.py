#!/usr/bin/env python3
"""
The endgame camp's verdicts, checked once, when the content is written
(v8-1-plan T2) — never at run time: the app ships no tablebase.

For every position in src/web/js/endgames.js:

  - ≤ 4 men: the Syzygy WDL table. Records the value from White's (the
    student's) side and every move that keeps it, so an item that names its
    only move (`key`) can be held to the table.
  - 5 men or more: native Stockfish with the 3–4-piece tables attached, at two
    depths. A win needs a mate or tablebase-win score at both; a draw needs
    0.00 at both. Anything else fails the script.

The 5-piece Syzygy set (~1 GB with the 3–4-piece files) could not be fetched
here — tablebase.lichess.ovh is refused by this machine's proxy — so 5+ men
are the Stockfish rows. v8-1-plan §9 M3 has the whole story.

Writes docs/endgames-verified.json; scripts/test-endgames.mjs holds endgames.js
to it (goal, method, FEN, the only moves).

Needs: python-chess (pip install chess), a native Stockfish, and a folder of
3–4-piece Syzygy files (*.rtbw / *.rtbz).
  python3 scripts/verify-endgames.py --tb DIR [--stockfish PATH] [--depths 30,40]
"""
import argparse, hashlib, json, os, re, sys, time
import chess, chess.engine, chess.syzygy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src/web/js/endgames.js")
OUT = os.path.join(ROOT, "docs/endgames-verified.json")
ITEM = re.compile(r'\{ id: "([^"]+)", g: "([a-z]+)", fen: "([^"]+)", goal: "(win|draw)", v: "(tb|sf)"(?:, key: \[([^\]]*)\])?')


def items():
    out = [dict(zip(("id", "g", "fen", "goal", "v", "key"), m.groups())) for m in ITEM.finditer(open(SRC, encoding="utf-8").read())]
    for it in out:
        it["key"] = re.findall(r'"([^"]+)"', it["key"]) if it["key"] else None
    return out


def wdl_after(tb, b):
    if b.is_checkmate(): return -2
    if b.is_stalemate() or b.is_insufficient_material(): return 0
    return tb.probe_wdl(b)


def by_table(tb, b):
    w = tb.probe_wdl(b)
    good = []
    for m in list(b.legal_moves):
        san = b.san(m); b.push(m); v = -wdl_after(tb, b); b.pop()
        # a cursed win (1) is a draw under the fifty-move rule, which the camp plays by
        if (v >= 2) == (w >= 2) and (v <= -2) == (w <= -2): good.append(san)
    verdict = "win" if w >= 2 else "loss" if w <= -2 else "draw"
    return {"method": "tb", "wdl": w, "dtz": tb.probe_dtz(b), "verdict": verdict, "good": sorted(good)}


def by_engine(eng, b, depths):
    rows = []
    for d in depths:
        eng.protocol.send_line("ucinewgame")
        r = eng.analyse(b, chess.engine.Limit(depth=d))
        s = r["score"].white()
        rows.append({"depth": r.get("depth"), "score": str(s), "cp": s.score(mate_score=100000), "mate": s.mate(),
                     "pv": b.variation_san(r.get("pv", [])[:10])})

    def cls(row):
        if row["mate"] is not None: return "win" if row["mate"] > 0 else "loss"
        if row["cp"] >= 10000: return "win"   # Stockfish's tablebase-win band
        if row["cp"] <= -10000: return "loss"
        if row["cp"] == 0: return "draw"
        return "unresolved"
    seen = {cls(r) for r in rows}
    verdict = seen.pop() if len(seen) == 1 else "unstable"
    return {"method": "sf", "verdict": verdict, "search": rows}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tb", required=True)
    ap.add_argument("--stockfish", default="stockfish")
    ap.add_argument("--depths", default="30,40")
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    depths = [int(x) for x in a.depths.split(",")]
    tb = chess.syzygy.open_tablebase(a.tb)
    eng = chess.engine.SimpleEngine.popen_uci(a.stockfish)
    eng.configure({"Threads": a.threads, "Hash": 1024, "SyzygyPath": os.path.abspath(a.tb)})
    prev = {}
    if os.path.exists(OUT):
        prev = {r["id"]: r for r in json.load(open(OUT, encoding="utf-8"))["items"]}
    rows, bad = [], []
    for it in items():
        b = chess.Board(it["fen"])
        assert b.is_valid() and b.turn == chess.WHITE, it["id"]
        men = len(b.piece_map())
        if a.only and it["id"] not in a.only.split(",") and it["id"] in prev and prev[it["id"]]["fen"] == it["fen"]:
            rows.append(prev[it["id"]]); continue
        t0 = time.time()
        rec = by_table(tb, b) if men <= 4 else by_engine(eng, b, depths)
        rec = dict({"id": it["id"], "fen": it["fen"], "men": men}, **rec)
        ok = rec["verdict"] == it["goal"] and rec["method"] == it["v"]
        if it["key"] is not None and rec.get("good") != sorted(it["key"]): ok = False
        print(("ok  " if ok else "BAD ") + it["id"], rec["verdict"], rec.get("good") or [r["score"] for r in rec.get("search", [])],
              "%.0fs" % (time.time() - t0), flush=True)
        if not ok: bad.append(it["id"])
        rows.append(rec)
    sf_name = eng.id.get("name")
    eng.quit()
    files = sorted(f for f in os.listdir(a.tb) if f.endswith((".rtbw", ".rtbz")))
    doc = {
        "about": "v8-1-plan T2: each endgame's verdict, from White's side (the student's), as checked when the content was written. Written by scripts/verify-endgames.py; read by scripts/test-endgames.mjs.",
        "tools": {
            "python-chess": chess.__version__,
            "stockfish": sf_name,
            "depths": depths,
            "syzygy": "3–4-piece WDL/DTZ (%d files) from the python-chess repository's data/syzygy/regular" % len(files),
            "syzygyMd5": {f: hashlib.md5(open(os.path.join(a.tb, f), "rb").read()).hexdigest() for f in files},
        },
        "items": rows,
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    print(len(rows), "items,", len(bad), "bad", bad)
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
