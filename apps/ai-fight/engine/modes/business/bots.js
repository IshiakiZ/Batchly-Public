'use strict';
// Sparring companies for `node arena.js test <id> [bot]`, valid at every level.
// Every bot is the same readable template (BOT_TEMPLATE) with a different personality (CFG).

const R = require('./rules');

const BOT_TEMPLATE = String.raw`
// Sparring bot "__NAME__" - generated from engine/modes/business/bots.js
var CFG = __CFG__;

function decide(s) {
  var me = s.me, rules = s.rules, out = {};
  var cats = Object.keys(rules.categories);
  var hist = me.history || [];
  var recent = hist.slice(-7);
  var avgRev = recent.length ? util.avg(recent, function (h) { return h.revenue; }) : 0;
  var avgProfit = recent.length ? util.avg(recent, function (h) { return h.profit; }) : 0;
  var physical = me.stores.filter(function (x) { return x.tier !== 'online'; });

  // 1) product lines: launch what we can sell once there is money for it
  var launch = [];
  for (var i = 0; i < cats.length; i++) {
    var c = cats[i], C = rules.categories[c];
    if (me.lines.indexOf(c) >= 0) continue;
    if (CFG.skip.indexOf(c) >= 0) continue;
    var canSell = C.onlineOnly ? me.stores.some(function (x) { return x.tier === 'online'; }) : physical.some(function (x) { return x.tier !== 'cart' || C.cart; });
    if (canSell && me.cash > C.launch * CFG.launchCash && s.daysLeft > 25) { launch.push(c); break; }
  }
  if (launch.length) out.launch = launch;

  // 2) prices: a fixed markup over the fair price, optionally reacting to the rival
  out.prices = {};
  for (var j = 0; j < cats.length; j++) {
    var cc = cats[j], ref = rules.categories[cc].ref;
    var p = ref * CFG.price;
    if (CFG.undercut && s.rival.lines.indexOf(cc) >= 0) p = Math.min(p, s.rival.prices[cc] * (1 - CFG.undercut));
    if (CFG.holidayMarkup && s.today.length) p *= 1 + CFG.holidayMarkup;
    out.prices[cc] = util.clamp(p, rules.categories[cc].cost * 1.08, ref * 3);
  }

  // 3) marketing: a share of recent revenue, spread over the channels we like
  var budget = Math.max(CFG.mktMin * rules.money.startCash / 10000, avgRev * CFG.mkt);
  if (me.cash < rules.money.startCash * 0.05) budget *= 0.3;
  var chans = Object.keys(rules.channels), weights = 0, mk = {};
  for (var k = 0; k < chans.length; k++) weights += (CFG.mix[chans[k]] || 0);
  for (var k2 = 0; k2 < chans.length; k2++) {
    var w = CFG.mix[chans[k2]] || 0;
    mk[chans[k2]] = weights > 0 ? Math.round(budget * w / weights) : 0;
  }
  out.marketing = mk;

  // 4) R&D (level 3+): a share of revenue into the lines we sell most
  if (rules.features.rnd) {
    out.rnd = {};
    for (var q = 0; q < me.lines.length; q++) out.rnd[me.lines[q]] = Math.round(avgRev * CFG.rnd / Math.max(1, me.lines.length));
  }
  out.staffing = CFG.staffing;
  out.stockDays = {};
  for (var sd = 0; sd < cats.length; sd++) out.stockDays[cats[sd]] = rules.categories[cats[sd]].spoil >= 0.2 ? CFG.fresh : rules.categories[cats[sd]].spoil >= 0.05 ? CFG.fresh + 0.4 : 4;

  // 5) expansion: only when our stores are busy (or a district is still uncovered),
  //    into the district with the most untapped demand per dollar
  var tiers = CFG.tiers.filter(function (t) { return rules.tiers[t]; });
  var y = me.yesterday || { wages: 0, rent: 0 };
  var reserve = Math.max(rules.money.startCash * CFG.reserve, ((y.wages || 0) + (y.rent || 0)) * CFG.reserveDays);
  var own = physical.filter(function (x) { return x.status === 'open' && !x.franchise; });
  var capNow = util.sum(own, function (x) { return x.maxCapacity; });
  var needNow = util.sum(own, function (x) { return x.demandYesterday; });
  var busy = capNow > 0 ? needNow / capNow : 1;
  var uncovered = Object.keys(s.market.districts).some(function (x) { return s.market.districts[x].open && util.storesIn(s, x).length === 0; });
  if (s.daysLeft > CFG.stopDays && tiers.length && (busy > CFG.busyAt || (uncovered && s.day > 2))) {
    var best = null;
    var dnames = Object.keys(s.market.districts);
    for (var d = 0; d < dnames.length; d++) {
      var dn = dnames[d], D = s.market.districts[dn];
      if (!D.open) continue;
      var mine = util.storesIn(s, dn).length, theirs = util.rivalStoresIn(s, dn).length;
      if (mine >= rules.money.maxStoresPerDistrict) continue;
      var pot = 0;
      for (var m = 0; m < me.lines.length; m++) {
        var ln = me.lines[m], LC = rules.categories[ln];
        if (LC.onlineOnly) continue;
        pot += (D.potential[ln] || 0) * (LC.ref - LC.cost);
      }
      for (var ti = 0; ti < tiers.length; ti++) {
        var tier = tiers[ti];
        if (tier === 'cart' && !me.lines.some(function (x) { return rules.categories[x].cart; })) continue;
        var cost = util.buildCost(s, tier, dn);
        if (me.cash - cost < reserve) continue;
        var value = pot / (1 + mine * CFG.crowd + theirs * 0.6) * Math.min(1, rules.tiers[tier].capacity / 600) * (mine === 0 ? CFG.cover : 1);
        var score = value / Math.pow(cost, CFG.costPow);
        if (!best || score > best.score) best = { district: dn, tier: tier, score: score };
        break;   // first affordable tier in our preference order
      }
    }
    if (best && physical.filter(function (x) { return x.status === 'building'; }).length < CFG.parallel) out.open = [{ district: best.district, tier: best.tier }];
  }
  // upgrades: busy stores move up a tier
  if (s.daysLeft > CFG.stopDays) {
    for (var u = 0; u < me.stores.length; u++) {
      var st = me.stores[u];
      if (st.status !== 'open' || st.franchise || st.upgradingTo || st.tier === 'online') continue;
      var order = ['cart', 'shop', 'flagship', 'megastore'], nx = order[order.indexOf(st.tier) + 1];
      if (!nx || !rules.tiers[nx] || CFG.tiers.indexOf(nx) < 0) continue;
      var upCost = util.buildCost(s, nx, st.district) - util.buildCost(s, st.tier, st.district);
      if (st.demandYesterday > st.maxCapacity * CFG.upgradeAt && me.cash - upCost > reserve) { out.upgrade = [st.id]; break; }
    }
  }
  // online store (level 6+)
  if (rules.tiers.online && CFG.online && !me.stores.some(function (x) { return x.tier === 'online'; }) && me.cash > util.buildCost(s, 'online') * 2 + reserve && s.daysLeft > 40) {
    out.open = (out.open || []).concat([{ tier: 'online' }]);
  }
  // franchising (level 7+)
  if (rules.features.franchise && CFG.franchise && me.franchises < rules.franchiseMax && s.day % 5 === 0) {
    var fd = Object.keys(s.market.districts).filter(function (x) { return s.market.districts[x].open && util.storesIn(s, x).length === 0; });
    if (fd.length) out.franchise = [{ district: fd[0], tier: rules.tiers.flagship ? 'flagship' : 'shop' }];
  }
  // acquisitions (level 8+)
  if (rules.features.acquire && CFG.acquire && s.day > 20 && s.daysLeft > 30 && (me.lastAcquisitionDay === null || s.day - me.lastAcquisitionDay >= rules.acquireCooldown)) {
    var targets = s.rival.stores.filter(function (x) { return x.status === 'open' && !x.franchise && x.tier !== 'online' && x.tier !== 'megastore'; });
    var tgt = util.maxBy(targets, function (x) { return ['cart', 'shop', 'flagship'].indexOf(x.tier); });
    if (tgt && targets.length > 1 && me.cash > util.buildCost(s, tgt.tier, tgt.district) * 1.5 + reserve * 2) out.acquire = tgt.id;
  }
  // loans (level 3+)
  if (rules.features.loans) {
    if (CFG.borrow && me.debt < me.creditLimit * CFG.borrow && s.daysLeft > 45 && avgProfit > 0) out.borrow = Math.round((me.creditLimit * CFG.borrow - me.debt) / 4);
    if (s.daysLeft < 30 && me.debt > 0 && me.cash > me.debt * 0.5) out.repay = Math.min(me.debt, me.cash * 0.5);
  }
  // IPO (level 9+) during a bull market
  if (rules.features.ipo && CFG.ipo && !me.ipoShare && util.eventOn(s, 'bull') && s.day >= 10 && avgProfit > 0) out.ipo = CFG.ipo;
  // moonshots (level 10+)
  if (rules.features.moonshots && CFG.moon.length) {
    var ms = {};
    for (var mi = 0; mi < CFG.moon.length && mi < rules.moonshotSlots; mi++) {
      var id = CFG.moon[mi], M = rules.moonshots[id];
      if (!M || (me.moonshots[id] && (me.moonshots[id].done || me.moonshots[id].lost))) continue;
      ms[id] = me.cash > reserve * 2 && s.daysLeft > 20 ? Math.round(M.cost / 25) : 0;
    }
    out.moonshot = ms;
  }
  // wind down: no new stores near the end of the year
  if (s.daysLeft <= CFG.stopDays) { delete out.open; delete out.upgrade; }
  return out;
}
`;

const BASE = {
  price: 1.0, undercut: 0, holidayMarkup: 0, mkt: 0.05, mktMin: 20, mix: { flyers: 3, social: 2, billboards: 1, influencers: 1, tv: 1, search: 1, global: 1 },
  rnd: 0.02, staffing: 1.0, fresh: 1.15, tiers: ['cart', 'shop'], reserve: 0.08, reserveDays: 6, busyAt: 0.8, cover: 1.5, stopDays: 28, crowd: 0.9, costPow: 0.6, parallel: 1, upgradeAt: 0.85,
  online: true, franchise: false, acquire: false, borrow: 0, ipo: 0, moon: [], skip: [], launchCash: 1.6,
};

const BOTS = {
  discounter: {
    desc: 'Budget Barn - rock-bottom prices, lean staff, lots of cheap stores in price-sensitive districts, little marketing',
    company: { name: 'Budget Barn', slogan: 'Cheap. Cheerful. Everywhere.', logo: { icon: 'tag', primary: '#f2c14e', secondary: '#3a3a3a' }, hq: 'university' },
    cfg: { busyAt: 0.6, price: 0.8, undercut: 0.05, mkt: 0.02, mix: { flyers: 3, social: 1, search: 1 }, rnd: 0, staffing: 0.9, tiers: ['cart', 'shop', 'megastore'], crowd: 0.7, costPow: 0.8, parallel: 3, franchise: true, borrow: 0.3, moon: ['labfood', 'robots'], skip: ['ai'] },
  },
  premium: {
    desc: 'Velvet & Co - premium prices backed by R&D quality, flagships in rich districts, generous staffing',
    company: { name: 'Velvet & Co', slogan: 'Worth every penny.', logo: { icon: 'diamond', primary: '#7b4fd6', secondary: '#f3e9ff' }, hq: 'downtown' },
    cfg: { busyAt: 0.8, reserveDays: 10, price: 1.14, holidayMarkup: 0.05, mkt: 0.06, mix: { flyers: 1, social: 1, billboards: 2, influencers: 3, tv: 2, search: 1, global: 2 }, rnd: 0.06, staffing: 1.25, tiers: ['shop', 'flagship', 'megastore', 'cart'], crowd: 1.2, costPow: 0.4, parallel: 2, upgradeAt: 0.7, ipo: 0.2, moon: ['quantum', 'spacehotel'], launchCash: 1.3 },
  },
  expansionist: {
    desc: 'MegaMart - fair prices, borrows and opens stores everywhere fast, franchises and acquisitions',
    company: { name: 'MegaMart', slogan: 'There is one near you.', logo: { icon: 'bolt', primary: '#2f7fd8', secondary: '#ffe066' }, hq: 'downtown' },
    cfg: { busyAt: 0.7, reserveDays: 5, cover: 2, price: 1.0, mkt: 0.03, mix: { flyers: 2, social: 1, billboards: 2, tv: 1, global: 1 }, rnd: 0.01, staffing: 1.0, tiers: ['shop', 'cart', 'flagship', 'megastore'], reserve: 0.05, stopDays: 22, crowd: 0.8, costPow: 0.5, parallel: 2, franchise: true, acquire: true, borrow: 0.5, ipo: 0.3, moon: ['robots', 'fusion'], launchCash: 1.2 },
  },
  marketer: {
    desc: 'Hype House - loud brand: big marketing budget on every channel, slightly premium prices, fewer but busy stores',
    company: { name: 'Hype House', slogan: 'You have seen us everywhere.', logo: { icon: 'star', primary: '#ff4f9a', secondary: '#1b1b2f' }, hq: 'downtown' },
    cfg: { busyAt: 0.7, price: 1.12, mkt: 0.11, mktMin: 60, mix: { flyers: 2, social: 3, billboards: 2, influencers: 3, tv: 3, search: 2, global: 3 }, rnd: 0.02, staffing: 1.1, tiers: ['shop', 'flagship', 'cart'], crowd: 0.8, costPow: 0.55, parallel: 2, ipo: 0.25, moon: ['spacehotel'] },
  },
  balanced: {
    desc: 'Corner Co - the starter strategy\'s big sibling: fair prices, steady growth, a bit of everything',
    company: { name: 'Corner Co', slogan: 'Good stuff, good prices.', logo: { icon: 'leaf', primary: '#3fb56b', secondary: '#f4f1de' }, hq: 'downtown' },
    cfg: { price: 1.0, mkt: 0.05, rnd: 0.02, busyAt: 0.7, parallel: 2, tiers: ['cart', 'shop', 'flagship', 'megastore'], borrow: 0.3, franchise: true, ipo: 0.15, moon: ['fusion', 'robots', 'quantum'] },
  },
};
const BOT_NAMES = ['starter', 'autopilot', ...Object.keys(BOTS)];
const BOT_DESCS = {
  starter: 'the starter company (company.json + strategy.js installed at New Match)',
  autopilot: 'Sleepy Stall - the starter company.json with an EMPTY strategy (the built-in manager only)',
  ...Object.fromEntries(Object.entries(BOTS).map(([k, v]) => [k, v.desc])),
};

function companyJsonFor(company, level, extra = {}) {
  const cats = R.unlockedCategories(level);
  const lines = cats.filter(c => !(R.CATEGORIES[c].onlineOnly));
  const hq = R.unlockedDistricts(level).includes(company.hq) ? company.hq : 'downtown';
  const prices = {};
  for (const c of cats) prices[c] = Math.round(R.CATEGORIES[c].ref * (extra.price || 1) * 100) / 100;
  const marketing = {};
  if (R.CHANNELS.flyers.level <= level) marketing.flyers = 20;
  return JSON.stringify({ ...company, hq, lines: extra.lines || lines.slice(0, Math.max(1, Math.min(lines.length, extra.maxLines || 3))), prices, marketing }, null, 2);
}

function botBundle(name, level) {
  level = R.clampLevel(level);
  if (name === 'starter' || !BOTS[name] && name !== 'autopilot') return { design: STARTER['company.json'], brain: STARTER['strategy.js'], lib: null };
  if (name === 'autopilot') {
    return { design: companyJsonFor({ name: 'Sleepy Stall', slogan: 'We open. Sometimes.', logo: { icon: 'cup', primary: '#9aa3b5', secondary: '#2b2f3a' }, hq: 'downtown' }, level), brain: '', lib: null };
  }
  const b = BOTS[name];
  const cfg = { ...BASE, ...b.cfg, mix: { ...(b.cfg.mix || BASE.mix) } };
  const brain = BOT_TEMPLATE.replace('__NAME__', name).replace('__CFG__', JSON.stringify(cfg));
  return { design: companyJsonFor(b.company, level, { price: cfg.price }), brain, lib: null };
}

// ── the starter files installed at New Match ─────────────────────────────────
const STARTER_COMPANY = `{
  "name": "My Company",
  "slogan": "Fresh every day.",
  "logo": { "icon": "cup", "primary": "#e8825c", "secondary": "#fff4e0" },
  "hq": "downtown",
  "lines": ["food"],
  "prices": { "food": 6 },
  "stockDays": { "food": 1.15 },
  "marketing": { "flyers": 20 }
}
`;

const STARTER_STRATEGY = `// strategy.js - your company's brain. decide(state) runs once per simulated day.
// Return only what you want to change: every setting persists until you change it again.
// An empty {} keeps running the business on autopilot (restocking + staffing are automatic).
// Full manual: BUSINESS_GUIDE.md.   Try it:  node arena.js test <id>

function decide(s) {
  var me = s.me, rules = s.rules, out = {};

  // 1) Prices: start at the fair price, never undercut the rival by more than 10%.
  out.prices = {};
  me.lines.forEach(function (c) {
    var ref = rules.categories[c].ref;
    var p = ref;
    if (s.rival.lines.indexOf(c) >= 0) p = Math.max(ref * 0.9, Math.min(p, s.rival.prices[c]));
    out.prices[c] = Math.round(p * 100) / 100;
  });

  // 2) Marketing: flyers near our stores, a bit more when business is good.
  var last = me.yesterday;
  out.marketing = { flyers: last && last.revenue > 800 ? 45 : 20 };

  // 3) Growth: open one store at a time when our stores are busy (yesterday's demand above
  //    85% of capacity) or on day 3 - while there is time left to earn the money back.
  var open = me.stores.filter(function (st) { return st.status === 'open' && st.tier !== 'online'; });
  var cap = util.sum(open, function (st) { return st.maxCapacity; });
  var demand = util.sum(open, function (st) { return st.demandYesterday; });
  var building = me.stores.some(function (st) { return st.status === 'building'; });
  var tier = rules.tiers.shop && me.cash > util.buildCost(s, 'shop', 'downtown') * 1.5 ? 'shop' : 'cart';
  if (!building && s.daysLeft > 30 && (demand > cap * 0.85 || s.day === 3)) {
    var best = null;
    Object.keys(s.market.districts).forEach(function (d) {
      var D = s.market.districts[d];
      if (!D.open || util.storesIn(s, d).length >= rules.money.maxStoresPerDistrict) return;
      var demand = 0;
      me.lines.forEach(function (c) { demand += D.potential[c] || 0; });
      var perStore = demand / (1 + util.storesIn(s, d).length + util.rivalStoresIn(s, d).length);
      if (!best || perStore > best.score) best = { district: d, score: perStore };
    });
    if (best && me.cash > util.buildCost(s, tier, best.district) * 1.3) out.open = [{ district: best.district, tier: tier }];
  }

  // 4) New product lines: launch one unlocked product we don't sell yet when we can afford it
  //    (carts only sell food + coffee; AI Apps need an online store).
  Object.keys(rules.categories).forEach(function (c) {
    var C = rules.categories[c];
    if (out.launch || me.lines.indexOf(c) >= 0 || C.onlineOnly || s.daysLeft < 40) return;
    var canSell = me.stores.some(function (st) { return st.tier !== 'cart' || C.cart; });
    if (canSell && me.cash > C.launch * 3) out.launch = [c];
  });

  // 5) Memory survives between rounds (max 16 KB): keep notes for next year.
  if (s.day === s.days) memory.lastYear = { netWorth: me.netWorth, rivalNetWorth: s.rival.netWorth, rivalPrices: s.rival.prices };
  return out;
}
`;

const STARTER = { 'company.json': STARTER_COMPANY, 'strategy.js': STARTER_STRATEGY };

module.exports = { BOT_NAMES, BOT_DESCS, botBundle, STARTER, BOT_TEMPLATE, BOTS };
