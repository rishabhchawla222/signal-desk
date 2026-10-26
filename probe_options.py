"""One-off probe: which free option-price sources answer from GitHub's servers."""
import json
import sys
from pathlib import Path

import requests

H = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
}
out = {}


def rec(name, fn):
    try:
        out[name] = fn()
    except Exception as e:  # noqa: BLE001
        out[name] = {"error": repr(e)[:300]}
    print(name, json.dumps(out[name])[:400])


def nse():
    s = requests.Session()
    s.headers.update(H)
    r0 = s.get("https://www.nseindia.com", timeout=15)
    s.get("https://www.nseindia.com/option-chain", timeout=15)
    res = {"home": r0.status_code, "cookies": list(s.cookies.keys())}
    r = s.get("https://www.nseindia.com/api/option-chain-indices?symbol=NIFTY", timeout=15,
              headers={"Referer": "https://www.nseindia.com/option-chain"})
    res["indices_status"] = r.status_code
    res["indices_head"] = r.text[:200]
    r = s.get("https://www.nseindia.com/api/option-chain-contract-info?symbol=NIFTY", timeout=15,
              headers={"Referer": "https://www.nseindia.com/option-chain"})
    res["contract_status"] = r.status_code
    res["contract_head"] = r.text[:300]
    try:
        exp = r.json()["expiryDates"][0]
        r = s.get(f"https://www.nseindia.com/api/option-chain-v3?type=Indices&symbol=NIFTY&expiry={exp}",
                  timeout=15, headers={"Referer": "https://www.nseindia.com/option-chain"})
        res["v3_status"] = r.status_code
        js = r.json()
        rows = js.get("records", {}).get("data", [])
        res["v3_rows"] = len(rows)
        res["v3_sample"] = rows[len(rows) // 2] if rows else None
        res["v3_underlying"] = js.get("records", {}).get("underlyingValue")
    except Exception as e:  # noqa: BLE001
        res["v3_error"] = repr(e)[:200]
    return res


def bse():
    h = {**H, "Referer": "https://www.bseindia.com/", "Origin": "https://www.bseindia.com"}
    r = requests.get("https://api.bseindia.com/BseIndiaAPI/api/ddlExpiry_IV/w?ProductType=IO&scrip_cd=1",
                     headers=h, timeout=15)
    res = {"expiry_status": r.status_code, "expiry_head": r.text[:300]}
    try:
        tbl = r.json().get("Table") or []
        exp = tbl[0]["ExpiryDate"]
        res["first_expiry"] = exp
        r = requests.get("https://api.bseindia.com/BseIndiaAPI/api/DerivOptionChain_IV/w",
                         params={"Expiry": exp, "scrip_cd": 1, "strprice": 0}, headers=h, timeout=15)
        res["chain_status"] = r.status_code
        js = r.json()
        rows = js.get("Table") or []
        res["chain_rows"] = len(rows)
        res["chain_sample"] = rows[len(rows) // 2] if rows else js
    except Exception as e:  # noqa: BLE001
        res["chain_error"] = repr(e)[:200]
    return res


def vix():
    r = requests.get("https://query1.finance.yahoo.com/v8/finance/chart/%5EINDIAVIX",
                     params={"interval": "5m", "range": "1d"}, headers=H, timeout=15)
    m = r.json()["chart"]["result"][0]["meta"]
    return {"status": r.status_code, "price": m.get("regularMarketPrice")}


rec("nse", nse)
rec("bse", bse)
rec("vix", vix)
d = Path(sys.argv[1] if len(sys.argv) > 1 else "data-branch") / "probe"
d.mkdir(parents=True, exist_ok=True)
(d / "options_probe.json").write_text(json.dumps(out, indent=1, default=str))
