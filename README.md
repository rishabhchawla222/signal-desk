# Signal Desk — personal NIFTY / SENSEX call & put signals

A personal tool that watches NIFTY and SENSEX every 5 minutes from 9:15 AM to 3:15 PM IST,
and emails you when a strict buy-CALL or buy-PUT setup appears — plus stop-loss updates and exits.
A dashboard website shows the live picture.

**Cost: ₹0.** Everything runs on free services you own:

| Part | Runs on | Cost |
|---|---|---|
| Signal engine (Python) | GitHub Actions (your account) | Free for public repositories |
| Website | GitHub Pages (your account) | Free |
| Market data | Yahoo Finance 5-min candles | Free (can lag 1–3 min) |
| Alerts | Your Gmail | Free |

---

## One-time setup (about 20 minutes)

### 1. Create the repository
1. Sign in (or sign up) at **github.com**.
2. Click **+ → New repository**. Name it e.g. `signal-desk`. Choose **Public** (free unlimited
   Actions minutes; a private repo would run out of the free monthly minutes). Click **Create**.
3. On the new repo page click **uploading an existing file**, then drag in **everything inside**
   the unzipped `signal-desk` folder (including the `.github` folder). Click **Commit changes**.
   > On Mac, hidden folders like `.github` may not show in Finder: press **Cmd + Shift + .** to show them.
   > Check that the repo now shows a `.github/workflows` folder.

### 2. Make a Gmail App Password (for sending alerts)
1. Go to **myaccount.google.com → Security** and turn on **2-Step Verification** if it's off.
2. Search **"App passwords"** at the top of your Google Account page, create one named
   `Signal Desk`, and copy the 16-character password.

### 3. Add your secrets to GitHub
In your repo: **Settings → Secrets and variables → Actions → New repository secret**. Add:

| Name | Value |
|---|---|
| `SMTP_USER` | your Gmail address |
| `SMTP_PASS` | the 16-character App Password (no spaces) |
| `EMAIL_TO` | address to receive alerts (can be the same Gmail) |

Secrets are encrypted and never visible in the public repo.

### 4. Turn on the website
**Settings → Pages →** Source: **Deploy from a branch**, Branch: **main**, folder **/docs** → **Save**.
After a minute your site is at `https://<your-username>.github.io/signal-desk/`.

Optional: **Settings → Secrets and variables → Actions → Variables tab → New variable**
`DASHBOARD_URL` = that address, so every email has an "Open dashboard" button.

### 5. Allow the workflows to save data
**Settings → Actions → General → Workflow permissions →** select **Read and write permissions** → **Save**.

### 6. Test it
Open the **Actions** tab (click "I understand… enable" if asked), then:
1. **Test email → Run workflow.** You should get a "✅ Signal Desk test email" within a minute.
2. **Backtest → Run workflow.** Takes ~1 minute. Then open your website → *Track record → Backtest*.
3. **Live signals** starts by itself every weekday at 8:50 AM IST. Nothing else to do.

---

## How the signals work

Every closed 5-minute candle, for each index, the engine checks 8 conditions:

| # | Buy CALL | Buy PUT |
|---|---|---|
| 1 | Close above the 9:15–9:30 range high | Close below the range low |
| 2 | EMA 9 above EMA 21 | EMA 9 below EMA 21 |
| 3 | Supertrend (10, 3) bullish | Supertrend bearish |
| 4 | RSI 55–75 (momentum, not exhausted) | RSI 25–45 |
| 5 | ADX ≥ 20 (market actually trending) | same |
| 6 | 15-minute trend up | 15-minute trend down |
| 7 | Strong bullish candle | Strong bearish candle |
| 8 | Not stretched more than 1.2× ATR from EMA 21 | same |

A signal fires **only when all 8 become true together**. Then:
- **Stop-loss** at the Supertrend line (kept between 0.5× and 1.5× ATR), **target** at 1.5× the risk.
- When price moves 1× risk in your favour you get an email to **move the stop-loss to cost**.
- **Exit email** when target/stop is hit, the trend flips, or at **3:15 PM** square-off.
- At most **2 signals per index per day**, no new entries after **2:45 PM**, and a 30-minute pause after a loss.
- Daily summary email after the close.

Many days will have **zero signals**. That's by design.

Levels in emails are **index (spot) levels**. The suggested option is the at-the-money strike;
pick the nearest available expiry. An ATM option moves roughly half the index points.

## Changing settings
Edit `config.json` on GitHub (pencil icon → Commit). Examples:
- Switch indices: set `"enabled": true` or `false` per index (BANKNIFTY is included but off).
- More/fewer signals: `max_trades_per_index`, `adx_min`, RSI bands.
- Wider target: `reward_risk` (e.g. 2.0).

After changing rules, run **Backtest** again to see the effect before trusting them.

## Good to know
- **Holidays** are detected automatically (no data → engine stops for the day).
- GitHub scheduled runs can occasionally start a few minutes late; the engine starts at 8:50 to leave room.
- The website updates within about 1–2 minutes of each candle; **email is the fastest alert**.
  Turn on Gmail notifications on your phone for these emails.
- If GitHub ever shows *"scheduled workflow disabled due to inactivity"*, open Actions and click **Enable**.
- The repo is public, so anyone who finds the link could see the signals. Your email and password stay secret.

## Run on your own computer instead (optional)
```
pip install -r requirements.txt
SMTP_USER=you@gmail.com SMTP_PASS=xxxx python run_live.py --no-git --data-dir data-branch
```

## Files
| File | What it does |
|---|---|
| `strategy.py` | The signal rules and trade management |
| `indicators.py` | EMA, RSI, ATR, Supertrend, ADX |
| `data.py` | Downloads 5-min candles from Yahoo Finance |
| `run_live.py` | Live loop, saves data, sends emails |
| `backtest.py` | Tests the same rules on the last ~60 days |
| `notify.py` | Gmail alerts |
| `docs/index.html` | The dashboard website |
| `.github/workflows/` | Schedules (live signals, weekly backtest, test email) |

---
*Personal tool. Automated technical signals, not investment advice. Intraday option buying is high risk;
size positions so a stop-loss never hurts badly.*
