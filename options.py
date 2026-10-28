"""
Option premium for a signal.

NIFTY  -> live price from NSE's option chain (bid / ask / last traded price).
SENSEX -> BSE blocks automated access, so prices are ESTIMATED with the
          Black-Scholes formula. Each strike uses the live implied volatility of
          the NIFTY strike at the same moneyness (strike / spot), so the estimate
          follows the market's real volatility smile; India VIX is the fallback.
          Bid/ask are set 0.25% either side. Always marked as an estimate.

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


# ------------------------------------------- estimated (proxy) option prices
EST_HALF_SPREAD = 0.0025          # 0.25% either side of the model price


def smile_points(rows: list, spot: float, compact: bool = False) -> list[tuple[float, float]]:
    """(strike/spot, implied vol) from the out-of-the-money side of a NIFTY chain."""
    pts = []
    for r in rows:
        if compact:
            k, ce_iv, pe_iv = r[0], r[7], r[15]
        else:
            k = r.get("strikePrice")
            ce_iv = (r.get("CE") or {}).get("impliedVolatility")
            pe_iv = (r.get("PE") or {}).get("impliedVolatility")
        iv = ce_iv if k >= spot else pe_iv
        if k and iv and 1 < iv < 300:
            pts.append((k / spot, iv / 100))
    return sorted(pts)


def smile_iv(points: list[tuple[float, float]], m: float) -> float | None:
    if not points:
        return None
    if m <= points[0][0]:
        return points[0][1]
    if m >= points[-1][0]:
        return points[-1][1]
    for (m0, v0), (m1, v1) in zip(points, points[1:]):
        if m0 <= m <= m1:
            return v0 + (v1 - v0) * (m - m0) / ((m1 - m0) or 1)
    return points[-1][1]


def fit_smile(points: list[tuple[float, float]]):
    """Smooth volatility smile: least-squares quadratic in log-moneyness near the money,
    clamped to the observed range (removes the call/put jump at the money and noisy wings)."""
    import numpy as np
    if not points:
        return None
    near = [(math.log(m), v) for m, v in points if abs(math.log(m)) <= 0.06]
    use = near if len(near) >= 5 else [(math.log(m), v) for m, v in points]
    vs = [v for _, v in points]
    lo, hi = min(vs), max(vs)
    if len(use) < 3:
        mid = sorted(vs)[len(vs) // 2]
        return lambda m: mid
    xs, ys = np.array([x for x, _ in use]), np.array([y for _, y in use])
    a, b, c = np.polyfit(xs, ys, 2)
    x0, x1 = xs.min(), xs.max()

    def iv(m: float) -> float:
        x = min(max(math.log(m), x0), x1)
        return float(min(max(a * x * x + b * x + c, lo), hi))
    return iv


def no_arbitrage(rows: list) -> list:
    """Calls must not get dearer, puts must not get cheaper, as the strike rises (compact rows)."""
    for i in range(1, len(rows)):
        rows[i][1] = min(rows[i][1], rows[i - 1][1])
    for i in range(len(rows) - 2, -1, -1):
        rows[i][9] = min(rows[i][9], rows[i + 1][9])
    for r in rows:
        for o in (1, 9):
            half = max(0.05, r[o] * EST_HALF_SPREAD)
            r[o + 2], r[o + 3] = r05(max(0.05, r[o] - half)), r05(max(0.1, r[o] + half))
    return rows


def model_quote(spot: float, strike: float, expiry: date, side: str, iv: float, now: datetime) -> dict:
    px = bs_price(spot, strike, years_to(expiry, now), iv, side)
    half = max(0.05, px * EST_HALF_SPREAD)
    return {"ltp": r05(max(0.05, px)), "bid": r05(max(0.05, px - half)), "ask": r05(max(0.1, px + half)),
            "iv": round(iv * 100, 1), "estimated": True}


def sensex_expiries(today: date, n: int = 2, include_today: bool = True) -> list[date]:
    """SENSEX weekly options expire on Thursdays (holiday shifts are not modelled)."""
    out, d = [], today if include_today else today + timedelta(days=1)
    while len(out) < n:
        if d.weekday() == WEEKLY_EXPIRY_WEEKDAY["SENSEX"]:
            out.append(d)
        d += timedelta(days=1)
    return out


def _yahoo_price(symbol: str) -> float | None:
    try:
        r = requests.get("https://query1.finance.yahoo.com/v8/finance/chart/" + requests.utils.quote(symbol),
                         params={"interval": "1m", "range": "1d"}, headers=HEADERS, timeout=15)
        return float(r.json()["chart"]["result"][0]["meta"]["regularMarketPrice"])
    except Exception:  # noqa: BLE001
        return None


def estimated_quote(index: str, strike: int, side: str, expiry: str, now: datetime | None = None,
                    spot: float | None = None) -> dict | None:
    """Model bid/ask/ltp for an option without a free live feed (SENSEX), using NIFTY's live smile."""
    now = now or now_ist()
    spot = spot or _yahoo_price("^BSESN")
    if not spot:
        return None
    iv = None
    try:
        _, rec = _nse.chain("NIFTY", now.date())          # nearest expiry after today (never expiry-day)
        n_spot = float(rec.get("underlyingValue"))
        sm = fit_smile(smile_points(rec.get("data", []), n_spot))
        iv = sm(strike / spot) if sm else None
    except Exception as e:  # noqa: BLE001
        print(f"[estimate] NIFTY smile unavailable: {e}")
    iv = iv or _vix()
    if not iv:
        return None
    q = model_quote(spot, strike, date.fromisoformat(expiry), side, iv, now)
    q["spot"] = round(spot, 2)
    return q


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
        # SENSEX (or any index without a free live chain): estimate from NIFTY's live smile
        exp = _next_weekday(now.date(), WEEKLY_EXPIRY_WEEKDAY.get(index, 3))
        q = estimated_quote(index, strike, side, exp.isoformat(), now, spot)
        if not q:
            return None
        iv, t, prem = q["iv"] / 100, years_to(exp, now), q["ltp"]
        p_sl, p_tg, delta = _levels(spot, strike, t, iv, side, sl_spot, tgt_spot, prem)
        return {
            "source": "Estimated from NIFTY's live volatility (BSE has no free live feed)", "estimated": True,
            "expiry": exp.isoformat(), "price": prem, "bid": q["bid"], "ask": q["ask"],
            "buy_upto": r05(q["ask"] * 1.03), "sl": p_sl, "target": p_tg,
            "iv": q["iv"], "delta": delta, "time": now.isoformat(timespec="seconds"),
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
    if index == "SENSEX":
        q = estimated_quote(index, strike, side, expiry, now, spot)
        if q:
            return q["ltp"], True
    if iv:
        return r05(bs_price(spot, strike, years_to(exp, now), iv / 100, side)), True
    return None


def live_quote(index: str, strike: int, side: str, expiry: str) -> dict | None:
    """Live bid / ask / last price for one option (None when unavailable).
    SENSEX returns an estimate (with "estimated": True)."""
    if index == "SENSEX":
        return estimated_quote(index, strike, side, expiry)
    exp = date.fromisoformat(expiry)
    got_exp, rec = _nse.chain(index, exp - timedelta(days=1))
    if got_exp != exp:
        return None
    q = _row(rec, strike, side)
    if not q:
        return None
    return {"bid": q.get("buyPrice1") or 0, "ask": q.get("sellPrice1") or 0, "ltp": q.get("lastPrice") or 0}


_LOTS = {"date": None, "lots": {}}
_LOT_FALLBACK = {"NIFTY": 65, "BANKNIFTY": 30, "FINNIFTY": 60, "MIDCPNIFTY": 120, "SENSEX": 20}


def lot_size(symbol: str) -> int:
    """Current F&O lot size from NSE's official lot-size file (cached for the day)."""
    today = now_ist().date().isoformat()
    if _LOTS["date"] != today:
        try:
            txt = _nse._session().get("https://nsearchives.nseindia.com/content/fo/fo_mktlots.csv", timeout=20).text
            lots = {}
            for line in txt.splitlines()[1:]:
                cols = [c.strip() for c in line.split(",")]
                if len(cols) > 2 and cols[1]:
                    v = next((int(float(c)) for c in cols[2:] if c.replace(".", "", 1).isdigit()), None)
                    if v:
                        lots[cols[1]] = v
            if lots:
                _LOTS.update(date=today, lots=lots)
        except Exception as e:  # noqa: BLE001
            print(f"[lot size] {e}")
    return _LOTS["lots"].get(symbol) or _LOT_FALLBACK.get(symbol, 1)
