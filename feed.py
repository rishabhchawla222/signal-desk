"""
Market feed for the paper-trading app.

Every minute during market hours it saves a snapshot of
  quotes.json    – all F&O stocks (price, day range, 52-week range, volume), indices, futures
  chains.json    – option chains (NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY + popular stocks)
  intraday.json  – today's 5-minute price line for every stock and index
and once a day
  history/<SYMBOL>.json – one year of daily closes (for charts)
  universe.json  – symbols, company names and lot sizes

Everything is published to the `market-data` branch as a single commit that is
replaced every minute (so the repository never grows).

Sources: NSE website (indices, futures, option chains, lot sizes, market status)
and Yahoo Finance (stock prices). Prices can lag 1–2 minutes.
"""
import argparse
import json
import os
import subprocess
import threading
import time as _time
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import quote

import requests

from data import HEADERS, now_ist
from options import fit_smile, model_quote, no_arbitrage, sensex_expiries, smile_points

ROOT = Path(__file__).parent
CFG = json.loads((ROOT / "feed_config.json").read_text())
NSE = "https://www.nseindia.com"
SPARK = "https://query2.finance.yahoo.com/v7/finance/spark"
CHART = "https://query1.finance.yahoo.com/v8/finance/chart/"
END = (15, 40)
MAX_RUNTIME = timedelta(hours=5, minutes=45)

# indices shown in the app: key -> (NSE allIndices name, Yahoo symbol, lot-file symbol)
INDICES = {
    "NIFTY": ("NIFTY 50", "^NSEI"),
    "BANKNIFTY": ("NIFTY BANK", "^NSEBANK"),
    "FINNIFTY": ("NIFTY FINANCIAL SERVICES", "NIFTY_FIN_SERVICE.NS"),
    "MIDCPNIFTY": ("NIFTY MID SELECT", "NIFTY_MID_SELECT.NS"),
    "SENSEX": (None, "^BSESN"),
    "INDIAVIX": ("INDIA VIX", "^INDIAVIX"),
}
INDEX_NAMES = {"NIFTY": "Nifty 50", "BANKNIFTY": "Nifty Bank", "FINNIFTY": "Nifty Financial Services",
               "MIDCPNIFTY": "Nifty Midcap Select", "SENSEX": "BSE Sensex", "INDIAVIX": "India VIX"}


def log(*a):
    print(f"[{now_ist():%H:%M:%S}]", *a, flush=True)


# --------------------------------------------------------------------- NSE
class Nse:
    def __init__(self):
        self.s, self.born = None, 0.0

    def session(self):
        if self.s is None or _time.time() - self.born > 600:
            s = requests.Session()
            s.headers.update({**HEADERS, "Accept": "application/json, text/plain, */*",
                              "Accept-Language": "en-US,en;q=0.9"})
            s.get(NSE, timeout=15)
            s.get(NSE + "/option-chain", timeout=15)
            self.s, self.born = s, _time.time()
        return self.s

    def get(self, path: str, text=False):
        last = None
        for attempt in range(2):
            try:
                r = self.session().get(path if path.startswith("http") else NSE + path, timeout=20,
                                       headers={"Referer": NSE + "/option-chain"})
                r.raise_for_status()
                return r.text if text else r.json()
            except Exception as e:  # noqa: BLE001
                last = e
                self.s = None
        raise RuntimeError(f"NSE {path}: {last}")


nse = Nse()


def num(x, nd=2):
    try:
        v = float(x)
        return round(v, nd) if v == v else None
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------- universe
def load_universe() -> dict:
    """F&O stocks and their lot sizes from NSE's official lot-size file."""
    txt = nse.get("https://nsearchives.nseindia.com/content/fo/fo_mktlots.csv", text=True)
    stocks, lots = {}, {}
    for line in txt.splitlines()[1:]:
        cols = [c.strip() for c in line.split(",")]
        if len(cols) < 3 or not cols[1]:
            continue
        name, sym = cols[0], cols[1]
        lot = next((int(float(c)) for c in cols[2:] if c.replace(".", "", 1).isdigit()), None)
        if not lot:
            continue
        lots[sym] = lot
        if not name.upper().startswith("NIFTY"):
            stocks[sym] = {"name": name.title(), "lot": lot}
    return {"stocks": stocks, "lots": lots}


# ------------------------------------------------------------------ Yahoo
def ysym(sym: str) -> str:
    return sym + ".NS"


def spark(symbols: list[str]) -> dict:
    out = {}
    for i in range(0, len(symbols), 20):
        chunk = symbols[i:i + 20]
        try:
            r = requests.get(SPARK, params={"symbols": ",".join(chunk), "range": "1d", "interval": "5m"},
                             headers=HEADERS, timeout=20)
            r.raise_for_status()
            for res in r.json().get("spark", {}).get("result", []) or []:
                resp = (res.get("response") or [None])[0]
                if resp:
                    q = (resp.get("indicators", {}).get("quote") or [{}])[0]
                    out[res["symbol"]] = {"meta": resp.get("meta", {}), "t": resp.get("timestamp") or [],
                                          "c": q.get("close") or []}
        except Exception as e:  # noqa: BLE001
            log("spark error", chunk[0], e)
    return out


def intraday_series(sp: dict, today: date) -> list:
    """[[minutes since 9:15], [close]] for today's 5-minute candles."""
    mins, closes = [], []
    for t, c in zip(sp["t"], sp["c"]):
        if c is None:
            continue
        dt = datetime.utcfromtimestamp(t) + timedelta(hours=5, minutes=30)
        if dt.date() != today:
            continue
        m = (dt.hour * 60 + dt.minute) - (9 * 60 + 15)
        if 0 <= m <= 380:
            mins.append(m)
            closes.append(round(c, 2))
    return [mins, closes]


def daily_history(yahoo_symbol: str) -> dict | None:
    try:
        r = requests.get(CHART + quote(yahoo_symbol), params={"interval": "1d", "range": "1y"},
                         headers=HEADERS, timeout=20)
        res = r.json()["chart"]["result"][0]
        ts, cl = res.get("timestamp") or [], res["indicators"]["quote"][0].get("close") or []
        t, c = [], []
        for a, b in zip(ts, cl):
            if b is None:
                continue
            d = datetime.utcfromtimestamp(a) + timedelta(hours=5, minutes=30)
            t.append(int(d.strftime("%Y%m%d")))
            c.append(round(b, 2))
        return {"t": t, "c": c}
    except Exception as e:  # noqa: BLE001
        log("history error", yahoo_symbol, e)
        return None


# ------------------------------------------------------------ option data
_expiries: dict[str, tuple[str, list[str]]] = {}


def expiries(sym: str, today: date, client=None) -> list[str]:
    client = client or nse
    cached = _expiries.get(sym)
    if cached and cached[0] == today.isoformat():
        return cached[1]
    info = client.get(f"/api/option-chain-contract-info?symbol={quote(sym)}")
    exps = sorted(datetime.strptime(e, "%d-%b-%Y").date() for e in info.get("expiryDates", []))
    exps = [e.isoformat() for e in exps if e >= today]
    _expiries[sym] = (today.isoformat(), exps)
    return exps


def chain(sym: str, kind: str, exp_iso: str, each_side: int, client=None) -> dict | None:
    client = client or nse
    exp = date.fromisoformat(exp_iso)
    js = client.get(f"/api/option-chain-v3?type={kind}&symbol={quote(sym)}&expiry={exp:%d-%b-%Y}")
    rec = js.get("records", {})
    under = num(rec.get("underlyingValue"))
    rows = sorted(rec.get("data", []), key=lambda r: r["strikePrice"])
    if not rows or not under:
        return None
    strikes = [r["strikePrice"] for r in rows]
    atm = min(range(len(strikes)), key=lambda i: abs(strikes[i] - under))
    rows = rows[max(0, atm - each_side): atm + each_side + 1]

    def leg(q):
        q = q or {}
        return [num(q.get("lastPrice")), num(q.get("change")), num(q.get("buyPrice1")), num(q.get("sellPrice1")),
                q.get("openInterest") or 0, q.get("changeinOpenInterest") or 0,
                num(q.get("impliedVolatility"), 1), q.get("totalTradedVolume") or 0]

    return {"u": sym, "exp": exp_iso, "spot": under,
            "rows": [[r["strikePrice"], *leg(r.get("CE")), *leg(r.get("PE"))] for r in rows]}


def futures() -> dict:
    out = {}
    for ix in ("nse50_fut", "nifty_bank_fut", "stock_fut"):
        try:
            for d in nse.get(f"/api/liveEquity-derivatives?index={ix}").get("data", []):
                exp = datetime.strptime(d["expiryDate"], "%d-%b-%Y").date().isoformat()
                out[f"FUT:{d['underlying']}:{exp}"] = {
                    "u": d["underlying"], "exp": exp, "p": num(d.get("lastPrice")), "ch": num(d.get("change")),
                    "chp": num(d.get("pChange")), "o": num(d.get("openPrice")), "h": num(d.get("highPrice")),
                    "l": num(d.get("lowPrice")), "oi": d.get("openInterest"), "v": d.get("volume"),
                    "spot": num(d.get("underlyingValue")),
                }
        except Exception as e:  # noqa: BLE001
            log("futures error", ix, e)
    return out


def market_status() -> dict:
    try:
        for m in nse.get("/api/marketStatus").get("marketState", []):
            if m.get("market") == "Capital Market":
                return {"status": m.get("marketStatus"), "msg": m.get("marketStatusMessage"),
                        "date": m.get("tradeDate")}
    except Exception as e:  # noqa: BLE001
        log("status error", e)
    return {"status": "Unknown", "msg": ""}


def nse_indices() -> dict:
    try:
        return {d["index"]: d for d in nse.get("/api/allIndices").get("data", [])}
    except Exception as e:  # noqa: BLE001
        log("indices error", e)
        return {}


# ----------------------------------------------------------------- output
def write(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, separators=(",", ":"), default=str))
    tmp.replace(path)


def publish(out: Path, msg: str):
    def g(*a):
        return subprocess.run(["git", "-C", str(out), *a], capture_output=True, text=True)
    g("add", "-A")
    has_head = g("rev-parse", "--verify", "HEAD").returncode == 0
    r = g("commit", "-q", "--amend", "-m", msg) if has_head else g("commit", "-q", "-m", msg)
    if r.returncode and "nothing" not in (r.stdout + r.stderr):
        log("commit failed", r.stderr.strip())
    for attempt in range(3):
        p = g("push", "-q", "-f", "origin", "HEAD:market-data")
        if p.returncode == 0:
            return
        log("push failed", p.stderr.strip()[:200])
        _time.sleep(3)


# ------------------------------------------------------------------- main
QUOTE_SECONDS = 15        # stock/index/futures refresh cadence (each stock every 2 slots = 30 s)
CHAIN_SECONDS = 40        # option chains refresh in a background thread
LIVE_KEEP_MIN = 6


def stamp15(now: datetime) -> str:
    return f"{now:%Y%m%d-%H%M}{(now.second // 15) * 15:02d}"


class Feed:
    def __init__(self, out: Path, use_git: bool):
        self.out, self.use_git = out, use_git
        self.uni = None
        self.stock_q, self.intraday, self.idx, self.fut = {}, {}, {}, {}
        self.status = {"status": "Unknown", "msg": ""}
        self.chains, self.chains_ts = {}, None
        self.lock = threading.Lock()
        self.slot = 0
        self.stopping = False

    def ensure_daily(self, today: date):
        uni_path = self.out / "universe.json"
        uni = json.loads(uni_path.read_text()) if uni_path.exists() else {}
        if uni.get("date") != today.isoformat():
            try:
                u = load_universe()
                uni = {"date": today.isoformat(), "stocks": u["stocks"], "lots": u["lots"],
                       "indices": {k: {"name": INDEX_NAMES[k], "lot": u["lots"].get(k)} for k in INDICES}}
                write(uni_path, uni)
                log("universe", len(uni["stocks"]), "stocks")
            except Exception as e:  # noqa: BLE001
                log("universe error", e)
                if not uni:
                    raise
        self.uni = uni
        stamp = self.out / "history" / "_date.txt"
        if not stamp.exists() or stamp.read_text().strip() != today.isoformat():
            log("refreshing daily history…")
            for sym in list(uni["stocks"]):
                h = daily_history(ysym(sym))
                if h:
                    write(self.out / "history" / f"{sym}.json", h)
            for key, (_, ys) in INDICES.items():
                h = daily_history(ys)
                if h:
                    write(self.out / "history" / f"{key}.json", h)
            stamp.write_text(today.isoformat())
            log("history done")

    # ------------------------------------------------------------ pieces
    def refresh_stocks(self, now: datetime, part: int, parts: int):
        syms = sorted(self.uni["stocks"])[part::parts]
        sp = spark([ysym(s) for s in syms])
        for sym in syms:
            d = sp.get(ysym(sym))
            if not d:
                continue
            m = d["meta"]
            self.stock_q[sym] = {"p": num(m.get("regularMarketPrice")),
                                 "pc": num(m.get("chartPreviousClose") or m.get("previousClose")),
                                 "h": num(m.get("regularMarketDayHigh")), "l": num(m.get("regularMarketDayLow")),
                                 "v": m.get("regularMarketVolume"), "yh": num(m.get("fiftyTwoWeekHigh")),
                                 "yl": num(m.get("fiftyTwoWeekLow")), "t": m.get("regularMarketTime")}
            st = self.uni["stocks"][sym]
            if not st.get("full") and (m.get("longName") or m.get("shortName")):
                st["full"] = m.get("longName") or m.get("shortName")
            self.intraday[sym] = intraday_series(d, now.date())

    def refresh_indices(self, now: datetime):
        nsei = nse_indices()
        sp = spark([v[1] for v in INDICES.values()])
        for key, (nname, ys) in INDICES.items():
            n = nsei.get(nname) if nname else None
            d = sp.get(ys)
            if n:
                self.idx[key] = {"p": num(n.get("last")), "pc": num(n.get("previousClose")), "o": num(n.get("open")),
                                 "h": num(n.get("high")), "l": num(n.get("low")), "yh": num(n.get("yearHigh")),
                                 "yl": num(n.get("yearLow")), "src": "nse"}
                # NSE's index list refreshes slowly; use Yahoo's tick when it is fresh (< 60 s old)
                m = d["meta"] if d else {}
                yt = m.get("regularMarketTime")
                if yt and m.get("regularMarketPrice") and _time.time() - yt < 60:
                    self.idx[key]["p"] = num(m["regularMarketPrice"])
                    self.idx[key]["src"] = "yahoo"
                    if m.get("regularMarketDayHigh"):
                        self.idx[key]["h"] = max(self.idx[key]["h"] or 0, num(m["regularMarketDayHigh"]))
                    if m.get("regularMarketDayLow") and self.idx[key]["l"]:
                        self.idx[key]["l"] = min(self.idx[key]["l"], num(m["regularMarketDayLow"]))
            elif d:
                m = d["meta"]
                self.idx[key] = {"p": num(m.get("regularMarketPrice")),
                                 "pc": num(m.get("chartPreviousClose") or m.get("previousClose")),
                                 "h": num(m.get("regularMarketDayHigh")), "l": num(m.get("regularMarketDayLow")),
                                 "yh": num(m.get("fiftyTwoWeekHigh")), "yl": num(m.get("fiftyTwoWeekLow"))}
            if d:
                self.intraday[key] = intraday_series(d, now.date())

    def build_chains(self, client) -> dict:
        today = now_ist().date()
        chains = {}
        for sym, c in CFG["index_chains"].items():
            try:
                for exp in expiries(sym, today, client)[: c["expiries"]]:
                    ch = chain(sym, "Indices", exp, c["strikes_each_side"], client)
                    if ch:
                        chains[f"{sym}|{exp}"] = ch
            except Exception as e:  # noqa: BLE001
                log("chain error", sym, e)
        for sym in CFG["stock_chains"]:
            try:
                exps = expiries(sym, today, client)
                take = exps[:2] if exps and (date.fromisoformat(exps[0]) - today).days <= 7 else exps[:1]
                for exp in take:
                    ch = chain(sym, "Equity", exp, CFG["stock_strikes_each_side"], client)
                    if ch:
                        chains[f"{sym}|{exp}"] = ch
            except Exception as e:  # noqa: BLE001
                log("chain error", sym, e)
        return chains

    def chain_worker(self):
        client = Nse()
        while not self.stopping:
            t0 = _time.time()
            try:
                ch = self.build_chains(client)
                if ch:
                    with self.lock:
                        self.chains, self.chains_ts = ch, now_ist().isoformat(timespec="seconds")
            except Exception as e:  # noqa: BLE001
                log("chain worker error", e)
            _time.sleep(max(5, CHAIN_SECONDS - (_time.time() - t0)))

    def estimated_chains(self, now: datetime, real: dict) -> dict:
        """Model chains for indices with no free live feed (SENSEX), priced every slot from the
        live index level and the proxy index's (NIFTY's) live implied-volatility smile."""
        out = {}
        for sym, c in (CFG.get("estimated_chains") or {}).items():
            spot = (self.idx.get(sym) or {}).get("p")
            # proxy chains, never one expiring today (expiry-day smiles are distorted)
            proxies = sorted(k for k in real if k.startswith(c["proxy"] + "|") and k.split("|")[1] > now.date().isoformat())
            if not spot or not proxies:
                continue
            step, n = c["step"], c["strikes_each_side"]
            atm = round(spot / step) * step
            for exp in sensex_expiries(now.date(), c["expiries"], include_today=now.time() < datetime.strptime("15:30", "%H:%M").time()):
                # proxy expiry closest in time to this expiry
                pk = min(proxies, key=lambda k: abs((date.fromisoformat(k.split("|")[1]) - exp).days))
                prox = real[pk]
                sm = fit_smile(smile_points(prox["rows"], prox["spot"], compact=True))
                if not sm:
                    continue
                rows = []
                for k in range(atm - n * step, atm + (n + 1) * step, step):
                    iv = sm(k / spot)
                    ce, pe = model_quote(spot, k, exp, "CALL", iv, now), model_quote(spot, k, exp, "PUT", iv, now)
                    leg = lambda q: [q["ltp"], None, q["bid"], q["ask"], 0, 0, q["iv"], 0]  # noqa: E731
                    rows.append([k, *leg(ce), *leg(pe)])
                rows = no_arbitrage(rows)
                out[f"{sym}|{exp.isoformat()}"] = {"u": sym, "exp": exp.isoformat(), "spot": spot, "rows": rows,
                                                   "estimated": True, "proxy": c["proxy"], "proxy_expiry": pk.split("|")[1]}
            self.uni.setdefault("lots", {})[sym] = c["lot"]
        return out

    # -------------------------------------------------------------- write
    def write_all(self, now: datetime, full: bool):
        ts = now.isoformat(timespec="seconds")
        quotes = {"ts": ts, "market": self.status, "indices": self.idx, "stocks": self.stock_q, "futures": self.fut}
        with self.lock:
            real = dict(self.chains)
            chains = {"ts": self.chains_ts or ts, "chains": real}
        try:
            est = self.estimated_chains(now, real)
            if est:
                chains = {**chains, "ts": ts if not self.chains_ts or ts > chains["ts"] else chains["ts"],
                          "chains": {**real, **est}}
        except Exception as e:  # noqa: BLE001
            log("estimated chain error", e)
        st = stamp15(now)
        write(self.out / "quotes.json", quotes)
        write(self.out / "live" / f"{st}-q.json", quotes)
        if chains["chains"]:
            write(self.out / "chains.json", chains)
            write(self.out / "live" / f"{st}-c.json", chains)
        if full:
            write(self.out / "intraday.json", {"ts": ts, "series": self.intraday})
            write(self.out / "universe.json", self.uni)
        cutoff = (now - timedelta(minutes=LIVE_KEEP_MIN)).strftime("%Y%m%d-%H%M%S")
        for f in (self.out / "live").glob("*.json"):
            if f.name[:15] < cutoff:
                f.unlink()
        if self.use_git:
            publish(self.out, f"market {ts}")

    def tick(self):
        """One 15-second slot: half the stocks, all indices and futures; chains come from the worker."""
        now = now_ist()
        self.ensure_daily(now.date())
        t0 = _time.time()
        first = not self.stock_q
        if first:
            self.refresh_stocks(now, 0, 1)
        else:
            self.refresh_stocks(now, self.slot % 2, 2)
        self.refresh_indices(now)
        self.fut = futures() or self.fut
        if self.slot % 4 == 0:
            self.status = market_status()
        if first and not self.chains:
            with self.lock:
                self.chains, self.chains_ts = self.build_chains(nse), now.isoformat(timespec="seconds")
        self.write_all(now, full=(self.slot % 4 == 0))
        if self.slot % 4 == 0:
            log(f"slot {self.slot}: {len(self.stock_q)} stocks, {len(self.chains)} chains, {len(self.fut)} futures, "
                f"market {self.status.get('status')} ({_time.time() - t0:.1f}s)")
        self.slot += 1
        return {"market": self.status}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.getenv("FEED_DIR", "market-branch"))
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--no-git", action="store_true")
    a = ap.parse_args()
    feed = Feed(Path(a.out), use_git=not a.no_git)
    start = now_ist()
    stop = min(start.replace(hour=END[0], minute=END[1], second=0, microsecond=0), start + MAX_RUNTIME)
    log("feed started; stops at", stop.strftime("%H:%M"))
    if start.weekday() >= 5:
        feed.tick()
        return
    worker = None
    while True:
        now = now_ist()
        if now.time() < datetime.strptime("09:00", "%H:%M").time() and not a.once:
            _time.sleep(min(600, (now.replace(hour=9, minute=0, second=5) - now).total_seconds()))
            continue
        try:
            q = feed.tick()
            if worker is None and not a.once:
                worker = threading.Thread(target=feed.chain_worker, daemon=True)
                worker.start()
            closed = str(q["market"].get("status", "")).lower().startswith("close")
            if closed and now.time() >= datetime.strptime("09:20", "%H:%M").time():
                log("market closed – final snapshot saved")
                break
        except Exception as e:  # noqa: BLE001
            log("tick failed", e)
        if a.once or now_ist() >= stop:
            break
        n = now_ist()
        nxt = n.replace(microsecond=0) + timedelta(seconds=QUOTE_SECONDS - n.second % QUOTE_SECONDS + 2)
        _time.sleep(max(1, (nxt - now_ist()).total_seconds()))
    feed.stopping = True
    log("feed finished")


if __name__ == "__main__":
    main()
