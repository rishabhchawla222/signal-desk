"""Estimated SENSEX option chains (no free BSE feed). Run: python -m unittest discover -s tests"""
import json
import math
import sys
import unittest
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import feed  # noqa: E402
from options import R, sensex_expiries, smile_iv, smile_points, years_to  # noqa: E402

FIX = ROOT / "tests" / "fixtures"
QUOTES = json.loads((FIX / "quotes.json").read_text())
CHAINS = json.loads((FIX / "chains.json").read_text())["chains"]
DAY = date.fromisoformat(QUOTES["ts"][:10])
NOW = datetime.combine(DAY, datetime.min.time()).replace(hour=13, minute=25)


def build():
    f = feed.Feed(Path("."), use_git=False)
    f.uni = {"lots": {}}
    f.idx = {"SENSEX": {"p": QUOTES["indices"]["SENSEX"]["p"]}}
    return f.estimated_chains(NOW, CHAINS), f


class EstimatedChainTest(unittest.TestCase):
    def test_two_thursday_expiries_and_lot_size(self):
        est, f = build()
        exps = sorted(k.split("|")[1] for k in est)
        self.assertEqual(len(exps), 2)
        for e in exps:
            self.assertEqual(date.fromisoformat(e).weekday(), 3)
        self.assertEqual(f.uni["lots"]["SENSEX"], 20)
        self.assertTrue(all(c["estimated"] for c in est.values()))

    def test_prices_are_consistent(self):
        est, _ = build()
        spot = QUOTES["indices"]["SENSEX"]["p"]
        for key, ch in est.items():
            rows = ch["rows"]
            self.assertEqual(len(rows), 41)
            strikes = [r[0] for r in rows]
            self.assertEqual(strikes, sorted(strikes))
            calls, puts = [r[1] for r in rows], [r[9] for r in rows]
            self.assertTrue(all(a >= b for a, b in zip(calls, calls[1:])), "calls fall as strike rises")
            self.assertTrue(all(a <= b for a, b in zip(puts, puts[1:])), "puts rise as strike rises")
            for r in rows:
                self.assertLess(r[3], r[4])            # call bid < ask
                self.assertLess(r[11], r[12])          # put bid < ask
                self.assertLessEqual(r[3], r[1])
                self.assertGreaterEqual(r[4], r[1])
            # put-call parity: C - P = S - K e^(-rT) (within rounding and the 0.05 floor)
            t = years_to(date.fromisoformat(ch["exp"]), NOW)
            atm = min(rows, key=lambda r: abs(r[0] - spot))
            parity = spot - atm[0] * math.exp(-R * t)
            self.assertAlmostEqual(atm[1] - atm[9], parity, delta=0.5)

    def test_volatility_follows_the_nifty_smile(self):
        k = sorted(x for x in CHAINS if x.startswith("NIFTY|"))[0]
        pts = smile_points(CHAINS[k]["rows"], CHAINS[k]["spot"], compact=True)
        self.assertGreater(len(pts), 10)
        lo, hi = min(v for _, v in pts), max(v for _, v in pts)
        est, _ = build()
        for ch in est.values():
            for r in ch["rows"]:
                self.assertGreaterEqual(r[7] / 100, lo - 1e-9)
                self.assertLessEqual(r[7] / 100, hi + 1e-9)
        self.assertAlmostEqual(smile_iv([(0.9, 0.2), (1.1, 0.1)], 1.0), 0.15)

    def test_expiry_day_rules(self):
        thu = date(2026, 10, 29)
        self.assertEqual(sensex_expiries(thu, 2, include_today=True)[0], thu)
        self.assertEqual(sensex_expiries(thu, 2, include_today=False)[0], date(2026, 11, 5))

    def test_no_spot_or_no_proxy_means_no_chain(self):
        f = feed.Feed(Path("."), use_git=False)
        f.uni, f.idx = {"lots": {}}, {}
        self.assertEqual(f.estimated_chains(NOW, CHAINS), {})
        f.idx = {"SENSEX": {"p": 73000}}
        self.assertEqual(f.estimated_chains(NOW, {}), {})


if __name__ == "__main__":
    unittest.main()
