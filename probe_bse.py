"""One-off probe: can GitHub's servers read BSE's SENSEX option chain?"""
import json, sys, time
from pathlib import Path
import requests
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
out = {}
s = requests.Session()
s.headers.update({"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
for u in ["https://www.bseindia.com/", "https://www.bseindia.com/markets/Derivatives/DeriReports/DeriOptionchain.html"]:
    try:
        r = s.get(u, timeout=20); out[u] = {"status": r.status_code, "cookies": list(s.cookies.keys())}
    except Exception as e:
        out[u] = {"error": repr(e)[:200]}
H = {"Accept": "application/json, text/plain, */*", "Referer": "https://www.bseindia.com/", "Origin": "https://www.bseindia.com"}
tests = {
  "expiry_IV": "https://api.bseindia.com/BseIndiaAPI/api/ddlExpiry_IV/w?ProductType=IO&scrip_cd=1",
  "expiry_new": "https://api.bseindia.com/BseIndiaAPI/api/ddlExpiry_IV/w?scrip_cd=1&ProductType=IO",
  "sensex_quote": "https://api.bseindia.com/BseIndiaAPI/api/GetSensexData/w",
  "deriv_expiry": "https://api.bseindia.com/BseIndiaAPI/api/DerivExpiryDate/w?ScripCode=1&ProductType=IO",
}
for k, u in tests.items():
    try:
        r = s.get(u, headers=H, timeout=20)
        out[k] = {"status": r.status_code, "head": r.text[:400]}
    except Exception as e:
        out[k] = {"error": repr(e)[:200]}
# if an expiry came back, try the chain
try:
    j = json.loads(out["expiry_IV"]["head"]) if out["expiry_IV"].get("status") == 200 else None
except Exception:
    j = None
if j:
    exp = (j.get("Table") or [{}])[0].get("ExpiryDate")
    r = s.get("https://api.bseindia.com/BseIndiaAPI/api/DerivOptionChain_IV/w", params={"Expiry": exp, "scrip_cd": 1, "strprice": 0}, headers=H, timeout=20)
    out["chain"] = {"status": r.status_code, "head": r.text[:600]}
print(json.dumps(out, indent=1))
d = Path(sys.argv[1]); d.mkdir(parents=True, exist_ok=True); (d / "bse_probe.json").write_text(json.dumps(out, indent=1))
