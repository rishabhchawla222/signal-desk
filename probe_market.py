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


for idx in ["NIFTY 50", "NIFTY 200", "SECURITIES IN F&O", "NIFTY BANK"]:
    from urllib.parse import quote
    probe("eq_" + idx, "https://www.nseindia.com/api/equity-stockIndices?index=" + quote(idx),
          lambda j: {"n": len(j.get("data", [])), "row": j["data"][1] if len(j.get("data", [])) > 1 else head(j)})
probe("eq_raw_fo", "https://www.nseindia.com/api/equity-stockIndices?index=SECURITIES%20IN%20F%26O", raw=True)
for ix in ["nse50_fut", "nifty_bank_fut", "stock_fut"]:
    probe("fut_" + ix, f"https://www.nseindia.com/api/liveEquity-derivatives?index={ix}",
          lambda j: {"n": len(j.get("data", [])), "row": (j.get("data") or [None])[0]})
probe("quote_eq", "https://www.nseindia.com/api/quote-equity?symbol=RELIANCE", lambda j: head(j))
probe("deriv_raw", "https://www.nseindia.com/api/quote-derivative?symbol=NIFTY", raw=True)

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
