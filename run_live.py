"""
Live signal runner. Runs during market hours, checks every closed 5-minute
candle, emails you on every signal/update/exit, and writes JSON files that the
dashboard website reads.

  python run_live.py                 # loop until 15:25 IST (or ~5h40m max)
  python run_live.py --once          # single check (good for testing)
  python run_live.py --no-git        # don't commit/push data (local use)
"""
import argparse
import json
import os
import subprocess
import time as _time
from datetime import datetime, timedelta
from pathlib import Path

from data import BAR, fetch_candles, now_ist
from notify import event_email, send_email, summary_email
from options import current_premium, entry_quote
from strategy import IndexEngine, prepare, snapshot

ROOT = Path(__file__).parent
MAX_RUNTIME = timedelta(hours=5, minutes=40)   # GitHub jobs are capped at 6h
SESSION_END = (15, 25)
STALE_ENTRY = timedelta(minutes=8)             # never send an entry for an old candle


def load_json(p: Path, default):
    try:
        return json.loads(p.read_text())
    except Exception:  # noqa: BLE001
        return default


def save_json(p: Path, obj):
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, indent=1, default=str))
    tmp.replace(p)


def git_push(data_dir: Path, msg: str):
    def g(*a, check=True):
        return subprocess.run(["git", "-C", str(data_dir), *a], check=check, capture_output=True, text=True)
    try:
        g("add", "-A")
        if g("diff", "--cached", "--quiet", check=False).returncode == 0:
            return
        g("commit", "-m", msg)
        for attempt in range(3):
            r = g("push", "origin", "HEAD:signals-data", check=False)
            if r.returncode == 0:
                return
            print("[git push failed]", r.stderr.strip())
            _time.sleep(3 * (attempt + 1))
            # someone else updated the data branch: replay our commit on top (ours wins on conflict)
            g("pull", "--rebase", "-X", "theirs", "origin", "signals-data", check=False)
    except subprocess.CalledProcessError as e:
        print("[git error]", e.stderr)


class Runner:
    def __init__(self, data_dir: Path, use_git: bool, fetch=fetch_candles, clock=now_ist, notify=True,
                 premiums=True):
        self.premiums = premiums
        self.cfg = json.loads((ROOT / "config.json").read_text())
        self.s = self.cfg["strategy"]
        self.dir = data_dir
        self.use_git = use_git
        self.fetch = fetch
        self.clock = clock
        self.notify = notify and self.cfg.get("email", {}).get("enabled", True)
        self.state = load_json(data_dir / "state.json", {"engines": {}, "summary_sent": None})
        self.signals = load_json(data_dir / "signals.json", [])
        self.indices = [i for i in self.cfg["indices"] if i.get("enabled")]
        self.engines = {
            i["name"]: IndexEngine(i["name"], i["strike_step"], self.s, self.state["engines"].get(i["name"]))
            for i in self.indices
        }
        self.status = {"indices": {}, "errors": []}

    # ---------------------------------------------------------------- store
    def add_premium(self, ev: dict, eng: IndexEngine, spot: float):
        """Attach option premium (buy price, premium SL/target, exit price) to the event."""
        t = ev["trade"]
        try:
            if ev["type"] == "ENTRY":
                q = entry_quote(t["index"], t["strike"], t["side"], spot, t["sl"], t["target"], self.clock())
                if q:
                    t["premium"] = q
                    if eng.state.get("open") and eng.state["open"]["id"] == t["id"]:
                        eng.state["open"]["premium"] = q
            elif t.get("premium"):
                p = t["premium"]
                cur = current_premium(t["index"], t["strike"], t["side"], p["expiry"], spot, p.get("iv"), self.clock())
                if cur:
                    key = "exit_price" if ev["type"] == "EXIT" else "now"
                    p = {**p, key: cur[0], f"{key}_estimated": cur[1]}
                    if ev["type"] == "EXIT":
                        p["pnl"] = round(cur[0] - p["price"], 2)
                    t["premium"] = p
                    if ev["type"] != "EXIT" and eng.state.get("open"):
                        eng.state["open"]["premium"] = p
        except Exception as e:  # noqa: BLE001
            print(f"[premium error] {e}")

    def apply(self, ev: dict):
        t = ev["trade"]
        for k, old in enumerate(self.signals):
            if old["id"] == t["id"]:
                self.signals[k] = {**old, **t}
                break
        else:
            self.signals.append(t)
        self.signals = self.signals[-1000:]
        if self.notify:
            send_email(*event_email(ev))

    def save(self, market: str, note: str = ""):
        now = self.clock()
        self.state["engines"] = {k: e.state for k, e in self.engines.items()}
        self.status.update(
            updated_at=now.isoformat(timespec="seconds"),
            market=market,
            note=note,
            data_source="Yahoo Finance 5-min candles (free; can lag 1–3 min)",
        )
        save_json(self.dir / "state.json", self.state)
        save_json(self.dir / "signals.json", self.signals)
        save_json(self.dir / "status.json", self.status)
        if self.use_git:
            git_push(self.dir, f"signals {now:%Y-%m-%d %H:%M}")

    # ---------------------------------------------------------------- cycle
    def cycle(self) -> str:
        """Process all newly closed candles. Returns market state."""
        now = self.clock()
        today = now.date()
        self.status["errors"] = []
        any_today = False
        for idx in self.indices:
            name = idx["name"]
            eng = self.engines[name]
            try:
                df = self.fetch(idx["symbol"], "5d", now)
            except Exception as e:  # noqa: BLE001
                self.status["errors"].append(f"{name}: {e}")
                continue
            if df.empty:
                continue
            p = prepare(df, self.s)
            todays = p[p.index.date == today]
            if not todays.empty:
                any_today = True
            last = eng.state.get("last_bar")
            new = p[p.index > datetime.fromisoformat(last)] if last else todays
            for ts in new.index:
                pos = p.index.get_loc(ts)
                prev = p.iloc[pos - 1] if pos > 0 else None
                fresh = now - (ts + BAR) <= STALE_ENTRY
                for ev in eng.on_bar(ts.to_pydatetime(), p.iloc[pos], prev, allow_entry=fresh):
                    if fresh and self.premiums:
                        self.add_premium(ev, eng, float(p.iloc[pos].close))
                    self.apply(ev)
            prev_days = p[p.index.date < today] if not todays.empty else p[p.index.date < p.index[-1].date()]
            prev_close = float(prev_days["close"].iloc[-1]) if not prev_days.empty else None
            snap = snapshot(name, p, self.s, prev_close)
            snap["open_trade"] = eng.state.get("open")
            self.status["indices"][name] = snap
        return "OPEN" if any_today else "NO_DATA"

    def daily_summary(self):
        day = self.clock().date().isoformat()
        if self.state.get("summary_sent") == day or not self.cfg["email"].get("send_daily_summary", True):
            return
        trades = [t for t in self.signals if t["entry_time"].startswith(day)]
        if self.notify:
            send_email(*summary_email(day, trades))
        self.state["summary_sent"] = day


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default=os.getenv("DATA_DIR", "data-branch"))
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--no-git", action="store_true")
    a = ap.parse_args()

    data_dir = Path(a.data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    run = Runner(data_dir, use_git=not a.no_git)

    start = now_ist()
    end = min(start.replace(hour=SESSION_END[0], minute=SESSION_END[1], second=0, microsecond=0),
              start + MAX_RUNTIME)
    print(f"Runner started {start:%H:%M:%S} IST, will stop at {end:%H:%M} IST")

    if start.weekday() >= 5:
        run.save("CLOSED", "Weekend – market closed")
        return

    while True:
        now = now_ist()
        open_t = now.replace(hour=9, minute=15, second=0, microsecond=0)
        if now < open_t + BAR:
            run.save("PRE_OPEN", "Waiting for the first 5-minute candle (9:20 IST)")
            if a.once:
                return
            _time.sleep(min(1800, max(5, (open_t + BAR - now).total_seconds() + 20)))
            continue

        market = run.cycle()
        if market == "NO_DATA" and now >= open_t + timedelta(minutes=30):
            run.save("HOLIDAY", "No trading data today – market holiday")
            return
        closing = now.time() >= datetime.strptime("15:15", "%H:%M").time()
        if closing:
            run.daily_summary()
        run.save("CLOSED" if closing else market,
                 "Session over – see you tomorrow" if closing else "")

        if a.once or now >= end:
            break
        # wake up ~25s after the next 5-minute candle closes
        nxt = now.replace(second=0, microsecond=0) + timedelta(minutes=5 - now.minute % 5, seconds=25)
        wait = (nxt - now_ist()).total_seconds()
        if now_ist() + timedelta(seconds=max(wait, 0)) > end:
            break
        _time.sleep(max(wait, 5))
    print("Runner finished")


if __name__ == "__main__":
    main()
