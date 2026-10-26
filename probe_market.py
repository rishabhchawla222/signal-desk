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


probe("fo_stocks", "https://www.nseindia.com/api/equity-stockIndices?index=SECURITIES%20IN%20F%26O",
      lambda j: {"n": len(j.get("data", [])), "keys": list(j["data"][1].keys()), "row": j["data"][1]})
probe("allIndices", "https://www.nseindia.com/api/allIndices",
      lambda j: {"n": len(j.get("data", [])), "rows": [d for d in j["data"] if d.get("index") in ("NIFTY 50", "NIFTY BANK", "INDIA VIX", "NIFTY FIN SERVICE")]})
probe("deriv_nifty", "https://www.nseindia.com/api/quote-derivative?symbol=NIFTY",
      lambda j: {"keys": list(j.keys()), "n": len(j.get("stocks", [])),
                 "fut": [x for x in j.get("stocks", []) if x.get("metadata", {}).get("instrumentType", "").startswith("Index Fut")][:2]})
probe("deriv_reliance", "https://www.nseindia.com/api/quote-derivative?symbol=RELIANCE",
      lambda j: {"n": len(j.get("stocks", [])),
                 "fut": [x for x in j.get("stocks", []) if "Fut" in x.get("metadata", {}).get("instrumentType", "")][:1]})
probe("ci_reliance", "https://www.nseindia.com/api/option-chain-contract-info?symbol=RELIANCE", lambda j: j)
try:
    exp = s.get("https://www.nseindia.com/api/option-chain-contract-info?symbol=RELIANCE", timeout=15).json()["expiryDates"][0]
    probe("v3_reliance", f"https://www.nseindia.com/api/option-chain-v3?type=Equity&symbol=RELIANCE&expiry={exp}",
          lambda j: {"rows": len(j["records"]["data"]), "under": j["records"].get("underlyingValue")})
    exp = s.get("https://www.nseindia.com/api/option-chain-contract-info?symbol=BANKNIFTY", timeout=15).json()["expiryDates"][0]
    probe("v3_banknifty", f"https://www.nseindia.com/api/option-chain-v3?type=Indices&symbol=BANKNIFTY&expiry={exp}",
          lambda j: {"rows": len(j["records"]["data"]), "under": j["records"].get("underlyingValue"), "exp": exp})
except Exception as e:  # noqa: BLE001
    out["v3_err"] = repr(e)
probe("lots_csv", "https://nsearchives.nseindia.com/content/fo/fo_mktlots.csv", raw=True)
probe("chart_reliance", "https://www.nseindia.com/api/chart-databyindex?index=RELIANCEEQN",
      lambda j: {"keys": list(j.keys()), "n": len(j.get("grapthData", [])), "first": j.get("grapthData", [])[:2]})
probe("market_status", "https://www.nseindia.com/api/marketStatus", lambda j: j)
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
