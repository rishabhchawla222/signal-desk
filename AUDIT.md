# Signal Desk – audit (27 Oct 2026)

## Architecture as found

| Part | What it is | Runs on |
|---|---|---|
| `strategy.py`, `indicators.py` | Signal rules (8-condition CALL/PUT setup on 5-min candles) | GitHub Actions |
| `run_live.py`, `notify.py`, `options.py` | Live signal loop, Gmail alerts, NSE option premiums | GitHub Actions (`signals.yml`), writes `signals-data` branch |
| `autotrade.py` | Paper auto-trader that trades each NIFTY signal | inside `run_live.py`, state in `signals-data/autotrade.json` |
| `feed.py` | Market snapshot every 15 s (stocks, indices, futures, option chains) | GitHub Actions (`feed.yml`), writes `market-data` branch |
| `docs/index.html` | Signals dashboard | GitHub Pages (static) |
| `docs/trade/index.html` + `engine.js` | Paper-trading app; account lives in browser `localStorage` | GitHub Pages (static) |

No build step, no framework, no dependencies in the browser. There is no broker integration, so **every order is simulated**
(paper trading). The app had no automated test suite in the repo; tests lived only in a scratch folder.

Data: NSE (indices, futures, option chains, lot sizes) and Yahoo Finance (stock prices), via the feed. All prices shown are real;
nothing in the app is mock data except the clearly labelled sample data on the signals dashboard when opened outside GitHub Pages.

## Bugs and gaps (prioritised)

### Critical
1. **No way to exit an auto-trade manually.** The auto-trader runs on GitHub; the app could only *view* it. A losing auto
   position could only be closed by the strategy. → fixed with a command channel (see "Manual exit" below).
2. **Duplicate exit orders flip a position.** `exitPosition` placed a new market exit every click. With the market closed
   (orders queue as AMO) two clicks queued two exits; when both filled the long became a short. Reproduced in `tests/engine.test.js`.

### High
3. **Auto-trader state shown up to 5 minutes late.** The app read `autotrade.json`/`signals.json` from raw.githubusercontent,
   which caches each URL for 5 minutes and ignores cache-busting query strings.
4. **Trade history not viewable.** Every fill was recorded in `acct.trades`, but no screen showed it; closed positions disappeared the next day.
5. **No pause / emergency stop for the auto-trader** other than editing `config.json` and pushing.
6. **Misleading exit label.** Today's auto-trade (NIFTY 22750 CE) closed as "Stopped at cost after moving SL" but lost ₹897:
   the *index* came back to the entry level while the *option* lost value to time decay and spread. Label now says
   "Index back at entry (stop moved to cost)" and the P&L shown is the option's.
7. **Confirm button could submit twice** on a fast double tap (no in-flight guard).

### Medium
8. Floating-point drift in cash (e.g. `999324.0000000049` after 100 trades). → all money now rounded to paise at every step.
9. Order status vocabulary was internal (`OPEN`, `COMPLETE`, `TRIGGER_PENDING`). → shown as Pending, Trigger pending, Queued (AMO), Filled, Cancelled, Rejected.
10. Dashboard missing: no single place with portfolio value, invested, total/today P&L, open orders, watchlist, auto-trader status.
11. No portfolio value history, so no performance chart.
12. Holdings had no sort or search; positions didn't show stop-loss/target or which ones came from signals.
13. Order sheet had no focus management; Escape closed it but focus was lost.
14. Signals dashboard polls the unauthenticated GitHub API (60 calls/hour); with other tabs open it falls back to cached data.

### Low
15. Chart range "ALL" isn't possible: the feed stores one year of daily closes. Ranges stop at 1Y.
16. Option chain change % on deep ITM strikes is noisy (thin trading) – shown as-is, it's real data.
17. Intraday (MIS) square-off at 3:20 PM needs the app open; if closed, it happens on next open at the last price seen. (Documented; a browser-only app cannot do better.)
18. SENSEX options: BSE blocks free access, so they now trade on clearly labelled **estimated** prices (NIFTY-smile model); real prices would need a data vendor.

## Status (all fixed unless marked)
| # | Fix |
|---|---|
| 1 | Exit / Pause / Resume / Stop & exit all / Allow re-entry from the app via the `control` branch; applied once per command id; result reported back in `autotrade.json` |
| 2 | Second exit refused while one is pending; idempotent `clientId` on every order |
| 3 | With a token the app reads `autotrade.json` through the GitHub API (fresh); without one it says the data may be ~5 min old |
| 4 | New **Trade history** page (your trades + auto-trader trades) |
| 5 | Pause (emergency stop for new entries) on Dashboard and Auto trading |
| 6 | Exit label fixed; P&L shown is always the option's |
| 7 | In-flight guard + idempotent order id on Confirm |
| 8 | Money rounded to the paisa at every step |
| 9 | User-facing status labels |
| 10–12 | New Dashboard, equity history chart, holdings search/sort/allocation, positions show SL/target and realized/unrealized |
| 13 | Dialogs and order ticket trap focus, close on Escape, return focus |
| 14 | Not changed (signals dashboard is read-only and falls back gracefully) |
| 15–18 | Documented limitations |

## Tests
* `node --test tests/engine.test.js tests/control.test.js` – 26 engine and control-client cases
* `python -m unittest discover -s tests` – 15 auto-trader cases (manual exit, races, retries, pause, re-entry, restart)
* `python tests/ui_test.py` – 29 browser checks (every page at 390/820/1280 px, order double-tap, manual exits,
  refresh during exit, network failure + retry, rejected exit, pause/resume, missing data)
All run on every push via `.github/workflows/tests.yml`.
