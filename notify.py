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
              "Levels are on the index (spot). Option prices move differently; always use a stop-loss.")


def send_email(subject: str, text: str, html: str | None = None) -> bool:
    user = os.getenv("SMTP_USER")
    pw = os.getenv("SMTP_PASS")
    to = os.getenv("EMAIL_TO") or user
    if not user or not pw:
        print(f"[email skipped – not configured] {subject}")
        return False
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f"Signal Desk <{user}>"
    msg["To"] = to
    msg.set_content(text)
    if html:
        msg.add_alternative(html, subtype="html")
    host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    port = int(os.getenv("SMTP_PORT", "465"))
    for attempt in range(3):
        try:
            with smtplib.SMTP_SSL(host, port, timeout=30) as s:
                s.login(user, pw)
                s.send_message(msg)
            print(f"[email sent] {subject}")
            return True
        except Exception as e:  # noqa: BLE001
            print(f"[email error attempt {attempt + 1}] {e}")
    return False


def _fmt(x):
    return f"{x:,.2f}" if isinstance(x, (int, float)) else str(x)


def _wrap(title: str, color: str, rows: list[tuple[str, str]], extra: str = "") -> str:
    link = os.getenv("DASHBOARD_URL")
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


def event_email(ev: dict) -> tuple[str, str, str]:
    t = ev["trade"]
    side = t["side"]
    if ev["type"] == "ENTRY":
        color = "#0a8f4e" if side == "CALL" else "#c62828"
        emoji = "🟢" if side == "CALL" else "🔴"
        title = f"BUY {t['option']}"
        subject = f"{emoji} BUY {side}: {t['option']} | spot {_fmt(t['entry'])} | SL {_fmt(t['sl'])} | TGT {_fmt(t['target'])}"
        rows = [("Action", f"Buy {t['option']} (nearest expiry)"),
                ("Signal time", t["entry_time"].replace("T", " ")[:16] + " IST"),
                (f"{t['index']} spot at signal", _fmt(t["entry"])),
                ("Stop-loss (spot)", _fmt(t["sl"])),
                ("Target (spot)", _fmt(t["target"])),
                ("Risk (index points)", _fmt(t["risk"]))]
        extra = ("<p style='margin:12px 0 4px;font-weight:600;'>Why</p><ul>"
                 + "".join(f"<li>{r}</li>" for r in t["reasons"]) + "</ul>")
        text = "\n".join(f"{k}: {v}" for k, v in rows) + "\nWhy: " + "; ".join(t["reasons"]) + "\n\n" + DISCLAIMER
        return subject, text, _wrap(title, color, rows, extra)
    if ev["type"] == "UPDATE":
        subject = f"🟡 {t['option']}: {ev['message']}"
        rows = [("Update", ev["message"]), ("Entry (spot)", _fmt(t["entry"])),
                ("New stop-loss", _fmt(t["sl"])), ("Target", _fmt(t["target"]))]
        text = "\n".join(f"{k}: {v}" for k, v in rows)
        return subject, text, _wrap(f"Update: {t['option']}", "#b7791f", rows)
    # EXIT
    pts = t["points"]
    sign = "+" if pts >= 0 else ""
    subject = f"⚪ EXIT {t['option']} — {t['note']} ({sign}{pts} pts)"
    rows = [("Action", f"Exit {t['option']}"), ("Reason", t["note"]),
            ("Entry → Exit (spot)", f"{_fmt(t['entry'])} → {_fmt(t['exit'])}"),
            ("Result (index points)", f"{sign}{pts}  ({sign}{t['r_multiple']}R)"),
            ("Exit time", t["exit_time"].replace("T", " ")[:16] + " IST")]
    text = "\n".join(f"{k}: {v}" for k, v in rows)
    return subject, text, _wrap(f"EXIT {t['option']}", "#455a64", rows)


def summary_email(day: str, trades: list[dict]) -> tuple[str, str, str]:
    closed = [t for t in trades if t.get("status") == "CLOSED"]
    total_r = round(sum(t.get("r_multiple", 0) for t in closed), 2)
    wins = sum(1 for t in closed if t.get("points", 0) > 0)
    if not trades:
        subject = f"📊 {day}: no signals today"
        text = "No setup met all conditions today. No trade is also a decision."
        return subject, text, _wrap(f"Daily summary · {day}", "#37474f", [("Signals", "0"), ("Note", text)])
    rows = [("Signals", str(len(trades))), ("Winners", f"{wins}/{len(closed)}"), ("Net result", f"{total_r:+}R")]
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
