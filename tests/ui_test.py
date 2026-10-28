"""
Browser tests for the paper-trading app (Playwright + Chromium).

  pip install playwright && playwright install chromium   # once
  python tests/ui_test.py

Serves docs/trade with the frozen market snapshot in tests/fixtures, pins the
browser clock to market hours, and fakes the GitHub API (including a fake
auto-trader that processes commands). No network, no real orders.
"""
import base64
import copy
import functools
import http.server
import json
import shutil
import socketserver
import sys
import tempfile
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / "tests" / "fixtures"
SHOTS = Path(sys.argv[1]) if len(sys.argv) > 1 else None

quotes = json.loads((FIX / "quotes.json").read_text())
DAY = quotes["ts"][:10]
NOW_IST = f"{DAY}T13:25:30"
NOW_UTC = f"{DAY}T07:55:30Z"


def build_site() -> Path:
    tmp = Path(tempfile.mkdtemp())
    shutil.copytree(ROOT / "docs" / "trade", tmp / "trade")
    (tmp / "md").mkdir()
    (tmp / "sig").mkdir()
    q = copy.deepcopy(quotes)
    q["ts"], q["market"] = f"{DAY}T13:25:00", {"status": "Open", "msg": "Normal Market is Open"}
    (tmp / "md" / "quotes.json").write_text(json.dumps(q))
    ch = json.loads((FIX / "chains.json").read_text())
    ch["ts"] = f"{DAY}T13:25:00"
    # estimated SENSEX chains, built exactly as the feed builds them
    sys.path.insert(0, str(ROOT))
    import feed
    from datetime import datetime as _dt
    f = feed.Feed(Path("."), use_git=False)
    f.uni, f.idx = {"lots": {}}, {"SENSEX": {"p": q["indices"]["SENSEX"]["p"]}}
    ch["chains"].update(f.estimated_chains(_dt.fromisoformat(NOW_IST), ch["chains"]))
    (tmp / "md" / "chains.json").write_text(json.dumps(ch))
    uni = json.loads((FIX / "universe.json").read_text())
    uni["lots"]["SENSEX"] = 20
    (tmp / "md" / "universe.json").write_text(json.dumps(uni))
    (tmp / "md" / "intraday.json").write_text(json.dumps({"ts": q["ts"], "series": {
        "NIFTY": [[0, 60, 120, 180, 240], [22700, 22720, 22690, 22740, q["indices"]["NIFTY"]["p"]]]}}))
    (tmp / "sig" / "signals.json").write_text("[]")
    return tmp


def serve(directory: Path):
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    handler = functools.partial(Quiet, directory=str(directory))
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def nifty_key():
    ch = json.loads((FIX / "chains.json").read_text())["chains"]
    k = sorted(x for x in ch if x.startswith("NIFTY|"))[0]
    c = ch[k]
    row = min(c["rows"], key=lambda r: abs(r[0] - c["spot"]))
    return f"OPT:NIFTY:{c['exp']}:{row[0]}:CE", c["exp"], row


class FakeGitHub:
    """api.github.com for the control channel + a fake auto-trader that processes commands."""
    def __init__(self):
        key, exp, row = nifty_key()
        self.commands, self.sha = [], 1
        self.fail_put, self.mode, self.put_at = False, "done", None
        self.auto = {"start_cash": 1000000, "cash": 1000000 - 65 * (row[4] - 5), "started": DAY, "updated": NOW_IST,
                     "paused": False, "blocks": {}, "processed": {}, "trades": [], "skipped": [],
                     "open": {"SIG1": {"id": "SIG1", "key": key, "option": f"NIFTY {row[0]} CE", "expiry": exp, "index": "NIFTY",
                                       "side": "CALL", "strike": row[0], "qty": 65, "lot": 65, "buy_price": round(row[4] - 5, 2),
                                       "buy_time": f"{DAY}T12:40:00", "buy_charges": 26.5, "sl": 100.0, "target": 200.0}}}

    def b64(self, obj):
        return base64.b64encode(json.dumps(obj).encode()).decode()

    def process(self):
        if self.mode == "hold" or not self.put_at or time.time() - self.put_at < 1:
            return
        for c in self.commands:
            if c["id"] in self.auto["processed"]:
                continue
            if self.mode == "failed":
                res = {"status": "failed", "message": "No live option price for 2 minutes, so nothing was sold."}
            elif c["type"] == "EXIT":
                p = self.auto["open"].pop(c["target"], None)
                if p:
                    self.auto["trades"].append({**p, "sell_price": p["buy_price"] + 3, "sell_time": NOW_IST, "net": 120.5,
                                                "reason": "Manual exit (you)", "manual": True, "sell_charges": 30})
                    self.auto["blocks"]["NIFTY"] = DAY
                    res = {"status": "done", "message": f"Sold 65 {p['option']} (paper)."}
                else:
                    res = {"status": "noop", "message": "Already closed."}
            elif c["type"] == "PAUSE":
                self.auto["paused"] = True
                res = {"status": "done", "message": "Auto-trading paused."}
            elif c["type"] == "RESUME":
                self.auto["paused"] = False
                res = {"status": "done", "message": "Auto-trading resumed."}
            else:
                res = {"status": "done", "message": "ok"}
            self.auto["processed"][c["id"]] = {**res, "type": c["type"], "time": NOW_IST}
            self.auto["updated"] = f"{DAY}T13:26:{len(self.auto['processed']):02d}"

    def handle(self, route, request):
        url, method = request.url, request.method
        if "/contents/commands.json" in url:
            if method == "PUT":
                if self.fail_put:
                    return route.abort("internetdisconnected")
                body = json.loads(request.post_data)
                if body.get("sha") != str(self.sha):
                    return route.fulfill(status=409, body="{}")
                self.commands = json.loads(base64.b64decode(body["content"]))["commands"]
                self.sha += 1
                self.put_at = time.time()
                return route.fulfill(status=200, json={})
            return route.fulfill(status=200, json={"sha": str(self.sha), "content": self.b64({"commands": self.commands})})
        if "/contents/autotrade.json" in url:
            self.process()
            return route.fulfill(status=200, json={"sha": "x", "content": self.b64(self.auto)})
        if url.rstrip("/").endswith("/repos/me/signal-desk"):
            return route.fulfill(status=200, json={"full_name": "me/signal-desk", "permissions": {"push": True}})
        return route.fulfill(status=404, json={})


results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("PASS " if cond else "FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))


def main():
    site = build_site()
    srv = serve(site)
    port = srv.server_address[1]
    base = f"http://127.0.0.1:{port}/trade/index.html?data=http://127.0.0.1:{port}/md/&signals=http://127.0.0.1:{port}/sig/&repo=me/signal-desk"
    with sync_playwright() as p:
        browser = p.chromium.launch()

        def page_for(token=False, viewport=(1280, 860), gh=None, mobile=False):
            ctx = browser.new_context(viewport={"width": viewport[0], "height": viewport[1]}, is_mobile=mobile, has_touch=mobile)
            ctx.route("https://fonts.googleapis.com/**", lambda r, q: r.fulfill(status=200, body=""))
            ctx.route("https://fonts.gstatic.com/**", lambda r, q: r.fulfill(status=200, body=""))
            if gh:
                ctx.route("https://api.github.com/**", gh.handle)
            if token:
                ctx.add_init_script("localStorage.getItem('signaldesk.gh.token') || localStorage.setItem('signaldesk.gh.token', JSON.stringify('github_pat_TESTTOKEN0123456789abcdef'))")
            pg = ctx.new_page()
            pg.clock.set_system_time(NOW_UTC)
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.on("console", lambda m: m.type == "error" and "404" not in m.text and "Failed to load resource" not in m.text and errs.append(m.text))
            return pg, errs

        # 1. every page renders, no errors, no horizontal overflow (desktop + phone)
        routes = ["dashboard", "market", "watchlist", "fno", "orders", "positions", "holdings", "auto", "history", "settings", "stock-RELIANCE", "index-NIFTY"]
        for vp, mobile in (((1280, 860), False), ((390, 844), True), ((820, 1180), True)):
            pg, errs = page_for(viewport=vp, mobile=mobile, gh=FakeGitHub())
            pg.goto(base + "#dashboard")
            pg.wait_for_selector(".sum", timeout=15000)
            bad = []
            for r in routes:
                pg.evaluate(f"location.hash = '{r}'")
                pg.wait_for_timeout(350)
                w = pg.evaluate("document.documentElement.scrollWidth")
                if w > vp[0]:
                    bad.append(f"{r}:{w}")
                if SHOTS and r in ("dashboard", "positions", "auto", "holdings", "fno", "orders", "settings", "stock-RELIANCE"):
                    pg.screenshot(path=str(SHOTS / f"{vp[0]}-{r}.png"), full_page=(vp[0] > 800))
            check(f"all pages render at {vp[0]}px without errors", not errs, "; ".join(errs[:3]))
            check(f"no horizontal overflow at {vp[0]}px", not bad, ", ".join(bad))
            pg.context.close()

        # 2. order ticket: double tap on Confirm creates one order
        pg, errs = page_for()
        pg.goto(base + "#stock-RELIANCE")
        pg.wait_for_selector(".trade-bar")
        pg.click(".trade-bar .btn.buy")
        pg.fill("#sheetQty", "3")
        pg.click("#sheetPlace")
        pg.dblclick("#sheetGo")
        pg.wait_for_timeout(300)
        acct = pg.evaluate("JSON.parse(localStorage.getItem('signaldesk.paper.account.v1'))")
        check("double-tap Confirm places exactly one order", len([o for o in acct["orders"] if o["inst"] == "EQ:RELIANCE"]) == 1)
        check("holding created with 3 shares", acct["holdings"].get("RELIANCE", {}).get("qty") == 3)

        # 3. own position: Exit -> confirm dialog -> closed; Escape closes dialogs and returns focus
        pg.evaluate("location.hash='stock-SBIN'")
        pg.wait_for_selector(".trade-bar")
        pg.click(".trade-bar .btn.buy")
        pg.click("[data-sprod='MIS']")
        pg.fill("#sheetQty", "10")
        pg.click("#sheetPlace")
        pg.click("#sheetGo")
        pg.evaluate("location.hash='positions'")
        pg.wait_for_selector("[data-exit]")
        btn = pg.locator("[data-exit]").first
        btn.focus()
        btn.press("Enter")
        pg.wait_for_selector(".dialog")
        check("exit dialog shows estimate and paper note", "Estimated P&L" in pg.inner_text(".dialog") and "Paper trade" in pg.inner_text(".dialog"))
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(100)
        check("Escape closes the dialog and returns focus", pg.locator(".dialog").count() == 0 and pg.evaluate("document.activeElement.dataset.exit != null"))
        pg.click("[data-exit]")
        pg.click("#dlgOk")
        pg.wait_for_timeout(300)
        acct = pg.evaluate("JSON.parse(localStorage.getItem('signaldesk.paper.account.v1'))")
        check("manual exit closes own position", acct["positions"]["EQ:SBIN|MIS"]["qty"] == 0)
        check("no Exit button left for a closed position", pg.locator("[data-exit]").count() == 0)
        check("no errors in trading flow", not errs, "; ".join(errs[:3]))
        pg.context.close()

        # 3b. SENSEX options: estimated chain, clearly labelled, tradable in lots of 20
        pg, errs = page_for()
        pg.goto(base + "#fno-SENSEX")
        pg.wait_for_selector("table.oc")
        check("SENSEX chain shows the estimated-prices notice", "Estimated prices" in pg.inner_text("main"))
        pg.locator("table.oc .px-btn").nth(20).click()
        pg.wait_for_selector(".sheet")
        check("order ticket warns the SENSEX price is estimated", "Estimated price" in pg.inner_text(".sheet") and "lot size 20" in pg.inner_text(".sheet"))
        pg.click("#sheetPlace")
        pg.click("#sheetGo")
        pg.wait_for_timeout(300)
        acct = pg.evaluate("JSON.parse(localStorage.getItem('signaldesk.paper.account.v1'))")
        pos = [p for k, p in acct["positions"].items() if k.startswith("OPT:SENSEX:")]
        check("SENSEX option bought: 20 qty", len(pos) == 1 and pos[0]["qty"] == 20)
        if SHOTS:
            pg.goto(base + "#fno-SENSEX"); pg.wait_for_selector("table.oc"); pg.wait_for_timeout(300)
            pg.screenshot(path=str(SHOTS / "sensex-fno.png"))
        check("no errors on SENSEX F&O", not errs, "; ".join(errs[:3]))
        pg.context.close()

        # 4. auto exit without a token asks to connect
        gh = FakeGitHub()
        pg, errs = page_for(gh=gh)
        pg.route("**/sig/autotrade.json*", lambda r, q: r.fulfill(status=200, json=gh.auto))
        pg.goto(base + "#auto")
        pg.wait_for_selector("[data-auto-exit]")
        pg.click("[data-auto-exit]")
        check("without a token, Exit trade explains how to connect", "GitHub token" in pg.inner_text(".dialog"))
        pg.context.close()

        # 5. auto exit with token: confirm -> Exiting… (no double submit) -> reconciled closed
        gh = FakeGitHub()
        gh.mode = "hold"
        pg, errs = page_for(token=True, gh=gh)
        pg.goto(base + "#auto")
        pg.wait_for_selector("[data-auto-exit]")
        pg.click("[data-auto-exit]")
        txt = pg.inner_text(".dialog")
        check("auto exit dialog shows instrument, qty, bid, estimate, disclaimer",
              all(s in txt for s in ("NIFTY", "65 qty", "Current bid", "Estimated net P&L", "can differ")))
        pg.dblclick("#dlgOk")
        pg.wait_for_selector(".exiting")
        check("shows Exiting… and removes the Exit button", pg.locator("[data-auto-exit]").count() == 0)
        pg.wait_for_timeout(1500)
        check("one command sent despite double click", len(gh.commands) == 1, str(gh.commands))
        # 6. refresh while exiting: still Exiting…, never shown as closed before confirmation
        pg.reload()
        pg.wait_for_selector(".exiting", timeout=10000)
        check("after refresh the exit is still shown as in progress", "SIG1" in gh.auto["open"] and pg.locator(".exiting").count() >= 1)
        gh.mode = "done"
        pg.wait_for_function("!document.querySelector('.exiting')", timeout=15000)
        check("position disappears only after the auto-trader confirms", "SIG1" not in gh.auto["open"] and pg.locator("[data-auto-exit]").count() == 0)
        check("command result shown in log", "Sold 65" in pg.inner_text("main"))
        check("re-entry block is shown", "Re-entry blocked" in pg.inner_text("main"))
        check("no errors in auto exit flow", not errs, "; ".join(errs[:3]))
        pg.context.close()

        # 7. network failure while sending: kept open, Try again works
        gh = FakeGitHub()
        gh.fail_put = True
        pg, errs = page_for(token=True, gh=gh)
        pg.goto(base + "#auto")
        pg.wait_for_selector("[data-auto-exit]")
        pg.click("[data-auto-exit]")
        pg.click("#dlgOk")
        pg.wait_for_selector("[data-auto-retry]", timeout=10000)
        check("failed send keeps the position and offers Try again", "SIG1" in gh.auto["open"] and "Couldn't reach GitHub" in pg.inner_text("main"))
        gh.fail_put = False
        pg.click("[data-auto-retry]")
        pg.wait_for_function("!document.querySelector('.exiting') && !document.querySelector('[data-auto-retry]')", timeout=15000)
        check("retry after reconnecting exits the trade", "SIG1" not in gh.auto["open"])
        pg.context.close()

        # 8. auto-trader reports failure: position stays with Exit button
        gh = FakeGitHub()
        gh.mode = "failed"
        pg, errs = page_for(token=True, gh=gh)
        pg.goto(base + "#auto")
        pg.wait_for_selector("[data-auto-exit]")
        pg.click("[data-auto-exit]")
        pg.click("#dlgOk")
        pg.wait_for_function("document.querySelector('[data-auto-exit]') && !document.querySelector('.exiting')", timeout=15000)
        check("rejected exit leaves position open and actionable", "SIG1" in gh.auto["open"] and "nothing was sold" in pg.inner_text("#toasts"))
        pg.context.close()

        # 9. pause and resume
        gh = FakeGitHub()
        pg, errs = page_for(token=True, gh=gh)
        pg.goto(base + "#auto")
        pg.wait_for_selector("[data-auto-pause]")
        pg.click("[data-auto-pause]")
        check("pause dialog explains open trades stay open", "stays open" in pg.inner_text(".dialog"))
        pg.click("#dlgOk")
        pg.wait_for_selector("[data-auto-resume]", timeout=15000)
        check("paused state confirmed by auto-trader", gh.auto["paused"] and "Paused" in pg.inner_text("main"))
        pg.click("[data-auto-resume]")
        pg.click("#dlgOk")
        pg.wait_for_selector("[data-auto-pause]", timeout=15000)
        check("resume works", not gh.auto["paused"])
        pg.context.close()

        # 10. missing market data
        pg, errs = page_for()
        pg.goto(base.replace("/md/", "/nothing-here/") + "#dashboard")
        pg.wait_for_timeout(2500)
        check("missing market data shows a clear message, no crash", "Prices unavailable" in pg.inner_text("main") and not errs, "; ".join(errs[:2]))
        pg.context.close()
        browser.close()
    srv.shutdown()
    shutil.rmtree(site)
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} UI checks passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
