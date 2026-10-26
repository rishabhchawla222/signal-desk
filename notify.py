"""Email alerts through Gmail (free). Configure with environment variables:
SMTP_USER  - your Gmail address
SMTP_PASS  - a Gmail *App Password* (not your normal password)
EMAIL_TO   - where to send alerts (defaults to SMTP_USER)
DASHBOARD_URL - optional link to your website, added to every email
"""
import os
import smtplib
import sys
from email.message import EmailMessage

DISCLAIMER = ("Automated technical signal for personal use only. Not investment advice. "
              "NIFTY premiums are live from NSE at the time of the email; SENSEX premiums are estimates. "
              "Prices move fast – always use a stop-loss.")


def send_email(subject: str, text: str, html: str | None = None) -> bool:
    user = os.getenv("SMTP_USER")
    pw = os.getenv("SMTP_PASS")
    # EMAIL_TO can hold several addresses separated by commas or semicolons
    # Each recipient gets a separate copy, so nobody sees the other addresses.
    raw = (os.getenv("EMAIL_TO") or user or "").replace(";", ",")
    recipients = list(dict.fromkeys(a.strip() for a in raw.split(",") if a.strip()))
    if not user or not pw or not recipients:
        print(f"[email skipped – not configured] {subject}")
        return False
    host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    port = int(os.getenv("SMTP_PORT", "465"))
    pending = recipients[:]
    for attempt in range(3):
        try:
            with smtplib.SMTP_SSL(host, port, timeout=30) as s:
                s.login(user, pw)
                while pending:
                    msg = EmailMessage()
                    msg["Subject"] = subject
                    msg["From"] = f"Signal Desk <{user}>"
                    msg["To"] = pending[0]
                    msg.set_content(text)
                    if html:
                        msg.add_alternative(html, subtype="html")
                    s.send_message(msg)
                    pending.pop(0)
            print(f"[email sent to {len(recipients)}] {subject}")
            return True
        except Exception as e:  # noqa: BLE001
            print(f"[email error attempt {attempt + 1}] {e}")
    print(f"[email not sent to {len(pending)} of {len(recipients)}]")
    return len(pending) < len(recipients)


def _fmt(x):
    return f"{x:,.2f}" if isinstance(x, (int, float)) else str(x)


def _wrap(title: str, color: str, rows: list[tuple[str, str]], extra: str = "") -> str:
    link = os.getenv("DASHBOARD_URL") or "https://rishabhchawla222.github.io/signal-desk/"
    trs = "".join(
        f"<tr><td style='padding:6px 12px;color:#667;'>{k}</td>"
        f"<td style='padding:6px 12px;font-weight:600;'>{v}</td></tr>" for k, v in rows
    )
    btn = (f"<p><a href='{link}' style='background:#111;color:#fff;padding:10px 16px;"
           f"border-radius:6px;text-decoration:none;'>Open dashboard</a></p>") if link else ""
    return (f"<div style='font-family:Arial,sans-serif;max-width:520px;'>"
            f"<div style='background:{color};color:#fff;padding:14px 16px;border-radius:8px 8px 0 0;"
            f"font-size:18px;font-weight:700;'>{title}</div>"
            f"<table style='border:1px solid #ddd;border-top:0;width:100%;border-collapse:collapse;'>{trs}</table>"
            f"{extra}{btn}<p style='color:#888;font-size:12px;'>{DISCLAIMER}</p></div>")


def _inr(x: float, nd: int = 2) -> str:
    """Indian digit grouping: 1002519.48 -> 10,02,519.48"""
    neg = x < 0
    whole, _, frac = f"{abs(x):.{nd}f}".partition(".")
    head, tail = whole[:-3], whole[-3:]
    while len(head) > 2:
        tail = head[-2:] + "," + tail
        head = head[:-2]
    out = (head + "," + tail if head else tail) + ("." + frac if nd else "")
    return ("-" if neg else "") + out


def _rs(x):
    return f"₹{_inr(x)}" if isinstance(x, (int, float)) else "—"


def _exp(p):
    from datetime import date
    try:
        return date.fromisoformat(p["expiry"]).strftime("%d %b")
    except Exception:  # noqa: BLE001
        return "nearest"


def event_email(ev: dict) -> tuple[str, str, str]:
    t = ev["trade"]
    side = t["side"]
    p = t.get("premium") or {}
    est = "≈" if p.get("estimated") else ""
    if ev["type"] == "ENTRY":
        color = "#0a8f4e" if side == "CALL" else "#c62828"
        emoji = "🟢" if side == "CALL" else "🔴"
        title = f"BUY {t['option']}" + (f" @ {est}{_rs(p['price'])}" if p else "")
        until = (t.get("valid_until") or "")[11:16]
        cmp_ = "below" if side == "CALL" else "above"
        window = ([("Buy window", f"Now until {until} IST"),
                   ("Buy only if " + t["index"] + " is", f"{cmp_} {_fmt(t['chase_limit'])}")]
                  if until and t.get("chase_limit") else [])
        if p:
            subject = (f"{emoji} BUY {t['option']} @ {est}{_rs(p['price'])} | SL {est}{_rs(p['sl'])} | "
                       f"TGT {est}{_rs(p['target'])} | {_exp(p)} expiry")
            rows = [("Action", f"Buy {t['option']} · {_exp(p)} expiry"), *window,
                    ("Buy price (premium)", f"{est}{_rs(p['price'])}"
                     + (f"  (bid {_rs(p.get('bid'))} / ask {_rs(p.get('ask'))})" if not p.get("estimated") else "")),
                    ("Don't pay more than", _rs(p["buy_upto"])),
                    ("Stop-loss (premium)", f"{est}{_rs(p['sl'])}"),
                    ("Target (premium)", f"{est}{_rs(p['target'])}"),
                    ("Price source", p["source"] + (f", at {p['time'][11:16]} IST" if p.get("time") else ""))]
        else:
            subject = f"{emoji} BUY {t['option']} | spot {_fmt(t['entry'])} | SL {_fmt(t['sl'])} | TGT {_fmt(t['target'])}"
            rows = [("Action", f"Buy {t['option']} (nearest expiry)"), *window,
                    ("Buy price (premium)", "Live price unavailable – check your broker app")]
        a = t.get("auto")
        if a and a.get("status") == "bought":
            rows.insert(1, ("Auto-trader (paper)", f"Bought {a['qty']} @ {_rs(a['price'])} in the virtual account"))
        elif a and a.get("status") == "skipped":
            rows.insert(1, ("Auto-trader (paper)", f"Skipped – {a['reason']}"))
        rows += [("Signal time", t["entry_time"].replace("T", " ")[:16] + " IST"),
                 (f"{t['index']} spot at signal", _fmt(t["entry"])),
                 ("Stop-loss / target (spot)", f"{_fmt(t['sl'])} / {_fmt(t['target'])}")]
        if until:
            subject += f" | buy till {until}"
        note = ""
        if t.get("late"):
            subject = "⚠️ DON'T CHASE – " + subject
            title = "Price already moved – don't chase"
            color = "#b7791f"
            note = (f"<p style='background:#fff6e0;border:1px solid #f0c36d;padding:8px 10px;border-radius:6px;'>"
                    f"{t['index']} was already at {_fmt(p.get('spot_now'))} when this email was sent, past the "
                    f"don't-chase level {_fmt(t['chase_limit'])}. Only buy if it comes back {cmp_} that level "
                    f"before {until}.</p>")
        elif p.get("estimated"):
            note = ("<p style='background:#fff6e0;border:1px solid #f0c36d;padding:8px 10px;border-radius:6px;'>"
                    "SENSEX premiums are <b>estimated</b> (BSE has no free live feed). Check the live price in your "
                    "broker app before buying and adjust SL/target by the same difference.</p>")
        elif p:
            note = ("<p style='color:#555;font-size:13px;'>Premium SL/target are where the option should be when "
                    "NIFTY reaches the spot SL/target. Exit on whichever happens first.</p>")
        extra = (note + "<p style='margin:12px 0 4px;font-weight:600;'>Why</p><ul>"
                 + "".join(f"<li>{r}</li>" for r in t["reasons"]) + "</ul>")
        text = "\n".join(f"{k}: {v}" for k, v in rows) + "\nWhy: " + "; ".join(t["reasons"]) + "\n\n" + DISCLAIMER
        return subject, text, _wrap(title, color, rows, extra)
    if ev["type"] == "UPDATE":
        subject = f"🟡 {t['option']}: {ev['message']}"
        rows = [("Update", ev["message"])]
        if p:
            rows += [("Your buy price", f"{est}{_rs(p['price'])}"),
                     ("New stop-loss (premium)", f"around your buy price {est}{_rs(p['price'])}")]
            if p.get("now"):
                rows.append(("Premium now", f"{'≈' if p.get('now_estimated') else ''}{_rs(p['now'])}"))
            rows.append(("Target (premium)", f"{est}{_rs(p['target'])}"))
        rows += [("New stop-loss (spot)", _fmt(t["sl"])), ("Target (spot)", _fmt(t["target"]))]
        text = "\n".join(f"{k}: {v}" for k, v in rows)
        return subject, text, _wrap(f"Update: {t['option']}", "#b7791f", rows)
    # EXIT
    pts = t["points"]
    sign = "+" if pts >= 0 else ""
    if p.get("exit_price") is not None:
        e2 = "≈" if p.get("exit_price_estimated") else ""
        pnl = p.get("pnl", 0)
        subject = f"⚪ EXIT {t['option']} @ {e2}{_rs(p['exit_price'])} — {t['note']} ({'+' if pnl >= 0 else ''}{pnl:.2f}/unit)"
        rows = [("Action", f"Sell / exit {t['option']} now"),
                ("Exit price (premium)", f"{e2}{_rs(p['exit_price'])}"),
                ("Bought at", f"{est}{_rs(p['price'])}"),
                ("Profit / loss per unit", f"{'+' if pnl >= 0 else ''}₹{pnl:,.2f}"),
                ("Reason", t["note"])]
    else:
        subject = f"⚪ EXIT {t['option']} — {t['note']} ({sign}{pts} pts)"
        rows = [("Action", f"Sell / exit {t['option']} now"), ("Reason", t["note"])]
    a = t.get("auto")
    if a and a.get("status") == "sold":
        rows.insert(1, ("Auto-trader (paper)", f"Sold {a['qty']} @ {_rs(a['price'])} (bought {_rs(a['buy_price'])}) · "
                                               f"net {'+' if a['net'] >= 0 else '−'}₹{_inr(abs(a['net']))} after charges"))
    rows += [("Entry → Exit (spot)", f"{_fmt(t['entry'])} → {_fmt(t['exit'])}"),
             ("Result (index points)", f"{sign}{pts}  ({sign}{t['r_multiple']}R)"),
             ("Exit time", t["exit_time"].replace("T", " ")[:16] + " IST")]
    text = "\n".join(f"{k}: {v}" for k, v in rows)
    return subject, text, _wrap(f"EXIT {t['option']}", "#455a64", rows)


def summary_email(day: str, trades: list[dict], auto_day: dict | None = None,
                  auto_all: dict | None = None) -> tuple[str, str, str]:
    closed = [t for t in trades if t.get("status") == "CLOSED"]
    total_r = round(sum(t.get("r_multiple", 0) for t in closed), 2)
    wins = sum(1 for t in closed if t.get("points", 0) > 0)
    if not trades:
        subject = f"📊 {day}: no signals today"
        text = "No setup met all conditions today. No trade is also a decision."
        return subject, text, _wrap(f"Daily summary · {day}", "#37474f", [("Signals", "0"), ("Note", text)])
    rows = [("Signals", str(len(trades))), ("Winners", f"{wins}/{len(closed)}"), ("Net result", f"{total_r:+}R")]
    if auto_day is not None:
        rows.append(("Auto-trader today", f"{auto_day['trades']} trade(s), net {'+' if auto_day['net'] >= 0 else '−'}₹{_inr(abs(auto_day['net']))}"))
    if auto_all is not None:
        tot = auto_all["value"] - auto_all["start_cash"]
        rows.append(("Auto-trader account", f"{_rs(auto_all['value'])} ({'+' if tot >= 0 else '−'}₹{_inr(abs(tot), 0)} since start)"))
    for t in trades:
        res = f"{t.get('points', 0):+} pts ({t.get('outcome', 'OPEN')})" if t.get("status") == "CLOSED" else "open"
        rows.append((f"{t['entry_time'][11:16]} {t['option']}", res))
    subject = f"📊 {day}: {len(trades)} signal(s), net {total_r:+}R"
    text = "\n".join(f"{k}: {v}" for k, v in rows)
    return subject, text, _wrap(f"Daily summary · {day}", "#37474f", rows)


if __name__ == "__main__":
    if "--test" in sys.argv:
        ok = send_email("✅ Signal Desk test email",
                        "If you can read this, email alerts are working.",
                        _wrap("Email alerts are working", "#0a8f4e",
                              [("Status", "Connected"), ("Next", "You'll get signals here on market days")]))
        sys.exit(0 if ok else 1)
