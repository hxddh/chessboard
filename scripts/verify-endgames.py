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

--online (v8-2-plan V2): ask tablebase.lichess.ovh — the full Syzygy set, up
to 7 men — about every position the file already records, one request a
second, and write its answer beside the record as `lichess` (category,
verdict, DTZ, the moves that keep the verdict). Nothing else in the record
changes: whether a 5-man item's method becomes `tb` is decided by a person,
after reading the answers. Exits 1 if the table disagrees with an item's goal,
with a 3–4-man record's moves or with an item's only move; the positions over
7 men are listed and skipped. Needs no engine and no local tables. Run by
.github/workflows/verify-endgames.yml; scripts/lib/tablebase_api.py has the API.
  python3 scripts/verify-endgames.py --online [--only ID,…] [--delay 1.0] [--out FILE]
"""
import argparse, hashlib, json, os, re, sys, time
import chess, chess.engine, chess.syzygy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src/web/js/endgames.js")
OUT = os.path.join(ROOT, "docs/endgames-verified.json")
ITEM = re.compile(r'\{ id: "([^"]+)", g: "([a-z]+)", fen: "([^"]+)", goal: "(win|draw)", v: "(tb|sf)"(?:, key: \[([^\]]*)\])?')


def items():
    with open(SRC, encoding="utf-8") as fh:
        out = [dict(zip(("id", "g", "fen", "goal", "v", "key"), m.groups())) for m in ITEM.finditer(fh.read())]
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


def write_doc(doc, path):
    """Whole or not at all: a run stopped mid-write leaves the last file there was."""
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    os.replace(tmp, path)


def online(a, client=None):
    sys.path.insert(0, os.path.join(ROOT, "scripts", "lib"))
    import tablebase_api as T
    with open(OUT, encoding="utf-8") as fh:
        doc = json.load(fh)
    rec = {r["id"]: r for r in doc["items"]}
    client = client or T.Client(delay=a.delay)
    only = set(filter(None, a.only.split(",")))
    bad, over, asked = [], [], 0

    def save(done):
        doc["tools"]["lichessTablebase"] = dict({
            "endpoint": T.ENDPOINT,
            "checkedAt": time.strftime("%Y-%m-%d", time.gmtime()),
            "asked": asked,
            "over7": over,
            "rule": "category from the side to move; cursed-win and blessed-loss count as draws (fifty-move rule); maybe-* and unknown settle nothing",
        }, **({} if done else {"partial": True}))
        write_doc(doc, a.out)

    # M1 评审: the file is written after every answer, and once more however
    # the run ends — ninety positions at one a second, and a job that times
    # out or dies on the eightieth used to keep none of the answers it had
    done = False
    try:
        for it in items():
            if only and it["id"] not in only: continue
            row = rec.get(it["id"])
            if row is None or row["fen"] != it["fen"]:
                print("BAD " + it["id"], "not in", os.path.relpath(OUT, ROOT), "for this FEN: run the offline check first", flush=True)
                bad.append(it["id"]); continue
            n = T.men(it["fen"])
            if n > T.MAX_MEN:
                print("skip " + it["id"], n, "men: no table", flush=True)
                over.append(it["id"]); continue
            asked += 1
            try:
                ans = client.probe(it["fen"])
            except Exception as e:  # one failed request is reported, not the end of the run
                print("ERR " + it["id"], repr(e)[:200], flush=True)
                bad.append(it["id"]); continue
            row["lichess"] = ans
            save(False)
            why = T.disagreements(it["goal"], it["key"], row, ans)
            print(("ok  " if not why else "BAD ") + it["id"], n, "men", row["method"], ans["category"], ans.get("dtz"),
                  ans.get("good"), "; ".join(why), flush=True)
            if why: bad.append(it["id"])
        done = True
    finally:
        save(done)
    print(asked, "asked,", len(over), "over 7 men", over, ",", len(bad), "bad", bad)
    return 1 if bad else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tb")
    ap.add_argument("--stockfish", default="stockfish")
    ap.add_argument("--depths", default="30,40")
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--only", default="")
    ap.add_argument("--online", action="store_true")
    ap.add_argument("--delay", type=float, default=1.0)
    ap.add_argument("--out", default=OUT)
    a = ap.parse_args()
    if a.online:
        sys.exit(online(a))
    if not a.tb:
        ap.error("--tb DIR is required (or --online)")
    depths = [int(x) for x in a.depths.split(",")]
    tb = chess.syzygy.open_tablebase(a.tb)
    eng = chess.engine.SimpleEngine.popen_uci(a.stockfish)
    eng.configure({"Threads": a.threads, "Hash": 1024, "SyzygyPath": os.path.abspath(a.tb)})
    prev, prev_tools = {}, {}
    if os.path.exists(OUT):
        prev_doc = json.load(open(OUT, encoding="utf-8"))
        prev, prev_tools = {r["id"]: r for r in prev_doc["items"]}, prev_doc.get("tools", {})
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
        # v8-2-plan V2: the online table's answer for this same position stays
        was = prev.get(it["id"])
        if was and was["fen"] == it["fen"] and "lichess" in was: rec["lichess"] = was["lichess"]
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
    if "lichessTablebase" in prev_tools: doc["tools"]["lichessTablebase"] = prev_tools["lichessTablebase"]
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    print(len(rows), "items,", len(bad), "bad", bad)
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
