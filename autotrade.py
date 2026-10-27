"""
Auto-trader: paper-trades every Signal Desk signal in a virtual account.

* ENTRY  -> buys the signal's option (ATM, nearest expiry) at the live NSE ask
* EXIT   -> sells at the live NSE bid (target, stop-loss, trend flip or 3:15 PM)
* Skips a signal when there is no live option price (e.g. SENSEX, whose BSE
  prices are only estimates), when price already ran past the don't-chase
  level, or when there isn't enough virtual cash.

The account is saved as autotrade.json on the signals-data branch, so it keeps
going day after day without any browser being open.

Manual control (from the app, through the `control` branch):
  EXIT          sell one open auto position now (at the live bid)
  EXIT_ALL      pause new entries and sell every open auto position
  PAUSE         stop new automated entries (open positions are left alone)
  RESUME        allow automated entries again
  ALLOW_REENTRY lift today's re-entry block after a manual exit
  SET_REENTRY   value "block_today" (default) or "allow"
Every command has a unique id and is applied at most once; its result is kept in
`processed` so the app can show the authoritative outcome.
"""
import json
from datetime import date, datetime
from pathlib import Path

from options import live_quote, lot_size


def option_charges(side: str, qty: int, price: float) -> float:
    """Approximate charges for one option order (2026 rates)."""
    val = qty * price
    brokerage = 20.0
    stt = val * 0.0015 if side == "SELL" else 0.0
    txn = val * 0.0003503
    stamp = val * 0.00003 if side == "BUY" else 0.0
    sebi = val * 0.000001
    gst = 0.18 * (brokerage + txn + sebi)
    return round(brokerage + stt + txn + stamp + sebi + gst, 2)


def _sane(b, a):
    return b and a and a >= b and (a - b) <= max(2.0, 0.06 * a)


def _key(t: dict, expiry: str) -> str:
    return f"OPT:{t['index']}:{expiry}:{t['strike']}:{'CE' if t['side'] == 'CALL' else 'PE'}"


class AutoTrader:
    def __init__(self, path: Path, cfg: dict, quote=live_quote, lots=lot_size):
        self.path, self.cfg = path, cfg
        self.quote, self.lots = quote, lots
        try:
            self.st = json.loads(path.read_text())
        except Exception:  # noqa: BLE001
            cash = float(cfg.get("start_cash", 1000000))
            self.st = {"start_cash": cash, "cash": cash, "open": {}, "trades": [], "skipped": [], "started": None}
        for k, v in (("paused", False), ("blocks", {}), ("processed", {}), ("attempts", {}),
                     ("manual_exits", {}), ("reentry_rule", cfg.get("reentry_after_manual_exit", "block_today"))):
            self.st.setdefault(k, v)

    # ----------------------------------------------------------------- events
    def on_event(self, ev: dict, now: datetime) -> dict | None:
        if not self.cfg.get("enabled", True):
            return None
        t = ev["trade"]
        self.st["started"] = self.st.get("started") or now.date().isoformat()
        if ev["type"] == "ENTRY":
            return self._enter(t, now)
        if ev["type"] == "EXIT" and t["id"] in self.st["open"]:
            return self._exit(t, now)
        if ev["type"] == "EXIT" and t["id"] in self.st["manual_exits"]:
            m = self.st["manual_exits"][t["id"]]
            return {"status": "manual", "price": m["price"], "net": m["net"], "time": m["time"]}
        return None

    def _skip(self, t: dict, now: datetime, reason: str) -> dict:
        self.st["skipped"].append({"id": t["id"], "time": now.isoformat(timespec="seconds"),
                                   "option": t["option"], "reason": reason})
        self.st["skipped"] = self.st["skipped"][-100:]
        return {"status": "skipped", "reason": reason}

    def _enter(self, t: dict, now: datetime) -> dict:
        if t["index"] not in self.cfg.get("indices", ["NIFTY"]):
            return self._skip(t, now, f"{t['index']} has no live option prices (estimates only), so it isn't auto-traded")
        p = t.get("premium") or {}
        if not p or p.get("estimated") or not p.get("expiry"):
            return self._skip(t, now, "No live option price at signal time")
        if t.get("late"):
            return self._skip(t, now, "Price had already run past the don't-chase level")
        if self.st.get("paused"):
            return self._skip(t, now, "Auto-trading is paused (by you)")
        if self.st["blocks"].get(t["index"]) == now.date().isoformat():
            return self._skip(t, now, f"Re-entry blocked: you exited a {t['index']} auto-trade manually today")
        q = None
        try:
            q = self.quote(t["index"], t["strike"], t["side"], p["expiry"])
        except Exception as e:  # noqa: BLE001
            print(f"[auto] quote error {e}")
        if q:
            px = q["ask"] if _sane(q.get("bid"), q.get("ask")) else q.get("ltp")
        else:
            px = p.get("ask") if _sane(p.get("bid"), p.get("ask")) else p.get("price")
        if not px:
            return self._skip(t, now, "No live option price at signal time")
        lot = self.lots(t["index"])
        qty = lot * int(self.cfg.get("lots", 1))
        cost = qty * px
        ch = option_charges("BUY", qty, px)
        if cost + ch > self.st["cash"]:
            return self._skip(t, now, f"Not enough virtual cash (needed ₹{cost + ch:,.0f})")
        self.st["cash"] = round(self.st["cash"] - cost - ch, 2)
        pos = {"id": t["id"], "key": _key(t, p["expiry"]), "option": t["option"], "expiry": p["expiry"],
               "index": t["index"], "side": t["side"], "strike": t["strike"], "qty": qty, "lot": lot,
               "buy_price": round(px, 2), "buy_time": now.isoformat(timespec="seconds"), "buy_charges": ch,
               "spot_entry": t["entry"], "sl": p.get("sl"), "target": p.get("target")}
        self.st["open"][t["id"]] = pos
        print(f"[auto] BUY {qty} {t['option']} @ {px}")
        return {"status": "bought", "qty": qty, "price": round(px, 2), "charges": ch,
                "time": pos["buy_time"], "cash_after": self.st["cash"]}

    def _exit(self, t: dict, now: datetime) -> dict:
        pos = self.st["open"][t["id"]]
        return self._sell(pos, now, t.get("note"), t.get("outcome"), t)

    def _sell(self, pos: dict, now: datetime, reason: str, outcome: str, t: dict | None = None,
              manual: bool = False) -> dict | None:
        """Sell an open auto position. Manual exits need a live price (returns None to retry)."""
        t = t or {}
        px = None
        try:
            q = self.quote(pos["index"], pos["strike"], pos["side"], pos["expiry"])
            if q:
                px = q["bid"] if _sane(q.get("bid"), q.get("ask")) else q.get("ltp")
        except Exception as e:  # noqa: BLE001
            print(f"[auto] quote error {e}")
        source = "live bid"
        if px is None and manual:
            return None  # never close a manual exit on a guessed price; caller retries
        if px is None:
            px = (t.get("premium") or {}).get("exit_price")
            source = "signal exit price"
        if px is None:  # last resort: intrinsic value at the index exit level
            s = float(t.get("exit") or t.get("entry") or pos["spot_entry"])
            px = max(0.05, s - pos["strike"] if pos["side"] == "CALL" else pos["strike"] - s)
            source = "intrinsic value"
        ch = option_charges("SELL", pos["qty"], px)
        self.st["cash"] = round(self.st["cash"] + pos["qty"] * px - ch, 2)
        gross = (px - pos["buy_price"]) * pos["qty"]
        net = round(gross - pos["buy_charges"] - ch, 2)
        rec = {**pos, "sell_price": round(px, 2), "sell_time": now.isoformat(timespec="seconds"),
               "sell_charges": ch, "gross": round(gross, 2), "net": net, "reason": reason,
               "outcome": outcome, "price_source": source, "manual": manual}
        self.st["trades"].append(rec)
        self.st["trades"] = self.st["trades"][-1000:]
        del self.st["open"][pos["id"]]
        print(f"[auto] SELL {pos['qty']} {pos['option']} @ {px} net {net}")
        return {"status": "sold", "qty": pos["qty"], "price": round(px, 2), "buy_price": pos["buy_price"],
                "net": net, "charges": round(pos["buy_charges"] + ch, 2), "time": rec["sell_time"],
                "cash_after": self.st["cash"]}

    # --------------------------------------------------------------- commands
    MAX_ATTEMPTS = 12  # ~2 minutes of 10-second polls without a live price -> report failure

    def handle_command(self, cmd: dict, now: datetime) -> dict | None:
        """Apply one command from the app. Returns the result, or None to retry later."""
        cid = cmd.get("id")
        if not cid:
            return {"status": "failed", "message": "Command without id ignored"}
        if cid in self.st["processed"]:
            return self.st["processed"][cid]          # idempotent: never apply twice
        kind = cmd.get("type")
        res = None
        if kind == "PAUSE":
            self.st["paused"], self.st["paused_at"] = True, now.isoformat(timespec="seconds")
            res = {"status": "done", "message": "Auto-trading paused. Open positions are unchanged."}
        elif kind == "RESUME":
            self.st["paused"] = False
            res = {"status": "done", "message": "Auto-trading resumed for new signals."}
        elif kind == "ALLOW_REENTRY":
            self.st["blocks"] = {}
            res = {"status": "done", "message": "Re-entry allowed again today."}
        elif kind == "SET_REENTRY":
            v = cmd.get("value") if cmd.get("value") in ("block_today", "allow") else "block_today"
            self.st["reentry_rule"] = v
            res = {"status": "done", "message": f"After a manual exit: {'no new auto-trades that day' if v == 'block_today' else 'auto-trading continues'}."}
        elif kind == "EXIT":
            res = self._manual_exit(cmd.get("target"), now, cid)
        elif kind == "EXIT_ALL":
            self.st["paused"], self.st["paused_at"] = True, now.isoformat(timespec="seconds")
            results = [self._manual_exit(pid, now, cid) for pid in list(self.st["open"])]
            if any(r is None for r in results):
                res = None if self.st["attempts"].get(cid, 0) < self.MAX_ATTEMPTS else {
                    "status": "partial", "message": "Paused. Some positions could not be sold (no live price); they are still open."}
            else:
                n = sum(1 for r in results if r and r["status"] == "done")
                res = {"status": "done", "message": f"Paused and exited {n} position(s)."}
        else:
            res = {"status": "failed", "message": f"Unknown command {kind}"}
        if res is None:
            self.st["attempts"][cid] = self.st["attempts"].get(cid, 0) + 1
            if self.st["attempts"][cid] >= self.MAX_ATTEMPTS:
                res = {"status": "failed", "message": "No live option price for 2 minutes, so nothing was sold. The position is still open – try again."}
            else:
                return None
        res = {**res, "type": kind, "target": cmd.get("target"), "time": now.isoformat(timespec="seconds")}
        self.st["processed"][cid] = res
        self.st["attempts"].pop(cid, None)
        if len(self.st["processed"]) > 500:
            for k in list(self.st["processed"])[:-500]:
                del self.st["processed"][k]
        return res

    def _manual_exit(self, pid: str, now: datetime, cid: str) -> dict | None:
        pos = self.st["open"].get(pid)
        if not pos:
            done = next((x for x in reversed(self.st["trades"]) if x["id"] == pid), None)
            if done:
                return {"status": "noop", "message": f"Already closed at ₹{done['sell_price']} ({done.get('reason')}) at {done['sell_time'][11:16]}."}
            return {"status": "noop", "message": "No open auto position with that id."}
        out = self._sell(pos, now, "Manual exit (you)", "MANUAL", manual=True)
        if out is None:
            return None
        self.st["manual_exits"][pid] = {"price": out["price"], "net": out["net"], "time": out["time"], "cmd": cid}
        if self.st.get("reentry_rule", "block_today") == "block_today":
            self.st["blocks"][pos["index"]] = now.date().isoformat()
        return {"status": "done", "message": f"Sold {out['qty']} {pos['option']} at ₹{out['price']:.2f} (paper). Net {'+' if out['net'] >= 0 else '−'}₹{abs(out['net']):,.2f}.",
                "price": out["price"], "net": out["net"], "option": pos["option"]}

    # ---------------------------------------------------------------- summary
    def summary(self, day: str | None = None) -> dict:
        tr = [x for x in self.st["trades"] if not day or x["sell_time"].startswith(day)]
        net = round(sum(x["net"] for x in tr), 2)
        wins = sum(1 for x in tr if x["net"] > 0)
        open_cost = sum(p["qty"] * p["buy_price"] for p in self.st["open"].values())
        return {"trades": len(tr), "wins": wins, "net": net, "cash": self.st["cash"],
                "value": round(self.st["cash"] + open_cost, 2), "start_cash": self.st["start_cash"]}

    def save(self, now: datetime):
        self.st["updated"] = now.isoformat(timespec="seconds")
        self.st["summary"] = self.summary()
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.st, indent=1, default=str))
        tmp.replace(self.path)
