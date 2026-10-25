"""Save the raw 5-minute candles (last ~60 days) to CSV for research."""
import argparse
import json
from pathlib import Path

from data import fetch_candles, now_ist

ROOT = Path(__file__).parent

ap = argparse.ArgumentParser()
ap.add_argument("--data-dir", default="data-branch")
a = ap.parse_args()
out = Path(a.data_dir) / "raw"
out.mkdir(parents=True, exist_ok=True)
for idx in json.loads((ROOT / "config.json").read_text())["indices"]:
    df = fetch_candles(idx["symbol"], "60d", now_ist())
    df.to_csv(out / f"{idx['name']}.csv")
    print(idx["name"], len(df), df.index[0], df.index[-1])
