"""
Backtest the exact same rules on the last ~60 days of 5-minute data
(the most Yahoo provides for free). Writes backtest.json for the dashboard.

  python backtest.py --data-dir data-branch
"""
import argparse
import json
import os
from datetime import datetime
from pathlib import Path

import pandas as pd

from data import fetch_candles, now_ist
from strategy import IndexEngine, prepare

ROOT = Path(__file__).parent


def run_backtest(df: pd.DataFrame, name: str, step: int, s: dict) -> list[dict]:
    p = prepare(df, s)
    eng = IndexEngine(name, step, s)
    trades = []
    prev = None
    for k in range(len(p)):
        r = p.iloc[k]
        for ev in eng.on_bar(p.index[k].to_pydatetime(), r, prev):
            if ev["type"] == "EXIT":
                trades.append(ev["trade"])
        prev = r
    return trades


def stats(trades: list[dict]) -> dict:
    if not trades:
        return {"trades": 0}
    pts = [t["points"] for t in trades]
    rs = [t["r_multiple"] for t in trades]
    wins = [p for p in pts if p > 0]
    losses = [p for p in pts if p <= 0]
    eq, peak, mdd = 0.0, 0.0, 0.0
    for r in rs:
        eq += r
        peak = max(peak, eq)
        mdd = min(mdd, eq - peak)
    gross_loss = abs(sum(r for r in rs if r < 0))
    outcomes = {}
    for t in trades:
        outcomes[t["outcome"]] = outcomes.get(t["outcome"], 0) + 1
    return {
        "trades": len(trades),
        "win_rate": round(100 * len(wins) / len(trades), 1),
        "total_points": round(sum(pts), 1),
        "avg_win_points": round(sum(wins) / len(wins), 1) if wins else 0,
        "avg_loss_points": round(sum(losses) / len(losses), 1) if losses else 0,
        "total_r": round(sum(rs), 2),
        "expectancy_r": round(sum(rs) / len(rs), 3),
        "profit_factor": round(sum(r for r in rs if r > 0) / gross_loss, 2) if gross_loss else None,
        "max_drawdown_r": round(mdd, 2),
        "outcomes": outcomes,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default=os.getenv("DATA_DIR", "data-branch"))
    a = ap.parse_args()
    cfg = json.loads((ROOT / "config.json").read_text())
    s = cfg["strategy"]
    out = {"generated_at": now_ist().isoformat(timespec="seconds"), "indices": {}, "trades": []}
    all_trades = []
    for idx in [i for i in cfg["indices"] if i.get("enabled")]:
        df = fetch_candles(idx["symbol"], "60d", now_ist())
        trades = run_backtest(df, idx["name"], idx["strike_step"], s)
        st = stats(trades)
        st["from"] = df.index[0].date().isoformat()
        st["to"] = df.index[-1].date().isoformat()
        st["days"] = int(pd.Series(df.index.date).nunique())
        out["indices"][idx["name"]] = st
        all_trades += trades
        print(idx["name"], json.dumps(st))
    all_trades.sort(key=lambda t: t["entry_time"])
    out["overall"] = stats(all_trades)
    out["trades"] = all_trades[-300:]
    d = Path(a.data_dir)
    d.mkdir(parents=True, exist_ok=True)
    (d / "backtest.json").write_text(json.dumps(out, indent=1, default=str))
    print("overall", json.dumps(out["overall"]))


if __name__ == "__main__":
    main()
