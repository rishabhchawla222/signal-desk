/*
 * Paper-trading engine: instruments, prices, margins, charges, order matching,
 * positions, holdings, intraday square-off and expiry settlement.
 * Pure functions on a plain account object, so it can be tested in Node.
 *
 * Instrument keys
 *   EQ:RELIANCE                      cash-market stock
 *   FUT:NIFTY:2026-10-27             future
 *   OPT:NIFTY:2026-10-27:22600:CE    option
 */
(function (root) {
  "use strict";

  const INDEX_UNDERLYINGS = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50", "SENSEX"];
  const MIS_SQUAREOFF = 15 * 60 + 20; // 3:20 PM
  const OPEN = 9 * 60 + 15, CLOSE = 15 * 60 + 30;
  const STALE_MS = 5 * 60 * 1000;
  /** Money is kept in rupees rounded to the paisa at every step (no float drift). */
  const money = x => Math.round((+x + Number.EPSILON) * 100) / 100;
  const ACTIVE = o => o.status === "OPEN" || o.status === "TRIGGER_PENDING";

  // ------------------------------------------------------------------ time
  function ist(now) {
    const d = new Date((now instanceof Date ? now.getTime() : now) + 330 * 60000);
    const date = d.toISOString().slice(0, 10);
    return { date, mins: d.getUTCHours() * 60 + d.getUTCMinutes(), wd: d.getUTCDay(), iso: d.toISOString().slice(0, 19) };
  }
  function nextWeekday(date) {
    const d = new Date(date + "T00:00:00Z");
    do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
    return d.toISOString().slice(0, 10);
  }
  function feedAgeMs(data, now) {
    if (!data || !data.quotes || !data.quotes.ts) return Infinity;
    return (now instanceof Date ? now.getTime() : now) - new Date(data.quotes.ts + "+05:30").getTime();
  }
  /** Is the market open for matching right now? Uses clock + feed status + feed freshness. */
  function marketOpen(data, now) {
    const t = ist(now);
    if (t.wd === 0 || t.wd === 6) return false;
    if (t.mins < OPEN || t.mins >= CLOSE) return false;
    const st = (data && data.quotes && data.quotes.market && data.quotes.market.status || "").toLowerCase();
    if (st && st.startsWith("close")) return false;
    return feedAgeMs(data, now) < STALE_MS;
  }
  function sessionPhase(data, now) {
    const t = ist(now);
    if (t.wd === 0 || t.wd === 6) return "closed";
    const st = (data && data.quotes && data.quotes.market && data.quotes.market.status || "").toLowerCase();
    if (st.startsWith("close") && data.quotes.ts && data.quotes.ts.slice(0, 10) === t.date && t.mins > OPEN + 10) return "closed";
    if (t.mins < OPEN) return "pre";
    if (t.mins >= CLOSE) return "post";
    return "open";
  }

  // ----------------------------------------------------------- instruments
  function parse(key) {
    const p = key.split(":");
    if (p[0] === "EQ") return { key, kind: "EQ", u: p[1] };
    if (p[0] === "FUT") return { key, kind: "FUT", u: p[1], exp: p[2] };
    if (p[0] === "OPT") return { key, kind: "OPT", u: p[1], exp: p[2], strike: +p[3], right: p[4] };
    throw new Error("Unknown instrument " + key);
  }
  const isIndex = u => INDEX_UNDERLYINGS.includes(u);
  function lotSize(inst, data) {
    if (inst.kind === "EQ") return 1;
    const lots = data && data.universe && data.universe.lots || {};
    return lots[inst.u] || 1;
  }
  function fmtExp(exp) {
    const d = new Date(exp + "T00:00:00Z");
    return d.getUTCDate() + " " + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  }
  function label(key) {
    const i = parse(key);
    if (i.kind === "EQ") return i.u;
    if (i.kind === "FUT") return `${i.u} ${fmtExp(i.exp)} FUT`;
    return `${i.u} ${fmtExp(i.exp)} ${i.strike} ${i.right}`;
  }
  function chainRow(data, u, exp, strike) {
    const ch = data && data.chains && data.chains.chains && data.chains.chains[u + "|" + exp];
    if (!ch) return null;
    return ch.rows.find(r => r[0] === strike) || null;
  }
  function underlyingSpot(u, data) {
    const q = data && data.quotes || {};
    if (q.indices && q.indices[u] && q.indices[u].p) return q.indices[u].p;
    if (q.stocks && q.stocks[u] && q.stocks[u].p) return q.stocks[u].p;
    const chs = data && data.chains && data.chains.chains || {};
    for (const k in chs) if (k.startsWith(u + "|") && chs[k].spot) return chs[k].spot;
    return null;
  }
  /** {ltp, bid, ask, pc, ch} for an instrument, or null when no price is known. */
  function quote(key, data) {
    const i = parse(key);
    const q = data && data.quotes || {};
    if (i.kind === "EQ") {
      const s = q.stocks && q.stocks[i.u];
      if (!s || !s.p) return null;
      return { ltp: s.p, bid: 0, ask: 0, pc: s.pc, ch: s.pc ? s.p - s.pc : 0 };
    }
    if (i.kind === "FUT") {
      const f = q.futures && q.futures[key];
      if (!f || !f.p) return null;
      return { ltp: f.p, bid: 0, ask: 0, pc: f.ch != null ? f.p - f.ch : null, ch: f.ch || 0 };
    }
    const r = chainRow(data, i.u, i.exp, i.strike);
    if (!r) return null;
    const o = i.right === "CE" ? 1 : 9;
    const ltp = r[o], ch = r[o + 1] || 0;
    if (ltp == null) return null;
    const chain = data.chains.chains[i.u + "|" + i.exp];
    return { ltp, bid: r[o + 2] || 0, ask: r[o + 3] || 0, pc: ltp - ch, ch, oi: r[o + 4], iv: r[o + 6], est: !!(chain && chain.estimated) };
  }
  /** Price you'd realistically get now: options use bid/ask when they look sane. */
  function execPrice(q, side) {
    if (!q) return null;
    const sane = (b, a) => b > 0 && a > 0 && a >= b && (a - b) <= Math.max(2, 0.06 * a);
    if (sane(q.bid, q.ask)) return side === "BUY" ? q.ask : q.bid;
    return q.ltp;
  }
  function lastPrice(acct, key, data) {
    const q = quote(key, data);
    if (q) { acct.lastPx[key] = q.ltp; return q.ltp; }
    return acct.lastPx[key] != null ? acct.lastPx[key] : null;
  }

  // --------------------------------------------------------------- account
  function newAccount(cash) {
    cash = cash || 1000000;
    return { v: 1, created: Date.now(), cash, deposits: cash, orders: [], positions: {}, holdings: {},
             trades: [], lastPx: {}, lastDay: null, chargesPaid: 0, realized: 0, seq: 0, log: [] };
  }
  const posKey = (inst, product) => inst + "|" + product;

  // --------------------------------------------------------------- margins
  const MARGIN = { MIS_EQ: 0.20, FUT_INDEX: 0.12, FUT_STOCK: 0.18, SHORT_OPT_INDEX: 0.10, SHORT_OPT_STOCK: 0.16 };

  /** Margin blocked by a (signed) quantity of an instrument. */
  function marginFor(key, product, qty, data, acct, avgForLong) {
    if (!qty) return 0;
    const i = parse(key);
    const px = lastPrice(acct, key, data) || avgForLong || 0;
    if (i.kind === "EQ") {
      if (product === "CNC") return qty > 0 ? qty * px : 0;
      return Math.abs(qty) * px * MARGIN.MIS_EQ;
    }
    if (i.kind === "FUT") return Math.abs(qty) * px * (isIndex(i.u) ? MARGIN.FUT_INDEX : MARGIN.FUT_STOCK);
    // options
    if (qty > 0) return qty * (avgForLong != null ? avgForLong : px);
    const spot = underlyingSpot(i.u, data) || i.strike;
    return Math.abs(qty) * spot * (isIndex(i.u) ? MARGIN.SHORT_OPT_INDEX : MARGIN.SHORT_OPT_STOCK);
  }

  /** Extra margin needed if this order fills (0 when it reduces an existing position). */
  function orderMargin(acct, o, data) {
    const qtySigned = o.side === "BUY" ? o.qty : -o.qty;
    const i = parse(o.inst);
    if (i.kind === "EQ" && o.product === "CNC") {
      if (o.side === "SELL") return 0;
      return o.qty * (o.type === "LIMIT" || o.type === "SL" ? o.price : (execPrice(quote(o.inst, data), "BUY") || o.price || 0));
    }
    const p = acct.positions[posKey(o.inst, o.product)];
    const cur = p ? p.qty : 0;
    const estPx = (o.type === "LIMIT" || o.type === "SL") ? o.price : execPrice(quote(o.inst, data), o.side);
    const before = marginFor(o.inst, o.product, cur, data, acct, p && cur > 0 ? p.avg : null);
    let afterAvg = null;
    const nq = cur + qtySigned;
    if (i.kind === "OPT" && nq > 0) {
      afterAvg = cur > 0 && qtySigned > 0 ? (cur * p.avg + qtySigned * estPx) / nq : (cur > 0 ? p.avg : estPx);
    }
    const after = marginFor(o.inst, o.product, nq, data, acct, afterAvg);
    return Math.max(0, after - before);
  }

  // --------------------------------------------------------------- charges
  /** Approximate statutory + brokerage charges for one executed order (2026 rates). */
  function charges(key, side, qty, price, product) {
    const i = parse(key);
    const val = qty * price;
    let brokerage, stt = 0, txn, stamp = 0;
    if (i.kind === "EQ") {
      brokerage = Math.max(5, Math.min(20, val * 0.001));
      if (product === "CNC") { stt = val * 0.001; if (side === "BUY") stamp = val * 0.00015; }
      else { if (side === "SELL") stt = val * 0.00025; if (side === "BUY") stamp = val * 0.00003; }
      txn = val * 0.0000297;
    } else if (i.kind === "FUT") {
      brokerage = 20;
      if (side === "SELL") stt = val * 0.0005;
      if (side === "BUY") stamp = val * 0.00002;
      txn = val * 0.0000173;
    } else {
      brokerage = 20;
      if (side === "SELL") stt = val * 0.0015;
      if (side === "BUY") stamp = val * 0.00003;
      txn = val * 0.0003503;
    }
    const sebi = val * 0.000001;
    const gst = 0.18 * (brokerage + txn + sebi);
    const total = brokerage + stt + txn + stamp + sebi + gst;
    const r = x => Math.round(x * 100) / 100;
    return { brokerage: r(brokerage), stt: r(stt), txn: r(txn), stamp: r(stamp), sebi: r(sebi), gst: r(gst), total: r(total) };
  }

  // -------------------------------------------------------------- summary
  function summary(acct, data) {
    let used = 0, unreal = 0, mtmLoss = 0, dayPnl = 0;
    for (const k in acct.positions) {
      const p = acct.positions[k];
      if (!p.qty) continue;
      const i = parse(p.inst);
      used += marginFor(p.inst, p.product, p.qty, data, acct, p.qty > 0 && i.kind === "OPT" ? p.avg : null);
      const px = lastPrice(acct, p.inst, data);
      if (px != null) {
        const u = (px - p.avg) * p.qty;
        unreal += u;
        if (!(i.kind === "OPT" && p.qty > 0) && u < 0) mtmLoss += -u;
      }
    }
    let invested = 0, current = 0;
    for (const s in acct.holdings) {
      const h = acct.holdings[s];
      invested += h.qty * h.avg;
      const q = quote("EQ:" + s, data);
      const px = q ? q.ltp : (acct.lastPx["EQ:" + s] || h.avg);
      current += h.qty * px;
      if (q && q.pc) dayPnl += h.qty * (q.ltp - q.pc);
    }
    let pending = 0;
    for (const o of acct.orders) if (o.status === "OPEN" || o.status === "TRIGGER_PENDING") pending += o.blocked || 0;
    const available = acct.cash - used - mtmLoss - pending;
    const netWorth = money(acct.cash + current + unreal);
    return { cash: acct.cash, used, pending, unrealized: unreal, available, invested, current, netWorth,
             holdingsPnl: current - invested, holdingsDayPnl: dayPnl, realized: acct.realized, charges: acct.chargesPaid };
  }

  // ---------------------------------------------------------------- orders
  function validate(acct, o, data, now) {
    const i = parse(o.inst);
    const lot = lotSize(i, data);
    if (!(o.qty > 0) || Math.floor(o.qty) !== o.qty) return "Enter a whole quantity.";
    if (i.kind !== "EQ" && o.qty % lot) return `Quantity must be a multiple of the lot size (${lot}).`;
    if (i.kind === "EQ" && !["CNC", "MIS"].includes(o.product)) return "Choose Delivery or Intraday.";
    if (i.kind !== "EQ" && !["NRML", "MIS"].includes(o.product)) return "Choose Carry forward or Intraday.";
    if (!["MARKET", "LIMIT", "SL", "SL-M"].includes(o.type)) return "Unknown order type.";
    if ((o.type === "LIMIT" || o.type === "SL") && !(o.price > 0)) return "Enter a price.";
    if ((o.type === "SL" || o.type === "SL-M") && !(o.trigger > 0)) return "Enter a trigger price.";
    const q = quote(o.inst, data);
    if (o.type === "SL" || o.type === "SL-M") {
      const ltp = q && q.ltp;
      if (ltp && o.side === "BUY" && o.trigger <= ltp) return `Buy trigger must be above the current price (${ltp}).`;
      if (ltp && o.side === "SELL" && o.trigger >= ltp) return `Sell trigger must be below the current price (${ltp}).`;
      if (o.type === "SL" && o.side === "BUY" && o.price < o.trigger) return "For a buy stop-loss, the limit price must be at or above the trigger.";
      if (o.type === "SL" && o.side === "SELL" && o.price > o.trigger) return "For a sell stop-loss, the limit price must be at or below the trigger.";
    }
    if (!q && !acct.lastPx[o.inst]) return "No live price for this instrument right now.";
    if (i.kind !== "EQ") {
      const t = ist(now);
      if (i.exp < t.date || (i.exp === t.date && t.mins >= CLOSE)) return "This contract has expired.";
    }
    const t = ist(now);
    if (o.product === "MIS" && marketOpen(data, now) && t.mins >= MIS_SQUAREOFF) return "Intraday orders close at 3:20 PM. Use Delivery / Carry forward.";
    if (i.kind === "EQ" && o.product === "CNC" && o.side === "SELL") {
      const h = acct.holdings[i.u];
      const pendingSell = acct.orders.filter(x => x.inst === o.inst && x.product === "CNC" && x.side === "SELL" &&
        (x.status === "OPEN" || x.status === "TRIGGER_PENDING")).reduce((a, x) => a + x.qty, 0);
      if (!h || h.qty - pendingSell < o.qty) return `You can sell at most ${h ? h.qty - pendingSell : 0} shares from your holdings.`;
    }
    return null;
  }

  function placeOrder(acct, input, data, now) {
    now = now || new Date();
    if (input.clientId) {
      const dup = acct.orders.find(x => x.clientId === input.clientId);
      if (dup) return { ok: dup.status !== "REJECTED", duplicate: true, order: dup, events: [], error: dup.status === "REJECTED" ? dup.msg : undefined };
    }
    const o = {
      id: "O" + (++acct.seq) + "-" + (now instanceof Date ? now.getTime() : now).toString(36).slice(-4).toUpperCase(),
      ts: ist(now).iso, inst: input.inst, side: input.side, qty: +input.qty, product: input.product,
      type: input.type || "MARKET", price: input.price ? +input.price : null, trigger: input.trigger ? +input.trigger : null,
      status: "OPEN", tag: input.tag || null, clientId: input.clientId || null,
    };
    const err = validate(acct, o, data, now);
    if (err) { o.status = "REJECTED"; o.msg = err; acct.orders.push(o); return { ok: false, error: err, order: o }; }
    const need = orderMargin(acct, o, data);
    const charge = charges(o.inst, o.side, o.qty, o.price || execPrice(quote(o.inst, data), o.side) || 0, o.product).total;
    const avail = summary(acct, data).available;
    if (need + charge > avail + 1e-6) {
      o.status = "REJECTED";
      o.msg = `Not enough funds. Needed ₹${(need + charge).toFixed(2)}, available ₹${avail.toFixed(2)}.`;
      acct.orders.push(o);
      return { ok: false, error: o.msg, order: o };
    }
    o.blocked = need;
    const t = ist(now);
    if (!marketOpen(data, now)) {
      o.amo = true;
      o.day = t.mins < OPEN && t.wd >= 1 && t.wd <= 5 ? t.date : nextWeekday(t.date);
      o.msg = "Market closed: after-market order, executes when the market opens.";
    } else o.day = t.date;
    if (o.type === "SL" || o.type === "SL-M") o.status = "TRIGGER_PENDING";
    acct.orders.push(o);
    const events = process(acct, data, now);
    return { ok: true, order: o, events };
  }

  function cancelOrder(acct, id) {
    const o = acct.orders.find(x => x.id === id);
    if (!o || !(o.status === "OPEN" || o.status === "TRIGGER_PENDING")) return false;
    o.status = "CANCELLED"; o.msg = "Cancelled by you"; o.blocked = 0;
    return true;
  }

  function modifyOrder(acct, id, changes, data, now) {
    const o = acct.orders.find(x => x.id === id);
    if (!o || !(o.status === "OPEN" || o.status === "TRIGGER_PENDING")) return { ok: false, error: "Order is no longer open." };
    const copy = { ...o, ...changes };
    const err = validate(acct, copy, data, now);
    if (err) return { ok: false, error: err };
    const oldBlocked = o.blocked; o.blocked = 0;
    const need = orderMargin(acct, copy, data);
    if (need > summary(acct, data).available + 1e-6) { o.blocked = oldBlocked; return { ok: false, error: "Not enough funds for this change." }; }
    Object.assign(o, changes, { blocked: need });
    return { ok: true, events: process(acct, data, now) };
  }

  // ------------------------------------------------------------ execution
  function applyFill(acct, o, price, now, reason) {
    const i = parse(o.inst);
    price = money(price);
    const ch = charges(o.inst, o.side, o.qty, price, o.product);
    o.status = "COMPLETE"; o.fillPrice = price; o.fillTs = ist(now).iso; o.charges = ch.total; o.blocked = 0;
    if (reason) o.msg = reason;
    acct.cash = money(acct.cash - ch.total); acct.chargesPaid = money(acct.chargesPaid + ch.total);
    let realized = 0;
    if (i.kind === "EQ" && o.product === "CNC") {
      const h = acct.holdings[i.u] || { qty: 0, avg: 0 };
      if (o.side === "BUY") {
        h.avg = Math.round((h.qty * h.avg + o.qty * price) / (h.qty + o.qty) * 10000) / 10000; h.qty += o.qty;
        acct.cash = money(acct.cash - o.qty * price);
        acct.holdings[i.u] = h;
      } else {
        realized = money((price - h.avg) * o.qty);
        h.qty -= o.qty; acct.cash = money(acct.cash + o.qty * price);
        if (h.qty <= 0) delete acct.holdings[i.u]; else acct.holdings[i.u] = h;
      }
    } else {
      const k = posKey(o.inst, o.product);
      const p = acct.positions[k] || { inst: o.inst, product: o.product, qty: 0, avg: 0, realized: 0, opened: ist(now).date,
                                      buyQty: 0, buyVal: 0, sellQty: 0, sellVal: 0 };
      const s = o.side === "BUY" ? 1 : -1;
      let q = o.qty;
      if (p.qty && Math.sign(p.qty) !== s) {
        const closing = Math.min(q, Math.abs(p.qty));
        realized = money((price - p.avg) * closing * Math.sign(p.qty));
        p.qty += s * closing; q -= closing;
        if (!p.qty) p.avg = 0;
      }
      if (q > 0) {
        p.avg = Math.round((Math.abs(p.qty) * p.avg + q * price) / (Math.abs(p.qty) + q) * 10000) / 10000;
        p.qty += s * q;
        if (Math.abs(p.qty) === q) p.opened = ist(now).date;
      }
      if (o.side === "BUY") { p.buyQty += o.qty; p.buyVal += o.qty * price; } else { p.sellQty += o.qty; p.sellVal += o.qty * price; }
      p.realized = money(p.realized + realized);
      p.last = ist(now).date;
      acct.cash = money(acct.cash + realized);
      acct.positions[k] = p;
    }
    acct.realized = money(acct.realized + realized);
    acct.lastPx[o.inst] = acct.lastPx[o.inst] || price;
    acct.trades.push({ id: o.id, ts: o.fillTs, inst: o.inst, side: o.side, qty: o.qty, price, product: o.product,
                       charges: ch.total, realized: Math.round(realized * 100) / 100 });
    if (acct.trades.length > 2000) acct.trades.splice(0, acct.trades.length - 2000);
    return { type: "FILL", order: o, price, realized };
  }

  function systemOrder(acct, inst, side, qty, product, now, tag) {
    const o = { id: "S" + (++acct.seq) + "-" + (now instanceof Date ? now.getTime() : now).toString(36).slice(-4).toUpperCase(),
                ts: ist(now).iso, inst, side, qty, product, type: "MARKET", price: null, trigger: null, status: "OPEN",
                tag, day: ist(now).date };
    acct.orders.push(o);
    return o;
  }

  function closePosition(acct, p, price, now, tag, reason) {
    const o = systemOrder(acct, p.inst, p.qty > 0 ? "SELL" : "BUY", Math.abs(p.qty), p.product, now, tag);
    return applyFill(acct, o, price, now, reason);
  }

  /** Settle expired F&O positions at the underlying's price. */
  function settleExpiries(acct, data, now, events) {
    const t = ist(now);
    for (const k of Object.keys(acct.positions)) {
      const p = acct.positions[k];
      if (!p.qty) continue;
      const i = parse(p.inst);
      if (i.kind === "EQ") continue;
      if (i.exp > t.date || (i.exp === t.date && t.mins < CLOSE)) continue;
      const spot = underlyingSpot(i.u, data);
      let px;
      if (i.kind === "FUT") px = spot != null ? spot : acct.lastPx[p.inst];
      else if (spot != null) px = Math.max(0, i.right === "CE" ? spot - i.strike : i.strike - spot);
      else px = acct.lastPx[p.inst] || 0;
      if (px == null) continue;
      events.push(closePosition(acct, p, px, now, "EXPIRY", `Expired, settled at ₹${(+px).toFixed(2)}`));
    }
  }

  function tryMatch(acct, o, data, now) {
    const q = quote(o.inst, data);
    if (!q) return null;
    acct.lastPx[o.inst] = q.ltp;
    if (o.status === "TRIGGER_PENDING") {
      const hit = o.side === "BUY" ? q.ltp >= o.trigger : q.ltp <= o.trigger;
      if (!hit) return null;
      o.status = "OPEN"; o.triggeredTs = ist(now).iso;
      if (o.type === "SL-M") o.type = "MARKET";
      else o.type = "LIMIT";
    }
    const px = execPrice(q, o.side);
    if (o.type === "MARKET") return applyFill(acct, o, px, now);
    if (o.type === "LIMIT") {
      if (o.side === "BUY" && px <= o.price) return applyFill(acct, o, Math.min(px, o.price), now);
      if (o.side === "SELL" && px >= o.price) return applyFill(acct, o, Math.max(px, o.price), now);
    }
    return null;
  }

  /** Advance the account to `now`: rollovers, matching, square-off, expiry. Returns events. */
  function process(acct, data, now) {
    now = now || new Date();
    const t = ist(now);
    const events = [];
    const open = marketOpen(data, now);

    // new trading day: expire yesterday's day orders, close leftover intraday positions
    if (acct.lastDay && acct.lastDay !== t.date) {
      for (const o of acct.orders) {
        if ((o.status === "OPEN" || o.status === "TRIGGER_PENDING") && o.day && o.day < t.date) {
          o.status = "CANCELLED"; o.msg = "Expired at end of day"; o.blocked = 0;
          events.push({ type: "EXPIRED_ORDER", order: o });
        }
      }
      for (const k of Object.keys(acct.positions)) {
        const p = acct.positions[k];
        if (p.qty && p.product === "MIS" && p.opened < t.date) {
          const px = acct.lastPx[p.inst];
          if (px != null) events.push(closePosition(acct, p, px, now, "SQUAREOFF", "Intraday auto square-off (last seen price)"));
        }
      }
    }
    if (t.wd >= 1 && t.wd <= 5) acct.lastDay = t.date;

    settleExpiries(acct, data, now, events);

    if (open) {
      for (const o of acct.orders) {
        if (!(o.status === "OPEN" || o.status === "TRIGGER_PENDING")) continue;
        if (o.day && o.day > t.date) continue;
        const ev = tryMatch(acct, o, data, now);
        if (ev) events.push(ev);
      }
      if (t.mins >= MIS_SQUAREOFF) {
        for (const o of acct.orders) {
          if (o.product === "MIS" && (o.status === "OPEN" || o.status === "TRIGGER_PENDING")) {
            o.status = "CANCELLED"; o.msg = "Cancelled at intraday square-off"; o.blocked = 0;
          }
        }
        for (const k of Object.keys(acct.positions)) {
          const p = acct.positions[k];
          if (!p.qty || p.product !== "MIS") continue;
          const px = execPrice(quote(p.inst, data), p.qty > 0 ? "SELL" : "BUY");
          if (px != null) events.push(closePosition(acct, p, px, now, "SQUAREOFF", "Intraday auto square-off at 3:20 PM"));
        }
      }
    }
    // end of session: unfilled day orders lapse
    if (t.mins >= CLOSE && t.wd >= 1 && t.wd <= 5) {
      for (const o of acct.orders) {
        if ((o.status === "OPEN" || o.status === "TRIGGER_PENDING") && o.day === t.date) {
          o.status = "CANCELLED"; o.msg = "Expired at end of day"; o.blocked = 0;
          events.push({ type: "EXPIRED_ORDER", order: o });
        }
      }
    }
    // tidy: drop flat positions from previous days
    for (const k of Object.keys(acct.positions)) {
      const p = acct.positions[k];
      if (!p.qty && (p.last || p.opened) < t.date) delete acct.positions[k];
    }
    if (acct.orders.length > 1500) acct.orders.splice(0, acct.orders.length - 1500);
    if (data && data.quotes) recordEquity(acct, data, now);
    return events;
  }

  /** One value per day (the latest), plus the value at the start of today for "Today's P&L". */
  function recordEquity(acct, data, now) {
    const t = ist(now);
    const v = summary(acct, data).netWorth;
    if (!isFinite(v)) return;
    acct.equity = acct.equity || [];
    const last = acct.equity[acct.equity.length - 1];
    if (!acct.dayStart || acct.dayStart.d !== t.date) acct.dayStart = { d: t.date, v: last ? last.v : acct.deposits };
    if (last && last.d === t.date) last.v = v; else acct.equity.push({ d: t.date, v });
    if (acct.equity.length > 1000) acct.equity.splice(0, acct.equity.length - 1000);
  }

  const STATUS_LABEL = { OPEN: "Pending", TRIGGER_PENDING: "Trigger pending", COMPLETE: "Filled", CANCELLED: "Cancelled", REJECTED: "Rejected" };
  function statusLabel(o) { return o.status === "OPEN" && o.amo ? "Queued (AMO)" : STATUS_LABEL[o.status] || o.status; }

  /** Exit a position at market (or queue if market is closed). */
  function pendingExitQty(acct, p) {
    const side = p.qty > 0 ? "SELL" : "BUY";
    return acct.orders.filter(o => ACTIVE(o) && o.inst === p.inst && o.product === p.product && o.side === side)
      .reduce((a, o) => a + o.qty, 0);
  }
  function exitPosition(acct, k, data, now, clientId) {
    const p = acct.positions[k];
    if (!p || !p.qty) return { ok: false, error: "This position is already closed." };
    if (clientId) {
      const dup = acct.orders.find(x => x.clientId === clientId);
      if (dup) return { ok: dup.status !== "REJECTED", duplicate: true, order: dup, events: [] };
    }
    if (pendingExitQty(acct, p) >= Math.abs(p.qty)) return { ok: false, error: "An exit order for this position is already pending." };
    const qty = Math.abs(p.qty) - pendingExitQty(acct, p);
    return placeOrder(acct, { inst: p.inst, side: p.qty > 0 ? "SELL" : "BUY", qty, product: p.product, type: "MARKET", tag: "EXIT", clientId }, data, now);
  }

  const api = { ist, nextWeekday, marketOpen, sessionPhase, feedAgeMs, parse, label, fmtExp, lotSize, quote, execPrice,
                underlyingSpot, chainRow, isIndex, newAccount, marginFor, orderMargin, charges, summary, validate,
                placeOrder, cancelOrder, modifyOrder, process, exitPosition, pendingExitQty, posKey, lastPrice, money,
                statusLabel, recordEquity, ACTIVE,
                CONST: { OPEN, CLOSE, MIS_SQUAREOFF, MARGIN } };
  root.PaperEngine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
