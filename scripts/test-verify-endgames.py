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
import importlib.util, io, json, os, socket, sys, tempfile, types, unittest, urllib.error, urllib.parse

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
            if isinstance(r, BaseException):
                raise r
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
        opener, calls = self.fake([404])
        with self.assertRaises(urllib.error.HTTPError):
            T.Client(opener=opener, sleep=lambda s: None).probe("8/8/8/8/8/8/8/K1k5 w - - 0 1")
        self.assertEqual(len(calls), 1)   # a 4xx is the request: asked once
        opener, calls = self.fake([500, 502, 503])
        with self.assertRaises(urllib.error.HTTPError):
            T.Client(opener=opener, sleep=lambda s: None).probe("8/8/8/8/8/8/8/K1k5 w - - 0 1")
        self.assertEqual(len(calls), 3)   # a 5xx: twice more, then it is reported
        opener, _ = self.fake([429, 429])
        with self.assertRaises(urllib.error.HTTPError):
            T.Client(retries=1, opener=opener, sleep=lambda s: None).probe("8/8/8/8/8/8/8/K1k5 w - - 0 1")

    def test_transient_failures_are_tried_again(self):
        # M1 评审: a timeout, a dropped connection or a 5xx is asked again
        # after a short back-off, not reported as a failed position
        answer = FIXTURE["rp-check"]["answer"]
        for first, second in ((socket.timeout("timed out"), 503), (urllib.error.URLError("reset"), ConnectionResetError())):
            opener, calls = self.fake([first, second, answer])
            slept = []
            c = T.Client(delay=0, opener=opener, sleep=slept.append)
            self.assertEqual(c.probe(FIXTURE["rp-check"]["fen"])["verdict"], "win")
            self.assertEqual((len(calls), slept), (3, [5.0, 10.0]))
        opener, calls = self.fake([500, 429, answer])   # the two counts are apart
        slept = []
        self.assertEqual(T.Client(delay=0, opener=opener, sleep=slept.append).probe(FIXTURE["rp-check"]["fen"])["verdict"], "win")
        self.assertEqual(slept, [5.0, 60])


class Online(unittest.TestCase):
    """verify-endgames.py --online keeps what it was told (M1 评审)."""

    def load(self):
        # python-chess is not needed by --online; checks.yml runs this without it
        try:
            import chess, chess.engine, chess.syzygy  # noqa: F401
        except ImportError:
            for name in ("chess", "chess.engine", "chess.syzygy"):
                sys.modules.setdefault(name, types.ModuleType(name))
        spec = importlib.util.spec_from_file_location("verify_endgames", os.path.join(ROOT, "scripts", "verify-endgames.py"))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod

    def unasked(self, V):
        # the records as they were before any online run (M2: the file on
        # disk now carries run 36771239680's answers), so that what this run
        # wrote is told apart from what was there
        with open(V.OUT, encoding="utf-8") as fh:
            doc = json.load(fh)
        doc["tools"].pop("lichessTablebase", None)
        for r in doc["items"]:
            r.pop("lichess", None)
        V.OUT = os.path.join(tempfile.mkdtemp(), "before.json")
        V.write_doc(doc, V.OUT)

    def test_answers_are_written_as_they_come(self):
        V = self.load()
        self.unasked(V)
        out = os.path.join(tempfile.mkdtemp(), "out.json")
        seen = []

        class Dies:
            def probe(self, fen):
                pid = next(k for k in ("rp-check", "mi-n-stop") if FIXTURE[k]["fen"] == fen)
                if seen:   # the second position: the first one's answer is on disk already
                    with open(out, encoding="utf-8") as fh:
                        doc = json.load(fh)
                    seen.append({r["id"]: "lichess" in r for r in doc["items"]}[seen[0]])
                    seen.append(doc["tools"]["lichessTablebase"].get("partial"))
                    raise KeyboardInterrupt   # the job killed, not a failed request
                seen.append(pid)
                return T.read_answer(FIXTURE[pid]["answer"])

        a = types.SimpleNamespace(only="rp-check,mi-n-stop", delay=0, out=out)
        with self.assertRaises(KeyboardInterrupt):
            V.online(a, client=Dies())
        self.assertEqual(seen[1:], [True, True])
        with open(out, encoding="utf-8") as fh:
            doc = json.load(fh)
        got = [r["id"] for r in doc["items"] if "lichess" in r and r["id"] in ("rp-check", "mi-n-stop")]
        self.assertEqual(got, [seen[0]])
        self.assertEqual(doc["items"][[r["id"] for r in doc["items"]].index(seen[0])]["lichess"],
                         T.read_answer(FIXTURE[seen[0]]["answer"]))
        self.assertTrue(doc["tools"]["lichessTablebase"]["partial"])
        self.assertFalse(os.path.exists(out + ".tmp"))

    def test_a_whole_run_is_not_partial(self):
        V = self.load()
        out = os.path.join(tempfile.mkdtemp(), "out.json")

        class Answers:
            def probe(self, fen):
                return T.read_answer(next(FIXTURE[k]["answer"] for k in ("rp-check", "mi-n-stop") if FIXTURE[k]["fen"] == fen))

        a = types.SimpleNamespace(only="rp-check,mi-n-stop", delay=0, out=out)
        self.assertEqual(V.online(a, client=Answers()), 0)
        with open(out, encoding="utf-8") as fh:
            doc = json.load(fh)
        self.assertEqual(doc["tools"]["lichessTablebase"]["asked"], 2)
        self.assertNotIn("partial", doc["tools"]["lichessTablebase"])


class OnFile(unittest.TestCase):
    """What the offline run holds an item to (M2, v8-2-plan V2): a 5–7-man `tb` rests on the online answer."""

    def test_the_basis_an_item_names(self):
        V = Online.load(self)
        it = lambda v, key=None, goal="win": {"id": "x", "goal": goal, "v": v, "key": key}
        local = {"men": 4, "method": "tb", "verdict": "win", "good": ["Rc5+"]}
        deep = {"men": 5, "method": "sf", "verdict": "win"}
        told = dict(deep, lichess={"category": "win", "verdict": "win", "dtz": 15, "good": ["Rb1", "Rc3"]})
        eight = {"men": 8, "method": "sf", "verdict": "win"}
        self.assertEqual(V.on_file(it("tb"), local), [])
        self.assertEqual(V.on_file(it("tb", ["Rc5+"]), local), [])
        self.assertEqual(len(V.on_file(it("tb", ["Rc4"]), local)), 1)
        self.assertEqual(len(V.on_file(it("sf"), local)), 1)          # ≤ 4 men: the local table, never the search
        self.assertEqual(V.on_file(it("sf"), deep), [])
        self.assertEqual(len(V.on_file(it("tb"), deep)), 1)           # 5 men, no answer: not `tb`
        self.assertEqual(V.on_file(it("tb"), told), [])
        self.assertEqual(V.on_file(it("sf"), told), [])               # an answer on file does not force the label
        self.assertEqual(len(V.on_file(it("tb", ["Rb1"]), told)), 1)  # an only move is held to the online moves
        self.assertEqual(len(V.on_file(it("tb", goal="draw"), told)), 2)
        self.assertEqual(len(V.on_file(it("tb"), dict(told, lichess={"category": "maybe-win", "verdict": "unresolved"}))), 1)
        self.assertEqual(len(V.on_file(it("tb"), dict(eight, lichess=told["lichess"]))), 1)   # over 7 men: no table
        self.assertEqual(V.on_file(it("sf"), eight), [])

    def test_the_file_on_disk(self):
        # every item as recorded passes the check the offline run makes
        V = Online.load(self)
        for it in V.items():
            self.assertEqual(V.on_file(it, RECORDS[it["id"]]), [], it["id"])

if __name__ == "__main__":
    unittest.main(verbosity=2)
