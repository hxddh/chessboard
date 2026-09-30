"""
The Lichess tablebase API, read for scripts/verify-endgames.py --online
(v8-2-plan V2).

The endgame camp's 5-man positions were checked by a deep Stockfish search
because the 5-piece Syzygy files could not be fetched on the machine that
wrote them. tablebase.lichess.ovh answers from the full Syzygy set (up to 7
men) over HTTP, and the CI machines can reach it — so the online mode asks it
about every position of ≤ 7 men and records the answer beside the one on file.

The API, as documented (github.com/lichess-org/lila-tablebase):

  GET https://tablebase.lichess.ovh/standard?fen=<FEN>
  → {"category": "win", "dtz": 5, "precise_dtz": 5, "dtm": 21, "checkmate": false,
     "stalemate": false, "insufficient_material": false, ...,
     "moves": [{"uci": "d6c7", "san": "Kc7", "category": "loss", "dtz": -4, ...}, ...]}

`category` is from the side to move's point of view; each move's `category`
is from the point of view of the side to move AFTER that move — a move that
wins is one whose category is "loss". The categories:

  win, syzygy-win           a win (syzygy-win: by DTZ; no DTM in the answer)
  cursed-win                a win only without the fifty-move rule
  draw
  blessed-loss              a loss only without the fifty-move rule
  loss, syzygy-loss
  maybe-win, maybe-loss     win/loss or cursed; DTZ rounding leaves it open
  unknown                   no table for this material

The camp plays by the fifty-move rule, so a cursed win and a blessed loss are
draws — the same rule verify-endgames.py applies to the local 3–4-man tables.
"maybe-*" and "unknown" settle nothing and are reported as unresolved.

Nothing here imports python-chess: the parsing is exercised by
scripts/test-verify-endgames.py on a plain Python install.
"""
import json, time, urllib.error, urllib.parse, urllib.request

ENDPOINT = "https://tablebase.lichess.ovh/standard"
USER_AGENT = "chessboard-verify-endgames (github.com/hxddh/chessboard; v8-2-plan V2)"
MAX_MEN = 7

_SIDE = {
    "win": "win", "syzygy-win": "win",
    "loss": "loss", "syzygy-loss": "loss",
    "draw": "draw", "cursed-win": "draw", "blessed-loss": "draw",
}
_FLIP = {"win": "loss", "loss": "win", "draw": "draw"}


def verdict(category):
    """The side to move's result under the fifty-move rule, or "unresolved"."""
    return _SIDE.get(category, "unresolved")


def move_verdict(category):
    """A move's result for the side that plays it (its category is the opponent's)."""
    v = verdict(category)
    return _FLIP.get(v, "unresolved")


def men(fen):
    """Pieces on the board, kings included, from the FEN's first field."""
    return sum(ch.isalpha() for ch in fen.split(" ")[0])


def read_answer(doc):
    """
    One API answer → the record kept in docs/endgames-verified.json:
    the category, the verdict it means for the side to move, DTZ / DTM when
    given, and every move that keeps the verdict (SAN, sorted — the same
    shape as the local table's `good`). A position with an unresolved verdict
    has no `good`: "keeps the verdict" means nothing there.
    """
    if not isinstance(doc, dict) or "category" not in doc or not isinstance(doc.get("moves"), list):
        raise ValueError(("not a tablebase answer: %r" % (doc,))[:200])
    v = verdict(doc["category"])
    rec = {"category": doc["category"], "verdict": v}
    for k in ("dtz", "precise_dtz", "dtm"):
        if doc.get(k) is not None:
            rec[k] = doc[k]
    if v != "unresolved":
        rec["good"] = sorted(m["san"] for m in doc["moves"] if move_verdict(m.get("category")) == v)
    return rec


def disagreements(goal, key, row, ans):
    """
    Where the tablebase's answer and the camp disagree, in words; empty when
    they agree. `goal` is the item's (win / draw), `key` its only moves or
    None, `row` its record on file (method tb: the local table's `good`),
    `ans` read_answer()'s record. Any disagreement means the item is changed
    or withdrawn (v8-2-plan V2), never that the check is loosened.
    """
    out = []
    if ans["verdict"] != goal:
        out.append("tablebase %s (%s), camp goal %s" % (ans["verdict"], ans["category"], goal))
        return out
    if row.get("method") == "tb" and row.get("good") != ans.get("good"):
        out.append("moves that keep it: local %s, tablebase %s" % (row.get("good"), ans.get("good")))
    if key is not None and sorted(key) != ans.get("good"):
        out.append("only move %s, tablebase %s" % (sorted(key), ans.get("good")))
    return out


class Client:
    """
    Sequential and polite: at most one request per `delay` seconds, and on a
    429 (the service's rate limit) wait a minute and try again, a few times.
    `opener` and `sleep` are replaceable for the tests.
    """

    def __init__(self, delay=1.0, retries=3, timeout=30, opener=None, sleep=time.sleep, clock=time.monotonic):
        self.delay, self.retries, self.timeout = delay, retries, timeout
        self.opener = opener or urllib.request.urlopen
        self.sleep, self.clock = sleep, clock
        self.last = None
        self.requests = 0

    def probe(self, fen):
        url = ENDPOINT + "?" + urllib.parse.urlencode({"fen": fen})
        for attempt in range(self.retries + 1):
            if self.last is not None:
                wait = self.delay - (self.clock() - self.last)
                if wait > 0:
                    self.sleep(wait)
            self.last = self.clock()
            self.requests += 1
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
            try:
                with self.opener(req, timeout=self.timeout) as res:
                    return read_answer(json.loads(res.read().decode("utf-8")))
            except urllib.error.HTTPError as e:
                if e.code == 429 and attempt < self.retries:
                    self.sleep(60)
                    continue
                raise
        raise RuntimeError("unreachable")
