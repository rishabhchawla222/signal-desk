/* Signal Desk – paper trading app (UI). Engine: engine.js · Auto-trader control: control.js */
"use strict";
const E = window.PaperEngine;
const SC = window.SignalControl;

// ================================================================ utilities
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const fmt = (x, d = 2) => x == null || isNaN(x) ? "—" : Number(x).toLocaleString("en-IN", {minimumFractionDigits: d, maximumFractionDigits: d});
const rs = (x, d = 2) => x == null || isNaN(x) ? "—" : (x < 0 ? "−₹" : "₹") + fmt(Math.abs(x), d);
const sgn = (x, d = 2) => x == null || isNaN(x) ? "—" : (x > 0 ? "+" : x < 0 ? "−" : "") + fmt(Math.abs(x), d);
const srs = (x, d = 2) => x == null || isNaN(x) ? "—" : (x > 0 ? "+₹" : x < 0 ? "−₹" : "₹") + fmt(Math.abs(x), d);
const pct = (x, d = 2) => x == null || !isFinite(x) ? "—" : sgn(x, d) + "%";
const cls = x => x > 0 ? "up" : x < 0 ? "down" : "muted";
const compact = x => x == null ? "—" : x >= 1e7 ? fmt(x / 1e7, 2) + " Cr" : x >= 1e5 ? fmt(x / 1e5, 2) + " L" : x >= 1e3 ? fmt(x / 1e3, 1) + " K" : fmt(x, 0);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dmy = iso => { if (!iso) return "—"; const d = new Date(iso.slice(0, 10) + "T00:00:00Z"); return d.getUTCDate() + " " + MON[d.getUTCMonth()]; };
const hm = iso => iso ? iso.slice(11, 16) : "—";
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};
const ICON = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  market: '<path d="M3 17l5-5 4 3 8-8"/><path d="M15 7h5v5"/>',
  watchlist: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  fno: '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>',
  orders: '<path d="M7 3h10a2 2 0 012 2v16l-3-2-2 2-2-2-2 2-2-2-3 2V5a2 2 0 012-2zM9 8h6M9 12h6"/>',
  positions: '<path d="M4 12h4l3-8 4 16 3-8h2"/>',
  holdings: '<path d="M3 7h18v12a1 1 0 01-1 1H4a1 1 0 01-1-1zM8 7V5a2 2 0 012-2h4a2 2 0 012 2v2M3 12h18"/>',
  auto: '<rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4M9 12h.01M15 12h.01M9 16h6"/>',
  history: '<path d="M3 12a9 9 0 109-9 9 9 0 00-7 3.4L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'
};
const svg = (name, extra = "") => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${ICON[name]}</svg>`;
const INDEX_ORDER = ["NIFTY", "SENSEX", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "INDIAVIX"];
const INDEX_LABEL = {NIFTY: "NIFTY 50", SENSEX: "SENSEX", BANKNIFTY: "BANK NIFTY", FINNIFTY: "FIN NIFTY", MIDCPNIFTY: "MIDCAP SELECT", INDIAVIX: "INDIA VIX"};
const NAV = [
  ["dashboard", "Dashboard"], ["market", "Market"], ["watchlist", "Watchlist"], ["fno", "F&O"],
  ["orders", "Orders"], ["positions", "Positions"], ["holdings", "Holdings"],
  ["auto", "Auto trading"], ["history", "Trade history"], ["settings", "Settings"]
];
const BOTTOM = ["dashboard", "market", "fno", "positions", "more"];
const ALIASES = {explore: "market", portfolio: "positions", funds: "settings"};

// ==================================================================== state
const ACCT_KEY = "signaldesk.paper.account.v1", WATCH_KEY = "signaldesk.paper.watch.v1", THEME_KEY = "signaldesk.theme",
      TOKEN_KEY = "signaldesk.gh.token", PEND_KEY = "signaldesk.auto.pending", LOG_KEY = "signaldesk.auto.log";
let acct = store.get(ACCT_KEY, null) || E.newAccount(1000000);
acct.equity = acct.equity || [];
let watch = store.get(WATCH_KEY, ["RELIANCE", "HDFCBANK", "ICICIBANK", "INFY", "TCS", "SBIN", "ITC", "LT"]);
const D = {quotes: null, chains: null, universe: null, intraday: null, signals: null, auto: null, history: {}};
let chainsAt = 0, intradayAt = 0, signalsAt = 0, autoAt = 0, autoSource = "", autoError = "", loadError = "";
const save = () => store.set(ACCT_KEY, acct);
let autoPending = store.get(PEND_KEY, []), autoLog = store.get(LOG_KEY, []);
const savePending = () => { store.set(PEND_KEY, autoPending); store.set(LOG_KEY, autoLog.slice(-30)); };

function applyTheme() {   // the app is light-only
  document.documentElement.setAttribute("data-theme", "light");
  store.del(THEME_KEY);
}
applyTheme();

// ============================================================ repo & data
function repoInfo() {
  const p = new URLSearchParams(location.search).get("repo");
  if (p && p.includes("/")) { const [owner, repo] = p.split("/"); return {owner, repo}; }
  const h = location.hostname;
  if (h.endsWith(".github.io")) {
    const owner = h.split(".")[0], seg = location.pathname.split("/").filter(Boolean)[0];
    return {owner, repo: seg || owner + ".github.io"};
  }
  return null;
}
function dataBase() {
  const p = new URLSearchParams(location.search).get("data");
  if (p) return p.replace(/\/?$/, "/");
  const r = repoInfo();
  return r ? `https://raw.githubusercontent.com/${r.owner}/${r.repo}/market-data/` : null;
}
const BASE = dataBase();
const SIG_BASE = (() => {
  const p = new URLSearchParams(location.search).get("signals");
  if (p) return p.replace(/\/?$/, "/");
  return BASE && BASE.replace(/market-data\/$/, "signals-data/");
})();
const CTRL = SC.create({repo: repoInfo, token: () => store.get(TOKEN_KEY, "")});
const hasToken = () => !!store.get(TOKEN_KEY, "");

async function getJSON(url) {
  const r = await fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now(), {cache: "no-store"});
  if (!r.ok) throw new Error(r.status === 404 ? "not published yet" : "HTTP " + r.status);
  return r.json();
}
// GitHub's raw server caches each URL ~5 min, so the feed writes a new file name every
// 15 seconds (live/YYYYMMDD-HHMMSS-q.json). Ask for the newest slot that should exist.
const lastLive = {q: "", c: ""};
function liveStamps() {
  const t = Date.now() + 330 * 60000 - 12000, base = Math.floor(t / 15000) * 15000, out = [];
  for (let i = 0; i < 6; i++) { const iso = new Date(base - i * 15000).toISOString(); out.push(iso.slice(0, 10).replace(/-/g, "") + "-" + iso.slice(11, 19).replace(/:/g, "")); }
  return out;
}
function liveWindow() { const t = E.ist(new Date()); return t.wd >= 1 && t.wd <= 5 && t.mins >= 9 * 60 && t.mins <= 15 * 60 + 41; }
async function getLive(kind, fallback) {
  if (liveWindow()) {
    for (const st of liveStamps()) {
      if (st <= lastLive[kind] && lastLive[kind + "obj"]) return lastLive[kind + "obj"];
      try {
        const r = await fetch(BASE + `live/${st}-${kind}.json`, {cache: "no-store"});
        if (r.ok) { const j = await r.json(); lastLive[kind] = st; lastLive[kind + "obj"] = j; return j; }
      } catch (e) {}
    }
  }
  return getJSON(BASE + fallback);
}
const engineData = () => ({quotes: D.quotes, chains: D.chains, universe: D.universe});

// price flashes: only for prices that really changed in the latest update
let flash = {}, flashUntil = 0;
function priceMap(q, c) {
  const m = {};
  if (q) {
    for (const k in q.stocks || {}) m["EQ:" + k] = q.stocks[k].p;
    for (const k in q.indices || {}) m["IDX:" + k] = q.indices[k].p;
    for (const k in q.futures || {}) m[k] = q.futures[k].p;
  }
  if (c) for (const key in c.chains || {}) {
    const [u, exp] = key.split("|");
    for (const r of c.chains[key].rows) { m[`OPT:${u}:${exp}:${r[0]}:CE`] = r[1]; m[`OPT:${u}:${exp}:${r[0]}:PE`] = r[9]; }
  }
  return m;
}
function noteChanges(before, after) {
  const f = {};
  for (const k in after) if (before[k] != null && after[k] != null && after[k] !== before[k]) f[k] = after[k] > before[k] ? "fl-up" : "fl-dn";
  if (Object.keys(f).length) { flash = f; flashUntil = Date.now() + 1400; }
}
const fx = key => Date.now() < flashUntil && flash[key] ? " " + flash[key] : "";

async function loadQuotes() {
  if (!BASE) { loadError = "Open this app from your GitHub Pages site to load live prices."; render(); return; }
  try {
    const [q, u] = await Promise.all([getLive("q", "quotes.json"), D.universe ? Promise.resolve(D.universe) : getJSON(BASE + "universe.json")]);
    if (!D.quotes || q.ts !== D.quotes.ts) {
      if (D.quotes && q.ts < D.quotes.ts) return;                 // never let older data overwrite newer
      const before = priceMap(D.quotes, null);
      D.quotes = q; noteChanges(before, priceMap(q, null));
    }
    D.universe = u; loadError = "";
  } catch (e) { loadError = "Couldn't load prices (" + e.message + "). Retrying…"; }
  if (needChains() && Date.now() - chainsAt > 14000) await ensureChains(true);
  tick();
}
function needChains() {
  if (["fno", "positions", "dashboard", "auto"].includes(route.name) || (sheet && sheet.inst.startsWith("OPT:"))) return true;
  if (Object.values(acct.positions).some(p => p.qty && p.inst.startsWith("OPT:"))) return true;
  return acct.orders.some(o => E.ACTIVE(o) && o.inst.startsWith("OPT:"));
}
async function ensureChains(force) {
  if (!BASE || (!force && D.chains && Date.now() - chainsAt < 14000)) return;
  try {
    const c = await getLive("c", "chains.json"); chainsAt = Date.now();
    if (!D.chains || c.ts !== D.chains.ts) {
      if (D.chains && c.ts < D.chains.ts) return;
      const before = priceMap(null, D.chains); D.chains = c; noteChanges(before, priceMap(null, c));
    }
  } catch (e) {}
  if (route.name === "fno" || sheet) render();
}
async function ensureIntraday() {
  if (!BASE) return;
  if (!D.intraday || Date.now() - intradayAt > 60000) {
    try { D.intraday = await getJSON(BASE + "intraday.json"); intradayAt = Date.now(); } catch (e) {}
  }
  const sym = route.arg;
  if (chartRange !== "1D" && sym && !D.history[sym]) {
    try { D.history[sym] = await getJSON(BASE + "history/" + encodeURIComponent(sym) + ".json"); } catch (e) { D.history[sym] = {t: [], c: [], error: true}; }
  }
  if (route.name === "stock" || route.name === "index") render();
}
async function loadSignals() {
  if (!SIG_BASE || Date.now() - signalsAt < 55000) return;
  signalsAt = Date.now();
  try { D.signals = await getJSON(SIG_BASE + "signals.json"); } catch (e) {}
}
/** Auto-trader state: fresh through the GitHub API when a token is set, else the (cached) raw file. */
async function loadAuto(force) {
  const busy = autoPending.some(p => p.state !== "failed");
  const every = hasToken() ? (busy ? 5000 : 20000) : 60000;
  if (!force && Date.now() - autoAt < every) return;
  autoAt = Date.now();
  try {
    let j = null;
    if (hasToken()) { j = await CTRL.autoState(); autoSource = "live"; }
    else if (SIG_BASE) { j = await getJSON(SIG_BASE + "autotrade.json"); autoSource = "cached"; }
    if (j && (!D.auto || !D.auto.updated || !j.updated || j.updated >= D.auto.updated)) D.auto = j;  // never go backwards
    autoError = "";
  } catch (e) {
    autoError = e.message === "not published yet" ? "" : e.message;
    if (hasToken() && e.code && e.code !== "network" && SIG_BASE) {
      try { const j = await getJSON(SIG_BASE + "autotrade.json"); if (!D.auto || j.updated >= (D.auto.updated || "")) D.auto = j; autoSource = "cached"; } catch (e2) {}
    }
  }
  reconcileAuto();
  if (["auto", "dashboard", "positions", "history"].includes(route.name)) render();
}

function tick() {
  if (D.quotes) {
    const evs = E.process(acct, engineData(), new Date());
    if (evs.length) evs.forEach(toastEvent);
    save();
  }
  renderTop();
  const a = document.activeElement;
  const typing = a && a.tagName === "INPUT" && a.closest("#view");
  if (!typing && !dialog) render();
  if (sheet) renderSheet();
}

// ================================================================= routing
let route = {name: "dashboard", arg: null}, ordersTab = "open", historyTab = "mine", moreOpen = false;
let lastChainView = null, fnoU = "NIFTY", fnoExp = null, chartRange = "1D", eqRange = "1M";
let marketSort = {k: "chp", dir: -1}, marketFilter = "", holdSort = {k: "value", dir: -1}, holdFilter = "", histFilter = "";
const ROUTES = ["dashboard", "market", "watchlist", "fno", "orders", "positions", "holdings", "auto", "history", "settings", "stock", "index"];
function parseHash() {
  const h = decodeURIComponent(location.hash.slice(1) || "dashboard");
  let [name, ...rest] = h.split("-");
  name = ALIASES[name] || name;
  if (ROUTES.includes(name)) return {name, arg: rest.join("-") || null};
  return {name: "dashboard", arg: null};
}
function go(hash) { moreOpen = false; if (location.hash.slice(1) !== hash) location.hash = hash; else onRoute(); }
function onRoute() {
  route = parseHash();
  moreOpen = false;
  if (route.name === "fno" && route.arg) { fnoU = route.arg; fnoExp = null; }
  if (route.name !== "fno") lastChainView = null;
  if (route.name === "stock" || route.name === "index") chartRange = "1D";
  renderNav(); render(); window.scrollTo(0, 0);
  const main = $("#view"); if (main) main.focus({preventScroll: true});
  if (needChains()) ensureChains();
  if (route.name === "stock" || route.name === "index") ensureIntraday();
  if (["auto", "dashboard", "positions", "history"].includes(route.name)) loadAuto(true);
}
window.addEventListener("hashchange", onRoute);

// ================================================================ chrome
function autoBadge() {
  if (!D.auto) return "";
  const n = Object.keys(D.auto.open || {}).length;
  if (D.auto.paused) return `<span class="badge paused" title="Auto-trading paused">Paused</span>`;
  return n ? `<span class="badge" title="Open auto positions">${n}</span>` : "";
}
function renderNav() {
  const active = {stock: "market", index: "market"}[route.name] || route.name;
  const btn = ([k, label]) => `<button class="nav-btn ${active === k ? "on" : ""}" data-go="${k}" ${active === k ? 'aria-current="page"' : ""}>${svg(k)}<span>${label}</span>${k === "auto" ? autoBadge() : k === "orders" && openOrders().length ? `<span class="badge">${openOrders().length}</span>` : ""}</button>`;
  $("#sideNav").innerHTML = `<span class="grp">Overview</span>${NAV.slice(0, 4).map(btn).join("")}<span class="grp">Portfolio</span>${NAV.slice(4, 7).map(btn).join("")}<span class="grp">Automation</span>${NAV.slice(7).map(btn).join("")}<div class="data-note" id="dataNote"></div>`;
  const inMore = !BOTTOM.includes(active);
  $("#bottomNav").innerHTML = BOTTOM.map(k => k === "more"
    ? `<button class="nav-btn ${inMore ? "on" : ""}" data-more="1" aria-haspopup="dialog">${svg("more")}<span>More</span></button>`
    : btn(NAV.find(n => n[0] === k)).replace(">Dashboard<", ">Home<")).join("");
  renderDataNote();
}
function renderDataNote() {
  const el = $("#dataNote"); if (!el) return;
  el.innerHTML = D.quotes ? `Live prices from NSE &amp; Yahoo, ~10–25 s behind the market.<br><b>Paper trading:</b> virtual money, no real orders.` : esc(loadError || "Loading prices…");
}
function renderTop() {
  $("#ticker").innerHTML = INDEX_ORDER.map(k => {
    const q = idxQuote(k); if (!q) return "";
    const c = chg(q);
    return `<button class="tick" data-go="index-${k}"><b>${INDEX_LABEL[k]}</b><span class="num${fx("IDX:" + k)}">${fmt(q.p)}</span><span class="num ${cls(c.abs)}">${pct(c.pct)}</span></button>`;
  }).join("");
  $("#availTop").textContent = rs(E.summary(acct, engineData()).available, 0);
}
setInterval(() => {
  const el = $("#ago"); if (!el) return;
  if (!D.quotes) { $("#agoTxt").textContent = loadError ? "Offline" : "Loading"; return; }
  const age = Math.max(0, Math.round(E.feedAgeMs(engineData(), new Date()) / 1000));
  const open = E.marketOpen(engineData(), new Date());
  el.className = "ago " + (open && age < 60 ? "live" : open || (liveWindow() && age > 300) ? "stale" : "");
  $("#agoTxt").textContent = open ? (age < 60 ? `Live · ${age}s` : `Delayed · ${Math.round(age / 60)} min`) : liveWindow() && age > 300 ? `Stale · ${Math.round(age / 60)} min` : `As of ${hm(D.quotes.ts)}`;
}, 1000);

// ================================================================= helpers
const stocks = () => (D.quotes && D.quotes.stocks) || {};
const uniStock = s => (D.universe && D.universe.stocks && D.universe.stocks[s]) || {};
const nameOf = s => uniStock(s).full || uniStock(s).name || s;
const chg = q => q && q.pc ? {abs: q.p - q.pc, pct: (q.p / q.pc - 1) * 100} : {abs: null, pct: null};
const idxQuote = k => D.quotes && D.quotes.indices && D.quotes.indices[k];
const openOrders = () => acct.orders.filter(E.ACTIVE);
const prodName = p => ({CNC: "Delivery", MIS: "Intraday", NRML: "Carry fwd"}[p] || p);
const typeName = t => ({MARKET: "Market", LIMIT: "Limit", SL: "Stop-loss", "SL-M": "SL-Market"}[t] || t);
function marketPill() {
  if (!D.quotes) return `<span class="pill">Loading</span>`;
  const ph = E.sessionPhase(engineData(), new Date());
  if (E.marketOpen(engineData(), new Date())) return `<span class="pill up live"><span class="dot"></span>Market open</span>`;
  if (ph === "open") return `<span class="pill warn" title="Prices are more than 5 minutes old; orders wait for fresh prices">Prices delayed</span>`;
  return `<span class="pill">${ph === "pre" ? "Pre-open" : "Market closed"}</span>`;
}
function skeleton(rows = 4) {
  return `<div class="card pad stack" aria-busy="true" aria-label="Loading"><div class="sk" style="height:22px;width:40%"></div>${Array.from({length: rows}, () => `<div class="sk" style="height:46px"></div>`).join("")}</div>`;
}

// ================================================================== charts
function chartSVG(xs, ys, opts = {}) {
  if (!ys || ys.length < 2) return `<div class="empty"><b>${esc(opts.emptyTitle || "No chart data yet")}</b>${esc(opts.emptyText || "The line appears once trading starts.")}</div>`;
  const W = 800, H = 240, pad = {t: 14, r: 8, b: 22, l: 8};
  const ref = opts.ref;
  let lo = Math.min(...ys, ref != null ? ref : Infinity), hi = Math.max(...ys, ref != null ? ref : -Infinity);
  if (hi === lo) { hi += 1; lo -= 1; }
  const span = hi - lo; lo -= span * .08; hi += span * .08;
  const x0 = opts.xmin != null ? opts.xmin : xs[0], x1 = opts.xmax != null ? opts.xmax : xs[xs.length - 1];
  const X = x => pad.l + (x - x0) / ((x1 - x0) || 1) * (W - pad.l - pad.r);
  const Y = y => pad.t + (hi - y) / (hi - lo) * (H - pad.t - pad.b);
  const up = ys[ys.length - 1] >= (ref != null ? ref : ys[0]);
  const col = up ? "var(--up)" : "var(--down)";
  const pts = xs.map((x, i) => `${X(x).toFixed(1)},${Y(ys[i]).toFixed(1)}`);
  const area = `M${pts[0]} L${pts.join(" L")} L${X(xs[xs.length - 1]).toFixed(1)},${H - pad.b} L${X(xs[0]).toFixed(1)},${H - pad.b} Z`;
  const gid = "g" + Math.random().toString(36).slice(2, 7);
  const refLine = ref != null ? `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(ref)}" y2="${Y(ref)}" stroke="var(--faint)" stroke-dasharray="4 4" stroke-width="1" vector-effect="non-scaling-stroke"/>` : "";
  const labels = (opts.labels || []).map(([x, t]) => { const px = X(x), a = px < 40 ? "start" : px > W - 40 ? "end" : "middle";
    return `<text x="${px}" y="${H - 5}" font-size="11" fill="var(--faint)" text-anchor="${a}" font-family="var(--mono)">${esc(t)}</text>`; }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(opts.label || "Price chart")}" data-x0="${x0}" data-x1="${x1}" data-w="${W}" data-pl="${pad.l}" data-pr="${pad.r}">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".18"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    ${refLine}<path d="${area}" fill="url(#${gid})"/><polyline points="${pts.join(" ")}" fill="none" stroke="${col}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
    <circle cx="${X(xs[xs.length - 1])}" cy="${Y(ys[ys.length - 1])}" r="3.5" fill="${col}"/>${labels}
    <line class="cursor" x1="0" x2="0" y1="${pad.t}" y2="${H - pad.b}" stroke="var(--faint)" stroke-width="1" vector-effect="non-scaling-stroke" visibility="hidden"/></svg><div class="tip" hidden></div>`;
}
function wireChart(el, xs, ys, fmtX, money = true) {
  if (!el || !ys || ys.length < 2) return;
  const svgEl = el.querySelector("svg"), tip = el.querySelector(".tip"), cur = el.querySelector(".cursor");
  if (!svgEl) return;
  const move = ev => {
    const r = svgEl.getBoundingClientRect();
    const fxp = (ev.clientX - r.left) / r.width;
    const W = +svgEl.dataset.w, pl = +svgEl.dataset.pl, pr = +svgEl.dataset.pr, x0 = +svgEl.dataset.x0, x1 = +svgEl.dataset.x1;
    const xv = x0 + ((fxp * W - pl) / (W - pl - pr)) * (x1 - x0);
    let best = 0; xs.forEach((x, i) => { if (Math.abs(x - xv) < Math.abs(xs[best] - xv)) best = i; });
    const px = pl + (xs[best] - x0) / ((x1 - x0) || 1) * (W - pl - pr);
    cur.setAttribute("x1", px); cur.setAttribute("x2", px); cur.setAttribute("visibility", "visible");
    tip.hidden = false; tip.style.left = Math.min(92, Math.max(8, px / W * 100)) + "%";
    tip.textContent = `${fmtX(xs[best])} · ${money ? "₹" : ""}${fmt(ys[best])}`;
  };
  svgEl.addEventListener("pointermove", move);
  svgEl.addEventListener("pointerleave", () => { tip.hidden = true; cur.setAttribute("visibility", "hidden"); });
}
const minToTime = m => { const t = 555 + m; return String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0"); };
const ymd = n => { const s = String(n); return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}`; };
function chartBlock(sym, q) {
  let xs = [], ys = [], opts = {label: `${sym} price chart`}, fx_ = minToTime;
  if (chartRange === "1D") {
    const s = D.intraday && D.intraday.series && D.intraday.series[sym];
    if (!D.intraday) return {html: `<div class="sk" style="height:240px;margin-top:14px"></div>`, xs: [], ys: []};
    if (s) { xs = s[0].slice(); ys = s[1].slice(); }
    if (q && q.p && xs.length) { xs.push(Math.max(xs[xs.length - 1], Math.min(375, xs[xs.length - 1] + 1))); ys.push(q.p); }
    Object.assign(opts, {ref: q && q.pc, xmin: 0, xmax: 375, labels: [[0, "09:15"], [105, "11:00"], [225, "13:00"], [375, "15:30"]]});
  } else {
    const h = D.history[sym];
    if (!h) return {html: `<div class="sk" style="height:240px;margin-top:14px"></div>`, xs: [], ys: []};
    if (h.error) return {html: `<div class="err" style="margin-top:14px">Couldn't load the price history. It will retry when you switch range again.</div>`, xs: [], ys: []};
    const n = {"1W": 5, "1M": 22, "3M": 66, "6M": 128, "1Y": 260}[chartRange];
    const ts = h.t.slice(-n).map(ymd); ys = h.c.slice(-n); xs = ys.map((_, i) => i);
    const today = (D.quotes.ts || "").slice(0, 10);
    if (q && q.p && ts.length && ts[ts.length - 1] !== today) { xs.push(xs.length); ys.push(q.p); ts.push(today); }
    fx_ = i => dmy(ts[i]);
    const L = Math.max(1, Math.floor(xs.length / 4));
    opts.labels = [0, L, 2 * L, 3 * L].filter(i => i < xs.length).map(i => [i, dmy(ts[i])]);
  }
  return {html: chartSVG(xs, ys, opts), xs, ys, fx: fx_};
}

// ============================================================= components
function stockItem(s) {
  const q = stocks()[s]; const c = chg(q || {});
  return `<button class="list-item" data-go="stock-${esc(s)}"><div class="li-main"><b>${esc(s)}</b><span>${esc(nameOf(s))}</span></div>
    <div class="li-end"><b class="${fx("EQ:" + s)}">${q ? fmt(q.p) : "—"}</b><span class="${cls(c.abs)}">${sgn(c.abs)} (${pct(c.pct)})</span></div></button>`;
}
function tile(s) {
  const q = stocks()[s]; const c = chg(q || {});
  return `<button class="tile" data-go="stock-${esc(s)}"><span class="nm">${esc(s)}</span><span class="muted" style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(nameOf(s))}</span>
    <span class="px${fx("EQ:" + s)}">₹${fmt(q.p)}</span><span class="ch ${cls(c.abs)}">${sgn(c.abs)} (${pct(c.pct)})</span></button>`;
}
function signalCard() {
  const sigs = (D.signals || []).filter(s => s.status === "OPEN");
  if (!sigs.length) return "";
  return sigs.map(s => {
    const p = s.premium || {}, exp = p.expiry, right = s.side === "CALL" ? "CE" : "PE";
    const key = exp ? `OPT:${s.index}:${exp}:${s.strike}:${right}` : null;
    const valid = s.valid_until && Date.now() < new Date(s.valid_until + "+05:30").getTime();
    const tradable = key && D.chains && E.chainRow(engineData(), s.index, exp, s.strike);
    return `<div class="sig ${s.side.toLowerCase()}">
      <div class="grow"><div class="k ${s.side === "CALL" ? "up" : "down"}">Signal · buy ${s.side.toLowerCase()} · ${esc(hm(s.entry_time))} IST</div>
      <div class="o">${esc(s.option)}${p.price ? ` <span class="muted" style="font-size:14px">@ ${p.estimated ? "≈" : ""}₹${fmt(p.price)}</span>` : ""}</div>
      <div class="sub">${valid ? `Buy window open till ${esc(hm(s.valid_until))}` : "Buy window closed"}${p.sl ? ` · SL ₹${fmt(p.sl)} · Target ₹${fmt(p.target)}` : ""}</div>
      ${s.auto ? `<div class="sub">${s.auto.status === "bought" ? `Auto-trader bought ${s.auto.qty} @ ₹${fmt(s.auto.price)}` : s.auto.status === "skipped" ? `Auto-trader skipped: ${esc(s.auto.reason)}` : ""}</div>` : ""}</div>
      ${key ? `<button class="btn ${tradable ? "buy" : ""}" data-trade="${esc(key)}" data-side="BUY" ${tradable ? "" : "disabled title='Option prices not loaded yet'"}>Paper trade</button>` : ""}
    </div>`;
  }).join("");
}
function rangeBar(lo, hi, v, l1, l2) {
  if (lo == null || hi == null || v == null || hi <= lo) return "";
  const p = Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100));
  return `<div class="range"><div class="ends"><span>${l1} ${fmt(lo)}</span><span>${l2} ${fmt(hi)}</span></div><div class="bar" role="img" aria-label="${l1} ${fmt(lo)}, ${l2} ${fmt(hi)}, now ${fmt(v)}"><i style="left:${p}%"></i></div></div>`;
}
function rangeTabs(cur, list, attr) {
  return `<div class="tabs" role="tablist" style="margin-top:12px">${list.map(r => `<button class="tab ${cur === r ? "on" : ""}" role="tab" aria-selected="${cur === r}" data-${attr}="${r}">${r}</button>`).join("")}</div>`;
}
function statusPill(o) {
  const tone = {COMPLETE: "up", REJECTED: "down", CANCELLED: "", OPEN: "acc", TRIGGER_PENDING: "warn"}[o.status] || "";
  return `<span class="pill ${tone}">${esc(E.statusLabel(o))}</span>`;
}
function orderPriceText(o) {
  if (o.fillPrice != null) return `₹${fmt(o.fillPrice)}`;
  if (o.type === "MARKET") return "Market";
  if (o.type === "SL-M") return `Trig ₹${fmt(o.trigger)}`;
  if (o.type === "SL") return `₹${fmt(o.price)} · trig ₹${fmt(o.trigger)}`;
  return `₹${fmt(o.price)}`;
}

// ============================================================ accounting
function posPnl(p) {
  const px = E.lastPrice(acct, p.inst, engineData());
  const unreal = p.qty && px != null ? (px - p.avg) * p.qty : 0;
  return {px, unreal, realized: p.realized, total: unreal + p.realized};
}
function slTargetFor(p) {
  const exitSide = p.qty > 0 ? "SELL" : "BUY";
  const os = openOrders().filter(o => o.inst === p.inst && o.product === p.product && o.side === exitSide);
  const sl = os.find(o => o.type === "SL" || o.type === "SL-M"), tg = os.find(o => o.type === "LIMIT");
  return {sl: sl ? sl.trigger : null, target: tg ? tg.price : null};
}
function autoOpen() { return D.auto ? Object.values(D.auto.open || {}) : []; }
function autoLivePx(p) { const q = E.quote(p.key, engineData()); return q ? E.execPrice(q, "SELL") : null; }
function pendingFor(target) { return autoPending.find(p => (p.target === target && p.type === "EXIT") || p.type === "EXIT_ALL"); }

// ================================================================== views
function render() {
  const v = $("#view");
  if (!D.quotes && !["settings", "history", "orders", "auto"].includes(route.name)) {
    v.innerHTML = loadError ? `<div class="card empty" style="margin-top:20px"><b>Prices unavailable</b>${esc(loadError)}</div>` : `<div class="page-h"><div class="sk" style="height:28px;width:200px"></div></div>${skeleton(5)}`;
    return;
  }
  const fn = {dashboard: viewDashboard, market: viewMarket, watchlist: viewWatch, fno: viewFno, orders: viewOrders, positions: viewPositions,
              holdings: viewHoldings, auto: viewAuto, history: viewHistory, settings: viewSettings, stock: viewStock, index: viewIndex}[route.name] || viewDashboard;
  const keep = focusKey(document.activeElement);
  v.innerHTML = fn();
  renderNav();
  if (keep) { const el = document.querySelector(keep); if (el && el !== document.activeElement) el.focus({preventScroll: true}); }
  const h = afterHooks; afterHooks = []; h.forEach(f => f());
}
let afterHooks = [];
/** A selector that finds "the same" control after a re-render, so live price updates don't steal keyboard focus. */
function focusKey(el) {
  if (!el || el === document.body || !el.closest || !el.closest("#view, #sideNav, #bottomNav")) return null;
  if (el.id) return "#" + CSS.escape(el.id);
  for (const a of el.getAttributeNames()) if (a.startsWith("data-")) return `${el.tagName.toLowerCase()}[${a}="${CSS.escape(el.getAttribute(a))}"]`;
  return null;
}
const pageHead = (title, sub, right = "") => `<div class="page-h"><div><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ""}</div>${right}</div>`;

// ---------- dashboard
function equitySeries() {
  const pts = (acct.equity || []).slice();
  const n = {"1W": 7, "1M": 31, "3M": 92, "1Y": 366, "All": 100000}[eqRange];
  const cut = new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  return pts.filter(p => p.d >= cut);
}
function viewDashboard() {
  const sm = E.summary(acct, engineData());
  const overall = sm.netWorth - acct.deposits;
  const today = acct.dayStart ? sm.netWorth - acct.dayStart.v : 0;
  const ps = Object.values(acct.positions).filter(p => p.qty);
  const oo = openOrders();
  const eq = equitySeries();
  const xs = eq.map((_, i) => i), ys = eq.map(p => p.v);
  const L = Math.max(1, Math.floor(xs.length / 4));
  const chart = chartSVG(xs, ys, {label: "Paper account value", ref: eq.length ? eq[0].v : null,
    labels: [0, L, 2 * L, 3 * L].filter(i => i < xs.length).map(i => [i, dmy(eq[i].d)]),
    emptyTitle: "Your performance chart starts today", emptyText: "It adds one point per trading day you use the app."});
  afterHooks.push(() => wireChart($("#eqChart"), xs, ys, i => dmy(eq[i].d)));
  const recent = acct.trades.slice(-6).reverse();
  const A = D.auto;
  return `${pageHead("Dashboard", `Paper account · ${marketPill()}`)}
  ${signalCard() ? `<div class="stack" style="margin-bottom:18px">${signalCard()}</div>` : ""}
  <div class="sum">
    <div><span>Account value</span><b>${rs(sm.netWorth)}</b></div>
    <div><span>Overall P&amp;L</span><b class="${cls(overall)}">${srs(overall)}</b> <small class="${cls(overall)}">${pct(overall / acct.deposits * 100)}</small></div>
    <div><span>Today's P&amp;L</span><b class="${cls(today)}">${srs(today)}</b></div>
    <div><span>Invested (holdings)</span><b>${rs(sm.invested)}</b></div>
    <div><span>Available to trade</span><b>${rs(sm.available)}</b></div>
  </div>
  <div class="dash" style="margin-top:20px">
    <div class="stack">
      <div class="card pad"><div class="row wrap"><h3 class="grow">Account value</h3>${rangeTabs(eqRange, ["1W", "1M", "3M", "1Y", "All"], "eq").replace('style="margin-top:12px"', "")}</div>
        <div class="chart sm" id="eqChart">${chart}</div></div>
      <div class="card"><div class="pad row" style="padding-bottom:4px"><h3 class="grow">Open positions</h3><a href="#positions">View all</a></div>
        ${ps.length ? ps.slice(0, 5).map(p => { const x = posPnl(p); return `<button class="list-item" data-go="positions"><div class="li-main"><b>${esc(E.label(p.inst))}</b><span>${p.qty > 0 ? "+" : ""}${p.qty} · ${prodName(p.product)} · avg ₹${fmt(p.avg)}</span></div><div class="li-end"><b class="${cls(x.total)}">${srs(x.total)}</b><span class="muted">LTP ${fmt(x.px)}</span></div></button>`; }).join("")
          : `<div class="empty" style="padding:20px">No open positions.</div>`}
        <div class="pad row" style="border-top:1px solid var(--line);padding-top:12px"><span class="sub grow">${oo.length} open order${oo.length === 1 ? "" : "s"}</span><a href="#orders">Orders</a></div></div>
      <div class="card"><div class="pad row" style="padding-bottom:4px"><h3 class="grow">Recent trades</h3><a href="#history">History</a></div>
        ${recent.length ? recent.map(t => `<div class="list-item"><div class="li-main"><b><span class="${t.side === "BUY" ? "up" : "down"}">${t.side}</span> ${esc(E.label(t.inst))}</b><span>${dmy(t.ts)} ${hm(t.ts)} · ${t.qty} @ ₹${fmt(t.price)} · ${prodName(t.product)}</span></div><div class="li-end">${t.realized ? `<b class="${cls(t.realized)}">${srs(t.realized)}</b>` : ""}</div></div>`).join("")
          : `<div class="empty" style="padding:20px"><b>No trades yet</b>Search a stock or open F&amp;O to place your first paper trade.</div>`}</div>
    </div>
    <div class="stack">
      ${autoCard(A)}
      <div class="card"><div class="pad row" style="padding-bottom:4px"><h3 class="grow">Watchlist</h3><a href="#watchlist">Edit</a></div>
        ${watch.length ? watch.slice(0, 6).map(stockItem).join("") : `<div class="empty" style="padding:20px">Star stocks to follow them here.</div>`}</div>
    </div>
  </div>`;
}
function autoCard(A) {
  if (!A) return `<div class="card pad stack"><div class="row"><h3 class="grow">Auto-trader</h3><a href="#auto">Open</a></div><div class="sub">${autoError ? esc(autoError) : "Starts with the next NIFTY signal. Trades 1 lot per signal in its own virtual account."}</div></div>`;
  const open = autoOpen();
  const today = E.ist(new Date()).date;
  const tNet = (A.trades || []).filter(t => t.sell_time.slice(0, 10) === today).reduce((a, t) => a + t.net, 0);
  const unreal = open.reduce((a, p) => { const px = autoLivePx(p); return a + (px != null ? (px - p.buy_price) * p.qty : 0); }, 0);
  const busy = autoPending.find(p => (p.type === "PAUSE" || p.type === "RESUME") && p.state !== "failed");
  return `<div class="card pad stack">
    <div class="row"><h3 class="grow">Auto-trader</h3><a href="#auto">Manage</a></div>
    <div class="auto-status">${A.paused ? `<span class="state off"><span class="dot"></span>Paused</span>` : `<span class="state on"><span class="dot"></span>Active</span>`}
      <span class="sub">Today <b class="num ${cls(tNet + unreal)}">${srs(tNet + unreal)}</b> · ${open.length} open</span></div>
    ${open.map(p => autoPosRow(p, true)).join("")}
    <div class="row wrap">${busy ? `<span class="exiting"><span class="spinner"></span>${busy.type === "PAUSE" ? "Pausing…" : "Resuming…"}</span>`
      : A.paused ? `<button class="btn sm ghost" data-auto-resume="1">Resume auto-trading</button>` : `<button class="btn sm warn" data-auto-pause="1">Pause auto-trading</button>`}</div>
  </div>`;
}
function autoPosRow(p, compactRow) {
  const px = autoLivePx(p);
  const pnl = px != null ? (px - p.buy_price) * p.qty : null;
  const pend = pendingFor(p.id);
  const action = pend && pend.state === "failed"
    ? `<span class="down" style="font-size:12.5px">Exit failed: ${esc(pend.error || "")}</span><button class="btn sm sell" data-auto-retry="${esc(pend.id)}">Try again</button>`
    : pend ? `<span class="exiting" role="status"><span class="spinner"></span>${pend.state === "sending" ? "Sending exit…" : "Exiting…"}</span>`
    : `<button class="btn sm sell" data-auto-exit="${esc(p.id)}">Exit trade</button>`;
  return `<div class="list-item" style="padding:${compactRow ? "10px 0" : "12px 16px"};align-items:flex-start;flex-wrap:wrap">
    <div class="li-main"><b>${esc(p.option)} <span class="pill acc">AUTO</span></b>
      <span class="wrap">Long ${p.side === "CALL" ? "call" : "put"} · ${p.qty} qty · bought ₹${fmt(p.buy_price)} at ${esc(hm(p.buy_time))}${p.sl ? ` · SL ₹${fmt(p.sl)} · target ₹${fmt(p.target)}` : ""}</span></div>
    <div class="li-end" style="display:flex;flex-direction:column;align-items:flex-end;gap:6px"><b class="${cls(pnl)}">${pnl == null ? "—" : srs(pnl)}</b>
      <span class="muted">LTP ${px == null ? "—" : fmt(px)}</span><div class="row" style="gap:6px">${action}</div></div></div>`;
}

// ---------- market
function viewMarket() {
  const all = Object.keys(stocks()).filter(s => stocks()[s].p && stocks()[s].pc);
  const rows0 = all.map(s => ({s, q: stocks()[s], pct: chg(stocks()[s]).pct, val: (stocks()[s].v || 0) * stocks()[s].p}));
  const gain = [...rows0].sort((a, b) => b.pct - a.pct).slice(0, 6);
  const lose = [...rows0].sort((a, b) => a.pct - b.pct).slice(0, 6);
  const active = [...rows0].sort((a, b) => b.val - a.val).slice(0, 6);
  const f = marketFilter.toLowerCase();
  let rows = rows0.filter(x => !f || x.s.toLowerCase().includes(f) || nameOf(x.s).toLowerCase().includes(f));
  const k = marketSort.k;
  rows.sort((a, b) => (k === "s" ? a.s.localeCompare(b.s) : k === "p" ? a.q.p - b.q.p : k === "val" ? a.val - b.val : a.pct - b.pct) * marketSort.dir);
  const th = (key, label, r) => `<th class="${r ? "r" : ""}" aria-sort="${marketSort.k === key ? (marketSort.dir > 0 ? "ascending" : "descending") : "none"}"><button class="sort" data-msort="${key}">${label}${marketSort.k === key ? (marketSort.dir > 0 ? " ↑" : " ↓") : ""}</button></th>`;
  afterHooks.push(() => keepInput("#marketFilter", v => { marketFilter = v; }));
  return `${pageHead("Market", `F&amp;O stocks and indices · prices as of ${esc(hm(D.quotes.ts))} IST`, marketPill())}
  <h2 style="margin-top:0">Indices</h2>
  <div class="grid g-tiles">${INDEX_ORDER.map(k => { const q = idxQuote(k); if (!q) return ""; const c = chg(q);
    return `<button class="tile" data-go="index-${k}"><span class="nm">${INDEX_LABEL[k]}</span><span class="px${fx("IDX:" + k)}">${fmt(q.p)}</span><span class="ch ${cls(c.abs)}">${sgn(c.abs)} (${pct(c.pct)})</span></button>`; }).join("")}</div>
  <h2>Top gainers</h2><div class="grid g-tiles">${gain.map(x => tile(x.s)).join("")}</div>
  <h2>Top losers</h2><div class="grid g-tiles">${lose.map(x => tile(x.s)).join("")}</div>
  <h2>Most traded today</h2><div class="grid g-tiles">${active.map(x => tile(x.s)).join("")}</div>
  <h2>All F&amp;O stocks <span class="muted" style="font-weight:500">(${all.length})</span></h2>
  <div class="card"><div class="pad" style="padding-bottom:8px"><div class="field"><label for="marketFilter" class="sr">Filter stocks</label><input id="marketFilter" class="txt" placeholder="Filter by name or symbol" value="${esc(marketFilter)}"></div></div>
  <div class="tbl-wrap"><table><thead><tr>${th("s", "Company")}${th("p", "Price", 1)}${th("chp", "Change", 1)}${th("val", "Traded value", 1)}</tr></thead><tbody>
  ${rows.slice(0, 250).map(x => `<tr class="click" data-go="stock-${esc(x.s)}" tabindex="0"><td class="cell-name"><b>${esc(x.s)}</b><span>${esc(nameOf(x.s))}</span></td>
    <td class="r num${fx("EQ:" + x.s)}">${fmt(x.q.p)}</td><td class="r num ${cls(x.pct)}">${pct(x.pct)}</td><td class="r num muted">₹${compact(x.val)}</td></tr>`).join("") || `<tr><td colspan="4" class="empty">No stocks match “${esc(marketFilter)}”.</td></tr>`}
  </tbody></table></div></div>`;
}
/** Re-render-safe text inputs: keep focus and caret while the list updates. */
function keepInput(sel, set) {
  const inp = $(sel); if (!inp) return;
  inp.addEventListener("input", e => { set(e.target.value); const pos = e.target.selectionStart; render(); const n = $(sel); if (n) { n.focus(); n.setSelectionRange(pos, pos); } });
}

// ---------- watchlist
function viewWatch() {
  return `${pageHead("Watchlist", "Tap ☆ on any stock page, or search above, to add stocks.")}
  <div class="card">${watch.length ? watch.map(s => `<div class="row" style="border-bottom:1px solid var(--line);gap:6px;padding-right:12px"><div class="grow">${stockItem(s).replace('class="list-item"', 'class="list-item" style="border:0"')}</div>
    <button class="btn sm buy" data-trade="EQ:${esc(s)}" data-side="BUY" aria-label="Buy ${esc(s)}">Buy</button><button class="btn sm sell" data-trade="EQ:${esc(s)}" data-side="SELL" aria-label="Sell ${esc(s)}">Sell</button>
    <button class="icon-btn" data-star="${esc(s)}" aria-label="Remove ${esc(s)} from watchlist" title="Remove">${svg("close")}</button></div>`).join("")
    : `<div class="empty"><b>Your watchlist is empty</b>Search for a stock and tap the star.</div>`}</div>`;
}

// ---------- stock & index
function viewStock() {
  const s = route.arg; const q = stocks()[s];
  if (!q) return `<button class="btn ghost sm" data-back="1">${svg("back")} Back</button><div class="card empty" style="margin-top:16px"><b>${esc(s)}</b>No live price for this symbol right now.</div>`;
  const c = chg(q), u = uniStock(s), ch = chartBlock(s, q);
  afterHooks.push(() => wireChart($("#chart"), ch.xs, ch.ys, ch.fx));
  const h = acct.holdings[s];
  const poss = Object.values(acct.positions).filter(p => p.qty && E.parse(p.inst).u === s);
  const chains = D.chains && Object.keys(D.chains.chains || {}).filter(k => k.startsWith(s + "|"));
  const futs = Object.entries((D.quotes && D.quotes.futures) || {}).filter(([k, f]) => f.u === s);
  const starred = watch.includes(s);
  const stale = !E.marketOpen(engineData(), new Date()) && E.sessionPhase(engineData(), new Date()) === "open";
  return `
  <div class="row" style="gap:10px;margin-bottom:16px"><button class="icon-btn" data-back="1" aria-label="Back">${svg("back")}</button>
    <div class="grow"><h1>${esc(nameOf(s))}</h1><div class="sub">NSE: ${esc(s)}${u.lot ? ` · F&amp;O lot ${u.lot}` : ""}</div></div>
    <button class="icon-btn ${starred ? "on" : ""}" data-star="${esc(s)}" aria-pressed="${starred}" aria-label="${starred ? "Remove from" : "Add to"} watchlist">${svg("star", starred ? 'fill="currentColor"' : "")}</button></div>
  ${stale ? `<div class="info" style="margin-bottom:12px">Prices are more than 5 minutes old. Orders will wait for fresh prices.</div>` : ""}
  <div class="card pad">
    <div class="quote-head"><div><div class="big${fx("EQ:" + s)}">₹${fmt(q.p)}</div><div class="num ${cls(c.abs)}" style="font-weight:600">${sgn(c.abs)} (${pct(c.pct)}) <span class="muted" style="font-weight:500">today</span></div></div>${marketPill()}</div>
    <div class="chart" id="chart">${ch.html}</div>
    ${rangeTabs(chartRange, ["1D", "1W", "1M", "3M", "6M", "1Y"], "range")}
  </div>
  <div class="trade-bar" style="margin-top:14px"><button class="btn buy" data-trade="EQ:${esc(s)}" data-side="BUY">Buy</button><button class="btn sell" data-trade="EQ:${esc(s)}" data-side="SELL">Sell</button></div>
  ${h || poss.length ? `<h2>Your investment</h2><div class="card">${h ? holdingItem(s, h) : ""}${poss.map(p => positionItem(p)).join("")}</div>` : ""}
  <h2>Performance</h2>
  <div class="card pad" style="display:grid;gap:18px">
    ${rangeBar(q.l, q.h, q.p, "Today's low", "Today's high")}
    ${rangeBar(q.yl, q.yh, q.p, "52W low", "52W high")}
    <div class="stats"><div class="stat"><span>Previous close</span><b>${fmt(q.pc)}</b></div><div class="stat"><span>Volume</span><b>${compact(q.v)}</b></div>
    <div class="stat"><span>Traded value</span><b>₹${compact((q.v || 0) * q.p)}</b></div><div class="stat"><span>Lot size</span><b>${u.lot || "—"}</b></div></div>
  </div>
  ${(chains && chains.length) || futs.length ? `<h2>Futures &amp; options</h2><div class="card">
    ${chains && chains.length ? `<button class="list-item" data-go="fno-${esc(s)}"><div class="li-main"><b>Option chain</b><span>${chains.length} expir${chains.length > 1 ? "ies" : "y"} available</span></div><span class="muted">→</span></button>` : ""}
    ${futs.map(([k, f]) => futRow(k, f)).join("")}</div>` : (u.lot ? `<h2>Futures &amp; options</h2><div class="card empty">Live F&amp;O prices for ${esc(s)} aren't in the feed. Add it to <span class="num">stock_chains</span> in feed_config.json to trade its options.</div>` : "")}`;
}
function futRow(k, f) {
  return `<div class="list-item"><div class="li-main"><b>${esc(E.label(k))}</b><span>OI ${compact(f.oi)} · Lot ${E.lotSize(E.parse(k), engineData())}</span></div>
    <div class="li-end" style="margin-right:8px"><b class="${fx(k)}">${fmt(f.p)}</b><span class="${cls(f.ch)}">${sgn(f.ch)} (${pct(f.chp)})</span></div>
    <button class="btn sm buy" data-trade="${esc(k)}" data-side="BUY">Buy</button><button class="btn sm sell" data-trade="${esc(k)}" data-side="SELL">Sell</button></div>`;
}
function viewIndex() {
  const k = route.arg; const q = idxQuote(k);
  if (!q) return `<div class="card empty"><b>Unknown index</b></div>`;
  const c = chg(q), ch = chartBlock(k, q);
  afterHooks.push(() => wireChart($("#chart"), ch.xs, ch.ys, ch.fx));
  const futs = Object.entries((D.quotes && D.quotes.futures) || {}).filter(([kk, f]) => f.u === k);
  const fnoable = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"].includes(k);
  return `
  <div class="row" style="gap:10px;margin-bottom:16px"><button class="icon-btn" data-back="1" aria-label="Back">${svg("back")}</button><div class="grow"><h1>${INDEX_LABEL[k]}</h1><div class="sub">Index</div></div></div>
  <div class="card pad"><div class="quote-head"><div><div class="big${fx("IDX:" + k)}">${fmt(q.p)}</div><div class="num ${cls(c.abs)}" style="font-weight:600">${sgn(c.abs)} (${pct(c.pct)})</div></div>${marketPill()}</div>
    <div class="chart" id="chart">${ch.html}</div>${rangeTabs(chartRange, ["1D", "1W", "1M", "3M", "6M", "1Y"], "range")}</div>
  ${fnoable ? `<div class="trade-bar" style="margin-top:14px"><button class="btn pri" data-go="fno-${k}">Option chain</button></div>` : ""}
  <h2>Performance</h2><div class="card pad" style="display:grid;gap:18px">${rangeBar(q.l, q.h, q.p, "Today's low", "Today's high")}${rangeBar(q.yl, q.yh, q.p, "52W low", "52W high")}
    <div class="stats"><div class="stat"><span>Open</span><b>${fmt(q.o)}</b></div><div class="stat"><span>Previous close</span><b>${fmt(q.pc)}</b></div></div></div>
  ${futs.length ? `<h2>Futures</h2><div class="card">${futs.map(([kk, f]) => futRow(kk, f)).join("")}</div>` : ""}
  ${k === "SENSEX" ? `<div class="info" style="margin-top:14px">SENSEX options trade on BSE, which has no free live feed, so they can't be paper-traded here.</div>` : ""}`;
}

// ---------- F&O
function chainUnderlyings() {
  const keys = Object.keys((D.chains && D.chains.chains) || {});
  const u = [...new Set(keys.map(k => k.split("|")[0]))];
  const idx = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"].filter(x => u.includes(x));
  return idx.concat(u.filter(x => !idx.includes(x)).sort());
}
function viewFno() {
  if (!D.chains) return `${pageHead("F&amp;O", "Option chains and futures")}${skeleton(8)}`;
  const us = chainUnderlyings();
  if (!us.includes(fnoU)) fnoU = us[0];
  const exps = Object.keys(D.chains.chains).filter(k => k.startsWith(fnoU + "|")).map(k => k.split("|")[1]).sort();
  if (!fnoExp || !exps.includes(fnoExp)) fnoExp = exps[0];
  const ch = D.chains.chains[fnoU + "|" + fnoExp];
  const lot = E.lotSize({kind: "OPT", u: fnoU}, engineData());
  const spot = E.underlyingSpot(fnoU, engineData()) || ch.spot;
  const futs = Object.entries(D.quotes.futures || {}).filter(([k, f]) => f.u === fnoU);
  let spotDone = false;
  const rows = ch.rows.map(r => {
    const K = r[0]; let pre = "";
    if (!spotDone && K > spot) { spotDone = true; pre = `<tr class="spot" id="spotRow"><td colspan="7" class="spot-tag"><span>${fnoU} ${fmt(spot)}</span></td></tr>`; }
    const ce = `OPT:${fnoU}:${fnoExp}:${K}:CE`, pe = `OPT:${fnoU}:${fnoExp}:${K}:PE`;
    const cIt = K < spot, pIt = K > spot;
    const p_ = (l, c) => l != null && l - c ? (c / (l - c) * 100) : null;
    const cp = p_(r[1], r[2]), pp = p_(r[9], r[10]);
    return pre + `<tr>
      <td class="r ${cIt ? "itm" : ""}"><span class="oi">${compact(r[5])}</span></td>
      <td class="c-chg r ${cIt ? "itm" : ""} num ${cls(cp)}" style="font-size:12px">${cp == null ? "" : pct(cp, 1)}</td>
      <td class="r ${cIt ? "itm" : ""}"><button class="px-btn${fx(ce)}" data-trade="${ce}" data-side="BUY" aria-label="Trade ${fnoU} ${K} call at ${fmt(r[1])}">${fmt(r[1])}</button></td>
      <td class="k">${K}</td>
      <td class="${pIt ? "itm" : ""}"><button class="px-btn${fx(pe)}" data-trade="${pe}" data-side="BUY" aria-label="Trade ${fnoU} ${K} put at ${fmt(r[9])}">${fmt(r[9])}</button></td>
      <td class="c-chg ${pIt ? "itm" : ""} num ${cls(pp)}" style="font-size:12px">${pp == null ? "" : pct(pp, 1)}</td>
      <td class="${pIt ? "itm" : ""}"><span class="oi">${compact(r[13])}</span></td></tr>`;
  }).join("");
  afterHooks.push(() => {
    const s = $("#fnoU"); if (s) s.onchange = e => go("fno-" + e.target.value);
    const view = fnoU + "|" + fnoExp;
    if (lastChainView !== view) { lastChainView = view; const r = $("#spotRow"); if (r) r.scrollIntoView({block: "center"}); }
  });
  return `${pageHead("F&amp;O", `Tap a price to buy or sell · lot size ${lot} · chain as of ${esc(hm(D.chains.ts))} IST`, marketPill())}
  ${signalCard() ? `<div class="stack" style="margin-bottom:14px">${signalCard()}</div>` : ""}
  <div class="row wrap" style="margin-bottom:12px;gap:10px"><label class="sr" for="fnoU">Underlying</label><select id="fnoU" class="inp">${us.map(u => `<option ${u === fnoU ? "selected" : ""}>${u}</option>`).join("")}</select>
    <div class="tabs" role="tablist" aria-label="Expiry">${exps.map(e => `<button class="tab ${e === fnoExp ? "on" : ""}" role="tab" aria-selected="${e === fnoExp}" data-exp="${e}">${E.fmtExp(e)}</button>`).join("")}</div>
    <div class="grow"></div><div class="num" style="font-weight:600">${fnoU} ${fmt(spot)}</div></div>
  <div class="card tbl-wrap"><table class="oc"><thead><tr><th class="r">Call OI</th><th class="r c-chg">Chg</th><th class="r">Call LTP</th><th class="k">Strike</th><th>Put LTP</th><th class="c-chg">Chg</th><th>Put OI</th></tr></thead><tbody>${rows}</tbody></table></div>
  <div class="sub" style="margin-top:8px">Shaded cells are in the money. Orders fill at the live bid/ask when available.</div>
  ${futs.length ? `<h2>${fnoU} futures</h2><div class="card">${futs.map(([k, f]) => futRow(k, f)).join("")}</div>` : ""}`;
}

// ---------- orders
function viewOrders() {
  const today = E.ist(new Date()).date;
  const open = openOrders();
  const todays = acct.orders.filter(o => o.ts.slice(0, 10) === today && !E.ACTIVE(o));
  const hist = acct.orders.filter(o => o.ts.slice(0, 10) !== today && !E.ACTIVE(o));
  const L = ({open, today: todays, history: hist}[ordersTab]).slice().reverse().slice(0, 300);
  const tab = (k, label) => `<button class="${ordersTab === k ? "on" : ""}" data-otab="${k}" aria-pressed="${ordersTab === k}">${label}</button>`;
  const actions = o => E.ACTIVE(o) ? `<button class="btn sm ghost" data-modify="${o.id}">Modify</button> <button class="btn sm danger" data-cancel="${o.id}">Cancel</button>` : "";
  return `${pageHead("Orders", "Day orders lapse at 3:30 PM. Orders placed while the market is closed run at the next open.")}
  <div class="seg" style="margin-bottom:12px">${tab("open", `Open (${open.length})`)}${tab("today", `Today (${todays.length})`)}${tab("history", "History")}</div>
  ${L.length ? `<div class="card tbl-wrap hide-sm"><table><thead><tr><th>Time</th><th>Instrument</th><th>Side</th><th>Type</th><th class="r">Qty</th><th class="r">Price</th><th>Status</th><th></th></tr></thead><tbody>
    ${L.map(o => `<tr><td class="num">${o.ts.slice(0, 10) !== today ? dmy(o.ts) + " " : ""}${hm(o.ts)}</td>
      <td class="cell-name"><b>${esc(E.label(o.inst))}</b><span>${prodName(o.product)}${o.tag === "SQUAREOFF" ? " · auto square-off" : o.tag === "EXPIRY" ? " · expiry" : o.tag === "EXIT" ? " · exit" : ""}${o.msg && o.status !== "COMPLETE" ? " · " + esc(o.msg) : ""}</span></td>
      <td class="${o.side === "BUY" ? "up" : "down"}" style="font-weight:700">${o.side}</td><td>${typeName(o.type)}</td><td class="r num">${o.qty}</td><td class="r num">${orderPriceText(o)}</td><td>${statusPill(o)}</td><td class="r">${actions(o)}</td></tr>`).join("")}
  </tbody></table></div>
  <div class="card show-sm">${L.map(o => `<div class="list-item" style="align-items:flex-start"><div class="li-main"><b><span class="${o.side === "BUY" ? "up" : "down"}">${o.side}</span> ${esc(E.label(o.inst))}</b>
    <span>${o.qty} qty · ${prodName(o.product)} · ${typeName(o.type)} · ${orderPriceText(o)} · ${hm(o.ts)}</span>${o.msg && o.status !== "COMPLETE" ? `<span class="${o.status === "REJECTED" ? "down" : "muted"}" style="white-space:normal">${esc(o.msg)}</span>` : ""}</div>
    <div class="li-end" style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">${statusPill(o)}<div class="row" style="gap:6px">${actions(o)}</div></div></div>`).join("")}</div>`
  : `<div class="card empty"><b>No orders here</b>${ordersTab === "open" ? "Pending limit, stop-loss and after-market orders appear here." : "Filled, cancelled and rejected orders appear here."}</div>`}`;
}

// ---------- positions
function positionItem(p) {
  const x = posPnl(p), k = E.posKey(p.inst, p.product), st = slTargetFor(p);
  const exiting = p.qty && E.pendingExitQty(acct, p) >= Math.abs(p.qty);
  const pctv = p.qty && p.avg && x.px != null ? ((x.px - p.avg) / p.avg * 100 * Math.sign(p.qty)) : null;
  return `<div class="list-item" style="align-items:flex-start;flex-wrap:wrap"><div class="li-main">
    <b>${esc(E.label(p.inst))} <span class="pill">${prodName(p.product)}</span> <span class="pill ${p.qty > 0 ? "up" : p.qty < 0 ? "down" : ""}">${p.qty > 0 ? "LONG" : p.qty < 0 ? "SHORT" : "CLOSED"}</span></b>
    <span class="wrap">${p.qty ? `${p.qty > 0 ? "+" : ""}${p.qty} · avg ₹${fmt(p.avg)} · LTP ₹${fmt(x.px)}` : `Bought ${p.buyQty} · sold ${p.sellQty}`}${st.sl ? ` · SL ₹${fmt(st.sl)}` : ""}${st.target ? ` · target ₹${fmt(st.target)}` : ""}</span>
    <span>Unrealized <b class="num ${cls(x.unreal)}">${srs(x.unreal)}</b> · Realized <b class="num ${cls(x.realized)}">${srs(x.realized)}</b></span></div>
    <div class="li-end" style="display:flex;flex-direction:column;align-items:flex-end;gap:6px"><b class="${cls(x.total)}">${srs(x.total)}</b>${pctv != null ? `<span class="${cls(pctv)}">${pct(pctv)}</span>` : ""}
    ${p.qty ? `<div class="row" style="gap:6px"><button class="btn sm ghost" data-trade="${esc(p.inst)}" data-side="${p.qty > 0 ? "BUY" : "SELL"}" data-product="${p.product}">Add</button>
      ${exiting ? `<span class="exiting"><span class="spinner"></span>Exit pending</span>` : `<button class="btn sm ${p.qty > 0 ? "sell" : "buy"}" data-exit="${esc(k)}">Exit</button>`}</div>` : ""}</div></div>`;
}
function viewPositions() {
  const sm = E.summary(acct, engineData());
  const ps = Object.values(acct.positions);
  const tot = ps.reduce((a, p) => a + posPnl(p).total, 0);
  const openN = ps.filter(p => p.qty).length;
  const ao = autoOpen();
  return `${pageHead("Positions", `Intraday and F&amp;O · intraday positions close automatically at 3:20 PM`, marketPill())}
  <div class="sum"><div><span>Total P&amp;L</span><b class="${cls(tot)}">${srs(tot)}</b></div><div><span>Open positions</span><b>${openN}</b></div><div><span>Margin used</span><b>${rs(sm.used)}</b></div><div><span>Available</span><b>${rs(sm.available)}</b></div></div>
  <h2>Your positions ${openN > 1 ? `<button class="btn sm ghost more" data-exitall="1">Exit all</button>` : ""}</h2>
  <div class="card">${ps.length ? ps.sort((a, b) => Math.abs(b.qty) - Math.abs(a.qty)).map(positionItem).join("") : `<div class="empty"><b>No positions</b>Intraday trades and F&amp;O positions show here.</div>`}</div>
  <h2>Auto-trader positions <a class="more" href="#auto">Manage</a></h2>
  <div class="card">${ao.length ? ao.map(p => autoPosRow(p)).join("") : `<div class="empty" style="padding:20px">${D.auto ? "No open auto-trades." : "Auto-trader data not loaded yet."}</div>`}</div>`;
}

// ---------- holdings
function holdingItem(s, h) {
  const q = stocks()[s], px = q ? q.p : null;
  const pnl = px != null ? (px - h.avg) * h.qty : null;
  return `<button class="list-item" data-go="stock-${esc(s)}"><div class="li-main"><b>${esc(s)}</b><span>${h.qty} shares · avg ₹${fmt(h.avg)} · LTP ${px != null ? "₹" + fmt(px) : "unavailable"}</span></div>
    <div class="li-end"><b class="${cls(pnl)}">${pnl == null ? "—" : srs(pnl)}</b><span class="${cls(pnl)}">${px != null ? pct((px / h.avg - 1) * 100) : ""}</span></div></button>`;
}
const PALETTE = ["#1d4ed8", "#0e9f6e", "#d97706", "#7c3aed", "#db2777", "#0891b2", "#94a3b8"];
function viewHoldings() {
  const sm = E.summary(acct, engineData());
  const rows0 = Object.entries(acct.holdings).map(([s, h]) => {
    const q = stocks()[s], px = q ? q.p : null;
    const inv = h.qty * h.avg, val = px != null ? h.qty * px : null;
    return {s, h, px, inv, val, pnl: val != null ? val - inv : null, pp: val != null ? (val / inv - 1) * 100 : null, day: q && q.pc ? (q.p - q.pc) * h.qty : null};
  });
  const f = holdFilter.toLowerCase();
  const rows = rows0.filter(r => !f || r.s.toLowerCase().includes(f) || nameOf(r.s).toLowerCase().includes(f));
  const k = holdSort.k;
  rows.sort((a, b) => (k === "s" ? a.s.localeCompare(b.s) : ((a[k] == null ? -1e18 : a[k]) - (b[k] == null ? -1e18 : b[k]))) * holdSort.dir);
  const tot = rows0.reduce((a, r) => a + (r.val != null ? r.val : r.inv), 0) || 1;
  const byVal = [...rows0].sort((a, b) => (b.val || b.inv) - (a.val || a.inv));
  const top = byVal.slice(0, 6), rest = byVal.slice(6).reduce((a, r) => a + (r.val || r.inv), 0);
  const segs = top.map((r, i) => ({l: r.s, v: r.val || r.inv, c: PALETTE[i]})).concat(rest ? [{l: "Others", v: rest, c: PALETTE[6]}] : []);
  const th = (key, label, r) => `<th class="${r ? "r" : ""}" aria-sort="${holdSort.k === key ? (holdSort.dir > 0 ? "ascending" : "descending") : "none"}"><button class="sort" data-hsort="${key}">${label}${holdSort.k === key ? (holdSort.dir > 0 ? " ↑" : " ↓") : ""}</button></th>`;
  afterHooks.push(() => keepInput("#holdFilter", v => { holdFilter = v; }));
  return `${pageHead("Holdings", "Stocks bought with Delivery")}
  <div class="sum"><div><span>Current value</span><b>${rs(sm.current)}</b></div><div><span>Invested</span><b>${rs(sm.invested)}</b></div>
    <div><span>Total returns</span><b class="${cls(sm.holdingsPnl)}">${srs(sm.holdingsPnl)}</b> <small class="${cls(sm.holdingsPnl)}">${sm.invested ? pct(sm.holdingsPnl / sm.invested * 100) : ""}</small></div>
    <div><span>1D returns</span><b class="${cls(sm.holdingsDayPnl)}">${srs(sm.holdingsDayPnl)}</b></div></div>
  ${rows0.length ? `<div class="card pad" style="margin-top:16px"><h3 style="margin-bottom:10px">Allocation</h3><div class="alloc" role="img" aria-label="Allocation by current value">${segs.map(x => `<i style="width:${x.v / tot * 100}%;background:${x.c}" title="${esc(x.l)} ${fmt(x.v / tot * 100, 1)}%"></i>`).join("")}</div>
    <div class="legend">${segs.map(x => `<span><i style="background:${x.c}"></i>${esc(x.l)} ${fmt(x.v / tot * 100, 1)}%</span>`).join("")}</div></div>
  <div class="card" style="margin-top:16px"><div class="pad" style="padding-bottom:8px"><label for="holdFilter" class="sr">Search holdings</label><div class="field"><input id="holdFilter" class="txt" placeholder="Search holdings" value="${esc(holdFilter)}"></div></div>
  <div class="tbl-wrap"><table><thead><tr>${th("s", "Stock")}${th("qty", "Qty", 1)}<th class="r">Avg</th><th class="r">LTP</th>${th("inv", "Invested", 1)}${th("value", "Current", 1)}${th("pnl", "P&amp;L", 1)}${th("pp", "P&amp;L %", 1)}</tr></thead><tbody>
  ${rows.map(r => `<tr class="click" data-go="stock-${esc(r.s)}" tabindex="0"><td class="cell-name"><b>${esc(r.s)}</b><span>${esc(nameOf(r.s))}</span></td><td class="r num">${r.h.qty}</td><td class="r num">${fmt(r.h.avg)}</td>
    <td class="r num">${r.px == null ? "—" : fmt(r.px)}</td><td class="r num">${fmt(r.inv)}</td><td class="r num">${r.val == null ? "—" : fmt(r.val)}</td><td class="r num ${cls(r.pnl)}">${r.pnl == null ? "—" : sgn(r.pnl)}</td><td class="r num ${cls(r.pp)}">${pct(r.pp)}</td></tr>`).join("") || `<tr><td colspan="8" class="empty">No holdings match.</td></tr>`}
  </tbody></table></div></div>` : `<div class="card empty" style="margin-top:16px"><b>No holdings yet</b>Stocks you buy with Delivery appear here.<br><a class="btn pri" href="#market">Browse stocks</a></div>`}`;
}

// ---------- auto trading
function viewAuto() {
  const A = D.auto;
  const tokenNote = hasToken() ? "" : `<div class="info">To exit trades or pause the auto-trader from here, add a GitHub token in <a href="#settings">Settings</a>. Until then this page is view-only and can be up to 5 minutes behind.</div>`;
  if (!A) return `${pageHead("Auto trading", "Paper auto-trader")}${tokenNote}<div class="card empty" style="margin-top:12px"><b>${autoError ? "Couldn't load the auto-trader" : "No auto-trades yet"}</b>${esc(autoError || "Every market day it buys each NIFTY signal (1 lot) at the live price and sells when the signal exits.")}</div>`;
  const open = autoOpen(), tr = (A.trades || []).slice().reverse();
  const net = tr.reduce((a, t) => a + t.net, 0), wins = tr.filter(t => t.net > 0).length;
  let openVal = 0, unreal = 0;
  open.forEach(p => { const px = autoLivePx(p); openVal += (px != null ? px : p.buy_price) * p.qty; if (px != null) unreal += (px - p.buy_price) * p.qty; });
  const value = A.cash + openVal, total = value - A.start_cash;
  const today = E.ist(new Date()).date;
  const tNet = tr.filter(t => t.sell_time.slice(0, 10) === today).reduce((a, t) => a + t.net, 0);
  const blocked = Object.entries(A.blocks || {}).filter(([, d]) => d === today).map(([i]) => i);
  const busyCtl = autoPending.find(p => ["PAUSE", "RESUME", "EXIT_ALL", "ALLOW_REENTRY", "SET_REENTRY"].includes(p.type) && p.state !== "failed");
  const failed = autoPending.filter(p => p.state === "failed" && p.type !== "EXIT");
  const age = A.updated ? Math.round((Date.now() - new Date(A.updated + "+05:30").getTime()) / 1000) : null;
  return `${pageHead("Auto trading", `Paper auto-trader · ${autoSource === "live" ? "live" : "cached"} data${age != null ? ` · updated ${age < 120 ? age + "s" : Math.round(age / 60) + " min"} ago` : ""}`)}
  ${tokenNote}
  <div class="card pad stack" style="margin-top:${tokenNote ? "12px" : "0"}">
    <div class="auto-status">${A.paused ? `<span class="state off"><span class="dot"></span>Paused – no new entries</span>` : `<span class="state on"><span class="dot"></span>Active – trading new NIFTY signals</span>`}
      ${blocked.length ? `<span class="pill warn">Re-entry blocked today: ${esc(blocked.join(", "))}</span>` : ""}</div>
    <div class="row wrap" style="gap:8px">
      ${busyCtl ? `<span class="exiting" role="status"><span class="spinner"></span>${esc(busyCtl.label)}…</span>` : `
      ${A.paused ? `<button class="btn pri" data-auto-resume="1">Resume auto-trading</button>` : `<button class="btn warn" data-auto-pause="1">Pause auto-trading</button>`}
      <button class="btn danger" data-auto-stopall="1" ${open.length || !A.paused ? "" : "disabled"}>Stop &amp; exit all</button>
      ${blocked.length ? `<button class="btn ghost" data-auto-reentry="1">Allow re-entry today</button>` : ""}`}
    </div>
    <div class="field" style="max-width:420px"><label for="reentryRule">After you exit an auto-trade manually</label>
      <select id="reentryRule" class="inp" ${busyCtl ? "disabled" : ""}><option value="block_today" ${(A.reentry_rule || "block_today") === "block_today" ? "selected" : ""}>Stop new auto-trades on that index for the day</option><option value="allow" ${A.reentry_rule === "allow" ? "selected" : ""}>Keep auto-trading new signals</option></select></div>
    ${failed.map(p => `<div class="err row wrap"><span class="grow">${esc(p.label)} failed: ${esc(p.error)}</span><button class="btn sm ghost" data-auto-retry="${esc(p.id)}">Try again</button><button class="btn sm ghost" data-auto-dismiss="${esc(p.id)}">Dismiss</button></div>`).join("")}
    <div class="sub">Pausing stops new entries only; open trades stay until their exit signal or until you exit them. Exits use the live NSE bid and happen within about 10–20 seconds during market hours (9:15–3:30). Paper trading: no real orders.</div>
  </div>
  <div class="sum" style="margin-top:16px">
    <div><span>Account value</span><b>${rs(value)}</b></div>
    <div><span>Total P&amp;L${A.started ? " since " + dmy(A.started) : ""}</span><b class="${cls(total)}">${srs(total)}</b> <small class="${cls(total)}">${pct(total / A.start_cash * 100)}</small></div>
    <div><span>Today</span><b class="${cls(tNet + unreal)}">${srs(tNet + unreal)}</b></div>
    <div><span>Closed trades</span><b>${tr.length}</b></div>
    <div><span>Win rate</span><b>${tr.length ? fmt(wins / tr.length * 100, 0) + "%" : "—"}</b></div>
  </div>
  <h2>Open auto positions</h2>
  <div class="card">${open.length ? open.map(p => autoPosRow(p)).join("") : `<div class="empty" style="padding:20px">No open auto-trades right now.</div>`}</div>
  <h2>Auto-trade history <a class="more" href="#history" data-htab="auto">Full history</a></h2>
  ${autoTradesTable(tr.slice(0, 20))}
  ${(A.skipped || []).length ? `<h2>Skipped signals</h2><div class="card">${A.skipped.slice(-8).reverse().map(x => `<div class="list-item"><div class="li-main"><b>${esc(x.option)}</b><span style="white-space:normal">${esc(dmy(x.time))} ${esc(hm(x.time))} · ${esc(x.reason)}</span></div></div>`).join("")}</div>` : ""}
  ${autoLog.length ? `<h2>Your recent commands</h2><div class="card">${autoLog.slice(-8).reverse().map(l => `<div class="list-item"><div class="li-main"><b>${esc(l.label)}</b><span style="white-space:normal">${esc(dmy(l.ts))} ${esc(hm(l.ts))} · ${esc(l.result.message)}</span></div><div class="li-end"><span class="pill ${l.result.status === "done" ? "up" : l.result.status === "noop" ? "" : "down"}">${esc(l.result.status.toUpperCase())}</span></div></div>`).join("")}</div>` : ""}`;
}
function autoTradesTable(tr) {
  if (!tr.length) return `<div class="card empty"><b>No closed auto-trades yet</b>They appear after the first signal exits.</div>`;
  return `<div class="card tbl-wrap"><table><thead><tr><th>Date</th><th>Option</th><th class="r">Qty</th><th class="r">Bought</th><th class="r">Sold</th><th class="r">Charges</th><th class="r">Net P&amp;L</th><th>Why it closed</th></tr></thead><tbody>
    ${tr.map(t => `<tr><td class="num">${dmy(t.buy_time)} ${hm(t.buy_time)}–${hm(t.sell_time)}</td><td><b>${esc(t.option)}</b>${t.manual ? ' <span class="pill warn">MANUAL</span>' : ""}</td><td class="r num">${t.qty}</td>
      <td class="r num">${fmt(t.buy_price)}</td><td class="r num">${fmt(t.sell_price)}</td><td class="r num muted">${fmt((t.buy_charges || 0) + (t.sell_charges || 0))}</td><td class="r num ${cls(t.net)}">${sgn(t.net)}</td><td class="muted">${esc(t.reason || "")}</td></tr>`).join("")}
  </tbody></table></div>`;
}

// ---------- trade history
function viewHistory() {
  const f = histFilter.toLowerCase();
  afterHooks.push(() => keepInput("#histFilter", v => { histFilter = v; }));
  const tabs = `<div class="seg" style="margin-bottom:12px"><button class="${historyTab === "mine" ? "on" : ""}" data-htab="mine">Your trades</button><button class="${historyTab === "auto" ? "on" : ""}" data-htab="auto">Auto-trader</button></div>`;
  if (historyTab === "auto") {
    const tr = ((D.auto && D.auto.trades) || []).slice().reverse().filter(t => !f || t.option.toLowerCase().includes(f));
    const net = tr.reduce((a, t) => a + t.net, 0);
    return `${pageHead("Trade history", "Every executed trade")}${tabs}
    <div class="row wrap" style="margin-bottom:12px"><div class="field grow" style="max-width:360px"><label for="histFilter" class="sr">Search</label><input id="histFilter" class="txt" placeholder="Search option" value="${esc(histFilter)}"></div><span class="sub">${tr.length} trades · net <b class="num ${cls(net)}">${srs(net)}</b></span></div>
    ${autoTradesTable(tr)}`;
  }
  const tr = acct.trades.slice().reverse().filter(t => !f || E.label(t.inst).toLowerCase().includes(f));
  const real = tr.reduce((a, t) => a + (t.realized || 0), 0), chg_ = tr.reduce((a, t) => a + (t.charges || 0), 0);
  return `${pageHead("Trade history", "Every executed trade in your paper account")}${tabs}
  <div class="row wrap" style="margin-bottom:12px"><div class="field grow" style="max-width:360px"><label for="histFilter" class="sr">Search</label><input id="histFilter" class="txt" placeholder="Search instrument" value="${esc(histFilter)}"></div>
    <span class="sub">${tr.length} trades · realized <b class="num ${cls(real)}">${srs(real)}</b> · charges <b class="num">${rs(chg_)}</b></span></div>
  ${tr.length ? `<div class="card tbl-wrap"><table><thead><tr><th>Date</th><th>Instrument</th><th>Side</th><th class="r">Qty</th><th class="r">Price</th><th>Product</th><th class="r">Charges</th><th class="r">Realized P&amp;L</th></tr></thead><tbody>
    ${tr.slice(0, 500).map(t => `<tr><td class="num">${dmy(t.ts)} ${hm(t.ts)}</td><td><b>${esc(E.label(t.inst))}</b></td><td class="${t.side === "BUY" ? "up" : "down"}" style="font-weight:700">${t.side}</td>
      <td class="r num">${t.qty}</td><td class="r num">${fmt(t.price)}</td><td>${prodName(t.product)}</td><td class="r num muted">${fmt(t.charges)}</td><td class="r num ${cls(t.realized)}">${t.realized ? sgn(t.realized) : "—"}</td></tr>`).join("")}
  </tbody></table></div>` : `<div class="card empty"><b>No trades yet</b>Executed orders appear here.</div>`}`;
}

// ---------- settings
let tokenCheck = null;
function viewSettings() {
  const sm = E.summary(acct, engineData());
  const r = repoInfo();
  return `${pageHead("Settings", "Everything here stays in this browser")}
  <h2 style="margin-top:0">Auto-trader control</h2>
  <div class="card pad stack">
    <div class="sub">To exit auto-trades and pause or resume the auto-trader from this app, it needs a GitHub token that can write to <b>${r ? esc(r.owner + "/" + r.repo) : "your repository"}</b>. The token is saved only in this browser and is sent only to api.github.com.</div>
    <ol class="sub" style="margin:0;padding-left:18px;line-height:1.7">
      <li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub → Fine-grained tokens → Generate new token</a>.</li>
      <li>Repository access: <b>Only select repositories</b> → <b>${r ? esc(r.repo) : "signal-desk"}</b>.</li>
      <li>Permissions → Repository → <b>Contents: Read and write</b>. Nothing else.</li>
      <li>Generate, copy, paste below.</li></ol>
    <div class="row wrap" style="align-items:flex-end"><div class="field grow" style="min-width:220px"><label for="tokenIn">GitHub token</label><input id="tokenIn" class="txt" type="password" autocomplete="off" spellcheck="false" placeholder="${hasToken() ? "Saved – paste a new one to replace" : "github_pat_…"}"></div>
      <button class="btn pri" id="tokenSave">${hasToken() ? "Replace & test" : "Save & test"}</button>${hasToken() ? `<button class="btn ghost" id="tokenTest">Test</button><button class="btn danger" id="tokenDel">Remove</button>` : ""}</div>
    ${tokenCheck ? `<div class="${tokenCheck.ok ? "ok-box" : "err"}" role="status">${esc(tokenCheck.msg)}</div>` : hasToken() ? `<div class="note">Token saved on this device.</div>` : ""}
    <div class="hint">Anyone who can use this browser profile could use the saved token. It can only change files in this one repository; remove it here or revoke it on GitHub anytime.</div>
  </div>
  <h2>Virtual money</h2>
  <div class="card pad stack">
    <div class="sum"><div><span>Cash balance</span><b>${rs(sm.cash)}</b></div><div><span>Added so far</span><b>${rs(acct.deposits)}</b></div><div><span>Realized P&amp;L</span><b class="${cls(sm.realized)}">${srs(sm.realized)}</b></div><div><span>Charges paid</span><b>${rs(sm.charges)}</b></div></div>
    <div class="row wrap" style="align-items:flex-end"><div class="field grow" style="max-width:260px"><label for="addAmt">Add virtual funds (₹)</label><input id="addAmt" type="number" min="1000" max="100000000" step="1000" value="100000" inputmode="numeric"></div><button class="btn pri" id="addFunds">Add funds</button></div>
  </div>
  <h2>Backup</h2>
  <div class="card pad stack"><div class="sub">Your paper account lives in this browser only. Download a backup to move it to another device.</div>
    <div class="row wrap"><button class="btn ghost" id="backupBtn">Download backup</button><label class="btn ghost" for="restoreFile" tabindex="0">Restore from file</label><input id="restoreFile" type="file" accept="application/json" class="sr"></div></div>
  <h2>Reset</h2>
  <div class="card pad row wrap"><div class="grow sub">Start again with ₹10,00,000 and no orders, positions or holdings. The auto-trader's account isn't affected.</div><button class="btn danger" id="resetAsk">Reset account</button></div>
  <h2>About the data</h2>
  <div class="card pad sub" style="line-height:1.7">
    <b>Mode: Paper trading.</b> All orders are simulated with virtual money; nothing is sent to any broker.<br>
    Prices: NSE (indices, futures, option chains, lot sizes) and Yahoo Finance (stocks), refreshed about every 15 seconds on market days and typically 10–25 seconds behind the exchange. Orders never fill on prices older than 5 minutes.<br>
    Charges are approximate (brokerage, STT incl. the 2026 F&amp;O rates, exchange, SEBI, stamp duty, GST). Margins are simplified estimates.<br>
    Limits: SENSEX options can't be traded (no free BSE feed). Charts go back one year. Intraday positions square off at 3:20 PM only while the app is open; otherwise at the last seen price on your next visit.
  </div>`;
}

// ================================================================ dialogs
let dialog = null, dialogReturn = null;
function openDialog(d) {
  dialogReturn = document.activeElement;
  dialog = {busy: false, error: "", cancel: "Cancel", ...d};
  renderDialog();
}
function closeDialog() {
  dialog = null; $("#dialogRoot").innerHTML = "";
  if (dialogReturn && document.contains(dialogReturn)) dialogReturn.focus();
}
function renderDialog() {
  if (!dialog) return;
  const d = dialog;
  $("#dialogRoot").innerHTML = `<div class="scrim center" id="dlgScrim"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlgTitle" aria-describedby="dlgBody">
    <div class="d-h" id="dlgTitle">${esc(d.title)}</div><div class="d-b" id="dlgBody">${d.html}${d.error ? `<div class="err" role="alert">${esc(d.error)}</div>` : ""}</div>
    <div class="d-f"><button class="btn ghost" id="dlgCancel" ${d.busy ? "disabled" : ""}>${esc(d.cancel)}</button>
      <button class="btn ${d.tone || "pri"}" id="dlgOk" ${d.busy ? "disabled aria-busy='true'" : ""}>${d.busy ? `<span class="spinner"></span>` : ""}${esc(d.confirm)}</button></div></div></div>`;
  setTimeout(() => { const b = $(d.focusCancel ? "#dlgCancel" : "#dlgOk"); if (b && !d.busy) b.focus(); }, 0);
}
async function confirmDialog() {
  if (!dialog || dialog.busy) return;
  const d = dialog;
  d.busy = true; d.error = ""; renderDialog();
  try {
    const r = await d.onConfirm();
    if (typeof r === "string") { d.busy = false; d.error = r; renderDialog(); return; }
    closeDialog();
  } catch (e) { d.busy = false; d.error = e.message || String(e); renderDialog(); }
}

// ======================================================== manual (own) exit
function askExitOwn(k) {
  const p = acct.positions[k]; if (!p || !p.qty) return toast("Already closed", "This position has no open quantity.");
  const q = E.quote(p.inst, engineData());
  const side = p.qty > 0 ? "SELL" : "BUY";
  const px = E.execPrice(q, side) ?? acct.lastPx[p.inst];
  const est = px != null ? (px - p.avg) * p.qty - E.charges(p.inst, side, Math.abs(p.qty), px, p.product).total : null;
  const open = E.marketOpen(engineData(), new Date());
  const cid = SC.uid("exit");
  openDialog({title: "Exit position?", confirm: open ? "Exit at market" : "Queue exit", tone: p.qty > 0 ? "sell" : "buy",
    html: `<div class="kv"><span class="muted">Instrument</span><b>${esc(E.label(p.inst))}</b></div>
      <div class="kv"><span class="muted">Position</span><b>${p.qty > 0 ? "Long" : "Short"} ${Math.abs(p.qty)} · ${prodName(p.product)}</b></div>
      <div class="kv"><span class="muted">Current ${q && q.bid && q.ask ? (side === "SELL" ? "bid" : "ask") : "price"}</span><b>${px != null ? "₹" + fmt(px) : "unavailable"}</b></div>
      <div class="kv"><span class="muted">Estimated P&amp;L after charges</span><b class="${cls(est)}">${est == null ? "—" : srs(est)}</b></div>
      <div class="note">Paper trade. ${open ? "It fills at the live price when you confirm; the final price can differ from this estimate." : "The market is closed, so this queues an exit for the next open."}</div>`,
    onConfirm: async () => {
      const r = E.exitPosition(acct, k, engineData(), new Date(), cid);
      save();
      if (!r.ok) return r.error;
      if (r.order.status === "COMPLETE") toast("Position closed", `${E.label(p.inst)} @ ₹${fmt(r.order.fillPrice)} (paper)`);
      else toast("Exit order placed", r.order.amo ? "Runs at the next open" : "Waiting for a fresh price");
      (r.events || []).forEach(e => { if (e.order !== r.order) toastEvent(e); });
      renderTop(); render();
    }});
}
function askExitAllOwn() {
  const ks = Object.keys(acct.positions).filter(k => acct.positions[k].qty && E.pendingExitQty(acct, acct.positions[k]) < Math.abs(acct.positions[k].qty));
  if (!ks.length) return toast("Nothing to exit", "No open positions without a pending exit.");
  openDialog({title: `Exit all ${ks.length} positions?`, confirm: "Exit all", tone: "sell",
    html: `<div>${ks.map(k => `<div class="kv"><span>${esc(E.label(acct.positions[k].inst))}</span><b>${acct.positions[k].qty}</b></div>`).join("")}</div><div class="note">Paper trades at the live price (or queued if the market is closed).</div>`,
    onConfirm: async () => {
      const errs = [];
      ks.forEach(k => { const r = E.exitPosition(acct, k, engineData(), new Date(), SC.uid("exit")); if (!r.ok) errs.push(r.error); (r.events || []).forEach(toastEvent); });
      save(); renderTop(); render();
      if (errs.length) toast("Some exits failed", errs[0], true);
    }});
}

// ===================================================== auto-trader control
const LABELS = {EXIT: "Exit trade", EXIT_ALL: "Stop & exit all", PAUSE: "Pausing auto-trading", RESUME: "Resuming auto-trading", ALLOW_REENTRY: "Allowing re-entry", SET_REENTRY: "Updating re-entry rule"};
function needToken() {
  openDialog({title: "Connect the auto-trader", confirm: "Open Settings", tone: "pri",
    html: `<div>Controlling the auto-trader from this app needs a GitHub token (one-time setup, about a minute).</div><div class="note">Without it, the auto-trader keeps running and closes trades on its own exit signals.</div>`,
    onConfirm: async () => { go("settings"); }});
}
async function sendAuto(type, target, extra = {}, label) {
  const ist = E.ist(new Date()).iso;
  const cmd = {id: SC.uid("cmd"), type, target: target || null, ts: ist, by: "app", ...extra};
  const p = {...cmd, label: label || LABELS[type] || type, state: "sending"};
  autoPending.push(p); savePending(); render();
  await deliver(p);
}
async function deliver(p) {
  p.state = "sending"; p.error = ""; savePending(); render();
  try {
    const {id, type, target, ts, by, value} = p;
    await CTRL.send({id, type, target, ts, by, ...(value ? {value} : {})});
    p.state = "sent"; p.sentAt = Date.now();
  } catch (e) { p.state = "failed"; p.error = e.message; toast(`${p.label} not sent`, e.message, true); }
  savePending(); render(); loadAuto(true);
}
function reconcileAuto() {
  if (!D.auto) return;
  const done = autoPending.filter(p => D.auto.processed && D.auto.processed[p.id]);
  if (!done.length) return;
  done.forEach(p => {
    const r = D.auto.processed[p.id];
    autoLog.push({id: p.id, label: p.label, ts: r.time || E.ist(new Date()).iso, result: r});
    const bad = r.status === "failed" || r.status === "partial";
    toast(r.status === "done" ? `${p.label.replace(/ing auto-trading$/, "ed")} ✓` : `${p.label}: ${r.status}`, r.message, bad);
  });
  autoPending = autoPending.filter(p => !done.includes(p));
  savePending(); renderNav();
}
function askAutoExit(id) {
  if (!hasToken()) return needToken();
  const p = (D.auto && D.auto.open || {})[id];
  if (!p) return toast("Already closed", "This auto-trade is no longer open.");
  if (pendingFor(id)) return toast("Exit already in progress", p.option);
  const px = autoLivePx(p);
  const est = px != null ? (px - p.buy_price) * p.qty - (p.buy_charges || 0) - E.charges(p.key, "SELL", p.qty, px, "NRML").total : null;
  const running = liveWindow();
  openDialog({title: "Exit auto-trade?", confirm: "Exit trade", tone: "sell",
    html: `<div class="kv"><span class="muted">Instrument</span><b>${esc(p.option)}</b></div>
      <div class="kv"><span class="muted">Position</span><b>Long ${p.side === "CALL" ? "call" : "put"} · ${p.qty} qty</b></div>
      <div class="kv"><span class="muted">Bought at</span><b>₹${fmt(p.buy_price)}</b></div>
      <div class="kv"><span class="muted">Current bid</span><b>${px != null ? "₹" + fmt(px) : "unavailable"}</b></div>
      <div class="kv"><span class="muted">Estimated net P&amp;L</span><b class="${cls(est)}">${est == null ? "—" : srs(est)}</b></div>
      <div class="note">Paper trade. The auto-trader sells at the live bid when it picks this up${running ? " – usually within 10–20 seconds" : " (it runs 9:15–3:30 on market days)"}. The final price and P&amp;L can differ from this estimate. After a manual exit it won't open a new NIFTY auto-trade today unless you allow it.</div>`,
    onConfirm: async () => { sendAuto("EXIT", id, {}, `Exit ${p.option}`); }});
}
function askAuto(kind) {
  if (!hasToken()) return needToken();
  const open = autoOpen();
  const cfg = {
    pause: {title: "Pause auto-trading?", confirm: "Pause", tone: "warn", type: "PAUSE",
      html: `<div>No new auto-trades will be opened until you resume. ${open.length ? `Your ${open.length} open auto-trade${open.length > 1 ? "s stay" : " stays"} open and still exit${open.length > 1 ? "" : "s"} on the strategy's signal or when you exit manually.` : ""}</div>`},
    resume: {title: "Resume auto-trading?", confirm: "Resume", tone: "pri", type: "RESUME",
      html: `<div>The auto-trader will start buying new NIFTY signals again (1 lot each, virtual money).</div>`},
    stopall: {title: "Stop and exit everything?", confirm: "Stop & exit all", tone: "sell", type: "EXIT_ALL",
      html: `<div>This pauses auto-trading and sells ${open.length ? `all ${open.length} open auto-trade${open.length > 1 ? "s" : ""}` : "any open auto-trades"} at the live bid.</div>${open.map(p => `<div class="kv"><span>${esc(p.option)}</span><b>${p.qty} qty</b></div>`).join("")}<div class="note">Paper trades. Anything without a live price is retried for about 2 minutes, then reported back to you; it is never closed at a guessed price.</div>`},
    reentry: {title: "Allow re-entry today?", confirm: "Allow", tone: "pri", type: "ALLOW_REENTRY",
      html: `<div>The auto-trader may open new trades today on the index you exited manually.</div>`}
  }[kind];
  openDialog({...cfg, onConfirm: async () => { sendAuto(cfg.type); }});
}

// ============================================================= order sheet
let sheet = null;
function openSheet(inst, side, product, modifyOrder) {
  const i = E.parse(inst), lot = E.lotSize(i, engineData()), q = E.quote(inst, engineData());
  sheet = {inst, side: side || "BUY", product: product || (i.kind === "EQ" ? "CNC" : "NRML"), type: "MARKET",
           qty: i.kind === "EQ" ? 1 : lot, price: q ? q.ltp : "", trigger: "", error: "", confirm: false, modifyId: null, clientId: SC.uid("ord"), busy: false};
  if (modifyOrder) Object.assign(sheet, {side: modifyOrder.side, product: modifyOrder.product, type: modifyOrder.type, qty: modifyOrder.qty,
    price: modifyOrder.price || (q ? q.ltp : ""), trigger: modifyOrder.trigger || "", modifyId: modifyOrder.id});
  if (i.kind === "OPT") ensureChains(true);
  dialogReturn = document.activeElement;
  renderSheet();
  setTimeout(() => { const f = $("#sheetQty"); if (f) f.focus({preventScroll: true}); }, 30);
}
function closeSheet() { sheet = null; $("#sheetRoot").innerHTML = ""; if (dialogReturn && document.contains(dialogReturn)) dialogReturn.focus(); }
function sheetOrder() {
  return {inst: sheet.inst, side: sheet.side, qty: +sheet.qty, product: sheet.product, type: sheet.type, clientId: sheet.clientId,
          price: (sheet.type === "LIMIT" || sheet.type === "SL") ? +sheet.price : null,
          trigger: (sheet.type === "SL" || sheet.type === "SL-M") ? +sheet.trigger : null};
}
function renderSheet() {
  if (!sheet) return;
  const i = E.parse(sheet.inst), d = engineData();
  const lot = E.lotSize(i, d), q = E.quote(sheet.inst, d), o = sheetOrder();
  const need = q || sheet.price ? E.orderMargin(acct, {...o, price: o.price || (q && q.ltp)}, d) : 0;
  const estPx = o.price || E.execPrice(q, sheet.side) || 0;
  const ch = estPx && o.qty ? E.charges(sheet.inst, sheet.side, o.qty, estPx, sheet.product) : null;
  const sm = E.summary(acct, d), isEq = i.kind === "EQ";
  const prods = isEq ? [["CNC", "Delivery"], ["MIS", "Intraday"]] : [["NRML", "Carry forward"], ["MIS", "Intraday"]];
  const open = E.marketOpen(d, new Date());
  const c = q ? {abs: q.ch, pct: q.pc ? q.ch / q.pc * 100 : null} : {};
  const held = isEq ? (acct.holdings[i.u] || {}).qty || 0 : 0;
  const pos = acct.positions[E.posKey(sheet.inst, sheet.product)];
  const typeBtn = (t, label) => `<button class="${sheet.type === t ? "on" : ""}" data-stype="${t}" aria-pressed="${sheet.type === t}">${label}</button>`;
  const html = `<div class="scrim" id="scrim"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle">
    <div class="sheet-h"><div class="row"><div class="grow"><div style="font-weight:800;font-size:16px" id="sheetTitle">${esc(E.label(sheet.inst))} <span class="mode" style="margin-left:4px">PAPER</span></div>
      <div class="num" style="margin-top:2px">${q ? `₹${fmt(q.ltp)} <span class="${cls(c.abs)}">${sgn(c.abs)} (${pct(c.pct)})</span>` : "No live price"}${q && q.bid && q.ask ? ` <span class="muted" style="font-size:12px">bid ${fmt(q.bid)} · ask ${fmt(q.ask)}</span>` : ""}</div></div>
      <button class="icon-btn" id="sheetClose" aria-label="Close order ticket">${svg("close")}</button></div></div>
    <div class="sheet-b">
      ${sheet.modifyId ? `<div class="info">Modifying open order ${esc(sheet.modifyId)}</div>` : `<div class="side-toggle" role="radiogroup" aria-label="Buy or sell"><button class="b ${sheet.side === "BUY" ? "on" : ""}" role="radio" aria-checked="${sheet.side === "BUY"}" data-sside="BUY">Buy</button><button class="s ${sheet.side === "SELL" ? "on" : ""}" role="radio" aria-checked="${sheet.side === "SELL"}" data-sside="SELL">Sell</button></div>`}
      <div class="seg" style="align-self:flex-start" aria-label="Product">${prods.map(([k, l]) => `<button class="${sheet.product === k ? "on" : ""}" data-sprod="${k}" aria-pressed="${sheet.product === k}" ${sheet.modifyId ? "disabled" : ""}>${l}</button>`).join("")}</div>
      <div class="field"><label for="sheetQty">${isEq ? "Quantity (shares)" : `Quantity (lot size ${lot})`}</label>
        <div class="stepper"><button data-step="-1" aria-label="Decrease quantity">−</button><input id="sheetQty" type="number" inputmode="numeric" min="${lot}" step="${lot}" value="${esc(sheet.qty)}"><button data-step="1" aria-label="Increase quantity">+</button></div>
        ${!isEq ? `<span class="hint">${o.qty && o.qty % lot === 0 ? o.qty / lot + " lot" + (o.qty / lot > 1 ? "s" : "") : "Must be a multiple of " + lot}</span>` : held ? `<span class="hint">You hold ${held} shares</span>` : ""}
        ${pos && pos.qty ? `<span class="hint">Open position: ${pos.qty > 0 ? "+" : ""}${pos.qty} @ ₹${fmt(pos.avg)}</span>` : ""}</div>
      <div class="field"><span class="lbl">Order type</span><div class="seg" style="align-self:flex-start">${typeBtn("MARKET", "Market")}${typeBtn("LIMIT", "Limit")}${typeBtn("SL", "Stop-loss")}${typeBtn("SL-M", "SL-Market")}</div></div>
      ${sheet.type === "SL" || sheet.type === "SL-M" ? `<div class="field"><label for="sheetTrig">Trigger price</label><input id="sheetTrig" type="number" step="0.05" inputmode="decimal" value="${esc(sheet.trigger)}" placeholder="${sheet.side === "BUY" ? "Above" : "Below"} ${q ? fmt(q.ltp) : "current price"}"></div>` : ""}
      ${sheet.type === "LIMIT" || sheet.type === "SL" ? `<div class="field"><label for="sheetPx">${sheet.type === "SL" ? "Limit price after trigger" : "Limit price"}</label><input id="sheetPx" type="number" step="0.05" inputmode="decimal" value="${esc(sheet.price)}"></div>` : ""}
      ${sheet.type === "MARKET" ? `<div class="hint">Fills at the live ${q && q.bid && q.ask ? (sheet.side === "BUY" ? "ask" : "bid") : "price"}${open ? "" : " when the market opens"}.</div>` : ""}
      ${!open ? `<div class="info">Market is closed or prices are delayed. This becomes a queued order and runs on the next fresh price.</div>` : ""}
      ${sheet.error ? `<div class="err" role="alert">${esc(sheet.error)}</div>` : ""}
    </div>
    <div class="sheet-f">
      <div class="kv"><span class="muted">${isEq && sheet.product === "CNC" && sheet.side === "BUY" ? "Amount required" : "Margin required"}</span><b>${rs(need)}</b></div>
      <div class="kv"><span class="muted">Approx. charges</span><b title="${ch ? `Brokerage ${ch.brokerage} · STT ${ch.stt} · Exchange ${ch.txn} · Stamp ${ch.stamp} · GST ${ch.gst}` : ""}">${ch ? rs(ch.total) : "—"}</b></div>
      <div class="kv"><span class="muted">Available</span><b>${rs(sm.available)}</b></div>
      ${sheet.confirm ? `<div class="confirm" role="group" aria-label="Confirm order"><div style="font-weight:700">${sheet.modifyId ? "Update order" : sheet.side === "BUY" ? "Buy" : "Sell"} ${o.qty} × ${esc(E.label(sheet.inst))} at ${sheet.type === "MARKET" ? "market" : "₹" + fmt(o.price || o.trigger)}?</div>
        <div class="row"><button class="btn ghost grow" id="sheetBack">Edit</button><button class="btn ${sheet.side === "BUY" ? "buy" : "sell"} grow" id="sheetGo" ${sheet.busy ? "disabled" : ""}>Confirm</button></div></div>`
      : `<button class="btn ${sheet.side === "BUY" ? "buy" : "sell"}" id="sheetPlace" style="padding:13px">${sheet.modifyId ? "Review change" : (sheet.side === "BUY" ? "Buy" : "Sell") + (open ? "" : " (queued)")}</button>`}
    </div></div></div>`;
  const focusId = document.activeElement && document.activeElement.id;
  const pos0 = focusId && document.activeElement.selectionStart;
  $("#sheetRoot").innerHTML = html;
  if (focusId && $("#" + focusId)) { const el = $("#" + focusId); el.focus({preventScroll: true}); try { el.setSelectionRange(pos0, pos0); } catch (e) {} }
}
function submitSheet() {
  if (!sheet || sheet.busy) return;
  sheet.busy = true;
  const o = sheetOrder(), d = engineData();
  if (sheet.modifyId) {
    const r = E.modifyOrder(acct, sheet.modifyId, {qty: o.qty, price: o.price, trigger: o.trigger, type: o.type}, d, new Date());
    if (!r.ok) { sheet.error = r.error; sheet.confirm = false; sheet.busy = false; renderSheet(); return; }
    save(); toast("Order updated", E.label(sheet.inst)); (r.events || []).forEach(toastEvent); closeSheet(); render(); return;
  }
  const r = E.placeOrder(acct, o, d, new Date());
  save();
  if (!r.ok) { sheet.error = r.error; sheet.confirm = false; sheet.busy = false; sheet.clientId = SC.uid("ord"); renderSheet(); return; }
  if (r.order.status !== "COMPLETE") toast(r.order.amo ? "Order queued" : r.order.status === "TRIGGER_PENDING" ? "Stop-loss order placed" : "Order placed",
    `${o.side} ${o.qty} ${E.label(o.inst)} · ${r.order.amo ? "runs at next open" : "waiting to fill"}`);
  (r.events || []).forEach(toastEvent);
  closeSheet(); renderTop(); render();
}

// ================================================================== toasts
function toast(title, body, bad) {
  const t = document.createElement("div"); t.className = "toast" + (bad ? " bad" : ""); t.setAttribute("role", bad ? "alert" : "status");
  t.innerHTML = `<b>${esc(title)}</b>${esc(body || "")}`;
  $("#toasts").appendChild(t); setTimeout(() => t.remove(), bad ? 8000 : 5000);
}
function toastEvent(ev) {
  if (ev.type === "FILL") {
    const o = ev.order;
    const head = o.tag === "SQUAREOFF" ? "Auto square-off" : o.tag === "EXPIRY" ? "Contract expired" : "Order filled";
    toast(head, `${o.side} ${o.qty} ${E.label(o.inst)} @ ₹${fmt(ev.price)}${ev.realized ? ` · P&L ${srs(ev.realized)}` : ""} (paper)`);
  } else if (ev.type === "EXPIRED_ORDER") toast("Order lapsed", `${E.label(ev.order.inst)} wasn't filled today`);
}

// ================================================================== events
document.addEventListener("click", e => {
  const t = e.target.closest("[data-go],[data-back],[data-more],[data-trade],[data-range],[data-eq],[data-exp],[data-star],[data-otab],[data-htab],[data-cancel],[data-modify],[data-exit],[data-exitall],[data-msort],[data-hsort],[data-sside],[data-sprod],[data-stype],[data-step],[data-auto-exit],[data-auto-retry],[data-auto-dismiss],[data-auto-pause],[data-auto-resume],[data-auto-stopall],[data-auto-reentry],#sheetClose,#sheetPlace,#sheetGo,#sheetBack,#scrim,#dlgScrim,#dlgOk,#dlgCancel,#addFunds,#resetAsk,#backupBtn,#fundsPill,#tokenSave,#tokenTest,#tokenDel,#moreScrim");
  if (!t) { if (!e.target.closest(".search")) $("#results").hidden = true; return; }
  const ds = t.dataset;
  if (t.id === "scrim" && e.target === t) return closeSheet();
  if (t.id === "dlgScrim") { if (e.target === t && dialog && !dialog.busy) closeDialog(); return; }
  if (t.id === "moreScrim") { if (e.target === t) { moreOpen = false; renderMore(); } return; }
  if (t.id === "dlgOk") return confirmDialog();
  if (t.id === "dlgCancel") return closeDialog();
  if (t.id === "fundsPill") return go("settings");
  if (ds.htab && t.tagName === "A") { historyTab = ds.htab; return; }
  if (ds.go) { $("#results").hidden = true; $("#q").value = ""; moreOpen = false; renderMore(); return go(ds.go); }
  if (ds.back) { if (history.length > 1) history.back(); else go("market"); return; }
  if (ds.more) { moreOpen = !moreOpen; return renderMore(); }
  if (ds.trade) return openSheet(ds.trade, ds.side, ds.product);
  if (ds.range) { chartRange = ds.range; render(); return ensureIntraday(); }
  if (ds.eq) { eqRange = ds.eq; return render(); }
  if (ds.exp) { fnoExp = ds.exp; return render(); }
  if (ds.star) { const on = !watch.includes(ds.star); watch = on ? watch.concat(ds.star) : watch.filter(x => x !== ds.star); store.set(WATCH_KEY, watch); toast(on ? "Added to watchlist" : "Removed from watchlist", ds.star); return render(); }
  if (ds.otab) { ordersTab = ds.otab; return render(); }
  if (ds.htab) { historyTab = ds.htab; return render(); }
  if (ds.cancel) { if (E.cancelOrder(acct, ds.cancel)) { save(); toast("Order cancelled", ""); } else toast("Can't cancel", "The order is no longer open.", true); renderTop(); return render(); }
  if (ds.modify) { const o = acct.orders.find(x => x.id === ds.modify); if (o && E.ACTIVE(o)) openSheet(o.inst, o.side, o.product, o); else toast("Can't modify", "The order is no longer open.", true); return; }
  if (ds.exit) return askExitOwn(ds.exit);
  if (ds.exitall) return askExitAllOwn();
  if (ds.msort) { marketSort = marketSort.k === ds.msort ? {k: ds.msort, dir: -marketSort.dir} : {k: ds.msort, dir: ds.msort === "s" ? 1 : -1}; return render(); }
  if (ds.hsort) { holdSort = holdSort.k === ds.hsort ? {k: ds.hsort, dir: -holdSort.dir} : {k: ds.hsort, dir: ds.hsort === "s" ? 1 : -1}; return render(); }
  if (ds.autoExit) return askAutoExit(ds.autoExit);
  if (ds.autoRetry) { const p = autoPending.find(x => x.id === ds.autoRetry); if (p) deliver(p); return; }
  if (ds.autoDismiss) { autoPending = autoPending.filter(x => x.id !== ds.autoDismiss); savePending(); return render(); }
  if (ds.autoPause) return askAuto("pause");
  if (ds.autoResume) return askAuto("resume");
  if (ds.autoStopall) return askAuto("stopall");
  if (ds.autoReentry) return askAuto("reentry");
  if (ds.sside) { sheet.side = ds.sside; sheet.error = ""; sheet.confirm = false; return renderSheet(); }
  if (ds.sprod) { sheet.product = ds.sprod; sheet.error = ""; sheet.confirm = false; return renderSheet(); }
  if (ds.stype) { sheet.type = ds.stype; sheet.error = ""; sheet.confirm = false; if (!sheet.price) { const q = E.quote(sheet.inst, engineData()); if (q) sheet.price = q.ltp; } return renderSheet(); }
  if (ds.step) { const lot = E.lotSize(E.parse(sheet.inst), engineData()); sheet.qty = Math.max(lot, (+sheet.qty || 0) + (+ds.step) * lot); sheet.confirm = false; return renderSheet(); }
  if (t.id === "sheetClose") return closeSheet();
  if (t.id === "sheetPlace") { const v = E.validate(acct, sheetOrder(), engineData(), new Date()); if (v) { sheet.error = v; return renderSheet(); } sheet.confirm = true; renderSheet(); const g = $("#sheetGo"); if (g) g.focus(); return; }
  if (t.id === "sheetBack") { sheet.confirm = false; return renderSheet(); }
  if (t.id === "sheetGo") return submitSheet();
  if (t.id === "addFunds") {
    const v = +$("#addAmt").value;
    if (!(v >= 1000 && v <= 1e8)) return toast("Enter an amount", "Between ₹1,000 and ₹10,00,00,000.", true);
    acct.cash = E.money(acct.cash + v); acct.deposits = E.money(acct.deposits + v); save(); toast("Funds added", rs(v) + " virtual money"); renderTop(); return render();
  }
  if (t.id === "resetAsk") return openDialog({title: "Reset paper account?", confirm: "Reset", tone: "sell", focusCancel: true,
    html: `<div>This erases your orders, positions, holdings and history in this browser and starts again with ₹10,00,000. Download a backup first if you want to keep them.</div>`,
    onConfirm: async () => { acct = E.newAccount(1000000); save(); toast("Account reset", "₹10,00,000 virtual money"); renderTop(); render(); }});
  if (t.id === "backupBtn") {
    const blob = new Blob([JSON.stringify({kind: "signal-desk-paper", saved: new Date().toISOString(), acct, watch})], {type: "application/json"});
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `paper-account-${E.ist(new Date()).date}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); return;
  }
  if (t.id === "tokenSave") {
    const v = ($("#tokenIn").value || "").trim();
    if (!v) { tokenCheck = {ok: false, msg: "Paste a token first."}; return render(); }
    if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(v)) { tokenCheck = {ok: false, msg: "That doesn't look like a GitHub token (it should start with github_pat_)."}; return render(); }
    store.set(TOKEN_KEY, v); return testToken();
  }
  if (t.id === "tokenTest") return testToken();
  if (t.id === "tokenDel") { store.del(TOKEN_KEY); tokenCheck = {ok: true, msg: "Token removed from this browser."}; autoSource = ""; return render(); }
});
async function testToken() {
  tokenCheck = {ok: true, msg: "Checking…"}; render();
  try { const r = await CTRL.check(); tokenCheck = {ok: true, msg: `Connected to ${r.repo}. You can now exit auto-trades and pause or resume the auto-trader.`}; loadAuto(true); }
  catch (e) { tokenCheck = {ok: false, msg: e.message}; }
  render();
}
document.addEventListener("change", e => {
  if (e.target.id === "reentryRule") {
    if (!hasToken()) { needToken(); return render(); }
    const v = e.target.value;
    return sendAuto("SET_REENTRY", null, {value: v}, "Updating re-entry rule");
  }
  if (e.target.id !== "restoreFile" || !e.target.files[0]) return;
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const j = JSON.parse(fr.result);
      if (j.kind !== "signal-desk-paper" || !j.acct || !Array.isArray(j.acct.orders) || typeof j.acct.cash !== "number") throw new Error("not a backup");
      acct = j.acct; acct.equity = acct.equity || [];
      if (Array.isArray(j.watch)) { watch = j.watch.filter(x => typeof x === "string"); store.set(WATCH_KEY, watch); }
      save(); toast("Account restored", "Backup from " + String(j.saved || "").slice(0, 10)); renderTop(); render();
    } catch (err) { toast("Couldn't restore", "That file isn't a Signal Desk backup.", true); }
  };
  fr.readAsText(e.target.files[0]);
});
document.addEventListener("input", e => {
  if (!sheet || !e.target.closest || !e.target.closest(".sheet")) return;
  if (e.target.id === "sheetQty") sheet.qty = e.target.value;
  if (e.target.id === "sheetPx") sheet.price = e.target.value;
  if (e.target.id === "sheetTrig") sheet.trigger = e.target.value;
  sheet.error = ""; sheet.confirm = false; renderSheet();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    if (dialog && !dialog.busy) return closeDialog();
    if (sheet) return closeSheet();
    if (moreOpen) { moreOpen = false; return renderMore(); }
  }
  if (e.key === "Enter" && e.target.matches && e.target.matches("tr.click[data-go]")) go(e.target.dataset.go);
  if (e.key === "Tab") {   // keep focus inside an open dialog or sheet
    const box = dialog ? $(".dialog") : sheet ? $(".sheet") : null;
    if (!box) return;
    const f = [...box.querySelectorAll("button:not([disabled]),input:not([disabled]),select,a[href],[tabindex='0']")];
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { f[f.length - 1].focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { f[0].focus(); e.preventDefault(); }
  }
});

// "More" sheet on phones
function renderMore() {
  const root = $("#moreRoot");
  if (!moreOpen) { root.innerHTML = ""; renderNav(); return; }
  const items = NAV.filter(([k]) => !BOTTOM.includes(k));
  root.innerHTML = `<div class="scrim center" id="moreScrim"><div class="dialog" role="dialog" aria-modal="true" aria-label="More pages"><div class="d-h">More</div>
    <div class="d-b" style="padding-bottom:16px">${items.map(([k, l]) => `<button class="nav-btn ${route.name === k ? "on" : ""}" data-go="${k}">${svg(k)}<span>${l}</span>${k === "auto" ? autoBadge() : ""}</button>`).join("")}</div></div></div>`;
  const first = root.querySelector(".nav-btn"); if (first) first.focus();
}

// search
let sel = 0;
function searchResults(v) {
  v = v.trim().toLowerCase(); if (!v) return [];
  const syms = Object.keys(stocks());
  const score = s => { const n = nameOf(s).toLowerCase(), l = s.toLowerCase(); return l === v ? 0 : l.startsWith(v) ? 1 : n.startsWith(v) ? 2 : l.includes(v) ? 3 : n.includes(v) ? 4 : 9; };
  const idx = INDEX_ORDER.filter(k => INDEX_LABEL[k].toLowerCase().includes(v) || k.toLowerCase().includes(v)).map(k => ({k: "index-" + k, a: INDEX_LABEL[k], b: "Index", q: idxQuote(k)}));
  return idx.concat(syms.map(s => [s, score(s)]).filter(x => x[1] < 9).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).slice(0, 12)
    .map(([s]) => ({k: "stock-" + s, a: s, b: nameOf(s), q: stocks()[s]})));
}
function paintResults() {
  const v = $("#q").value, r = searchResults(v), box = $("#results");
  if (!v) { box.hidden = true; return; }
  if (!r.length) { box.innerHTML = `<div class="empty" style="padding:14px">${D.quotes ? "No matches" : "Prices are still loading…"}</div>`; box.hidden = false; return; }
  sel = Math.min(sel, r.length - 1);
  box.innerHTML = r.map((x, i) => { const c = chg(x.q || {}); return `<button data-go="${esc(x.k)}" class="${i === sel ? "sel" : ""}" role="option" aria-selected="${i === sel}"><span><b>${esc(x.a)}</b><br><span class="muted" style="font-size:12px">${esc(x.b)}</span></span><span class="num" style="text-align:right">${x.q ? fmt(x.q.p) : ""}<br><span class="${cls(c.abs)}" style="font-size:12px">${x.q ? pct(c.pct) : ""}</span></span></button>`; }).join("");
  box.hidden = false;
}
$("#q").addEventListener("input", () => { sel = 0; paintResults(); });
$("#q").addEventListener("focus", paintResults);
$("#q").addEventListener("keydown", e => {
  const r = searchResults($("#q").value);
  if (e.key === "ArrowDown") { sel = Math.min(sel + 1, r.length - 1); paintResults(); e.preventDefault(); }
  if (e.key === "ArrowUp") { sel = Math.max(sel - 1, 0); paintResults(); e.preventDefault(); }
  if (e.key === "Enter" && r[sel]) { $("#results").hidden = true; $("#q").value = ""; $("#q").blur(); go(r[sel].k); }
  if (e.key === "Escape") { $("#results").hidden = true; $("#q").blur(); }
});

// ==================================================================== boot
route = parseHash(); if (route.name === "fno" && route.arg) fnoU = route.arg;
renderNav(); render(); renderTop();
// commands that were mid-send when the page was closed are re-sent (safe: idempotent by id)
autoPending.filter(p => p.state === "sending").forEach(p => deliver(p));
(async () => {
  await Promise.all([loadQuotes(), loadSignals(), loadAuto(true)]);
  if (needChains()) ensureChains(true);
  if (route.name === "stock" || route.name === "index") ensureIntraday();
})();
let lastPoll = 0;
setInterval(() => {
  if (document.hidden) return;
  const every = liveWindow() ? 5000 : 30000;
  if (Date.now() - lastPoll >= every) { lastPoll = Date.now(); loadQuotes(); loadSignals(); if (route.name === "stock" || route.name === "index") ensureIntraday(); }
  loadAuto(false);
}, 1000);
setInterval(() => { if (!document.hidden && D.quotes) tick(); }, 15000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { loadQuotes(); loadAuto(true); } });
window.addEventListener("online", () => { loadQuotes(); loadAuto(true); toast("Back online", "Refreshing prices"); });
window.addEventListener("offline", () => toast("You're offline", "Prices will refresh when you reconnect.", true));
