#!/usr/bin/env python3
"""
scripts/lib/tablebase_api.py, without the network (v8-2-plan V2).

The online check runs only in .github/workflows/verify-endgames.yml — the
machine that wrote it could not reach tablebase.lichess.ovh — so what can be
held here is the reading of an answer: the categories and the fifty-move
rule, whose side each move's category belongs to, the request (URL, pacing,
the 429 back-off), and that an answer built from the same 3–4-man tables the
camp's records came from gives exactly those records' verdicts and moves
(scripts/fixtures/tablebase-answers.json says how it was built).

Plain Python, no python-chess: python3 scripts/test-verify-endgames.py
"""
import io, json, os, sys, unittest, urllib.error, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts", "lib"))
import tablebase_api as T  # noqa: E402

FIXTURE = json.load(open(os.path.join(ROOT, "scripts/fixtures/tablebase-answers.json"), encoding="utf-8"))
RECORDS = {r["id"]: r for r in json.load(open(os.path.join(ROOT, "docs/endgames-verified.json"), encoding="utf-8"))["items"]}


class Categories(unittest.TestCase):
    def test_side_to_move(self):
        want = {"win": "win", "syzygy-win": "win", "cursed-win": "draw", "draw": "draw", "blessed-loss": "draw",
                "loss": "loss", "syzygy-loss": "loss", "maybe-win": "unresolved", "maybe-loss": "unresolved",
                "unknown": "unresolved", None: "unresolved", "something-new": "unresolved"}
        self.assertEqual({c: T.verdict(c) for c in want}, want)

    def test_a_move_is_read_from_the_other_side(self):
        # the move's category belongs to the side to move after it
        self.assertEqual(T.move_verdict("loss"), "win")
        self.assertEqual(T.move_verdict("syzygy-loss"), "win")
        self.assertEqual(T.move_verdict("win"), "loss")
        self.assertEqual(T.move_verdict("blessed-loss"), "draw")   # a cursed win for the mover: a draw
        self.assertEqual(T.move_verdict("cursed-win"), "draw")
        self.assertEqual(T.move_verdict("maybe-loss"), "unresolved")

    def test_men(self):
        self.assertEqual(T.men("1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1"), 5)
        self.assertEqual(T.men("6k1/ppp5/8/PPP5/8/8/8/6K1 w - - 0 1"), 8)


class Answers(unittest.TestCase):
    def test_fixture_matches_the_records_it_was_built_beside(self):
        # same tables, two readings: the online one must agree with the local one
        for pid in ("rp-check", "mi-n-stop"):
            ans = T.read_answer(FIXTURE[pid]["answer"])
            rec = RECORDS[pid]
            self.assertEqual(FIXTURE[pid]["fen"], rec["fen"])
            self.assertEqual(ans["verdict"], rec["verdict"], pid)
            self.assertEqual(ans["good"], rec["good"], pid)
            self.assertEqual(ans["dtz"], rec["dtz"], pid)
            self.assertEqual(T.disagreements(rec["verdict"], rec["good"], rec, ans), [], pid)

    def test_cursed_and_unresolved(self):
        moves = [{"san": "Kb2", "category": "blessed-loss"}, {"san": "Ka2", "category": "draw"}, {"san": "Rh1", "category": "loss"}]
        cursed = T.read_answer({"category": "cursed-win", "dtz": 101, "moves": moves})
        self.assertEqual((cursed["verdict"], cursed["good"]), ("draw", ["Ka2", "Kb2"]))
        maybe = T.read_answer({"category": "maybe-win", "dtz": None, "moves": moves})
        self.assertEqual(maybe, {"category": "maybe-win", "verdict": "unresolved"})

    def test_not_an_answer(self):
        for doc in ({}, {"category": "win"}, [], "win", {"error": "rate limited"}):
            with self.assertRaises(ValueError):
                T.read_answer(doc)

    def test_disagreements(self):
        ans = {"category": "win", "verdict": "win", "good": ["Rd1+", "Rh1"]}
        self.assertEqual(T.disagreements("win", None, {"method": "sf"}, ans), [])
        self.assertEqual(len(T.disagreements("draw", None, {"method": "sf"}, ans)), 1)
        self.assertEqual(len(T.disagreements("win", ["Rd1+"], {"method": "sf"}, ans)), 1)
        self.assertEqual(len(T.disagreements("win", None, {"method": "tb", "good": ["Rd1+"]}, ans)), 1)
        self.assertEqual(len(T.disagreements("win", None, {"method": "sf"}, {"category": "unknown", "verdict": "unresolved"})), 1)


class Client(unittest.TestCase):
    def fake(self, replies):
        calls = []

        class Res(io.BytesIO):
            def __enter__(self): return self
            def __exit__(self, *a): return False

        def opener(req, timeout):
            calls.append(req)
            r = replies.pop(0)
            if isinstance(r, int):
                raise urllib.error.HTTPError(req.full_url, r, "status %d" % r, {}, None)
            return Res(json.dumps(r).encode("utf-8"))
        return opener, calls

    def test_request_pacing_and_back_off(self):
        answer = FIXTURE["rp-check"]["answer"]
        opener, calls = self.fake([answer, 429, answer])
        slept, now = [], [100.0]
        c = T.Client(delay=1.0, opener=opener, sleep=lambda s: (slept.append(round(s, 3)), now.__setitem__(0, now[0] + s)),
                     clock=lambda: now[0])
        fen = FIXTURE["rp-check"]["fen"]
        self.assertEqual(c.probe(fen)["verdict"], "win")
        now[0] += 0.25   # the caller spent a quarter second before the next one
        self.assertEqual(c.probe(fen)["good"], ["Rc5+"])
        # 0.75 s to keep one a second, a minute after the 429, then again
        self.assertEqual(slept, [0.75, 60])
        self.assertEqual(c.requests, 3)
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(calls[0].full_url).query)
        self.assertEqual(q["fen"], [fen])
        self.assertTrue(calls[0].full_url.startswith("https://tablebase.lichess.ovh/standard?"))
        self.assertIn("chessboard", calls[0].get_header("User-agent"))

    def test_other_errors_and_too_many_429s_raise(self):
        opener, _ = self.fake([500])
        with self.assertRaises(urllib.error.HTTPError):
            T.Client(opener=opener, sleep=lambda s: None).probe("8/8/8/8/8/8/8/K1k5 w - - 0 1")
        opener, _ = self.fake([429, 429])
        with self.assertRaises(urllib.error.HTTPError):
            T.Client(retries=1, opener=opener, sleep=lambda s: None).probe("8/8/8/8/8/8/8/K1k5 w - - 0 1")


if __name__ == "__main__":
    unittest.main(verbosity=2)
