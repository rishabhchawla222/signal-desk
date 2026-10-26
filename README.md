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
- GitHub scheduled runs often start 15–60 minutes late, so the engine is scheduled from 7:45 AM with backup start times; it waits for 9:15 by itself.
- Each signal has a **buy window** (10 minutes) and a **don't-chase level**. If the price has already run past it when the email goes out, the subject starts with "⚠️ DON'T CHASE".
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

---

## Paper trading app

Your site also has a Groww-style **paper trading app** at `https://<your-username>.github.io/signal-desk/trade/`.
Trade with virtual money (₹10,00,000 to start) on live prices:

- **Stocks:** all ~210 F&O stocks, Delivery or Intraday, Market / Limit / Stop-loss / SL-Market orders
- **F&O:** option chains for NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY and 20 popular stocks; index and stock futures
- **Portfolio:** positions with live P&L, holdings, funds, orders (open / today / history), charges
- Real lot sizes from NSE, approximate margins and 2026 charges (incl. the new F&O STT)
- Intraday positions close at 3:20 PM; unfilled orders lapse at 3:30 PM; F&O settles on expiry
- Orders placed while the market is closed run at the next open
- Today's Signal Desk signal shows up with a one-tap "Paper trade" button

**How prices get there:** the *Market feed* workflow runs on weekdays from ~8:40 AM to 3:40 PM and saves a snapshot every
minute to the `market-data` branch (NSE for indices, futures, option chains and lot sizes; Yahoo Finance for stock prices).
Prices can lag 1–2 minutes. Orders don't fill on prices older than 5 minutes.

**Your account lives in your browser.** Use *Portfolio → Funds → Download backup* to move it to another device.

To add option chains for more stocks, edit `stock_chains` in `feed_config.json`.

Nothing here places real orders. To trade for real later, the order screen would need to be connected to a broker API
(which needs a fixed IP address under SEBI's 2026 rules).

### Auto-trader (paper)

Every market day the signal engine also trades its own signals in a **virtual account** (₹10,00,000 to start):
it buys each NIFTY signal (1 lot) at the live NSE ask price and sells at the live bid when the signal exits
(target, stop-loss, trend flip or 3:15 PM). Charges are included. SENSEX signals are skipped because their option
prices are only estimates. Signals where the price already ran past the don't-chase level are skipped too.

See it in the app under **Portfolio → Auto-trader**; every signal email and the daily summary say what it did.
Settings are in `config.json` → `autotrade` (`lots`, `indices`, `start_cash`, `enabled`).
The account is stored in `autotrade.json` on the `signals-data` branch; delete that file to start over.
