'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  BUSINESS MODE — the deterministic market simulation (one business year).
//  No randomness: the same company files + strategies always give the same year.
//
//  Each day:  morning (deliveries, construction, staff)  →  both strategies decide
//  (same snapshot, simultaneous)  →  decisions applied  →  auto-restocking  →  the
//  market (logit choice per district × product)  →  evening books (wages, rent,
//  marketing, R&D, interest, spoilage), awareness, reputation, quality  →  frame.
// ─────────────────────────────────────────────────────────────────────────────
const R = require('./rules');
const {
  DAYS, DAY_SEC, DISTRICTS, ADJ, CATEGORIES, CATEGORY_IDS, TIERS, TIER_ORDER, CHANNELS, CHANNEL_IDS,
  MODEL, MONEY, REP, RND, MOONSHOTS, MOONSHOT_IDS,
} = R;

const r2 = (v) => Math.round(v * 100) / 100;
const r0 = (v) => Math.round(v);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
const money = (v) => `$${R.fmtShort(v)}`;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

// ── setup ────────────────────────────────────────────────────────────────────
function defaultStockDays(c) { const s = CATEGORIES[c].spoil; return s >= 0.2 ? 1.15 : s >= 0.05 ? 1.6 : 4; }

function makeCompany(side, spec, level) {
  const cats = R.unlockedCategories(level);
  const co = {
    side, spec, name: spec.name, level,
    cash: R.START_CASH[level], loan: 0, emergency: 0,
    lines: cats.filter(c => spec.lines.includes(c)),
    prices: {}, dprices: {}, stockDays: {}, inventory: {}, invCost: {}, incoming: [],
    ratio: {}, vol: {}, quality: {}, rnd: {}, rndCum: {}, marketing: {}, aw: {}, rep: REP.start,
    staffing: 1, stores: [], lastAcquire: -99, ipoShare: 0, ipoDay: null, ipoCash: 0,
    moon: {}, moonDone: [], stockout: {}, bankrupt: false, bankruptDay: null, burnedOut: false,
    notes: [], noteLog: [], y: null, hist: [], lastPriceNews: {}, launchedDay: {},
    totals: { revenue: 0, cogs: 0, shipping: 0, wages: 0, rent: 0, marketing: 0, rnd: 0, interest: 0, spoilage: 0, overhead: 0, royalties: 0, tourism: 0, hiring: 0, launch: 0, build: 0, refund: 0, acqPaid: 0, acqGot: 0, moonshot: 0, moonRefund: 0, ipo: 0, customers: 0, lostStock: 0, lostCap: 0, spillIn: 0, orders: 0 },
    byCat: {}, byDist: {}, events: { opened: 0, closed: 0, upgraded: 0, franchised: 0, acquired: 0, lostToAcq: 0, launches: 0, priceMoves: 0 },
    maxStaff: 0, peakStores: 0,
  };
  for (const c of CATEGORY_IDS) {
    const C = CATEGORIES[c];
    const p = spec.prices[c];
    co.prices[c] = clamp(num(p) || C.ref, C.ref * MODEL.minPrice, C.ref * MODEL.maxPrice);
    co.stockDays[c] = num(spec.stockDays[c]) !== null ? clamp(spec.stockDays[c], 0, 30) : defaultStockDays(c);
    co.inventory[c] = 0; co.invCost[c] = C.cost; co.ratio[c] = 0.3; co.quality[c] = 1; co.rnd[c] = 0; co.rndCum[c] = 0;
    co.byCat[c] = { units: 0, revenue: 0, cogs: 0, lostStock: 0, lostCap: 0 };
  }
  if (R.has(level, 'rnd')) for (const c of cats) co.rnd[c] = clamp(num(spec.rnd[c]) || 0, 0, 1e7);
  for (const ch of R.unlockedChannels(level)) co.marketing[ch] = clamp(num(spec.marketing[ch]) || 0, 0, 1e7);
  for (const d of R.DISTRICT_IDS) {
    co.aw[d] = R.DISTRICTS[d].level <= level ? (d === spec.hq ? 0.3 : 0.15) : 0;
    co.byDist[d] = { customers: 0, revenue: 0, rivalCustomers: 0 };
  }
  return co;
}

// ── the year ─────────────────────────────────────────────────────────────────
/**
 * @param {object} o { specs:[a,b], strategies:[a,b] (sandboxed or null), level, round, labels, ids, days? }
 */
function simulateYear(o) {
  const level = R.clampLevel(o.level);
  const round = o.round || level;
  const days = o.days || DAYS;
  const labels = o.labels || ['A', 'B'];
  const cal = R.calendarFor(level);
  const dists = R.unlockedDistricts(level);
  const cats = R.unlockedCategories(level);
  const chans = R.unlockedChannels(level);
  const cos = [makeCompany(0, o.specs[0], level), makeCompany(1, o.specs[1], level)];
  const strategies = o.strategies || [null, null];
  const stores = [];          // every store ever (both sides)
  const events = [];
  const frames = [];
  let nextId = 1;
  let endDay = days;
  const overdraft = R.overdraftOf(level);
  const rulesView = rulesFor(level);
  const brainErrorsByDay = [[], []];

  const T = (day, frac = 0.5) => r2((day - 1 + frac) * DAY_SEC);
  function news(day, k, side, big, text, frac) { events.push({ t: T(day, frac === undefined ? 0.35 : frac), day, k, side, big: !!big, text }); }

  // ── stores ──
  function storeValue(st) { return st.franchise ? 0 : R.RESALE * st.invested; }
  function freeSlot(district, side) {
    const used = new Set(stores.filter(s => s.district === district && s.status !== 'closed').map(s => s.slot));
    const order = side === 0 ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
    for (const k of order) if (!used.has(k)) return k;
    return side === 0 ? 0 : 7;
  }
  function addStore(co, district, tier, day, { franchise = false, free = false } = {}) {
    const t = TIERS[tier];
    const cost = franchise || free ? 0 : R.buildCost(tier, district);
    const st = {
      id: nextId++, side: co.side, district, tier, franchise, status: free ? 'open' : 'building',
      startDay: day, readyDay: free ? day : day + t.days, closedDay: null, invested: free ? R.buildCost(tier, district) : cost,
      staff: 0, staffOverride: null, need: 0, cust: 0, rev: 0, custTotal: 0, revTotal: 0, profitTotal: 0,
      upgradeTo: null, upgradeReady: null, slot: district ? freeSlot(district, co.side) : co.side,
      tiers: [[day, tier]], owners: [[day, co.side]], free,
    };
    stores.push(st);
    co.stores.push(st);
    return st;
  }
  const openStores = (co) => co.stores.filter(s => s.status === 'open');
  const liveStores = (co) => co.stores.filter(s => s.status !== 'closed');
  function capacityOf(st, mods) {
    const t = TIERS[st.tier];
    let cap = Math.min(t.cap, Math.max(0, st.staff) * t.perStaff);
    if (st.franchise) cap = t.cap * MONEY.franchiseCap;
    if (st.tier === 'online') cap *= mods.onlineCap;
    return cap;
  }

  // ── money ──
  function creditLimit(co) {
    if (!R.has(level, 'loans')) return 0;
    let assets = 0;
    for (const st of liveStores(co)) assets += storeValue(st);
    for (const c of CATEGORY_IDS) assets += co.inventory[c] * co.invCost[c];
    return Math.round(MONEY.creditBase[level] + MONEY.creditAssets * assets);
  }
  function debtOf(co) { return co.loan + co.emergency; }
  function netWorth(co) {
    let v = co.cash - debtOf(co);
    for (const st of liveStores(co)) v += storeValue(st);
    for (const c of CATEGORY_IDS) v += co.inventory[c] * co.invCost[c];
    for (const m of co.moonDone) v += MOONSHOTS[m].cost * R.MOONSHOT_VALUE;
    return v * (1 - co.ipoShare);
  }
  /** Spend discretionary money: never more than cash (+ overdraft room); returns what was spent. */
  function affordable(co, want) {
    return Math.max(0, Math.min(want, co.cash));
  }
  function has(co, m) { return co.moonDone.includes(m); }
  function unitCost(co, c, mods) {
    let k = (mods.cost[c] || 1) * (mods.cost.all || 1) * (1 - R.bulkDiscount(co.vol[c] || 0));
    if (has(co, 'fusion')) k *= 0.8;
    if (has(co, 'labfood') && (c === 'food' || c === 'burgers')) k *= 0.6;
    return CATEGORIES[c].cost * k;
  }
  function qualityOf(co, c, tierQ) {
    let q = co.quality[c] * (1 + (tierQ || 0));
    if (has(co, 'quantum') && (c === 'gadgets' || c === 'games' || c === 'ai')) q *= 1.35;
    if (has(co, 'labfood') && (c === 'food' || c === 'burgers')) q *= 1.2;
    return q;
  }
  function priceOf(co, c, d) {
    const dp = d && co.dprices[d];
    return dp && dp[c] ? dp[c] : co.prices[c];
  }
  function sells(st, c) {
    const C = CATEGORIES[c];
    if (st.tier === 'online') return !!C.online;
    if (C.onlineOnly) return false;
    if (st.tier === 'cart') return !!C.cart;
    return true;
  }
  function distOpen(co, d) {
    const D = DISTRICTS[d];
    if (!D || D.level > level) return false;
    if (D.needs && !has(co, D.needs)) return false;
    return true;
  }

  // ── routes: how company co reaches customers of (d, c) ──
  function routesFor(co, mods) {
    const open = openStores(co);
    const byD = {};
    let online = null;
    for (const st of open) {
      if (st.tier === 'online') { online = st; continue; }
      (byD[st.district] || (byD[st.district] = [])).push(st);
    }
    const searchSpend = co.marketing.search || 0;
    const searchBonus = CHANNELS.search.online * (1 - Math.exp(-searchSpend / CHANNELS.search.scale)) * (CHANNELS.search.level <= level ? 1 : 0);
    const routes = {};
    for (const d of dists) {
      if (!distOpen(co, d) && !(byD[d] && byD[d].length)) continue;
      const D = DISTRICTS[d];
      routes[d] = {};
      for (const c of co.lines) {
        let best = null;
        const local = (byD[d] || []).filter(s => sells(s, c));
        if (local.length) {
          let pres = -9, tq = 0;
          for (const s of local) { const t = TIERS[s.tier]; if (t.presence > pres) { pres = t.presence; tq = t.quality; } }
          pres += MODEL.multiStore * Math.log(local.length) + Math.log(mods.walk);
          best = { pool: `d:${d}`, presence: pres, tq, kind: 'local' };
        }
        if (!D.overseas) {
          for (const n of ADJ[d] || []) {
            const ns = (byD[n] || []).filter(s => sells(s, c));
            if (!ns.length) continue;
            let pres = -9, tq = 0, mega = false;
            for (const s of ns) { const t = TIERS[s.tier]; if (t.presence > pres) { pres = t.presence; tq = t.quality; } if (s.tier === 'megastore') mega = true; }
            pres = pres - (mega ? R.MEGASTORE_REACH_PENALTY : R.TRAVEL_PENALTY) + Math.log(mods.walk);
            if (!best || pres > best.presence) best = { pool: `d:${n}`, presence: pres, tq, kind: 'near', via: n };
          }
        }
        if (online && CATEGORIES[c].online) {
          let pres = TIERS.online.presence + D.online + mods.online + searchBonus + (CATEGORIES[c].onlineBonus || 0);
          if (has(co, 'robots')) pres += 0.8;
          if (!best || pres > best.presence) best = { pool: 'online', presence: pres, tq: 0, kind: 'online' };
        }
        if (best) routes[d][c] = best;
      }
    }
    const pools = { online: online ? [online] : [] };
    for (const [d, arr] of Object.entries(byD)) pools[`d:${d}`] = arr;
    return { routes, pools };
  }

  // ── state for decide() ──
  function publicStore(st) {
    return { id: st.id, district: st.district, tier: st.tier, status: st.status, franchise: st.franchise, opensOnDay: st.status === 'building' ? st.readyDay : undefined, upgradingTo: st.upgradeTo || undefined };
  }
  function buildState(co, rv, day, mods, mk) {
    const me = {
      name: co.name, side: co.side, cash: r0(co.cash), debt: r0(debtOf(co)), loan: r0(co.loan), emergencyDebt: r0(co.emergency),
      creditLimit: creditLimit(co), netWorth: r0(netWorth(co)), reputation: r2(co.rep),
      awareness: {}, lines: co.lines.slice(), prices: {}, districtPrices: JSON.parse(JSON.stringify(co.dprices)),
      stockDays: {}, inventory: {}, incoming: {}, forecast: {}, unitCost: {}, bulkDiscount: {}, dailyVolume: {}, quality: {}, rnd: {}, marketing: { ...co.marketing }, staffing: co.staffing,
      stores: co.stores.filter(s => s.status !== 'closed').map(st => {
        const t = TIERS[st.tier];
        return {
          id: st.id, district: st.district, tier: st.tier, status: st.status, franchise: st.franchise, opensOnDay: st.status === 'building' ? st.readyDay : undefined,
          upgradingTo: st.upgradeTo || undefined, upgradeDoneDay: st.upgradeTo ? st.upgradeReady : undefined,
          staff: st.staff, staffMax: t.staffMax, staffOverride: st.staffOverride, capacity: r0(st.status === 'open' ? capacityOf(st, mods) : 0), maxCapacity: t.cap,
          demandYesterday: r0(st.lastNeed || 0), customersYesterday: r0(st.cust), revenueYesterday: r0(st.rev), value: r0(storeValue(st)),
          rent: r2(R.rentOf(st.tier, st.district)), wage: R.wageOf(st.district),
        };
      }),
      yesterday: co.y, ipoShare: co.ipoShare, moonshots: {}, moonshotsDone: co.moonDone.slice(), notes: co.notes.slice(0, 12),
      franchises: co.stores.filter(s => s.franchise && s.status !== 'closed').length, lastAcquisitionDay: co.lastAcquire > 0 ? co.lastAcquire : null,
      history: co.hist.slice(-14),
    };
    for (const d of dists) me.awareness[d] = r2(co.aw[d]);
    for (const c of cats) {
      me.prices[c] = r2(co.prices[c]); me.stockDays[c] = co.stockDays[c]; me.inventory[c] = r0(co.inventory[c]);
      me.incoming[c] = r0(co.incoming.filter(x => x.c === c).reduce((a, x) => a + x.units, 0));
      me.forecast[c] = r0(forecast(co, c, day));
      me.unitCost[c] = r2(unitCost(co, c, mods)); me.quality[c] = r2(qualityOf(co, c, 0)); me.rnd[c] = co.rnd[c];
      me.bulkDiscount[c] = r2(R.bulkDiscount(co.vol[c] || 0)); me.dailyVolume[c] = r0(co.vol[c] || 0);
    }
    for (const [id, m] of Object.entries(co.moon)) me.moonshots[id] = { funded: r0(m.funded), perDay: m.perDay, cost: MOONSHOTS[id].cost, done: m.done, lost: m.lost };
    const rival = {
      name: rv.name, cash: r0(rv.cash), netWorth: r0(netWorth(rv)), debt: r0(debtOf(rv)), reputation: r2(rv.rep), lines: rv.lines.slice(), prices: {}, districtPrices: JSON.parse(JSON.stringify(rv.dprices)),
      stores: rv.stores.filter(s => s.status !== 'closed').map(publicStore), marketing: { ...rv.marketing }, awareness: {}, quality: {},
      ipoShare: rv.ipoShare, moonshots: Object.fromEntries(Object.entries(rv.moon).map(([id, m]) => [id, { funded: r0(m.funded), done: m.done }])), moonshotsDone: rv.moonDone.slice(),
      bankrupt: rv.bankrupt, yesterday: rv.y ? { revenue: rv.y.revenue, customers: rv.y.customers } : null,
    };
    for (const d of dists) rival.awareness[d] = r2(rv.aw[d]);
    for (const c of cats) { rival.prices[c] = r2(rv.prices[c]); rival.quality[c] = r2(qualityOf(rv, c, 0)); }
    const tomorrowMods = R.eventMods(level, Math.min(days, day + 1));
    const districts = {};
    for (const d of dists) {
      const D = DISTRICTS[d];
      const potToday = {}, potTomorrow = {};
      for (const c of cats) { potToday[c] = r0(R.potential(level, d, c, day, mods)); potTomorrow[c] = r0(R.potential(level, d, c, Math.min(days, day + 1), tomorrowMods)); }
      const last = mk.lastDist[d] || null;
      districts[d] = {
        name: D.name, pop: D.pop, elasticity: D.elas, rent: D.rent, wage: D.wage, youth: D.youth, online: D.online, overseas: !!D.overseas, needs: D.needs || null,
        adjacent: ADJ[d] || [], open: distOpen(co, d), potential: potToday, potentialTomorrow: potTomorrow,
        yesterday: last ? { me: r0(last[co.side]), rival: r0(last[1 - co.side]), total: r0(last[2]) } : null,
        share: last ? shareOf(last, co.side) : null,
        catShare: mk.lastCat[d] ? Object.fromEntries(Object.entries(mk.lastCat[d]).map(([c, v]) => [c, { me: r0(v[co.side]), rival: r0(v[1 - co.side]), total: r0(v[2]) }])) : null,
      };
    }
    return {
      day, days, daysLeft: days - day + 1, season: R.SEASONS[R.seasonIndex(day)], weekday: R.WEEKDAYS[R.weekdayOf(day)], weekend: R.isWeekend(day),
      level, round, today: mods.active.map(e => ({ type: e.type, name: e.name, from: e.from, to: e.to, text: e.text })),
      calendar: cal.map(e => ({ type: e.type, name: e.name, from: e.from, to: e.to, text: e.text, mods: e.mods })),
      rules: rulesView, market: { districts }, me, rival,
    };
  }
  function shareOf(last, side) { const tot = last[0] + last[1]; return tot > 0 ? r2(last[side] / tot) : 0; }

  // ── forecasting (used by the auto-restocker and shown to strategies) ──
  function servedPotential(co, c, day, mods) {
    let pot = 0;
    const rt = co._routes || {};
    for (const d of dists) if (rt[d] && rt[d][c]) pot += R.potential(level, d, c, day, mods);
    return pot;
  }
  function forecast(co, c, day) {
    if (!co.lines.includes(c)) return 0;
    return forecastOn(co, c, day + 1);
  }
  /** Expected sales are capped by what your stores (at full staff) can serve. */
  function capFactor(co, day, m) {
    let cap = 0, load = 0;
    for (const st of co.stores) {
      if (st.franchise) continue;
      const t = TIERS[st.tier];
      if (st.status === 'open') cap += Math.min(t.cap, (st.staff + Math.max(2, t.staffMax / 4)) * t.perStaff);
      else if (st.status === 'building' && st.readyDay <= day) cap += t.cap * 0.6;
    }
    for (const c of co.lines) load += servedPotential(co, c, day, m) * co.ratio[c] * CATEGORIES[c].serve;
    return load > cap && load > 0 ? cap / load : 1;
  }

  // ── decisions ──
  function note(co, text) {
    if (co.notes.length < 12) co.notes.push(text);
    if (co.noteLog.length < 12 && !co.noteLog.some(n => n.text === text)) co.noteLog.push({ day: co._day || 0, text });
  }
  function applyDecision(co, rv, dec, day, mods) {
    if (!isObj(dec)) return;
    const unl = new Set(cats);
    // prices
    if (isObj(dec.prices)) {
      for (const [c, v] of Object.entries(dec.prices)) {
        if (!unl.has(c)) { note(co, `prices.${c}: unknown or locked product`); continue; }
        const p = num(v); if (p === null) continue;
        const C = CATEGORIES[c];
        const np = clamp(p, C.ref * MODEL.minPrice, C.ref * MODEL.maxPrice);
        if (np !== p) note(co, `prices.${c}: ${p} clamped to ${r2(np)} (allowed ${r2(C.ref * MODEL.minPrice)}-${r2(C.ref * MODEL.maxPrice)})`);
        const old = co.prices[c];
        co.prices[c] = r2(np);
        const ch = (np - old) / old;
        if (Math.abs(ch) >= 0.1 && co.lines.includes(c) && day > 1 && (co.lastPriceNews[c] || -99) <= day - 5) {
          co.lastPriceNews[c] = day; co.events.priceMoves++;
          news(day, 'price', co.side, Math.abs(ch) >= 0.25, `${co.name} ${ch < 0 ? 'slashes' : 'raises'} ${C.name} prices ${Math.round(Math.abs(ch) * 100)}% (${fmtPrice(np)})`);
        }
      }
    }
    if (dec.districtPrices !== undefined) {
      if (!R.has(level, 'districtPrices')) note(co, 'districtPrices unlock at level 4');
      else if (isObj(dec.districtPrices)) {
        for (const [d, m] of Object.entries(dec.districtPrices)) {
          if (!dists.includes(d)) { note(co, `districtPrices.${d}: unknown or locked district`); continue; }
          if (m === null) { delete co.dprices[d]; continue; }
          if (!isObj(m)) continue;
          const cur = co.dprices[d] || (co.dprices[d] = {});
          for (const [c, v] of Object.entries(m)) {
            if (!unl.has(c)) continue;
            if (v === null) { delete cur[c]; continue; }
            const p = num(v); if (p === null) continue;
            const C = CATEGORIES[c];
            cur[c] = r2(clamp(p, C.ref * MODEL.minPrice, C.ref * MODEL.maxPrice));
          }
          if (!Object.keys(cur).length) delete co.dprices[d];
        }
      }
    }
    if (isObj(dec.stockDays)) for (const [c, v] of Object.entries(dec.stockDays)) { const n = num(v); if (unl.has(c) && n !== null) co.stockDays[c] = clamp(n, 0, 30); }
    if (dec.staffing !== undefined) { const n = num(dec.staffing); if (n !== null) co.staffing = clamp(n, 0.3, 2.5); }
    if (isObj(dec.marketing)) {
      for (const [ch, v] of Object.entries(dec.marketing)) {
        if (!chans.includes(ch)) { note(co, `marketing.${ch}: unknown or locked channel (open: ${chans.join(', ')})`); continue; }
        const n = num(v); if (n === null) continue;
        const old = co.marketing[ch] || 0;
        co.marketing[ch] = r2(clamp(n, 0, 1e7));
        if (co.marketing[ch] >= Math.max(old * 1.8, 300 * Math.pow(2.2, level - 1) / 10) && co.marketing[ch] - old > 20 && day > 1 && (co._lastMkNews || -99) <= day - 8) {
          co._lastMkNews = day;
          news(day, 'marketing', co.side, co.marketing[ch] >= R.START_CASH[level] * 0.01, `${co.name} launches a ${CHANNELS[ch].name} blitz (${money(co.marketing[ch])}/day)`);
        }
      }
    }
    if (isObj(dec.rnd)) {
      if (!R.has(level, 'rnd')) note(co, 'rnd unlocks at level 3');
      else for (const [c, v] of Object.entries(dec.rnd)) { const n = num(v); if (unl.has(c) && n !== null) co.rnd[c] = r2(clamp(n, 0, 1e7)); }
    }
    if (isObj(dec.staff)) {
      for (const [id, v] of Object.entries(dec.staff)) {
        const st = co.stores.find(s => String(s.id) === String(id) && s.status !== 'closed' && !s.franchise);
        if (!st) { note(co, `staff.${id}: no such store of yours`); continue; }
        if (v === null) { st.staffOverride = null; continue; }
        const n = num(v); if (n === null) continue;
        st.staffOverride = clamp(Math.round(n), 1, TIERS[st.tier].staffMax);
      }
    }
    // product lines
    for (const c of list(dec.launch)) {
      if (!unl.has(c)) { note(co, `launch ${c}: unknown or locked product`); continue; }
      if (co.lines.includes(c)) continue;
      const cost = CATEGORIES[c].launch;
      if (co.cash < cost) { note(co, `launch ${c}: not enough cash (need ${money(cost)})`); continue; }
      co.cash -= cost; co.totals.launch += cost; co.lines.push(c); co.lines.sort((a, b) => CATEGORY_IDS.indexOf(a) - CATEGORY_IDS.indexOf(b));
      co.ratio[c] = 0.25; co.launchedDay[c] = day; co.events.launches++;
      news(day, 'launch', co.side, CATEGORIES[c].launch >= 20000, `${co.name} launches ${CATEGORIES[c].name}!`);
    }
    for (const c of list(dec.drop)) {
      if (!co.lines.includes(c)) continue;
      co.lines = co.lines.filter(x => x !== c);
      news(day, 'close', co.side, false, `${co.name} discontinues ${CATEGORIES[c].name}`);
    }
    // extra stock orders
    if (isObj(dec.order)) {
      for (const [c, v] of Object.entries(dec.order)) {
        const n = num(v);
        if (!unl.has(c) || n === null || n <= 0) continue;
        orderStock(co, c, Math.min(n, 1e7), day, mods, 'manual');
      }
    }
    // loans
    if (dec.repay !== undefined) {
      const n = num(dec.repay);
      if (n !== null && n > 0) {
        let pay = Math.min(n, Math.max(0, co.cash), debtOf(co));
        const e = Math.min(pay, co.emergency); co.emergency -= e; pay -= e;
        co.loan -= Math.min(pay, co.loan); co.cash -= e + pay;
        co.loan = Math.max(0, co.loan);
      }
    }
    if (dec.borrow !== undefined) {
      const n = num(dec.borrow);
      if (!R.has(level, 'loans')) note(co, 'borrow: loans unlock at level 3');
      else if (n !== null && n > 0) {
        const room = Math.max(0, creditLimit(co) - debtOf(co));
        const amt = Math.floor(Math.min(n, room));
        if (amt < n) note(co, `borrow: only ${money(amt)} of credit left (limit ${money(creditLimit(co))})`);
        if (amt > 0) {
          co.loan += amt; co.cash += amt;
          if (amt >= R.START_CASH[level] * 0.2) news(day, 'cash', co.side, amt >= R.START_CASH[level], `${co.name} takes a ${money(amt)} bank loan`);
        }
      }
    }
    // closing
    for (const idv of list(dec.close)) {
      const st = co.stores.find(s => String(s.id) === String(idv) && s.status !== 'closed');
      if (!st) { note(co, `close ${idv}: no such store of yours`); continue; }
      closeStore(co, st, day, 'closes');
    }
    // upgrades
    for (const u of list(dec.upgrade)) {
      const idv = isObj(u) ? u.id : u;
      const st = co.stores.find(s => String(s.id) === String(idv) && s.status === 'open' && !s.franchise);
      if (!st) { note(co, `upgrade ${idv}: no open store of yours with that id`); continue; }
      if (st.upgradeTo) continue;
      const k = TIER_ORDER.indexOf(st.tier);
      const to = isObj(u) && u.tier ? u.tier : TIER_ORDER[k + 1];
      if (!to || !TIERS[to] || TIER_ORDER.indexOf(to) <= k || TIERS[to].level > level) { note(co, `upgrade ${idv}: cannot upgrade a ${st.tier} to ${to || '?'} at this level`); continue; }
      const cost = R.buildCost(to, st.district) - R.buildCost(st.tier, st.district);
      if (co.cash < cost) { note(co, `upgrade ${idv}: not enough cash (need ${money(cost)})`); continue; }
      co.cash -= cost; co.totals.build += cost; st.invested += cost;
      st.upgradeTo = to; st.upgradeReady = day + TIERS[to].days; co.events.upgraded++;
      news(day, 'bell', co.side, false, `${co.name} starts turning its ${DISTRICTS[st.district].name} ${TIERS[st.tier].name.toLowerCase()} into a ${TIERS[to].name.toLowerCase()}`);
    }
    // opening
    const opens = list(dec.open).slice(0, 4);
    for (const op of opens) {
      if (!isObj(op)) continue;
      const tier = String(op.tier || 'shop');
      const T0 = TIERS[tier];
      if (!T0 || T0.level > level) { note(co, `open: store type "${tier}" is not available (open: ${R.unlockedTiers(level).join(', ')})`); continue; }
      let d = tier === 'online' ? null : String(op.district || '');
      if (tier === 'online') {
        if (co.stores.some(s => s.tier === 'online' && s.status !== 'closed')) { note(co, 'open online: you already have an online store'); continue; }
      } else {
        if (!dists.includes(d)) { note(co, `open: unknown or locked district "${d}"`); continue; }
        if (!distOpen(co, d)) { note(co, `open: ${DISTRICTS[d].name} needs the ${MOONSHOTS[DISTRICTS[d].needs].name} moonshot`); continue; }
        if (liveStores(co).filter(s => s.district === d).length >= R.MAX_STORES_PER_DISTRICT) { note(co, `open: already ${R.MAX_STORES_PER_DISTRICT} stores in ${DISTRICTS[d].name}`); continue; }
      }
      const cost = R.buildCost(tier, d);
      if (co.cash < cost) { note(co, `open ${tier} in ${d || 'online'}: not enough cash (need ${money(cost)}, have ${money(co.cash)})`); continue; }
      co.cash -= cost; co.totals.build += cost;
      const st = addStore(co, d, tier, day);
      co.events.opened++;
      const where = d ? DISTRICTS[d].name : 'the web';
      news(day, 'bell', co.side, TIERS[tier].rank >= 3, `${co.name} breaks ground on a ${TIERS[tier].name.toLowerCase()} ${d ? 'in' : 'on'} ${where}`, 0.3);
      void st;
    }
    // franchising
    for (const fr of list(dec.franchise).slice(0, 2)) {
      if (!R.has(level, 'franchise')) { note(co, 'franchise unlocks at level 7'); break; }
      if (!isObj(fr)) continue;
      const tier = String(fr.tier || 'shop'), d = String(fr.district || '');
      if (!TIERS[tier] || TIERS[tier].level > level || tier === 'online' || tier === 'megastore') { note(co, `franchise: tier ${tier} not allowed (cart, shop or flagship)`); continue; }
      if (!dists.includes(d) || !distOpen(co, d)) { note(co, `franchise: unknown or locked district "${d}"`); continue; }
      const nFr = liveStores(co).filter(s => s.franchise).length;
      if (nFr >= R.FRANCHISE_MAX(level)) { note(co, `franchise: at most ${R.FRANCHISE_MAX(level)} franchise stores at this level`); continue; }
      if (liveStores(co).filter(s => s.district === d).length >= R.MAX_STORES_PER_DISTRICT) { note(co, `franchise: already ${R.MAX_STORES_PER_DISTRICT} stores in ${DISTRICTS[d].name}`); continue; }
      addStore(co, d, tier, day, { franchise: true });
      co.events.franchised++;
      news(day, 'bell', co.side, false, `A partner opens a ${co.name} franchise ${TIERS[tier].name.toLowerCase()} in ${DISTRICTS[d].name}`, 0.3);
    }
    // acquisitions
    if (dec.acquire !== undefined && dec.acquire !== null) {
      const idv = dec.acquire;
      const st = rv.stores.find(s => String(s.id) === String(idv) && s.status === 'open');
      const cool = R.ACQUIRE_COOLDOWN(level);
      if (!R.has(level, 'acquire')) note(co, 'acquire unlocks at level 8');
      else if (!st) note(co, `acquire ${idv}: no open rival store with that id`);
      else if (st.franchise || st.tier === 'online') note(co, 'acquire: franchise and online stores cannot be bought');
      else if (level < 11 && TIERS[st.tier].rank >= 4) note(co, 'acquire: megastores can only be bought from level 11');
      else if (day - co.lastAcquire < cool) note(co, `acquire: one acquisition every ${cool} days (next on day ${co.lastAcquire + cool})`);
      else if (openStores(rv).filter(s => !s.franchise).length <= 1) note(co, 'acquire: the rival\'s last store cannot be bought');
      else if (liveStores(co).filter(s => s.district === st.district).length >= R.MAX_STORES_PER_DISTRICT) note(co, `acquire: you already have ${R.MAX_STORES_PER_DISTRICT} stores there`);
      else {
        const price = Math.round(MONEY.acquirePremium * R.buildCost(st.tier, st.district));
        if (co.cash < price) note(co, `acquire ${idv}: not enough cash (need ${money(price)})`);
        else {
          co.cash -= price; rv.cash += price; co.totals.acqPaid += price; rv.totals.acqGot += price;
          rv.stores = rv.stores.filter(s => s !== st); co.stores.push(st);
          st.side = co.side; st.owners.push([day, co.side]); st.staffOverride = null; st.upgradeTo = null;
          st.invested = R.buildCost(st.tier, st.district);
          co.lastAcquire = day; co.events.acquired++; rv.events.lostToAcq++;
          news(day, 'cash', co.side, true, `${co.name} BUYS ${rv.name}'s ${DISTRICTS[st.district].name} ${TIERS[st.tier].name.toLowerCase()} for ${money(price)}!`);
        }
      }
    }
    // IPO
    if (dec.ipo !== undefined && dec.ipo !== null && dec.ipo !== false) {
      const share = clamp(num(dec.ipo) || 0, 0, MONEY.ipoMaxShare);
      if (!R.has(level, 'ipo')) note(co, 'ipo unlocks at level 9');
      else if (co.ipoShare > 0) note(co, 'ipo: you are already public');
      else if (day < 10) note(co, 'ipo: possible from day 10');
      else if (share >= 0.05) {
        const val = ipoValuation(co, mods);
        const cash = Math.round(share * val);
        co.cash += cash; co.ipoShare = share; co.ipoDay = day; co.ipoCash = cash; co.totals.ipo += cash;
        news(day, 'cash', co.side, true, `${co.name} goes public! Sells ${Math.round(share * 100)}% at a ${money(val)} valuation (+${money(cash)})`);
      }
    }
    // moonshots
    if (dec.moonshot !== undefined) {
      if (!R.has(level, 'moonshots')) note(co, 'moonshots unlock at level 10');
      else if (dec.moonshot === null) { for (const m of Object.values(co.moon)) m.perDay = 0; }
      else if (isObj(dec.moonshot)) {
        for (const [id, v] of Object.entries(dec.moonshot)) {
          if (!MOONSHOTS[id]) { note(co, `moonshot ${id}: unknown (${MOONSHOT_IDS.join(', ')})`); continue; }
          const m = co.moon[id] || null;
          if (m && (m.done || m.lost)) continue;
          const rate = clamp(num(v) || 0, 0, MOONSHOTS[id].cost / R.MOONSHOT_MIN_DAYS);
          const active = Object.entries(co.moon).filter(([k, x]) => k !== id && x.perDay > 0 && !x.done && !x.lost).length;
          if (rate > 0 && active >= R.MOONSHOT_SLOTS(level)) { note(co, `moonshot ${id}: only ${R.MOONSHOT_SLOTS(level)} project(s) can be funded at a time`); continue; }
          if (!m) {
            if (rate <= 0) continue;
            co.moon[id] = { funded: 0, perDay: rate, done: false, lost: false, startDay: day };
            news(day, 'launch', co.side, true, `${co.name} starts the ${MOONSHOTS[id].name} moonshot!`);
          } else m.perDay = rate;
        }
      }
    }
  }

  function fmtPrice(p) { return p >= 100 ? `$${Math.round(p)}` : `$${p.toFixed(2)}`; }

  function ipoValuation(co, mods) {
    const recent = co.hist.slice(-20);
    const avg = recent.length ? recent.reduce((a, h) => a + h.profit, 0) / recent.length : 0;
    const equity = netWorth(co) / (1 - co.ipoShare);
    return Math.max(equity * 0.5, equity + MONEY.ipoProfitDays * avg * mods.ipo * (0.7 + 0.6 * co.rep / 100));
  }

  function closeStore(co, st, day, verb) {
    st.status = 'closed'; st.closedDay = day;
    if (!st.franchise) { const refund = R.RESALE * st.invested; co.cash += refund; co.totals.refund += refund; }
    co.events.closed++;
    if (verb) news(day, 'close', co.side, TIERS[st.tier].rank >= 3, `${co.name} ${verb} its ${st.district ? DISTRICTS[st.district].name : 'online'} ${TIERS[st.tier].name.toLowerCase()}`);
  }

  function orderStock(co, c, units, day, mods, why) {
    if (units <= 0) return 0;
    const uc = unitCost(co, c, mods);
    let n = Math.floor(units);
    const pay = affordable(co, n * uc);
    if (pay < n * uc) { n = Math.floor(pay / uc); if (why === 'manual') note(co, `order ${c}: could only afford ${n} units`); }
    if (n <= 0) return 0;
    co.cash -= n * uc; co.totals.orders += n * uc;
    co.incoming.push({ day: day + mods.lead, c, units: n, cost: uc });
    return n;
  }

  function autoRestock(co, day, mods) {
    for (const c of co.lines) {
      const sd = co.stockDays[c];
      if (!(sd > 0)) continue;
      const lead = mods.lead;
      // expected demand from today until the delivery arrives, plus sd days of shelf stock after it
      let need = 0;
      const mTomorrow = R.eventMods(level, Math.min(days, day + lead));
      for (let k = 0; k < lead; k++) need += forecastOn(co, c, day + k);
      need += sd * forecastOn(co, c, day + lead, mTomorrow);
      const pipeline = co.inventory[c] * (1 - CATEGORIES[c].spoil * 0.5) + co.incoming.filter(x => x.c === c).reduce((a, x) => a + x.units, 0);
      const units = need - pipeline;
      if (units > 0.5) orderStock(co, c, Math.ceil(units), day, mods, 'auto');
    }
  }
  function forecastOn(co, c, day, m) {
    const dd = Math.min(days, day);
    const mm = m || R.eventMods(level, dd);
    return servedPotential(co, c, dd, mm) * co.ratio[c] * capFactor(co, dd, mm);
  }

  // ── the market for one day ──
  function market(day, mods, mk) {
    const RT = cos.map(co => (co.bankrupt ? { routes: {}, pools: {} } : routesFor(co, mods)));
    cos.forEach((co, i) => { co._routes = RT[i].routes; });
    // 1) desire
    const want = [{}, {}];   // want[i][d][c] = { n, route }
    const distLog = {}, catLog = {};
    for (const d of dists) {
      const D = DISTRICTS[d];
      catLog[d] = {};
      for (const c of cats) {
        const pot = R.potential(level, d, c, day, mods);
        if (pot <= 0) continue;
        const C = CATEGORIES[c];
        const U = [null, null];
        let den = Math.exp(MODEL.outside);
        for (let i = 0; i < 2; i++) {
          const co = cos[i];
          const rt = RT[i].routes[d] && RT[i].routes[d][c];
          if (!rt) continue;
          const p = priceOf(co, c, d);
          let u = rt.presence;
          u += MODEL.quality * Math.log(qualityOf(co, c, rt.tq));
          const aw = rt.kind === 'online' ? Math.max(co.aw[d], avgAw(co)) : co.aw[d];
          u += MODEL.brand * (aw - MODEL.brandPivot);
          u += MODEL.rep * (co.rep - 50) / 50;
          u -= (D.elas + mods.elas) * Math.log(p / C.ref);
          if (co.stockout[`${d}|${c}`]) u -= MODEL.stockoutMemory;
          if (has(co, 'spacehotel')) u += 0.5;
          U[i] = u;
          den += Math.exp(u);
        }
        for (let i = 0; i < 2; i++) {
          if (U[i] === null) continue;
          const n = pot * Math.exp(U[i]) / den;
          const rt = RT[i].routes[d][c];
          (want[i][d] || (want[i][d] = {}))[c] = { n, rt, pot };
        }
        catLog[d][c] = [0, 0, pot];
      }
    }
    // 2) capacity per pool, 3) stock per category
    const res = cos.map((co, i) => serve(co, want[i], RT[i].pools, mods));
    // 4) spillover: unserved customers try the rival
    for (let i = 0; i < 2; i++) {
      const j = 1 - i;
      if (cos[j].bankrupt) continue;
      for (const [d, byC] of Object.entries(res[i].lost)) {
        for (const [c, lost] of Object.entries(byC)) {
          const w = want[j][d] && want[j][d][c];
          if (!w || lost <= 0) continue;
          const pool = res[j].poolLeft[w.rt.pool];
          if (!(pool > 0)) continue;
          const serveW = CATEGORIES[c].serve;
          let n = Math.min(lost * MODEL.spillover, pool / serveW);
          const own = res[j].poolOwnShare[w.rt.pool];
          const stockNeed = n * own;
          if (stockNeed > res[j].stockLeft[c]) n = own > 0 ? res[j].stockLeft[c] / own : n;
          if (n <= 0.01) continue;
          res[j].poolLeft[w.rt.pool] -= n * serveW;
          res[j].stockLeft[c] -= n * own;
          addServed(res[j], d, c, n, w.rt, own);
          res[j].spillIn += n;
        }
      }
    }
    // 5) books
    const out = [];
    for (let i = 0; i < 2; i++) {
      const co = cos[i], r = res[i];
      const y = { revenue: 0, cogs: 0, shipping: 0, royalties: 0, customers: 0, sales: {}, demand: {}, lostStock: {}, lostCapacity: 0, spillIn: r2(r.spillIn), byDistrict: {} };
      for (const st of co.stores) { st.cust = 0; st.rev = 0; st._need = 0; }
      for (const [d, byC] of Object.entries(r.served)) {
        for (const [c, s] of Object.entries(byC)) {
          const p = priceOf(co, c, d);
          const ownUnits = s.own, frUnits = s.fr;
          const rev = ownUnits * p;
          let ship = 0;
          if (s.rt.kind === 'online') ship = ownUnits * (has(co, 'robots') ? 0 : MODEL.onlineShip(p));
          const cogs = ownUnits * co.invCost[c];
          const roy = frUnits * p * MONEY.royalty;
          y.revenue += rev; y.cogs += cogs; y.shipping += ship; y.royalties += roy;
          y.customers += ownUnits + frUnits;
          y.sales[c] = (y.sales[c] || 0) + ownUnits + frUnits;
          y.byDistrict[d] = (y.byDistrict[d] || 0) + ownUnits + frUnits;
          co.byCat[c].units += ownUnits + frUnits; co.byCat[c].revenue += rev; co.byCat[c].cogs += cogs;
          co.byDist[d].customers += ownUnits + frUnits; co.byDist[d].revenue += rev + roy;
          catLog[d][c][i] += ownUnits + frUnits;
          // attribute to stores in the pool (by capacity)
          const pool = r.pools[s.rt.pool] || [];
          const capT = pool.reduce((a, st) => a + (r.caps[st.id] || 0), 0);
          for (const st of pool) {
            const k = capT > 0 ? (r.caps[st.id] || 0) / capT : 0;
            if (st.franchise) { if (frUnits > 0) { const fk = r.frCap[s.rt.pool] > 0 ? (r.caps[st.id] || 0) / r.frCap[s.rt.pool] : 0; st.cust += frUnits * fk; st.rev += frUnits * p * fk; } }
            else { const ok = r.ownCap[s.rt.pool] > 0 ? (r.caps[st.id] || 0) / r.ownCap[s.rt.pool] : 0; st.cust += ownUnits * ok; st.rev += (rev - ship) * ok; }
            void k;
          }
        }
      }
      // capacity need per store (served + lost to capacity), for auto-staffing
      for (const [pool, need] of Object.entries(r.poolNeed)) {
        const arr = r.pools[pool] || [];
        const own = arr.filter(s => !s.franchise);
        const capMax = own.reduce((a, st) => a + TIERS[st.tier].cap, 0);
        for (const st of own) st._need = capMax > 0 ? need * r.ownShareOfNeed[pool] * TIERS[st.tier].cap / capMax : 0;
      }
      for (const [c, v] of Object.entries(r.stockDemand)) y.demand[c] = r2(v);
      for (const [c, v] of Object.entries(r.lostStockC)) y.lostStock[c] = r2(v);
      y.lostCapacity = r2(r.lostCapT);
      // stock (+ the 10-day average volume that sets your bulk-buying discount)
      for (const c of CATEGORY_IDS) {
        co.inventory[c] = Math.max(0, co.inventory[c] - (r.usedStock[c] || 0));
        co.vol[c] = (co.vol[c] || 0) * 0.9 + (r.usedStock[c] || 0) * 0.1;
      }
      // demand ratio learning (for the forecast): shoppers who chose us (before capacity limits) / potential we reach
      for (const c of co.lines) {
        const pot = servedPotential(co, c, day, mods);
        if (pot > 0) {
          let w = 0;
          for (const byC of Object.values(want[i])) if (byC[c]) w += byC[c].n * (r.poolOwnShare[byC[c].rt.pool] || 0);
          co.ratio[c] = co.ratio[c] * 0.5 + (w / pot) * 0.5;
        }
      }
      // stock-out memory
      co.stockout = {};
      for (const [key, v] of Object.entries(r.lostStockDC)) if (v.lost > 0.05 * v.want && v.lost > 2) co.stockout[key] = true;
      out.push(y);
      co.totals.lostStock += Object.values(r.lostStockC).reduce((a, b) => a + b, 0);
      co.totals.lostCap += r.lostCapT;
      co.totals.spillIn += r.spillIn;
    }
    // district log for the frame and tomorrow's state
    for (const d of dists) {
      let a = 0, b = 0, tot = 0;
      for (const c of cats) { const v = catLog[d][c]; if (!v) continue; a += v[0]; b += v[1]; tot += v[2]; }
      distLog[d] = [a, b, tot];
      cos[0].byDist[d].rivalCustomers += b; cos[1].byDist[d].rivalCustomers += a;
    }
    mk.lastDist = distLog; mk.lastCat = catLog;
    return out;
  }
  function avgAw(co) { let s = 0, n = 0; for (const d of dists) { if (DISTRICTS[d].overseas) continue; s += co.aw[d]; n++; } return n ? s / n : 0; }

  function addServed(r, d, c, n, rt, ownShare) {
    const byC = r.served[d] || (r.served[d] = {});
    const s = byC[c] || (byC[c] = { own: 0, fr: 0, rt });
    s.own += n * ownShare; s.fr += n * (1 - ownShare);
    r.usedStock[c] = (r.usedStock[c] || 0) + n * ownShare;
  }

  function serve(co, want, pools, mods) {
    const r = { served: {}, lost: {}, poolLeft: {}, poolOwnShare: {}, stockLeft: {}, usedStock: {}, caps: {}, ownCap: {}, frCap: {}, pools, poolNeed: {}, ownShareOfNeed: {}, stockDemand: {}, lostStockC: {}, lostStockDC: {}, lostCapT: 0, spillIn: 0 };
    // pool capacities
    for (const [pool, arr] of Object.entries(pools)) {
      let own = 0, fr = 0;
      for (const st of arr) { const cap = capacityOf(st, mods); r.caps[st.id] = cap; if (st.franchise) fr += cap; else own += cap; }
      r.ownCap[pool] = own; r.frCap[pool] = fr;
      r.poolLeft[pool] = own + fr;
      r.poolOwnShare[pool] = own + fr > 0 ? own / (own + fr) : 0;
    }
    // capacity demand per pool
    const load = {};
    for (const byC of Object.values(want)) for (const [c, w] of Object.entries(byC)) load[w.rt.pool] = (load[w.rt.pool] || 0) + w.n * CATEGORIES[c].serve;
    const capK = {};
    for (const [pool, l] of Object.entries(load)) {
      const cap = r.poolLeft[pool] || 0;
      capK[pool] = l > cap ? cap / l : 1;
      r.poolNeed[pool] = l;
      const own = r.ownCap[pool] || 0, fr = r.frCap[pool] || 0;
      r.ownShareOfNeed[pool] = own + fr > 0 ? own / (own + fr) : 0;
    }
    // stock needed per category (own stores only)
    const need = {};
    for (const byC of Object.values(want)) for (const [c, w] of Object.entries(byC)) need[c] = (need[c] || 0) + w.n * capK[w.rt.pool] * r.poolOwnShare[w.rt.pool];
    const stockK = {};
    for (const c of CATEGORY_IDS) {
      const inv = co.inventory[c];
      const n = need[c] || 0;
      stockK[c] = n > inv ? (n > 0 ? inv / n : 1) : 1;
      r.stockDemand[c] = n;
    }
    for (const [d, byC] of Object.entries(want)) {
      for (const [c, w] of Object.entries(byC)) {
        const ck = capK[w.rt.pool];
        const own = r.poolOwnShare[w.rt.pool];
        const afterCap = w.n * ck;
        const lostCap = w.n - afterCap;
        const ownWant = afterCap * own, frServed = afterCap * (1 - own);
        const ownServed = ownWant * stockK[c];
        const lostStock = ownWant - ownServed;
        const byS = r.served[d] || (r.served[d] = {});
        byS[c] = { own: ownServed, fr: frServed, rt: w.rt };
        r.usedStock[c] = (r.usedStock[c] || 0) + ownServed;
        r.poolLeft[w.rt.pool] -= (ownServed + frServed) * CATEGORIES[c].serve;
        const lost = lostCap + lostStock;
        if (lost > 0) (r.lost[d] || (r.lost[d] = {}))[c] = lost;
        r.lostCapT += lostCap;
        r.lostStockC[c] = (r.lostStockC[c] || 0) + lostStock;
        r.lostStockDC[`${d}|${c}`] = { lost: lostStock, want: ownWant };
        co.byCat[c].lostStock += lostStock; co.byCat[c].lostCap += lostCap;
      }
    }
    for (const c of CATEGORY_IDS) r.stockLeft[c] = Math.max(0, co.inventory[c] - (r.usedStock[c] || 0));
    for (const p of Object.keys(r.poolLeft)) r.poolLeft[p] = Math.max(0, r.poolLeft[p]);
    return r;
  }

  // ── evening books ──
  function evening(co, y, day, mods) {
    let wages = 0, rent = 0;
    for (const st of co.stores) {
      if (st.status === 'closed' || st.franchise) continue;
      const rm = (mods.rent[st.district] || 1) * (has(co, 'fusion') ? 0.7 : 1);
      rent += R.rentOf(st.tier, st.district) * rm * (st.status === 'building' ? 0.5 : 1);
      if (st.status === 'open') wages += st.staff * R.wageOf(st.district);
    }
    let overhead = 0;
    for (const c of co.lines) overhead += R.LINE_OVERHEAD(c);
    const interest = co.loan * MONEY.loanRate + co.emergency * MONEY.penaltyRate + Math.max(0, -co.cash) * MONEY.penaltyRate;
    const tourism = has(co, 'spacehotel') ? 15000 : 0;
    co.cash += y.revenue - y.shipping + y.royalties + tourism - wages - rent - overhead - interest;
    // discretionary spending (never pushes you into debt you cannot cover)
    let mkt = 0;
    const wantMkt = Object.values(co.marketing).reduce((a, b) => a + b, 0);
    if (wantMkt > 0) { mkt = affordable(co, wantMkt); co.cash -= mkt; }
    const mktK = wantMkt > 0 ? mkt / wantMkt : 0;
    let rnd = 0;
    const wantRnd = Object.values(co.rnd).reduce((a, b) => a + b, 0);
    if (wantRnd > 0) {
      rnd = affordable(co, wantRnd); co.cash -= rnd;
      const k = rnd / wantRnd;
      for (const c of CATEGORY_IDS) {
        co.rndCum[c] += co.rnd[c] * k;
        co.quality[c] = 1 + RND.k * Math.log(1 + co.rndCum[c] / RND.scale(c, level));
      }
    }
    let moonSpend = 0;
    for (const [id, m] of Object.entries(co.moon)) {
      if (m.done || m.lost || !(m.perDay > 0)) continue;
      const pay = affordable(co, Math.min(m.perDay, MOONSHOTS[id].cost - m.funded));
      co.cash -= pay; m.funded += pay; moonSpend += pay;
    }
    // spoilage
    let spoil = 0;
    for (const c of CATEGORY_IDS) {
      const lost = co.inventory[c] * CATEGORIES[c].spoil;
      if (lost > 0) { co.inventory[c] -= lost; spoil += lost * co.invCost[c]; }
    }
    // awareness
    for (const d of dists) {
      if (!distOpen(co, d) && !liveStores(co).some(s => s.district === d)) continue;
      const hasStore = co.stores.some(s => s.status === 'open' && s.district === d);
      const near = !DISTRICTS[d].overseas && (ADJ[d] || []).some(n => co.stores.some(s => s.status === 'open' && s.district === n));
      let gain = 0;
      for (const ch of chans) {
        const spend = (co.marketing[ch] || 0) * mktK;
        if (!(spend > 0)) continue;
        const C = CHANNELS[ch];
        gain += C.gain * R.channelWeight(ch, d, hasStore, near) * (1 - Math.exp(-spend / C.scale)) * (mods.channel[ch] || 1);
      }
      for (const st of co.stores) {
        if (st.status !== 'open' || !st.district) continue;
        const t = TIERS[st.tier];
        if (st.district === d) gain += t.aw;
        else if ((ADJ[d] || []).includes(st.district)) gain += t.aw * 0.3;
      }
      co.aw[d] = clamp(co.aw[d] + gain * (1 - co.aw[d]) - R.AW_DECAY * co.aw[d], 0, 1);
    }
    // reputation
    let units = 0, vsum = 0;
    for (const [c, n] of Object.entries(y.sales)) {
      const C = CATEGORIES[c];
      const v = Math.log(qualityOf(co, c, 0)) - REP.pricePull * Math.log(co.prices[c] / C.ref);
      vsum += v * n; units += n;
    }
    const lostSt = Object.values(y.lostStock).reduce((a, b) => a + b, 0);
    if (units > 0) {
      const lostFrac = (lostSt + REP.capWeight * y.lostCapacity) / (units + lostSt + y.lostCapacity);
      let exp = 0, expN = 0;
      for (const st of openStores(co)) { exp += TIERS[st.tier].quality; expN++; }
      const infl = chans.includes('influencers') ? (CHANNELS.influencers.rep * 100) * (1 - Math.exp(-((co.marketing.influencers || 0) * mktK) / CHANNELS.influencers.scale)) : 0;
      const target = 50 + REP.value * Math.tanh(REP.valueK * vsum / units) - REP.service * lostFrac + REP.experience * (expN ? exp / expN : 0) * 10 + infl;
      co.rep = clamp(co.rep + REP.speed * (clamp(target, 0, 100) - co.rep), 0, 100);
    }
    const profit = y.revenue - y.shipping - y.cogs + y.royalties + tourism - wages - rent - overhead - interest - mkt - rnd - spoil;
    const T0 = co.totals;
    T0.revenue += y.revenue; T0.cogs += y.cogs; T0.shipping += y.shipping; T0.wages += wages; T0.rent += rent; T0.marketing += mkt; T0.rnd += rnd;
    T0.interest += interest; T0.spoilage += spoil; T0.overhead += overhead; T0.royalties += y.royalties; T0.tourism += tourism; T0.moonshot += moonSpend; T0.customers += y.customers;
    Object.assign(y, { wages: r0(wages), rent: r0(rent), marketing: r0(mkt), rnd: r0(rnd), overhead: r0(overhead), interest: r2(interest), spoilage: r0(spoil), tourism, moonshot: r0(moonSpend), profit: r0(profit) });
    y.revenue = r0(y.revenue); y.cogs = r0(y.cogs); y.shipping = r0(y.shipping); y.royalties = r0(y.royalties); y.customers = r0(y.customers);
    for (const k of Object.keys(y.sales)) y.sales[k] = r0(y.sales[k]);
    for (const k of Object.keys(y.byDistrict)) y.byDistrict[k] = r0(y.byDistrict[k]);
    return profit;
  }

  function autoStaff(co, day) {
    for (const st of co.stores) {
      if (st.franchise || st.status === 'closed') continue;
      const t = TIERS[st.tier];
      st.lastNeed = st._need || 0;
      if (st.status !== 'open') continue;
      st.need = st.need ? st.need * 0.55 + (st._need || 0) * 0.45 : (st._need || 0);
      let target;
      if (st.staffOverride) target = st.staffOverride;
      else target = clamp(Math.ceil(st.need * co.staffing * 1.08 / t.perStaff), 1, t.staffMax);
      target = clamp(target, 1, t.staffMax);
      if (target > st.staff) {
        const add = st.staffOverride ? target - st.staff : Math.min(target - st.staff, Math.max(2, Math.ceil(t.staffMax / 4)));
        st.staff += add; co.cash -= add * R.HIRE_COST; co.totals.hiring += add * R.HIRE_COST;
      } else if (target < st.staff) {
        const cut = st.staffOverride ? st.staff - target : 1;
        st.staff -= cut; const sev = cut * R.wageOf(st.district) * R.SEVERANCE_DAYS; co.cash -= sev; co.totals.hiring += sev;
      }
    }
  }

  function morning(co, day) {
    // deliveries
    const keep = [];
    for (const x of co.incoming) {
      if (x.day <= day) {
        const inv = co.inventory[x.c];
        const tot = inv + x.units;
        co.invCost[x.c] = tot > 0 ? (inv * co.invCost[x.c] + x.units * x.cost) / tot : x.cost;
        co.inventory[x.c] = tot;
      } else keep.push(x);
    }
    co.incoming = keep;
    // construction
    for (const st of co.stores) {
      if (st.status === 'building' && day >= st.readyDay) {
        st.status = 'open';
        const t = TIERS[st.tier];
        st.staff = st.franchise ? 0 : Math.max(1, Math.ceil(t.staffMax * 0.6));
        if (!st.franchise) { co.cash -= st.staff * R.HIRE_COST; co.totals.hiring += st.staff * R.HIRE_COST; }
        const where = st.district ? `in ${DISTRICTS[st.district].name}` : 'online';
        const big = t.rank >= 3 || st.tier === 'online';
        news(day, 'open', co.side, big, st.franchise ? `${co.name} franchise ${t.name.toLowerCase()} opens ${where}` : `${co.name} opens a ${t.name.toLowerCase()} ${where}!${big ? ' Grand opening!' : ''}`, 0.12);
      }
      if (st.upgradeTo && day >= st.upgradeReady) {
        const from = st.tier;
        st.tier = st.upgradeTo; st.upgradeTo = null; st.upgradeReady = null; st.tiers.push([day, st.tier]);
        news(day, 'open', co.side, TIERS[st.tier].rank >= 3, `${co.name} unveils its new ${DISTRICTS[st.district].name} ${TIERS[st.tier].name.toLowerCase()} (was a ${TIERS[from].name.toLowerCase()})`, 0.12);
      }
    }
    co.peakStores = Math.max(co.peakStores, openStores(co).length);
  }

  function moonshotCheck(day) {
    for (const co of cos) {
      for (const [id, m] of Object.entries(co.moon)) {
        if (m.done || m.lost) continue;
        if (m.funded >= MOONSHOTS[id].cost - 0.5) {
          m.done = true; m.doneDay = day; co.moonDone.push(id);
          news(day, 'milestone', co.side, true, `${co.name} completes the ${MOONSHOTS[id].name}! ${MOONSHOTS[id].text}`, 0.8);
          const rv = cos[1 - co.side];
          const rm = rv.moon[id];
          if (rm && !rm.done && !rm.lost) {
            rm.lost = true; const back = rm.funded * R.MOONSHOT_REFUND; rv.cash += back; rv.totals.moonRefund += back; rm.perDay = 0;
            news(day, 'close', rv.side, true, `${rv.name} loses the ${MOONSHOTS[id].name} race (${money(back)} refunded)`, 0.85);
          }
        }
      }
    }
  }

  function solvency(co, day) {
    if (co.bankrupt) return;
    if (co.cash < 0 && R.has(level, 'loans')) {
      const room = Math.max(0, creditLimit(co) - debtOf(co));
      const need = -co.cash;
      const take = Math.min(room, need);
      if (take > 0) { co.emergency += take; co.cash += take; if (!co._emNews || co._emNews <= day - 10) { co._emNews = day; news(day, 'cash', co.side, false, `${co.name} is out of cash - emergency credit of ${money(take)} at a penalty rate`, 0.9); } }
    }
    // fire sale: sell the weakest stores (at their 60% resale value) before going under
    while (co.cash < -overdraft) {
      const own = openStores(co).filter(s => !s.franchise).concat(co.stores.filter(s => s.status === 'building' && !s.franchise));
      if (own.length <= 1) break;
      own.sort((p, q) => (p.rev - q.rev) || (p.id - q.id));
      const st = own[0];
      closeStore(co, st, day, null);
      st.fireSale = true;
      news(day, 'close', co.side, true, `${co.name} is out of cash and sells its ${st.district ? DISTRICTS[st.district].name : 'online'} ${TIERS[st.tier].name.toLowerCase()} to pay the bills!`, 0.9);
    }
    if (co.cash < -overdraft) {
      co.bankrupt = true; co.bankruptDay = day; co.finalNW = netWorth(co);
      for (const st of co.stores) if (st.status !== 'closed') { st.status = 'closed'; st.closedDay = day; st.bankrupt = true; }
      news(day, 'bankrupt', co.side, true, `${co.name} GOES BANKRUPT! Every store is boarded up.`, 0.95);
    }
  }

  // ── starting position ──
  const mk = { lastDist: {}, lastCat: {} };
  const mods1 = R.eventMods(level, 1);
  for (const co of cos) {
    const st = addStore(co, co.spec.hq, R.startTier(level), 0, { free: true });
    st.status = 'open'; st.readyDay = 0;
    st.staff = Math.max(1, Math.ceil(TIERS[st.tier].staffMax * 0.6));
  }
  for (const co of cos) {
    co._routes = routesFor(co, mods1).routes;
    // opening stock: bought instantly on day 1 (the only delivery that needs no lead time)
    for (const c of co.lines) {
      const f = forecastOn(co, c, 1, mods1) * Math.max(1.2, co.stockDays[c]);
      const cap = openStores(co).reduce((a, s) => a + TIERS[s.tier].cap, 0) / CATEGORIES[c].serve;
      const n = Math.ceil(Math.min(f, cap * 1.5));
      const uc = unitCost(co, c, mods1);
      const pay = Math.min(n * uc, co.cash * 0.5);
      const units = Math.floor(pay / uc);
      co.cash -= units * uc; co.totals.orders += units * uc;
      co.inventory[c] = units; co.invCost[c] = uc;
    }
  }
  news(1, 'bell', null, true, `Year ${round} begins! ${cos[0].name} vs ${cos[1].name} - ${dists.length} districts, ${cats.length} product${cats.length > 1 ? 's' : ''}`, 0.05);

  // ── the loop ──
  const nwLead = { side: null, day: 0 };
  const milestones = [[], []];
  let stopAt = null;
  for (let day = 1; day <= days; day++) {
    const mods = R.eventMods(level, day);
    for (const ev of cal) if (ev.from === day) news(day, 'news', null, ev.kind === 'bad' || ev.to - ev.from >= 10, `${ev.name.toUpperCase()}: ${ev.text} (days ${ev.from}-${ev.to})`, 0.02);
    for (const co of cos) if (!co.bankrupt) morning(co, day);
    for (const co of cos) if (!co.bankrupt) co._routes = routesFor(co, mods).routes;
    // strategies (same snapshot for both)
    const states = cos.map((co, i) => (co.bankrupt ? null : buildState(co, cos[1 - i], day, mods, mk)));
    const decs = cos.map((co, i) => {
      if (co.bankrupt || !strategies[i]) return null;
      const before = strategies[i].stats.errors;
      const d = strategies[i].decide(states[i], day);
      if (strategies[i].stats.errors > before) brainErrorsByDay[i].push(day);
      if (strategies[i].stats.disabled && !co.burnedOut) { co.burnedOut = true; news(day, 'news', i, false, `${co.name}'s strategy burned out (CPU budget) - autopilot from here`, 0.6); }
      return d;
    });
    for (const co of cos) co.notes = [];
    cos.forEach((co, i) => { co._day = day; if (!co.bankrupt) applyDecision(co, cos[1 - i], decs[i], day, mods); });
    for (const co of cos) if (!co.bankrupt) co._routes = routesFor(co, mods).routes;
    for (const co of cos) if (!co.bankrupt) autoRestock(co, day, mods);
    const ys = market(day, mods, mk);
    const profits = cos.map((co, i) => (co.bankrupt ? 0 : evening(co, ys[i], day, mods)));
    for (const co of cos) if (!co.bankrupt) autoStaff(co, day);
    moonshotCheck(day);
    for (const co of cos) solvency(co, day);
    // frame
    const fr = { d: day, s: [], st: [], dm: {} };
    cos.forEach((co, i) => {
      const nw = co.bankrupt ? co.finalNW : netWorth(co);
      const y = ys[i];
      co.y = co.bankrupt ? null : y;
      co.hist.push({ day, revenue: y.revenue, profit: r0(profits[i]), netWorth: r0(nw), cash: r0(co.cash), customers: y.customers });
      const tot = Object.values(mk.lastDist).reduce((a, v) => a + v[0] + v[1], 0);
      const mine = Object.values(mk.lastDist).reduce((a, v) => a + v[i], 0);
      co.maxStaff = Math.max(co.maxStaff, co.stores.reduce((a, s) => a + (s.status === 'open' && !s.franchise ? s.staff : 0), 0));
      fr.s.push([r0(co.cash), r0(nw), r0(debtOf(co)), Math.round(co.rep * 10) / 10, y.revenue, r0(profits[i]), y.customers, tot > 0 ? Math.round(mine / tot * 1000) : 0,
        r0(Object.values(co.marketing).reduce((a, b) => a + b, 0)), Math.round(avgAw(co) * 1000), co.bankrupt ? 1 : 0, Object.fromEntries(co.lines.map(c => [c, co.prices[c]]))]);
      if (y.revenue > (co._bestDay || 0) * 1.25 && day > 5 && y.revenue > R.START_CASH[level] * 0.05) {
        co._bestDay = y.revenue;
        if ((co._saleNews || -99) <= day - 6) { co._saleNews = day; news(day, 'sale', i, false, `Record day for ${co.name}: ${money(y.revenue)} in sales`, 0.7); }
      }
      const start = R.START_CASH[level];
      for (const [mult, label] of [[2, 'doubles its money'], [5, 'is worth 5x its start'], [10, 'is worth 10x its start'], [25, 'is worth 25x its start']]) {
        if (!milestones[i].includes(mult) && nw >= start * mult) { milestones[i].push(mult); news(day, 'milestone', i, mult >= 5, `${co.name} ${label}: net worth ${money(nw)}`, 0.75); }
      }
    });
    for (const st of stores) if (st.status === 'open' && st.cust > 0) fr.st.push([st.id, r0(st.cust), r0(st.rev)]);
    for (const d of dists) { const v = mk.lastDist[d]; if (v) fr.dm[d] = [r0(v[0]), r0(v[1]), r0(v[2])]; }
    for (const st of stores) { if (st.status === 'open') { st.custTotal += st.cust; st.revTotal += st.rev; } }
    frames.push(fr);
    // lead changes
    const a = fr.s[0][1], b = fr.s[1][1];
    const leader = a > b * 1.02 ? 0 : b > a * 1.02 ? 1 : null;
    if (leader !== null && leader !== nwLead.side && day > 3 && day - nwLead.day >= 6) {
      news(day, 'milestone', leader, nwLead.side !== null, `${cos[leader].name} ${nwLead.side === null ? 'pulls ahead' : 'TAKES THE LEAD'} in net worth (${money(fr.s[leader][1])} vs ${money(fr.s[1 - leader][1])})`, 0.8);
      nwLead.side = leader; nwLead.day = day;
    }
    if (stopAt === null && cos.some(co => co.bankrupt)) stopAt = Math.min(days, day + 2);
    if (stopAt !== null && day >= stopAt) { endDay = day; break; }
  }

  // ── result ──
  const nws = cos.map(co => (co.bankrupt ? co.finalNW : netWorth(co)));
  let winner = null, method = 'NET WORTH', text;
  const bk = cos.map(co => co.bankrupt);
  if (bk[0] && !bk[1]) winner = 1; else if (bk[1] && !bk[0]) winner = 0;
  if (winner !== null) {
    method = 'BANKRUPTCY';
    const loser = cos[1 - winner];
    text = `${labels[winner]}'s ${cos[winner].name} drove ${labels[1 - winner]}'s ${loser.name} into bankruptcy on day ${loser.bankruptDay}`;
  } else {
    const ra = Math.round(nws[0]), rb = Math.round(nws[1]);
    if (ra === rb) { winner = null; method = 'DRAW'; text = `Dead heat: both companies ended the year worth ${money(ra)}`; }
    else {
      winner = ra > rb ? 0 : 1;
      const w = cos[winner], l = cos[1 - winner];
      const margin = Math.abs(ra - rb) / Math.max(1, Math.abs(Math.min(ra, rb)));
      method = 'NET WORTH';
      text = `${labels[winner]}'s ${w.name} ${margin > 0.5 ? 'crushed' : margin > 0.15 ? 'beat' : 'edged'} ${labels[1 - winner]}'s ${l.name}: ${money(nws[winner])} vs ${money(nws[1 - winner])} net worth after ${endDay} days`;
    }
  }
  const duration = r2(endDay * DAY_SEC + 1.2);
  events.push({ t: r2(endDay * DAY_SEC + 0.4), day: endDay, k: 'victory', side: winner, big: true, text: winner === null ? 'THE YEAR ENDS IN A DRAW!' : `${cos[winner].name.toUpperCase()} WINS THE YEAR!` });
  events.sort((p, q) => p.t - q.t);

  const result = { winner, method, time: r2(endDay * DAY_SEC), text, netWorth: nws.map(r0), day: endDay };

  // ── stats (flat numbers) ──
  const stats = cos.map((co, i) => {
    const T0 = co.totals;
    const own = T0.customers, riv = cos[1 - i].totals.customers;
    return {
      netWorth: r0(nws[i]), cash: r0(co.cash), debt: r0(debtOf(co)), revenue: r0(T0.revenue), profit: r0(co.hist.reduce((a, h) => a + h.profit, 0)),
      grossMargin: T0.revenue > 0 ? r2((T0.revenue - T0.cogs) / T0.revenue * 100) : 0,
      customers: r0(own), marketShare: own + riv > 0 ? r2(own / (own + riv) * 100) : 0,
      stores: openStores(co).length, peakStores: co.peakStores, storesOpened: co.events.opened, storesClosed: co.events.closed, franchises: co.events.franchised,
      acquisitions: co.events.acquired, reputation: r2(co.rep), awareness: r2(avgAw(co) * 100),
      marketing: r0(T0.marketing), rnd: r0(T0.rnd), wages: r0(T0.wages), rent: r0(T0.rent), interest: r0(T0.interest), spoilage: r0(T0.spoilage),
      lostSalesStock: r0(T0.lostStock), lostSalesCapacity: r0(T0.lostCap), spillIn: r0(T0.spillIn), lines: co.lines.length,
      ipoPercent: Math.round(co.ipoShare * 100), moonshots: co.moonDone.length, bankrupt: co.bankrupt ? 1 : 0, bankruptDay: co.bankruptDay || 0,
      brainErrors: strategies[i] ? strategies[i].stats.errors : 0, brainMs: strategies[i] ? r0(strategies[i].stats.totalMs) : 0,
    };
  });

  // ── the replay ──
  const replay = {
    mode: 'business', v: 1, duration, daySec: DAY_SEC, days: endDay, yearDays: days, level, round,
    sides: cos.map((co, i) => ({ id: (o.ids || [])[i], label: labels[i], name: co.name, slogan: co.spec.slogan, logo: co.spec.logo, colors: { primary: co.spec.logo.primary, secondary: co.spec.logo.secondary }, hq: co.spec.hq })),
    result,
    districts: dists,
    locked: R.DISTRICT_IDS.filter(d => !dists.includes(d)),
    categories: cats,
    calendar: cal.map(e => ({ type: e.type, name: e.name, icon: e.icon, kind: e.kind, from: e.from, to: e.to })),
    stores: stores.map(st => ({ id: st.id, side: st.owners[0][1], district: st.district, slot: st.slot, franchise: st.franchise, start: st.startDay, ready: st.readyDay, closed: st.closedDay, bankrupt: !!st.bankrupt, tiers: st.tiers, owners: st.owners, custTotal: r0(st.custTotal), revTotal: r0(st.revTotal) })),
    frames,
    events,
    summary: cos.map((co, i) => summaryOf(co, cos[1 - i], strategies[i], i)),
  };
  function summaryOf(co, rv, strat, i) {
    const T0 = co.totals;
    return {
      totals: Object.fromEntries(Object.entries(T0).map(([k, v]) => [k, r0(v)])),
      byCat: Object.fromEntries(Object.entries(co.byCat).filter(([c]) => cats.includes(c)).map(([c, v]) => [c, { units: r0(v.units), revenue: r0(v.revenue), cogs: r0(v.cogs), lostStock: r0(v.lostStock), lostCap: r0(v.lostCap), price: co.prices[c], quality: r2(co.quality[c]) }])),
      byDist: Object.fromEntries(dists.map(d => [d, { customers: r0(co.byDist[d].customers), rival: r0(co.byDist[d].rivalCustomers), revenue: r0(co.byDist[d].revenue), awareness: r2(co.aw[d]) }])),
      lines: co.lines.slice(), prices: { ...co.prices }, dprices: co.dprices, marketing: { ...co.marketing }, rnd: { ...co.rnd },
      rep: r2(co.rep), ipoShare: co.ipoShare, ipoDay: co.ipoDay, ipoCash: co.ipoCash, moonDone: co.moonDone.slice(), moon: co.moon,
      stores: co.stores.map(st => ({ id: st.id, district: st.district, tier: st.tier, status: st.status, franchise: st.franchise, start: st.startDay, closed: st.closedDay, cust: r0(st.custTotal), rev: r0(st.revTotal), staff: st.staff })),
      quarters: [30, 60, 90, 120].map(q => { const h = co.hist[Math.min(co.hist.length, q) - 1]; return h ? { day: h.day, netWorth: h.netWorth, cash: h.cash } : null; }),
      brain: strat ? { calls: strat.stats.calls, errors: strat.stats.errors, timeouts: strat.stats.timeouts, firstErrors: strat.stats.firstErrors.slice(0, 6), logs: strat.stats.logs.slice(0, 30), disabled: strat.stats.disabled, disabledReason: strat.stats.disabledReason } : null,
      errorDays: brainErrorsByDay[i].slice(0, 20),
      refused: co.noteLog.slice(0, 12),
      bankruptDay: co.bankruptDay,
    };
  }
  return { replay, result, stats, companies: cos };
}

// Static rules snapshot handed to strategies (state.rules), per level.
const rulesCache = {};
function rulesFor(level) {
  if (rulesCache[level]) return rulesCache[level];
  const out = {
    days: DAYS, level,
    districts: Object.fromEntries(R.unlockedDistricts(level).map(d => { const D = DISTRICTS[d]; return [d, { name: D.name, pop: D.pop, elasticity: D.elas, rent: D.rent, wage: D.wage, youth: D.youth, traffic: D.traffic, online: D.online, weekday: D.wk, weekend: D.we, season: D.season, prefs: D.prefs, adjacent: ADJ[d], overseas: !!D.overseas, needs: D.needs || null }]; })),
    categories: Object.fromEntries(R.unlockedCategories(level).map(c => { const C = CATEGORIES[c]; return [c, { name: C.name, ref: C.ref, cost: C.cost, spoil: C.spoil, serve: C.serve, launch: C.launch, overhead: R.LINE_OVERHEAD(c), rndScale: Math.round(RND.scale(c, level)), online: C.online, onlineOnly: !!C.onlineOnly, cart: C.cart, season: C.season, minPrice: R2(C.ref * MODEL.minPrice), maxPrice: R2(C.ref * MODEL.maxPrice) }]; })),
    tiers: Object.fromEntries(R.unlockedTiers(level).map(t => { const T0 = TIERS[t]; return [t, { name: T0.name, capacity: T0.cap, staffMax: T0.staffMax, perStaff: T0.perStaff, build: T0.build, rent: T0.rent, days: T0.days, presence: T0.presence, awareness: T0.aw, quality: T0.quality }]; })),
    channels: Object.fromEntries(R.unlockedChannels(level).map(c => { const C = CHANNELS[c]; return [c, { name: C.name, scale: C.scale, gain: C.gain, reach: C.reach }]; })),
    model: { outside: MODEL.outside, quality: MODEL.quality, brand: MODEL.brand, brandPivot: MODEL.brandPivot, rep: MODEL.rep, multiStore: MODEL.multiStore, stockoutMemory: MODEL.stockoutMemory, spillover: MODEL.spillover, travelPenalty: R.TRAVEL_PENALTY, megastoreReach: R.MEGASTORE_REACH_PENALTY, awarenessDecay: R.AW_DECAY },
    money: { resale: R.RESALE, maxStoresPerDistrict: R.MAX_STORES_PER_DISTRICT, hireCost: R.HIRE_COST, severanceDays: R.SEVERANCE_DAYS, loanRate: R.has(level, 'loans') ? MONEY.loanRate : null, penaltyRate: MONEY.penaltyRate, overdraft: R.overdraftOf(level), startCash: R.START_CASH[level], royalty: MONEY.royalty, acquirePremium: MONEY.acquirePremium, ipoMaxShare: MONEY.ipoMaxShare, ipoProfitDays: MONEY.ipoProfitDays },
    features: Object.fromEntries(Object.keys(R.FEATURES).map(f => [f, R.has(level, f)])),
    franchiseMax: R.FRANCHISE_MAX(level), acquireCooldown: R.ACQUIRE_COOLDOWN(level), moonshotSlots: R.MOONSHOT_SLOTS(level),
    moonshots: R.has(level, 'moonshots') ? Object.fromEntries(MOONSHOT_IDS.map(m => [m, { name: MOONSHOTS[m].name, cost: MOONSHOTS[m].cost, effect: MOONSHOTS[m].text }])) : {},
  };
  rulesCache[level] = out;
  return out;
}
function R2(v) { return Math.round(v * 100) / 100; }

module.exports = { simulateYear, rulesFor };
