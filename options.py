"""
Option premium for a signal.

NIFTY  -> live price from NSE's option chain (bid / ask / last traded price).
SENSEX -> BSE blocks automated access, so the premium is ESTIMATED with the
          Black-Scholes formula, using NIFTY's live at-the-money volatility
          (or India VIX as a fallback). It is clearly marked as an estimate.

Premium stop-loss and target are worked out by re-pricing the option at the
signal's index stop-loss and target levels, using the same volatility.
"""
import math
import time as _time
from datetime import date, datetime, time, timedelta

import requests

from data import HEADERS, now_ist

R = 0.065                     # risk-free rate used in pricing
NSE_HOME = "https://www.nseindia.com"
NSE_REF = {"Referer": "https://www.nseindia.com/option-chain"}
WEEKLY_EXPIRY_WEEKDAY = {"SENSEX": 3}   # Thursday (BSE); NIFTY comes from NSE


# ----------------------------------------------------------------- pricing
def _ncdf(x: float) -> float:
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def bs_price(spot: float, k: float, t: float, iv: float, side: str) -> float:
    if t <= 0 or iv <= 0:
        return max(0.0, spot - k) if side == "CALL" else max(0.0, k - spot)
    d1 = (math.log(spot / k) + (R + iv * iv / 2) * t) / (iv * math.sqrt(t))
    d2 = d1 - iv * math.sqrt(t)
    if side == "CALL":
        return spot * _ncdf(d1) - k * math.exp(-R * t) * _ncdf(d2)
    return k * math.exp(-R * t) * _ncdf(-d2) - spot * _ncdf(-d1)


def implied_vol(price: float, spot: float, k: float, t: float, side: str) -> float | None:
    lo, hi = 0.01, 3.0
    if price <= bs_price(spot, k, t, lo, side) or price >= bs_price(spot, k, t, hi, side):
        return None
    for _ in range(80):
        mid = (lo + hi) / 2
        if bs_price(spot, k, t, mid, side) > price:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2


def years_to(expiry: date, now: datetime) -> float:
    end = datetime.combine(expiry, time(15, 30))
    return max((end - now).total_seconds(), 60 * 30) / (365 * 24 * 3600)


def r05(x: float) -> float:
    return round(round(x * 20) / 20, 2)


# ------------------------------------------------------------ NSE (NIFTY)
class NSE:
    def __init__(self):
        self.s = None
        self.born = 0.0

    def _session(self):
        if self.s is None or _time.time() - self.born > 600:
            s = requests.Session()
            s.headers.update({**HEADERS, "Accept": "application/json, text/plain, */*",
                              "Accept-Language": "en-US,en;q=0.9"})
            s.get(NSE_HOME, timeout=15)
            s.get(NSE_HOME + "/option-chain", timeout=15)
            self.s, self.born = s, _time.time()
        return self.s

    def _get(self, path: str):
        for attempt in range(2):
            try:
                r = self._session().get(NSE_HOME + path, timeout=15, headers=NSE_REF)
                r.raise_for_status()
                return r.json()
            except Exception:  # noqa: BLE001
                self.s = None
                if attempt:
                    raise
        return None

    def chain(self, symbol: str, today: date):
        info = self._get(f"/api/option-chain-contract-info?symbol={symbol}")
        exps = [datetime.strptime(e, "%d-%b-%Y").date() for e in info["expiryDates"]]
        # nearest expiry; on expiry day itself use the next one (expiry-day options decay too fast)
        exp = next(e for e in sorted(exps) if e > today)
        js = self._get(f"/api/option-chain-v3?type=Indices&symbol={symbol}&expiry={exp:%d-%b-%Y}")
        return exp, js["records"]


_nse = NSE()


def _row(records, strike: int, side: str):
    key = "CE" if side == "CALL" else "PE"
    for row in records.get("data", []):
        if int(row.get("strikePrice", -1)) == strike and key in row:
            return row[key]
    return None


def _atm_iv(records, spot: float, exp: date, now: datetime) -> float | None:
    """Average implied vol of the at-the-money call and put."""
    rows = records.get("data", [])
    if not rows:
        return None
    atm = min(rows, key=lambda r: abs(r["strikePrice"] - spot))
    t = years_to(exp, now)
    ivs = []
    for key, side in (("CE", "CALL"), ("PE", "PUT")):
        q = atm.get(key) or {}
        px = _mid(q)
        if px:
            iv = implied_vol(px, spot, atm["strikePrice"], t, side)
            if iv:
                ivs.append(iv)
    return sum(ivs) / len(ivs) if ivs else None


def _mid(q: dict) -> float | None:
    b, a, l = q.get("buyPrice1") or 0, q.get("sellPrice1") or 0, q.get("lastPrice") or 0
    if b > 0 and a > 0 and a >= b and (a - b) <= max(2.0, 0.05 * a):
        return (a + b) / 2
    return l or None


def _vix() -> float | None:
    try:
        r = requests.get("https://query1.finance.yahoo.com/v8/finance/chart/%5EINDIAVIX",
                         params={"interval": "5m", "range": "1d"}, headers=HEADERS, timeout=15)
        return float(r.json()["chart"]["result"][0]["meta"]["regularMarketPrice"]) / 100
    except Exception:  # noqa: BLE001
        return None


def _next_weekday(today: date, wd: int) -> date:
    d = today + timedelta(days=1)
    while d.weekday() != wd:
        d += timedelta(days=1)
    return d


def _levels(spot, strike, t, iv, side, sl_spot, tgt_spot, entry_prem):
    """Premium stop/target by re-pricing at the index levels (anchored to the real premium)."""
    model_now = bs_price(spot, strike, t, iv, side)
    adj = entry_prem - model_now               # keep model in line with the market price
    p_sl = max(0.05, bs_price(sl_spot, strike, t, iv, side) + adj)
    p_tg = max(p_sl + 0.05, bs_price(tgt_spot, strike, t, iv, side) + adj)
    d1 = (math.log(spot / strike) + (R + iv * iv / 2) * t) / (iv * math.sqrt(t))
    delta = _ncdf(d1) if side == "CALL" else _ncdf(d1) - 1
    return r05(p_sl), r05(p_tg), round(delta, 2)


# ------------------------------------------------------------- public API
def entry_quote(index: str, strike: int, side: str, spot: float, sl_spot: float, tgt_spot: float,
                now: datetime | None = None) -> dict | None:
    """Premium details for a new signal. Never raises; returns None if nothing is available."""
    now = now or now_ist()
    try:
        if index == "NIFTY":
            exp, rec = _nse.chain("NIFTY", now.date())
            q = _row(rec, strike, side)
            if not q:
                return None
            under = float(rec.get("underlyingValue") or spot)
            t = years_to(exp, now)
            prem = _mid(q)
            iv = implied_vol(prem, under, strike, t, side) or (q.get("impliedVolatility") or 0) / 100
            if not prem or not iv:
                return None
            p_sl, p_tg, delta = _levels(under, strike, t, iv, side, sl_spot, tgt_spot, prem)
            ask = q.get("sellPrice1") or prem
            return {
                "source": "NSE live", "estimated": False, "expiry": exp.isoformat(),
                "price": r05(prem), "ltp": q.get("lastPrice"), "bid": q.get("buyPrice1"), "ask": ask,
                "buy_upto": r05(max(ask, prem) * 1.03), "sl": p_sl, "target": p_tg,
                "iv": round(iv * 100, 1), "delta": delta, "time": now.isoformat(timespec="seconds"),
                "spot_now": round(under, 2),
            }
        # SENSEX (or any index without a free live chain): estimate
        exp = _next_weekday(now.date(), WEEKLY_EXPIRY_WEEKDAY.get(index, 3))
        iv = None
        try:
            nexp, rec = _nse.chain("NIFTY", now.date())
            iv = _atm_iv(rec, float(rec.get("underlyingValue")), nexp, now)
        except Exception:  # noqa: BLE001
            pass
        iv = iv or _vix()
        if not iv:
            return None
        t = years_to(exp, now)
        prem = bs_price(spot, strike, t, iv, side)
        p_sl, p_tg, delta = _levels(spot, strike, t, iv, side, sl_spot, tgt_spot, prem)
        return {
            "source": "Estimated (BSE has no free live feed)", "estimated": True, "expiry": exp.isoformat(),
            "price": r05(prem), "buy_upto": r05(prem * 1.05), "sl": p_sl, "target": p_tg,
            "iv": round(iv * 100, 1), "delta": delta, "time": now.isoformat(timespec="seconds"),
        }
    except Exception as e:  # noqa: BLE001
        print(f"[premium unavailable] {index} {strike} {side}: {e}")
        return None


def current_premium(index: str, strike: int, side: str, expiry: str, spot: float, iv: float | None,
                    now: datetime | None = None) -> tuple[float, bool] | None:
    """Premium right now for an open trade: (price, estimated)."""
    now = now or now_ist()
    exp = date.fromisoformat(expiry)
    try:
        if index == "NIFTY":
            info_exp, rec = _nse.chain("NIFTY", exp - timedelta(days=1))
            if info_exp == exp:
                q = _row(rec, strike, side)
                if q and _mid(q):
                    return r05(_mid(q)), False
    except Exception as e:  # noqa: BLE001
        print(f"[premium unavailable] {e}")
    if iv:
        return r05(bs_price(spot, strike, years_to(exp, now), iv / 100, side)), True
    return None
