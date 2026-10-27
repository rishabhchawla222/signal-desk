"""Auto-trader tests (paper trading only). Run: python -m unittest discover -s tests"""
import json
import shutil
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import autotrade  # noqa: E402
from autotrade import AutoTrader, option_charges  # noqa: E402

CFG = {"enabled": True, "indices": ["NIFTY"], "lots": 1, "start_cash": 1000000}
NOW = datetime(2026, 10, 28, 10, 5, 30)


class Quotes:
    """Controllable fake NSE quotes."""
    def __init__(self, bid=99.8, ask=100.2):
        self.bid, self.ask, self.down = bid, ask, False

    def __call__(self, index, strike, side, expiry):
        if self.down:
            return None
        return {"bid": self.bid, "ask": self.ask, "ltp": round((self.bid + self.ask) / 2, 2)}


def signal(i=1, index="NIFTY", side="CALL", **kw):
    t = {"id": f"{index}-20261028-10{i:02d}-{side}", "index": index, "side": side, "strike": 22600 + 50 * i,
         "option": f"{index} {22600 + 50 * i} {'CE' if side == 'CALL' else 'PE'}", "entry": 22610.0,
         "premium": {"estimated": index == "SENSEX", "expiry": "2026-11-03", "price": 100, "sl": 70,
                     "target": 150, "bid": 99.8, "ask": 100.2}}
    t.update(kw)
    return t


class AutoTraderTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.q = Quotes()
        self.a = self.make()

    def tearDown(self):
        shutil.rmtree(self.dir)

    def make(self, cfg=CFG):
        return AutoTrader(self.dir / "autotrade.json", cfg, quote=self.q, lots=lambda s: 65)

    def enter(self, t, now=NOW):
        return self.a.on_event({"type": "ENTRY", "trade": t}, now)

    def exit_signal(self, t, now=NOW, note="Target hit"):
        return self.a.on_event({"type": "EXIT", "trade": {**t, "note": note, "outcome": "TARGET", "exit": 22700}}, now)

    def cmd(self, kind, target=None, cid=None, now=NOW, **kw):
        return self.a.handle_command({"id": cid or f"c-{kind}-{target}", "type": kind, "target": target,
                                      "ts": now.isoformat(), **kw}, now)

    def assertBalanced(self):
        expect = round(CFG["start_cash"] + sum(x["net"] for x in self.a.st["trades"])
                       - sum(p["qty"] * p["buy_price"] + p["buy_charges"] for p in self.a.st["open"].values()), 2)
        self.assertAlmostEqual(self.a.st["cash"], expect, places=2)

    # ------------------------------------------------------------ basics
    def test_entry_buys_at_ask_and_exit_sells_at_bid(self):
        t = signal()
        n = self.enter(t)
        self.assertEqual(n["status"], "bought")
        self.assertEqual(n["price"], 100.2)
        self.q.bid, self.q.ask = 139.8, 140.2
        x = self.exit_signal(t)
        self.assertEqual(x["status"], "sold")
        self.assertEqual(x["price"], 139.8)
        expected = round((139.8 - 100.2) * 65 - option_charges("BUY", 65, 100.2) - option_charges("SELL", 65, 139.8), 2)
        self.assertAlmostEqual(x["net"], expected, places=2)
        self.assertBalanced()

    def test_sensex_and_late_signals_are_skipped(self):
        self.assertEqual(self.enter(signal(index="SENSEX"))["status"], "skipped")
        self.assertEqual(self.enter(signal(2, late=True))["status"], "skipped")
        self.assertEqual(self.a.st["open"], {})

    # ------------------------------------------------------- manual exit
    def test_manual_exit_sells_records_and_blocks_reentry(self):
        t = signal()
        self.enter(t)
        self.q.bid, self.q.ask = 90.0, 90.4
        r = self.cmd("EXIT", t["id"])
        self.assertEqual(r["status"], "done")
        self.assertEqual(r["price"], 90.0)
        self.assertNotIn(t["id"], self.a.st["open"])
        last = self.a.st["trades"][-1]
        self.assertTrue(last["manual"])
        self.assertEqual(last["reason"], "Manual exit (you)")
        # strategy's own entry later the same day is blocked (no immediate re-entry)
        n = self.enter(signal(3), NOW + timedelta(minutes=20))
        self.assertEqual(n["status"], "skipped")
        self.assertIn("Re-entry blocked", n["reason"])
        # ...but allowed again the next day
        self.assertEqual(self.enter(signal(4), NOW + timedelta(days=1))["status"], "bought")
        self.assertBalanced()

    def test_repeated_clicks_same_command_id_apply_once(self):
        t = signal()
        self.enter(t)
        r1 = self.cmd("EXIT", t["id"], cid="click-1")
        r2 = self.cmd("EXIT", t["id"], cid="click-1")
        self.assertEqual(r1, r2)
        self.assertEqual(len(self.a.st["trades"]), 1)

    def test_two_different_exit_commands_second_is_noop(self):
        t = signal()
        self.enter(t)
        self.assertEqual(self.cmd("EXIT", t["id"], cid="a")["status"], "done")
        r = self.cmd("EXIT", t["id"], cid="b")
        self.assertEqual(r["status"], "noop")
        self.assertIn("Already closed", r["message"])
        self.assertEqual(len(self.a.st["trades"]), 1)
        self.assertBalanced()

    def test_strategy_exit_after_manual_exit_does_not_sell_twice(self):
        t = signal()
        self.enter(t)
        self.cmd("EXIT", t["id"])
        cash = self.a.st["cash"]
        x = self.exit_signal(t, NOW + timedelta(minutes=5))
        self.assertEqual(x["status"], "manual")
        self.assertEqual(self.a.st["cash"], cash)
        self.assertEqual(len(self.a.st["trades"]), 1)

    def test_manual_exit_after_strategy_exit_is_noop(self):
        t = signal()
        self.enter(t)
        self.exit_signal(t)
        r = self.cmd("EXIT", t["id"])
        self.assertEqual(r["status"], "noop")
        self.assertEqual(len(self.a.st["trades"]), 1)

    def test_failed_exit_keeps_position_open_and_reports(self):
        t = signal()
        self.enter(t)
        self.q.down = True
        for i in range(AutoTrader.MAX_ATTEMPTS - 1):
            self.assertIsNone(self.cmd("EXIT", t["id"], cid="x"))  # retry later
            self.assertIn(t["id"], self.a.st["open"])
        r = self.cmd("EXIT", t["id"], cid="x")
        self.assertEqual(r["status"], "failed")
        self.assertIn(t["id"], self.a.st["open"])                 # never falsely closed
        self.q.down = False
        self.assertEqual(self.cmd("EXIT", t["id"], cid="y")["status"], "done")  # user can retry

    def test_manual_exit_never_uses_a_guessed_price(self):
        t = signal()
        self.enter(t)
        self.q.down = True
        self.assertIsNone(self.cmd("EXIT", t["id"]))
        self.assertEqual(len(self.a.st["trades"]), 0)

    # ------------------------------------------------- pause and resume
    def test_pause_stops_entries_but_keeps_positions_then_resume(self):
        t = signal()
        self.enter(t)
        self.assertEqual(self.cmd("PAUSE")["status"], "done")
        self.assertIn(t["id"], self.a.st["open"])                 # pause doesn't close anything
        n = self.enter(signal(2))
        self.assertEqual(n["status"], "skipped")
        self.assertIn("paused", n["reason"])
        self.assertEqual(self.exit_signal(t)["status"], "sold")    # strategy exits still work
        self.cmd("RESUME")
        self.assertEqual(self.enter(signal(3))["status"], "bought")

    def test_exit_all_pauses_and_closes_everything(self):
        self.enter(signal(1))
        self.enter(signal(2, side="PUT"))
        r = self.cmd("EXIT_ALL")
        self.assertEqual(r["status"], "done")
        self.assertTrue(self.a.st["paused"])
        self.assertEqual(self.a.st["open"], {})
        self.assertBalanced()

    def test_reentry_rule_allow(self):
        self.cmd("SET_REENTRY", value="allow")
        t = signal()
        self.enter(t)
        self.cmd("EXIT", t["id"])
        self.assertEqual(self.enter(signal(2))["status"], "bought")

    def test_allow_reentry_command_lifts_block(self):
        t = signal()
        self.enter(t)
        self.cmd("EXIT", t["id"])
        self.cmd("ALLOW_REENTRY")
        self.assertEqual(self.enter(signal(2))["status"], "bought")

    # ------------------------------------------------- persistence
    def test_state_survives_restart(self):
        t = signal()
        self.enter(t)
        self.cmd("EXIT", t["id"], cid="persist")
        self.a.save(NOW)
        b = self.make()
        self.assertIn("persist", b.st["processed"])
        self.assertEqual(b.st["blocks"], {"NIFTY": NOW.date().isoformat()})
        self.assertEqual(b.handle_command({"id": "persist", "type": "EXIT", "target": t["id"]}, NOW)["status"], "done")
        self.assertEqual(len(b.st["trades"]), 1)


class RunnerCommandTest(unittest.TestCase):
    """Commands flow through run_live.Runner.poll_commands (no network, no git)."""
    def test_runner_applies_each_command_once_and_saves(self):
        import run_live
        d = Path(tempfile.mkdtemp())
        try:
            cmds = []
            r = run_live.Runner(d, use_git=False, notify=False, control_source=lambda: cmds,
                                clock=lambda: NOW)
            r.auto.quote, r.auto.lots = Quotes(), (lambda s: 65)
            t = signal()
            r.auto.on_event({"type": "ENTRY", "trade": t}, NOW)
            cmds += [{"id": "u1", "type": "EXIT", "target": t["id"], "ts": "2026-10-28T10:06:00"},
                     {"id": "u1", "type": "EXIT", "target": t["id"], "ts": "2026-10-28T10:06:00"},  # duplicate update
                     {"id": "u2", "type": "PAUSE", "ts": "2026-10-28T10:06:05"}]
            self.assertEqual(r.poll_commands(), 2)
            self.assertEqual(r.poll_commands(), 0)                  # nothing new
            saved = json.loads((d / "autotrade.json").read_text())
            self.assertEqual(saved["processed"]["u1"]["status"], "done")
            self.assertTrue(saved["paused"])
            self.assertEqual(len(saved["trades"]), 1)
        finally:
            shutil.rmtree(d)


if __name__ == "__main__":
    unittest.main()
