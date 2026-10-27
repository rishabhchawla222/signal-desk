// Paper-trading engine tests. Run: node --test tests/
// Uses a frozen real market snapshot (tests/fixtures) so results are repeatable.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const E = require("../docs/trade/engine.js");

const F = p => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", p)));
const BASE = { quotes: F("quotes.json"), chains: F("chains.json"), universe: F("universe.json") };
const DAY = BASE.quotes.ts.slice(0, 10);
const clone = o => JSON.parse(JSON.stringify(o));
const at = (hhmm, date = DAY) => new Date(`${date}T${hhmm}:00+05:30`);
/** market data as if published at hh:mm (so it's fresh at that time) */
const data = (hhmm, date = DAY, mut) => { const d = clone(BASE); d.quotes.ts = `${date}T${hhmm}:00`; if (mut) mut(d); return d; };
const r2 = x => Math.round(x * 100) / 100;
const nifty = () => {
  const k = Object.keys(BASE.chains.chains).filter(x => x.startsWith("NIFTY|")).sort()[0];
  const ch = BASE.chains.chains[k];
  const row = ch.rows.reduce((b, x) => Math.abs(x[0] - ch.spot) < Math.abs(b[0] - ch.spot) ? x : b);
  return { exp: ch.exp, row, key: `OPT:NIFTY:${ch.exp}:${row[0]}:CE`, lot: BASE.universe.lots.NIFTY };
};

test("delivery buy fills at market and debits value + charges", () => {
  const a = E.newAccount(1e6), d = data("13:25");
  const r = E.placeOrder(a, { inst: "EQ:RELIANCE", side: "BUY", qty: 10, product: "CNC" }, d, at("13:25"));
  assert.equal(r.order.status, "COMPLETE");
  assert.equal(a.holdings.RELIANCE.qty, 10);
  assert.equal(a.cash, r2(1e6 - 10 * d.quotes.stocks.RELIANCE.p - r.order.charges));
});

test("cannot sell more than holdings", () => {
  const a = E.newAccount(1e6), d = data("13:25");
  E.placeOrder(a, { inst: "EQ:RELIANCE", side: "BUY", qty: 10, product: "CNC" }, d, at("13:25"));
  const r = E.placeOrder(a, { inst: "EQ:RELIANCE", side: "SELL", qty: 11, product: "CNC" }, d, at("13:25"));
  assert.equal(r.ok, false);
  assert.equal(r.order.status, "REJECTED");
  assert.match(r.error, /at most 10/);
});

test("limit order waits, blocks funds, then fills at the better price", () => {
  const a = E.newAccount(1e6), d = data("13:25");
  const p0 = d.quotes.stocks.INFY.p;
  const r = E.placeOrder(a, { inst: "EQ:INFY", side: "BUY", qty: 5, product: "CNC", type: "LIMIT", price: r2(p0 * 0.99) }, d, at("13:25"));
  assert.equal(r.order.status, "OPEN");
  assert.ok(E.summary(a, d).pending > 0);
  const d2 = data("13:30", DAY, x => { x.quotes.stocks.INFY.p = r2(p0 * 0.985); });
  E.process(a, d2, at("13:30"));
  assert.equal(r.order.status, "COMPLETE");
  assert.equal(r.order.fillPrice, r2(p0 * 0.985));
  assert.equal(E.summary(a, d2).pending, 0);
});

test("stop-loss market sell triggers only when price falls through", () => {
  const a = E.newAccount(1e6), d = data("13:25"), p0 = d.quotes.stocks.TCS.p;
  E.placeOrder(a, { inst: "EQ:TCS", side: "BUY", qty: 2, product: "CNC" }, d, at("13:25"));
  const r = E.placeOrder(a, { inst: "EQ:TCS", side: "SELL", qty: 2, product: "CNC", type: "SL-M", trigger: r2(p0 * 0.98) }, d, at("13:25"));
  assert.equal(r.order.status, "TRIGGER_PENDING");
  E.process(a, data("13:26", DAY, x => { x.quotes.stocks.TCS.p = r2(p0 * 0.99); }), at("13:26"));
  assert.equal(r.order.status, "TRIGGER_PENDING");
  E.process(a, data("13:27", DAY, x => { x.quotes.stocks.TCS.p = r2(p0 * 0.97); }), at("13:27"));
  assert.equal(r.order.status, "COMPLETE");
  assert.equal(a.holdings.TCS, undefined);
});

test("invalid stop-loss trigger is rejected", () => {
  const a = E.newAccount(1e6), d = data("13:25");
  const r = E.placeOrder(a, { inst: "EQ:SBIN", side: "SELL", qty: 1, product: "MIS", type: "SL-M", trigger: d.quotes.stocks.SBIN.p * 1.01 }, d, at("13:25"));
  assert.equal(r.ok, false);
  assert.match(r.error, /below the current/);
});

test("intraday short: P&L sign and auto square-off at 3:20", () => {
  const a = E.newAccount(1e6), d = data("13:25"), p0 = d.quotes.stocks.SBIN.p;
  E.placeOrder(a, { inst: "EQ:SBIN", side: "SELL", qty: 100, product: "MIS" }, d, at("13:25"));
  const ev = E.process(a, data("15:20", DAY, x => { x.quotes.stocks.SBIN.p = r2(p0 - 2); }), at("15:20"));
  const p = a.positions["EQ:SBIN|MIS"];
  assert.equal(p.qty, 0);
  assert.ok(ev.some(e => e.order && e.order.tag === "SQUAREOFF"));
  assert.equal(p.realized, 200); // short gains when price falls
  const r = E.placeOrder(a, { inst: "EQ:SBIN", side: "BUY", qty: 1, product: "MIS" }, data("15:21"), at("15:21"));
  assert.equal(r.ok, false);
});

test("option buy fills at ask, exit at bid, realized P&L exact", () => {
  const n = nifty(), a = E.newAccount(5e5), d = data("13:25");
  const r = E.placeOrder(a, { inst: n.key, side: "BUY", qty: n.lot, product: "NRML" }, d, at("13:25"));
  assert.equal(r.order.fillPrice, n.row[4]);
  assert.equal(r2(E.summary(a, d).used), r2(n.lot * n.row[4]));
  const d2 = data("13:30", DAY, x => { const row = x.chains.chains[`NIFTY|${n.exp}`].rows.find(y => y[0] === n.row[0]); row[1] += 20; row[3] += 20; row[4] += 20; });
  const x = E.exitPosition(a, `${n.key}|NRML`, d2, at("13:30"));
  assert.equal(x.order.status, "COMPLETE");
  assert.equal(a.positions[`${n.key}|NRML`].realized, r2((n.row[3] + 20 - n.row[4]) * n.lot));
});

test("non-lot quantities and unaffordable option selling are rejected", () => {
  const n = nifty(), d = data("13:25");
  assert.match(E.placeOrder(E.newAccount(5e5), { inst: n.key, side: "BUY", qty: 7, product: "NRML" }, d, at("13:25")).error, /lot size/);
  assert.match(E.placeOrder(E.newAccount(5e4), { inst: n.key, side: "SELL", qty: n.lot, product: "NRML" }, d, at("13:25")).error, /Not enough funds/);
});

test("futures settle at the index on expiry day after 3:30", () => {
  const fk = Object.keys(BASE.quotes.futures).find(k => k.startsWith("FUT:NIFTY:"));
  const exp = fk.split(":")[2], lot = BASE.universe.lots.NIFTY, a = E.newAccount(2e6);
  const tradeDay = exp < DAY ? exp : DAY;
  const r = E.placeOrder(a, { inst: fk, side: "BUY", qty: lot, product: "NRML" }, data("13:25", tradeDay), at("13:25", tradeDay));
  assert.ok(r.ok);
  const ev = E.process(a, data("15:35", exp, x => { x.quotes.indices.NIFTY.p = r.order.fillPrice + 100; }), at("15:35", exp));
  assert.ok(ev.some(e => e.order && e.order.tag === "EXPIRY"));
  assert.equal(a.positions[`${fk}|NRML`].qty, 0);
});

test("orders placed after close queue as AMO and fill at next open", () => {
  const a = E.newAccount(1e5);
  const r = E.placeOrder(a, { inst: "EQ:ITC", side: "BUY", qty: 10, product: "CNC" }, data("15:35", DAY, x => { x.quotes.market.status = "Closed"; }), at("15:40"));
  assert.equal(r.order.amo, true);
  assert.equal(E.statusLabel(r.order), "Queued (AMO)");
  const next = E.nextWeekday(DAY);
  E.process(a, data("09:16", next), at("09:16", next));
  assert.equal(r.order.status, "COMPLETE");
});

test("unfilled day orders lapse at 3:30 and release blocked funds", () => {
  const a = E.newAccount(1e5), d = data("13:25");
  const r = E.placeOrder(a, { inst: "EQ:ITC", side: "BUY", qty: 10, product: "CNC", type: "LIMIT", price: r2(d.quotes.stocks.ITC.p * 0.9) }, d, at("13:25"));
  E.process(a, data("15:31"), at("15:31"));
  assert.equal(r.order.status, "CANCELLED");
  assert.equal(E.summary(a, d).available, 1e5);
});

test("stale prices (>5 min) never fill a market order", () => {
  const a = E.newAccount(1e5);
  const r = E.placeOrder(a, { inst: "EQ:ITC", side: "BUY", qty: 1, product: "CNC" }, data("13:00"), at("13:25"));
  assert.equal(r.order.status, "OPEN");
});

test("missing market data: no price -> order rejected, nothing debited", () => {
  const a = E.newAccount(1e5);
  const r = E.placeOrder(a, { inst: "EQ:NOSUCHSTOCK", side: "BUY", qty: 1, product: "CNC" }, data("13:25"), at("13:25"));
  assert.equal(r.ok, false);
  assert.equal(a.cash, 1e5);
});

// ---- audit fixes -------------------------------------------------------
test("double exit is refused (critical bug: used to flip the position)", () => {
  const a = E.newAccount(1e6);
  E.placeOrder(a, { inst: "EQ:SBIN", side: "BUY", qty: 10, product: "MIS" }, data("13:25"), at("13:25"));
  const closed = data("13:25", DAY, x => { x.quotes.market.status = "Closed"; });
  const k = "EQ:SBIN|MIS";
  const r1 = E.exitPosition(a, k, closed, at("13:25"));
  const r2_ = E.exitPosition(a, k, closed, at("13:25"));
  assert.equal(r1.ok, true);
  assert.equal(r2_.ok, false);
  assert.match(r2_.error, /already pending/);
  assert.equal(a.orders.filter(o => o.tag === "EXIT").length, 1);
});

test("same clientId submitted twice creates one order (double tap)", () => {
  const a = E.newAccount(1e6), d = data("13:25");
  const o = { inst: "EQ:ITC", side: "BUY", qty: 1, product: "CNC", clientId: "tap-1" };
  const r1 = E.placeOrder(a, o, d, at("13:25")), r2_ = E.placeOrder(a, o, d, at("13:25"));
  assert.equal(r2_.duplicate, true);
  assert.equal(r1.order.id, r2_.order.id);
  assert.equal(a.holdings.ITC.qty, 1);
});

test("money stays exact to the paisa after many trades", () => {
  const a = E.newAccount(1e6), d = data("13:25");
  for (let i = 0; i < 60; i++) {
    E.placeOrder(a, { inst: "EQ:ITC", side: "BUY", qty: 3, product: "CNC" }, d, at("13:25"));
    E.placeOrder(a, { inst: "EQ:ITC", side: "SELL", qty: 3, product: "CNC" }, d, at("13:25"));
  }
  assert.equal(a.cash, r2(a.cash));
  assert.equal(String(a.cash).split(".")[1]?.length > 2, false);
  assert.equal(a.cash, r2(1e6 - a.chargesPaid + a.realized));
});

test("portfolio totals: net worth = cash + holdings + open P&L; equity history recorded", () => {
  const a = E.newAccount(1e6), d = data("13:25");
  E.placeOrder(a, { inst: "EQ:RELIANCE", side: "BUY", qty: 10, product: "CNC" }, d, at("13:25"));
  const s = E.summary(a, d);
  assert.equal(s.netWorth, r2(s.cash + s.current + s.unrealized));
  assert.equal(a.equity.at(-1).d, DAY);
  assert.equal(a.dayStart.d, DAY);
});

test("status labels are user-facing", () => {
  assert.equal(E.statusLabel({ status: "COMPLETE" }), "Filled");
  assert.equal(E.statusLabel({ status: "OPEN" }), "Pending");
  assert.equal(E.statusLabel({ status: "TRIGGER_PENDING" }), "Trigger pending");
  assert.equal(E.statusLabel({ status: "REJECTED" }), "Rejected");
});

test("charges use 2026 F&O STT (0.15% on option sell premium)", () => {
  const c = E.charges("OPT:NIFTY:2026-10-27:22600:CE", "SELL", 65, 100, "NRML");
  assert.equal(c.stt, 9.75);
});
