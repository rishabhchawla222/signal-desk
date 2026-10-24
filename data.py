"""Free market data from Yahoo Finance (5-minute candles, IST)."""
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pandas as pd
import requests

IST = ZoneInfo("Asia/Kolkata")
BAR = timedelta(minutes=5)
HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "application/json",
}


def now_ist() -> datetime:
    return datetime.now(IST).replace(tzinfo=None)


def fetch_candles(symbol: str, range_: str = "5d", now: datetime | None = None) -> pd.DataFrame:
    """Return closed 5-minute candles (IST, tz-naive index named 'ts')."""
    last_err = None
    for attempt in range(3):
        for host in HOSTS:
            try:
                url = f"https://{host}/v8/finance/chart/{requests.utils.quote(symbol)}"
                r = requests.get(
                    url,
                    params={"interval": "5m", "range": range_, "includePrePost": "false"},
                    headers=HEADERS,
                    timeout=15,
                )
                r.raise_for_status()
                return _parse(r.json(), now)
            except Exception as e:  # noqa: BLE001
                last_err = e
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"Could not fetch {symbol}: {last_err}")


def _parse(js: dict, now: datetime | None) -> pd.DataFrame:
    res = js["chart"]["result"][0]
    ts = res.get("timestamp") or []
    q = res["indicators"]["quote"][0]
    df = pd.DataFrame(
        {k: q.get(k) for k in ("open", "high", "low", "close")},
        index=pd.to_datetime(ts, unit="s", utc=True).tz_convert(IST).tz_localize(None),
    )
    df.index.name = "ts"
    df = df.dropna().astype(float)
    df = df[~df.index.duplicated(keep="last")].sort_index()
    # keep regular session only
    mins = df.index.hour * 60 + df.index.minute
    df = df[(mins >= 9 * 60 + 15) & (mins < 15 * 60 + 30)]
    # drop the candle that is still forming
    if now is not None:
        df = df[df.index + BAR <= now]
    return df
