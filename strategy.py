"""
Signal rules. A CALL (or PUT) signal fires only when ALL conditions line up on a
closed 5-minute candle, and they were NOT all true on the previous candle
(so you get the signal at the moment it forms, not late).

CALL needs:                              PUT needs (mirror):
  1. Close above opening-range high        Close below opening-range low
  2. EMA 9 above EMA 21                    EMA 9 below EMA 21
  3. Supertrend bullish                    Supertrend bearish
  4. RSI between 55 and 75                 RSI between 25 and 45
  5. ADX >= 20 (market is trending)        same
  6. 15-min trend up                       15-min trend down
  7. Strong bullish candle                 Strong bearish candle
  8. Not overextended from EMA 21          same
"""
from datetime import datetime, time, timedelta

import numpy as np
import pandas as pd

from indicators import adx, atr, ema, rsi, supertrend

BAR = timedelta(minutes=5)


def _t(s: str) -> time:
    h, m = map(int, s.split(":"))
    return time(h, m)


def prepare(df: pd.DataFrame, s: dict) -> pd.DataFrame:
    d = df.copy()
    d.index.name = "ts"
    d["ema_f"] = ema(d["close"], s["ema_fast"])
    d["ema_s"] = ema(d["close"], s["ema_slow"])
    d["rsi"] = rsi(d["close"], s["rsi_period"])
    d["atr"] = atr(d, s["atr_period"])
    d["st"], d["st_dir"] = supertrend(d, s["supertrend_period"], s["supertrend_mult"])
    d["adx"] = adx(d, s["adx_period"])

    # 15-minute trend, using only 15-min candles that have fully closed
    h15 = (
        d[["open", "high", "low", "close"]]
        .resample("15min")
        .agg({"open": "first", "high": "max", "low": "min", "close": "last"})
        .dropna()
    )
    h15["ema15"] = ema(h15["close"], s["htf_ema"])
    h15["ema15_rising"] = (h15["ema15"].diff() > 0).astype(float)
    h15["end"] = h15.index + timedelta(minutes=15)
    left = pd.DataFrame({"ts": d.index, "end": d.index + BAR})
    m = pd.merge_asof(
        left.sort_values("end"),
        h15[["end", "ema15", "ema15_rising"]].sort_values("end"),
        on="end",
        direction="backward",
    ).set_index("ts")
    d["ema15"] = m["ema15"].reindex(d.index)
    d["ema15_rising"] = m["ema15_rising"].reindex(d.index)

    # opening range (first N minutes of each day)
    d["date"] = d.index.date
    tod = d.index - d.index.normalize()
    in_or = tod < timedelta(hours=9, minutes=15 + s["opening_range_minutes"])
    orh = d[in_or].groupby("date")["high"].max()
    orl = d[in_or].groupby("date")["low"].min()
    d["orh"] = d["date"].map(orh)
    d["orl"] = d["date"].map(orl)
    d.loc[in_or, ["orh", "orl"]] = np.nan
    return d


def checklist(r, side: str, s: dict) -> list[tuple[str, bool]]:
    rng = r.high - r.low
    pos = (r.close - r.low) / rng if rng > 0 else 0.5
    ratio = s["strong_close_ratio"]
    ext = s["max_extension_atr"] * r.atr
    rising = r.ema15_rising == 1.0
    falling = r.ema15_rising == 0.0
    if side == "CALL":
        return [
            ("Breakout above opening range", bool(r.close > r.orh)),
            (f"EMA {s['ema_fast']} above EMA {s['ema_slow']}", bool(r.ema_f > r.ema_s)),
            ("Supertrend bullish", bool(r.st_dir == 1)),
            (f"RSI {s['rsi_call_min']}–{s['rsi_call_max']}", bool(s["rsi_call_min"] <= r.rsi <= s["rsi_call_max"])),
            (f"ADX ≥ {s['adx_min']} (trending)", bool(r.adx >= s["adx_min"])),
            ("15-min trend up", bool(r.close > r.ema15 and rising)),
            ("Strong bullish candle", bool(r.close > r.open and pos >= ratio)),
            ("Not overextended", bool(0 <= r.close - r.ema_s <= ext)),
        ]
    return [
        ("Breakdown below opening range", bool(r.close < r.orl)),
        (f"EMA {s['ema_fast']} below EMA {s['ema_slow']}", bool(r.ema_f < r.ema_s)),
        ("Supertrend bearish", bool(r.st_dir == -1)),
        (f"RSI {s['rsi_put_min']}–{s['rsi_put_max']}", bool(s["rsi_put_min"] <= r.rsi <= s["rsi_put_max"])),
        (f"ADX ≥ {s['adx_min']} (trending)", bool(r.adx >= s["adx_min"])),
        ("15-min trend down", bool(r.close < r.ema15 and falling)),
        ("Strong bearish candle", bool(r.close < r.open and (1 - pos) >= ratio)),
        ("Not overextended", bool(0 <= r.ema_s - r.close <= ext)),
    ]


def all_ok(r, side, s) -> bool:
    return all(ok for _, ok in checklist(r, side, s))


class IndexEngine:
    """Keeps one index's trade state and turns closed candles into events."""

    def __init__(self, name: str, step: int, s: dict, state: dict | None = None):
        self.name, self.step, self.s = name, step, s
        self.state = state or {
            "date": None,
            "trades_today": 0,
            "last_loss_end": None,
            "open": None,
            "last_bar": None,
        }

    # ------------------------------------------------------------------ core
    def on_bar(self, ts: datetime, r, prev, allow_entry: bool = True) -> list[dict]:
        st, s = self.state, self.s
        events: list[dict] = []
        day = ts.date().isoformat()
        bar_end = ts + BAR
        if st["date"] != day:
            if st["open"]:  # should not happen (we square off), but be safe
                events.append(self._close(st["open"], bar_end, r.open, "CARRY_OVER", "Closed at next day's open"))
            st.update(date=day, trades_today=0, last_loss_end=None)
        st["last_bar"] = ts.isoformat()

        exited = False
        if st["open"]:
            ev = self._manage(st["open"], bar_end, r)
            if ev:
                events.append(ev)
                exited = ev["type"] == "EXIT"

        if not st["open"] and not exited and allow_entry and self._can_enter(bar_end):
            for side in ("CALL", "PUT"):
                if all_ok(r, side, s) and (prev is None or not all_ok(prev, side, s)):
                    events.append(self._enter(side, bar_end, r))
                    break
        return events

    # --------------------------------------------------------------- helpers
    def _can_enter(self, bar_end: datetime) -> bool:
        st, s = self.state, self.s
        t = bar_end.time()
        if not (_t(s["first_entry"]) <= t <= _t(s["last_entry"])):
            return False
        if st["trades_today"] >= s["max_trades_per_index"]:
            return False
        if st["last_loss_end"]:
            wait = datetime.fromisoformat(st["last_loss_end"]) + timedelta(minutes=s["cooldown_after_loss_min"])
            if bar_end < wait:
                return False
        return True

    def _enter(self, side: str, bar_end: datetime, r) -> dict:
        s = self.s
        d = 1 if side == "CALL" else -1
        a = float(r.atr)
        risk = abs(float(r.close) - float(r.st))
        risk = min(max(risk, s["risk_min_atr"] * a), s["risk_max_atr"] * a)
        entry = float(r.close)
        strike = int(round(entry / self.step) * self.step)
        tr = {
            "id": f"{self.name}-{bar_end:%Y%m%d-%H%M}-{side}",
            "index": self.name,
            "side": side,
            "option": f"{self.name} {strike} {'CE' if side == 'CALL' else 'PE'}",
            "strike": strike,
            "entry_time": bar_end.isoformat(),
            "entry": round(entry, 2),
            "risk": round(risk, 2),
            "sl": round(entry - d * risk, 2),
            "initial_sl": round(entry - d * risk, 2),
            "target": round(entry + d * s["reward_risk"] * risk, 2),
            "breakeven": False,
            "status": "OPEN",
            # the signal is only worth acting on for a short window, and only if price hasn't run away
            "valid_until": (bar_end + timedelta(minutes=s.get("entry_valid_min", 10))).isoformat(),
            "chase_limit": round(entry + d * s.get("max_chase_r", 0.3) * risk, 2),
            "reasons": [name for name, _ in checklist(r, side, s)],
            "indicators": {
                "rsi": round(float(r.rsi), 1),
                "adx": round(float(r.adx), 1),
                "ema_fast": round(float(r.ema_f), 2),
                "ema_slow": round(float(r.ema_s), 2),
                "supertrend": round(float(r.st), 2),
            },
        }
        self.state["open"] = tr
        self.state["trades_today"] += 1
        return {"type": "ENTRY", "trade": dict(tr)}

    def _manage(self, tr: dict, bar_end: datetime, r) -> dict | None:
        s = self.s
        d = 1 if tr["side"] == "CALL" else -1
        sl, tgt, entry = tr["sl"], tr["target"], tr["entry"]
        if d == 1:
            hit_sl, hit_tg = r.low <= sl, r.high >= tgt
            sl_px = min(sl, r.open)
        else:
            hit_sl, hit_tg = r.high >= sl, r.low <= tgt
            sl_px = max(sl, r.open)
        if hit_sl:  # if both happen in one candle we assume the worse case
            if tr["breakeven"]:
                return self._close(tr, bar_end, sl_px, "BREAKEVEN", "Index back at entry (stop had moved to cost)")
            return self._close(tr, bar_end, sl_px, "STOPLOSS", "Stop-loss hit")
        if hit_tg:
            return self._close(tr, bar_end, tgt, "TARGET", "Target hit")
        if int(r.st_dir) != d:
            return self._close(tr, bar_end, float(r.close), "REVERSAL", "Supertrend flipped against the trade")
        if bar_end.time() >= _t(s["square_off"]):
            return self._close(tr, bar_end, float(r.close), "TIME_EXIT", "Square-off time")
        fav = (r.high - entry) if d == 1 else (entry - r.low)
        if not tr["breakeven"] and fav >= s["breakeven_at_r"] * tr["risk"]:
            tr["sl"] = entry
            tr["breakeven"] = True
            return {"type": "UPDATE", "trade": dict(tr), "time": bar_end.isoformat(),
                    "message": f"Move stop-loss to cost ({entry})"}
        return None

    def _close(self, tr: dict, bar_end: datetime, px: float, outcome: str, note: str) -> dict:
        d = 1 if tr["side"] == "CALL" else -1
        pts = round(d * (float(px) - tr["entry"]), 2)
        tr.update(
            status="CLOSED",
            exit_time=bar_end.isoformat(),
            exit=round(float(px), 2),
            outcome=outcome,
            note=note,
            points=pts,
            r_multiple=round(pts / tr["risk"], 2) if tr["risk"] else 0.0,
        )
        if pts < 0:
            self.state["last_loss_end"] = bar_end.isoformat()
        self.state["open"] = None
        return {"type": "EXIT", "trade": dict(tr)}


def snapshot(name: str, d: pd.DataFrame, s: dict, prev_close: float | None) -> dict:
    """Live picture of one index for the dashboard."""
    r = d.iloc[-1]
    ts = d.index[-1]

    def num(x, nd=2):
        return None if pd.isna(x) else round(float(x), nd)

    out = {
        "name": name,
        "price": num(r.close),
        "prev_close": num(prev_close) if prev_close else None,
        "change_pct": num((r.close / prev_close - 1) * 100) if prev_close else None,
        "bar_time": (ts + BAR).isoformat(),
        "indicators": {
            "rsi": num(r.rsi, 1), "adx": num(r.adx, 1),
            "ema_fast": num(r.ema_f), "ema_slow": num(r.ema_s),
            "supertrend": num(r.st), "supertrend_dir": int(r.st_dir),
            "orh": num(r.orh), "orl": num(r.orl), "ema15": num(r.ema15),
        },
    }
    for side in ("CALL", "PUT"):
        cl = checklist(r, side, s)
        out[side.lower()] = {"checks": [{"name": n, "ok": ok} for n, ok in cl],
                             "score": sum(ok for _, ok in cl), "total": len(cl)}
    return out
