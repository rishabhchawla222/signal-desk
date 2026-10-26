"""One-off probe of NSE endpoints needed by the paper-trading app."""
import json
import sys
import time
from pathlib import Path

import requests

H = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
}
s = requests.Session()
s.headers.update(H)
s.get("https://www.nseindia.com", timeout=15)
s.get("https://www.nseindia.com/market-data/live-equity-market", timeout=15)
out = {}


def probe(name, url, keep=None, raw=False):
    t = time.time()
    try:
        r = s.get(url, timeout=20, headers={"Referer": "https://www.nseindia.com/"})
        res = {"status": r.status_code, "ms": int((time.time() - t) * 1000), "bytes": len(r.content)}
        if raw:
            res["head"] = r.text[:600]
        else:
            js = r.json()
            res["sample"] = keep(js) if keep else str(js)[:600]
    except Exception as e:  # noqa: BLE001
        res = {"error": repr(e)[:300]}
    out[name] = res
    print(name, json.dumps(res)[:300])


def head(j):
    return str(j)[:300]


probe("variations", "https://www.nseindia.com/api/live-analysis-variations?index=gainers", lambda j: head(j))
probe("most_active", "https://www.nseindia.com/api/live-analysis-most-active-securities?index=volume", lambda j: head(j))
# Yahoo batch endpoints
syms = "RELIANCE.NS,HDFCBANK.NS,ICICIBANK.NS,INFY.NS,TCS.NS,SBIN.NS,M&M.NS,BAJAJ-AUTO.NS,ITC.NS,LT.NS,AXISBANK.NS,KOTAKBANK.NS,HINDUNILVR.NS,BHARTIARTL.NS,MARUTI.NS,TATAMOTORS.NS,SUNPHARMA.NS,TITAN.NS,ASIANPAINT.NS,NTPC.NS"
for nm, url, params in [
    ("y_spark", "https://query1.finance.yahoo.com/v8/finance/spark", {"symbols": syms, "range": "1d", "interval": "5m"}),
    ("y_spark2", "https://query2.finance.yahoo.com/v7/finance/spark", {"symbols": syms, "range": "1d", "interval": "5m"}),
    ("y_quote", "https://query1.finance.yahoo.com/v7/finance/quote", {"symbols": syms}),
]:
    t = time.time()
    try:
        r = requests.get(url, params=params, headers=H, timeout=20)
        j = r.json()
        res = {"status": r.status_code, "ms": int((time.time() - t) * 1000), "bytes": len(r.content)}
        if isinstance(j, dict) and "spark" in j:
            rr = j["spark"]["result"]
            res["n"] = len(rr)
            res["first"] = str(rr[0])[:700]
        elif isinstance(j, dict) and any(k.endswith(".NS") for k in j):
            res["n"] = len(j)
            k0 = next(iter(j))
            res["first"] = {k0: str(j[k0])[:700]}
        else:
            res["head"] = str(j)[:500]
    except Exception as e:  # noqa: BLE001
        res = {"error": repr(e)[:300]}
    out[nm] = res
    print(nm, json.dumps(res)[:300])
# lot file: number of F&O underlyings
try:
    txt = s.get("https://nsearchives.nseindia.com/content/fo/fo_mktlots.csv", timeout=20).text
    rows = [l.split(",") for l in txt.splitlines()[1:] if l.strip()]
    out["lots"] = {"n": len(rows), "sample": [[c.strip() for c in r[:3]] for r in rows[:6] + rows[-3:]]}
except Exception as e:  # noqa: BLE001
    out["lots"] = {"error": repr(e)}

# Yahoo daily history for one stock
try:
    r = requests.get("https://query1.finance.yahoo.com/v8/finance/chart/RELIANCE.NS",
                     params={"interval": "1d", "range": "1y"}, headers=H, timeout=15)
    out["yahoo_daily"] = {"status": r.status_code, "n": len(r.json()["chart"]["result"][0]["timestamp"])}
except Exception as e:  # noqa: BLE001
    out["yahoo_daily"] = {"error": repr(e)}
print("yahoo_daily", out["yahoo_daily"])

d = Path(sys.argv[1] if len(sys.argv) > 1 else "out")
d.mkdir(parents=True, exist_ok=True)
(d / "market_probe.json").write_text(json.dumps(out, indent=1, default=str))
(d / "fresh.txt").write_text(str(time.time()))
