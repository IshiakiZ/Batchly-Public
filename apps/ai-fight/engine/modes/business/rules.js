'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  BUSINESS MODE — the rulebook (pure data + small pure helpers).
//  Every number the simulation uses lives here, so `node arena.js market`,
//  the guide and the engine can never disagree.  No randomness anywhere.
// ─────────────────────────────────────────────────────────────────────────────

const DAYS = 120;            // one round = one business year of 120 days
const DAY_SEC = 0.6;         // spectator seconds per simulated day (120 days = 72 s)
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];   // 30 days each
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const LIMITS = {
  callTimeoutMs: 100,       // one decide() call
  budgetMs: 3000,           // total strategy CPU per year before it "burns out" (autopilot)
  loadTimeoutMs: 1500,
  memoryMaxBytes: 16000,
  codeMaxBytes: 300000,     // strategy.js + lib/*.js
  libMaxFiles: 24,
};

// ── districts ────────────────────────────────────────────────────────────────
// pop      shoppers per day      elas  price sensitivity (higher = cares more about price)
// rent     rent / build multiplier   wage  $ per staff per day
// youth    weight for social / influencer ads      online  bonus for online shopping here
// wk/we    weekday / weekend traffic multipliers    season  [spring, summer, autumn, winter]
// prefs    share of shoppers who want each category on a normal day
const DISTRICTS = {
  downtown:   { name: 'Downtown',    level: 1,  pop: 3000, elas: 2.6, rent: 2.0, wage: 110, youth: 1.0, traffic: 1.4, online: -0.1, wk: 1.15, we: 0.6,  season: [1, 1, 1, 1.08],
    prefs: { food: .20, coffee: .30, burgers: .14, fashion: .05, gadgets: .025, games: .015, ai: .03 } },
  university: { name: 'University',  level: 1,  pop: 2200, elas: 3.8, rent: 0.8, wage: 70,  youth: 1.6, traffic: 0.8, online: 0.3,  wk: 1.1,  we: 0.75, season: [1.05, 0.7, 1.15, 1],
    prefs: { food: .24, coffee: .26, burgers: .18, fashion: .03, gadgets: .02, games: .05, ai: .05 } },
  suburbs:    { name: 'Suburbs',     level: 2,  pop: 2600, elas: 3.2, rent: 0.9, wage: 85,  youth: 0.8, traffic: 0.9, online: 0.25, wk: 0.9,  we: 1.3,  season: [1, 1.05, 1, 1.05],
    prefs: { food: .12, coffee: .12, burgers: .20, fashion: .05, gadgets: .03, games: .05, ai: .02 } },
  harbor:     { name: 'Harbor',      level: 3,  pop: 2000, elas: 2.4, rent: 1.2, wage: 90,  youth: 0.8, traffic: 1.1, online: -0.2, wk: 0.9,  we: 1.4,  season: [1, 1.5, 0.95, 0.7],
    prefs: { food: .30, coffee: .14, burgers: .16, fashion: .03, gadgets: .01, games: .01, ai: .01 } },
  oldtown:    { name: 'Old Town',    level: 4,  pop: 1800, elas: 2.3, rent: 1.4, wage: 95,  youth: 0.7, traffic: 1.0, online: -0.2, wk: 0.9,  we: 1.4,  season: [1.1, 1.2, 1, 0.9],
    prefs: { food: .16, coffee: .26, burgers: .08, fashion: .08, gadgets: .01, games: .02, ai: .01 } },
  techpark:   { name: 'Tech Park',   level: 5,  pop: 1600, elas: 2.0, rent: 1.8, wage: 120, youth: 1.2, traffic: 1.0, online: 0.4,  wk: 1.2,  we: 0.45, season: [1, 1, 1.05, 1],
    prefs: { food: .14, coffee: .34, burgers: .10, fashion: .02, gadgets: .07, games: .04, ai: .08 } },
  mall:       { name: 'Mall',        level: 6,  pop: 2400, elas: 2.9, rent: 1.5, wage: 90,  youth: 1.1, traffic: 1.3, online: 0.1,  wk: 0.9,  we: 1.5,  season: [1, 0.95, 1, 1.2],
    prefs: { food: .10, coffee: .10, burgers: .16, fashion: .12, gadgets: .06, games: .07, ai: .02 } },
  airport:    { name: 'Airport',     level: 7,  pop: 1500, elas: 1.7, rent: 2.5, wage: 110, youth: 0.6, traffic: 1.2, online: -0.3, wk: 1,    we: 1.1,  season: [1, 1.25, 0.95, 1.1],
    prefs: { food: .24, coffee: .30, burgers: .14, fashion: .04, gadgets: .04, games: .02, ai: .02 } },
  tokyo:      { name: 'Neo Tokyo',   level: 10, pop: 6000, elas: 2.4, rent: 3.0, wage: 140, youth: 1.3, traffic: 1.5, online: 0.4,  wk: 1.05, we: 0.9,  season: [1.1, 1, 1, 1.05], overseas: true,
    prefs: { food: .18, coffee: .20, burgers: .10, fashion: .08, gadgets: .08, games: .09, ai: .06 } },
  paris:      { name: 'Paris',       level: 10, pop: 4500, elas: 2.2, rent: 2.8, wage: 130, youth: 1.0, traffic: 1.4, online: 0.0,  wk: 1,    we: 1.15, season: [1.15, 1.1, 1, 0.95], overseas: true,
    prefs: { food: .16, coffee: .30, burgers: .06, fashion: .14, gadgets: .03, games: .03, ai: .03 } },
  newyork:    { name: 'New York',    level: 10, pop: 6500, elas: 2.5, rent: 3.2, wage: 150, youth: 1.1, traffic: 1.6, online: 0.2,  wk: 1.05, we: 0.95, season: [1, 1, 1, 1.15], overseas: true,
    prefs: { food: .20, coffee: .26, burgers: .16, fashion: .09, gadgets: .05, games: .05, ai: .05 } },
  moon:       { name: 'Moon Colony', level: 12, pop: 700,  elas: 1.4, rent: 6.0, wage: 400, youth: 1.0, traffic: 1.0, online: 0.5,  wk: 1,    we: 1,    season: [1, 1, 1, 1], overseas: true, needs: 'spacehotel',
    prefs: { food: .20, coffee: .25, burgers: .15, fashion: .10, gadgets: .15, games: .15, ai: .15 } },
};
const DISTRICT_IDS = Object.keys(DISTRICTS);

// Customers may walk to a neighbouring district if you have no store in theirs.
const ADJ = {
  downtown: ['oldtown', 'techpark', 'mall', 'university'],
  university: ['oldtown', 'downtown', 'mall', 'harbor'],
  oldtown: ['downtown', 'university'],
  techpark: ['downtown', 'suburbs', 'airport'],
  mall: ['downtown', 'university', 'suburbs', 'harbor'],
  suburbs: ['techpark', 'mall', 'harbor', 'airport'],
  harbor: ['university', 'mall', 'suburbs'],
  airport: ['techpark', 'suburbs'],
  tokyo: [], paris: [], newyork: [], moon: [],
};

// ── product categories ───────────────────────────────────────────────────────
// ref     the "fair" market price (price utility is measured against it)
// cost    unit cost when you order stock        spoil  fraction of stock lost per day
// serve   store capacity used per customer      launch cost to launch the line mid-year
// online  can be sold by the online store       onlineOnly: only online (digital)
// cart    a food cart can sell it               season [spring, summer, autumn, winter]
const CATEGORIES = {
  food:    { name: 'Street Food', level: 1, ref: 6,   cost: 2.4, spoil: 0.30, serve: 1.0, launch: 1500,   online: false, cart: true,  season: [1.0, 1.25, 1.0, 0.8] },
  coffee:  { name: 'Coffee',      level: 2, ref: 4,   cost: 1.1, spoil: 0.06, serve: 0.7, launch: 2500,   online: false, cart: true,  season: [1.0, 0.8, 1.1, 1.3] },
  burgers: { name: 'Burgers',     level: 3, ref: 11,  cost: 4.6, spoil: 0.30, serve: 1.3, launch: 8000,   online: false, cart: false, season: [1.0, 1.15, 1.0, 0.95] },
  fashion: { name: 'Fashion',     level: 4, ref: 45,  cost: 17,  spoil: 0.01, serve: 2.2, launch: 25000,  online: true,  cart: false, season: [1.2, 0.9, 1.2, 1.05] },
  gadgets: { name: 'Gadgets',     level: 5, ref: 160, cost: 92,  spoil: 0.004, serve: 3.0, launch: 70000, online: true,  cart: false, season: [0.9, 0.9, 1.0, 1.3] },
  games:   { name: 'Games',       level: 6, ref: 50,  cost: 17,  spoil: 0.003, serve: 1.4, launch: 60000, online: true,  cart: false, season: [0.9, 0.8, 1.0, 1.4], onlineBonus: 0.5 },
  ai:      { name: 'AI Apps',     level: 8, ref: 20,  cost: 1.5, spoil: 0,    serve: 0.2, launch: 200000, online: true,  cart: false, season: [1, 1, 1, 1], onlineOnly: true, onlineBonus: 1.1 },
};
const CATEGORY_IDS = Object.keys(CATEGORIES);
const LINE_OVERHEAD = (c) => Math.round(5 + CATEGORIES[c].launch * 0.003);   // $/day to carry a product line

// ── stores ───────────────────────────────────────────────────────────────────
// cap       customers (capacity units) per day at full staff    staffMax / perStaff
// build     cost to build ($, × district build factor)          rent $/day (× district rent)
// days      construction time                                   presence  utility bonus in its district
// aw        brand awareness the storefront adds per day          quality   perceived quality bonus
const TIERS = {
  cart:      { name: 'Food Cart',    level: 1, cap: 150,  staffMax: 2,  perStaff: 75,  build: 1500,   rent: 15,  days: 1,  presence: 0.0,  aw: 0.004, quality: 0,    rank: 1 },
  shop:      { name: 'Shop',         level: 2, cap: 480,  staffMax: 6,  perStaff: 80,  build: 9000,   rent: 55,  days: 3,  presence: 0.35, aw: 0.008, quality: 0.03, rank: 2 },
  flagship:  { name: 'Flagship',     level: 4, cap: 1400, staffMax: 16, perStaff: 88,  build: 45000,  rent: 190, days: 6,  presence: 0.7,  aw: 0.02,  quality: 0.08, rank: 3 },
  megastore: { name: 'Megastore',    level: 7, cap: 3600, staffMax: 38, perStaff: 95,  build: 180000, rent: 500, days: 10, presence: 1.0,  aw: 0.035, quality: 0.1,  rank: 4 },
  online:    { name: 'Online Store', level: 6, cap: 3000, staffMax: 20, perStaff: 150, build: 40000,  rent: 90,  days: 5,  presence: -1.0, aw: 0,     quality: 0,    rank: 0 },
};
const TIER_ORDER = ['cart', 'shop', 'flagship', 'megastore'];
const MAX_STORES_PER_DISTRICT = 4;     // per company (franchises included)
const RESALE = 0.6;                    // a store is worth 60% of what it cost (net worth, closing refund)
const TRAVEL_PENALTY = 0.9;            // utility lost by walking to a neighbouring district
const MEGASTORE_REACH_PENALTY = 0.35;  // ...only this much when the neighbour store is a megastore
const HIRE_COST = 40;                  // per new hire
const SEVERANCE_DAYS = 2;              // wages paid when you let someone go
const buildFactor = (d) => 0.5 + 0.5 * DISTRICTS[d].rent;
function buildCost(tier, district) {
  const t = TIERS[tier];
  if (!t) return 0;
  return Math.round(t.build * (district ? buildFactor(district) : 1));
}
function rentOf(tier, district) {
  const t = TIERS[tier];
  return t.rent * (district ? DISTRICTS[district].rent : 1);
}
function wageOf(district) { return district ? DISTRICTS[district].wage : 100; }

// ── marketing ────────────────────────────────────────────────────────────────
// Awareness in a district grows by  gain × weight × (1 − e^(−spend/scale)) × (1 − awareness)  per day
// and fades by AW_DECAY × awareness per day.
const CHANNELS = {
  flyers:      { name: 'Flyers',          level: 1,  scale: 50,    gain: 0.05,  reach: 'local' },
  social:      { name: 'Social Media',    level: 2,  scale: 220,   gain: 0.04,  reach: 'youth' },
  billboards:  { name: 'Billboards',      level: 4,  scale: 700,   gain: 0.045, reach: 'traffic' },
  influencers: { name: 'Influencers',     level: 5,  scale: 1500,  gain: 0.05,  reach: 'youth', rep: 0.03 },
  tv:          { name: 'TV Ads',          level: 6,  scale: 4000,  gain: 0.07,  reach: 'all' },
  search:      { name: 'Search Ads',      level: 8,  scale: 2500,  gain: 0.02,  reach: 'all', online: 0.35 },
  global:      { name: 'Global Campaign', level: 10, scale: 20000, gain: 0.06,  reach: 'global' },
};
const CHANNEL_IDS = Object.keys(CHANNELS);
const AW_DECAY = 0.03;
function channelWeight(ch, d, hasStore, nearStore) {
  const c = CHANNELS[ch], D = DISTRICTS[d];
  switch (c.reach) {
    case 'local': return hasStore ? 1 : nearStore ? 0.3 : 0;
    case 'youth': return D.youth * (D.overseas ? 0.5 : 1);
    case 'traffic': return D.traffic * (D.overseas ? 0.5 : 1);
    case 'global': return D.overseas ? 1.5 : 0.6;
    default: return D.overseas ? 0.6 : 1;
  }
}

// ── the market model (logit choice) ──────────────────────────────────────────
const MODEL = {
  outside: 0.3,          // utility of "buy elsewhere / nothing"
  quality: 1.2,          // × ln(quality)
  brand: 1.6,            // × (awareness − 0.4)
  brandPivot: 0.4,
  rep: 0.9,              // × (reputation − 50) / 50
  multiStore: 0.2,       // × ln(number of your stores in the district)
  stockoutMemory: 0.35,  // utility lost the day after you ran out of a product in a district
  spillover: 0.4,        // share of unserved customers who try the rival instead
  onlineShip: (price) => 1 + 0.04 * price,   // $ per unit shipped
  minPrice: 0.25,        // × ref
  maxPrice: 4,           // × ref
};

// ── money ────────────────────────────────────────────────────────────────────
const MONEY = {
  overdraft: 2000,          // before loans unlock: you may dip this far below $0 (penalty interest)
  loanRate: 0.001,          // per day (~12% for the year)
  penaltyRate: 0.0015,      // per day on emergency (automatic) borrowing / overdraft
  creditBase: [0, 0, 0, 30000, 60000, 120000, 200000, 300000, 450000, 700000, 1200000, 1800000, 2500000],
  creditAssets: 0.5,        // + this × (store value + stock value)
  royalty: 0.10,            // franchise royalty on the franchise store's revenue
  franchiseCap: 0.85,       // franchise stores run a bit leaner
  acquirePremium: 1.5,      // buy a rival store for 1.5 × its build cost (paid to the rival)
  ipoMaxShare: 0.4,
  ipoProfitDays: 60,        // valuation = equity + 60 × average daily profit (last 20 days) × market mood
};

/** Bulk buying: unit costs fall with your average daily volume of a product (10-day average), max 30%. */
function bulkDiscount(dailyUnits) { return Math.min(0.3, 0.07 * Math.log(1 + Math.max(0, dailyUnits) / 150)); }

/** How far below $0 cash may fall before the fire sale / bankruptcy (on top of any credit line). */
function overdraftOf(level) { return Math.max(5000, START_CASH[clampLevel(level)] * 0.05); }

// ── reputation ───────────────────────────────────────────────────────────────
// target = 50 + value x tanh(valueK x v) - service x (lost to empty shelves + half of lost to full stores)/demand
//          + experience x 10 x (average store-tier quality) + influencers;   v = ln(quality) - pricePull x ln(price/fair)
const REP = { start: 50, speed: 0.05, value: 32, valueK: 1.4, pricePull: 0.8, service: 30, capWeight: 0.5, experience: 6 };

// ── R&D ──────────────────────────────────────────────────────────────────────
// quality = 1 + 0.35 × ln(1 + totalSpent / scale),  scale = ref × 400 × (start cash / 10000)^0.75   (per category)
const RND = { k: 0.35, scale: (c, level) => CATEGORIES[c].ref * 400 * Math.pow(START_CASH[clampLevel(level || 1)] / 10000, 0.75) };

// ── moonshots (levels 10–12) ─────────────────────────────────────────────────
const MOONSHOTS = {
  robots:     { name: 'Robot Delivery Fleet', cost: 1200000, text: 'online stores feel local: online penalty 1.0 -> 0.2, free shipping' },
  quantum:    { name: 'Quantum Chip Lab',     cost: 1500000, text: 'quality x1.35 for gadgets, games and AI apps' },
  fusion:     { name: 'Fusion Power',         cost: 1800000, text: 'all unit costs -20%, rent -30%' },
  labfood:    { name: 'Lab-Grown Food',       cost: 900000,  text: 'food + burgers unit cost -40%, quality x1.2' },
  spacehotel: { name: 'Space Hotel',          cost: 2400000, text: '+0.5 brand utility everywhere, +$15k/day tourism income, and (level 12) stores on the Moon' },
};
const MOONSHOT_IDS = Object.keys(MOONSHOTS);
const MOONSHOT_VALUE = 0.5;     // a completed moonshot counts 50% of its cost in net worth
const MOONSHOT_REFUND = 0.5;    // if the rival completes it first you get 50% of what you put in back
const MOONSHOT_MIN_DAYS = 15;   // max funding per day = cost / 15

// ── events (the fixed, pre-announced calendar) ───────────────────────────────
// mods: all (every demand), cat {c: x}, dist {d: x}, walk (store traffic x), online (+utility online),
//       elas (+price sensitivity), cost {c|all: x}, lead (delivery days), rent {d: x}, channel {ch: x}, ipo (market mood)
const EVENT_TYPES = {
  festival:   { name: 'Street Festival',   icon: 'flag',   k: 'good', text: 'street food +30%, Old Town +50%, Harbor +25%', mods: { cat: { food: 1.3 }, dist: { oldtown: 1.5, harbor: 1.25 } } },
  heatwave:   { name: 'Heatwave',          icon: 'sun',    k: 'mixed', text: 'street food +25%, burgers +10%, coffee -30%, Harbor +40%', mods: { cat: { food: 1.25, burgers: 1.1, coffee: 0.7 }, dist: { harbor: 1.4 } } },
  coldsnap:   { name: 'Cold Snap',         icon: 'snow',   k: 'mixed', text: 'coffee +40%, street food -20%, store traffic -10%', mods: { cat: { coffee: 1.4, food: 0.8 }, walk: 0.9 } },
  rain:       { name: 'Rainy Week',        icon: 'rain',   k: 'bad',  text: 'store traffic -20%, online shopping +0.4 utility', mods: { walk: 0.8, online: 0.4 } },
  school:     { name: 'Back to School',    icon: 'book',   k: 'good', text: 'University +50%; coffee +20%, fashion +20%, gadgets +30%', mods: { dist: { university: 1.5 }, cat: { coffee: 1.2, fashion: 1.2, gadgets: 1.3 } } },
  techboom:   { name: 'Tech Boom',         icon: 'chip',   k: 'good', text: 'gadgets +60%, AI apps +60%, games +20%, Tech Park +30%', mods: { cat: { gadgets: 1.6, ai: 1.6, games: 1.2 }, dist: { techpark: 1.3 } } },
  recession:  { name: 'Recession',         icon: 'down',   k: 'bad',  text: 'all demand -20%, shoppers much more price-sensitive (+0.8)', mods: { all: 0.8, elas: 0.8, ipo: 0.8 } },
  shortage:   { name: 'Supply Shortage',   icon: 'truck',  k: 'bad',  text: 'unit costs +50%, deliveries take 3 days', mods: { cost: { all: 1.5 }, lead: 3 } },
  holiday:    { name: 'Holiday Rush',      icon: 'gift',   k: 'good', text: 'fashion +70%, gadgets +80%, games +100%, coffee +10%, Mall +30%', mods: { cat: { fashion: 1.7, gadgets: 1.8, games: 2.0, coffee: 1.1 }, dist: { mall: 1.3 } } },
  winterfair: { name: 'Winter Fair',       icon: 'gift',   k: 'good', text: 'coffee +30%, street food +20%, burgers +20%, Downtown +15%', mods: { cat: { coffee: 1.3, food: 1.2, burgers: 1.2 }, dist: { downtown: 1.15 } } },
  marathon:   { name: 'City Marathon',     icon: 'flag',   k: 'good', text: 'Downtown +30%, Harbor +30%; food and coffee +20%', mods: { dist: { downtown: 1.3, harbor: 1.3 }, cat: { food: 1.2, coffee: 1.2 } } },
  renthike:   { name: 'Rent Hike',         icon: 'down',   k: 'bad',  text: 'rent x1.6 in Downtown, Tech Park and Old Town', mods: { rent: { downtown: 1.6, techpark: 1.6, oldtown: 1.6 } } },
  viral:      { name: 'Viral Trend',       icon: 'heart',  k: 'good', text: 'social media and influencers twice as effective', mods: { channel: { social: 2, influencers: 2 } } },
  tourists:   { name: 'Tourist Season',    icon: 'plane',  k: 'good', text: 'Harbor, Old Town and Airport +40%', mods: { dist: { harbor: 1.4, oldtown: 1.4, airport: 1.4 } } },
  bull:       { name: 'Bull Market',       icon: 'up',     k: 'good', text: 'IPO valuations x1.5, all demand +5%', mods: { ipo: 1.5, all: 1.05 } },
  crash:      { name: 'Market Crash',      icon: 'down',   k: 'bad',  text: 'IPO valuations x0.6, all demand -10%', mods: { ipo: 0.6, all: 0.9 } },
  concert:    { name: 'Stadium Concert',   icon: 'note',   k: 'good', text: 'Suburbs +60%, burgers +20%', mods: { dist: { suburbs: 1.6 }, cat: { burgers: 1.2 } } },
  gameexpo:   { name: 'Game Expo',         icon: 'pad',    k: 'good', text: 'games +80%, gadgets +20%', mods: { cat: { games: 1.8, gadgets: 1.2 } } },
  fashionwk:  { name: 'Fashion Week',      icon: 'star',   k: 'good', text: 'fashion +80%, Old Town +20%, Paris +50%', mods: { cat: { fashion: 1.8 }, dist: { oldtown: 1.2, paris: 1.5 } } },
  phonelaunch:{ name: 'Phone Launch Day',  icon: 'chip',   k: 'good', text: 'gadgets x2', mods: { cat: { gadgets: 2.0 } } },
  strike:     { name: 'Transit Strike',    icon: 'down',   k: 'bad',  text: 'store traffic -30%, Downtown -30% more, online +0.3', mods: { walk: 0.7, online: 0.3, dist: { downtown: 0.7 } } },
  worldcup:   { name: 'World Cup',         icon: 'ball',   k: 'good', text: 'food +30%, burgers +40%, games +20%, all overseas cities +20%', mods: { cat: { food: 1.3, burgers: 1.4, games: 1.2 }, dist: { tokyo: 1.2, paris: 1.2, newyork: 1.2 } } },
  aiwave:     { name: 'AI Hype Wave',      icon: 'chip',   k: 'good', text: 'AI apps x2, Tech Park +20%', mods: { cat: { ai: 2.0 }, dist: { techpark: 1.2 } } },
  solar:      { name: 'Solar Storm',       icon: 'sun',    k: 'bad',  text: 'online stores capped at 50% capacity; gadgets -20%', mods: { onlineCap: 0.5, cat: { gadgets: 0.8 } } },
};

// Each level has its own fixed calendar: [type, firstDay, lastDay]
const CALENDARS = {
  1:  [['festival', 12, 16], ['heatwave', 38, 46], ['school', 61, 68], ['rain', 79, 84], ['coldsnap', 95, 101], ['winterfair', 110, 118]],
  2:  [['marathon', 8, 10], ['rain', 24, 29], ['heatwave', 44, 52], ['school', 62, 68], ['recession', 74, 86], ['coldsnap', 98, 104], ['winterfair', 111, 118]],
  3:  [['festival', 10, 14], ['shortage', 30, 35], ['heatwave', 40, 48], ['tourists', 50, 58], ['school', 62, 67], ['rain', 84, 90], ['winterfair', 108, 118]],
  4:  [['fashionwk', 14, 20], ['heatwave', 35, 42], ['renthike', 50, 70], ['school', 61, 67], ['recession', 76, 88], ['fashionwk', 92, 96], ['holiday', 104, 118]],
  5:  [['viral', 6, 14], ['techboom', 22, 34], ['heatwave', 41, 48], ['phonelaunch', 64, 66], ['shortage', 78, 84], ['coldsnap', 92, 98], ['holiday', 103, 118]],
  6:  [['gameexpo', 16, 22], ['rain', 30, 36], ['tourists', 40, 56], ['school', 61, 67], ['strike', 80, 86], ['holiday', 100, 118]],
  7:  [['marathon', 5, 7], ['tourists', 35, 55], ['heatwave', 44, 50], ['recession', 66, 80], ['fashionwk', 88, 93], ['holiday', 101, 118]],
  8:  [['aiwave', 10, 20], ['viral', 28, 34], ['techboom', 48, 60], ['shortage', 70, 76], ['phonelaunch', 90, 92], ['holiday', 102, 118]],
  9:  [['bull', 1, 25], ['techboom', 30, 42], ['crash', 50, 64], ['heatwave', 45, 52], ['bull', 80, 100], ['holiday', 104, 118]],
  10: [['worldcup', 20, 34], ['fashionwk', 40, 45], ['bull', 50, 70], ['solar', 75, 79], ['recession', 84, 94], ['holiday', 102, 118]],
  11: [['aiwave', 5, 15], ['crash', 20, 30], ['tourists', 36, 56], ['gameexpo', 60, 66], ['bull', 70, 95], ['strike', 96, 100], ['holiday', 103, 118]],
  12: [['techboom', 1, 14], ['viral', 18, 26], ['worldcup', 40, 54], ['bull', 56, 80], ['shortage', 84, 90], ['aiwave', 92, 100], ['holiday', 101, 118]],
};

// ── levels ───────────────────────────────────────────────────────────────────
const MAX_LEVEL = 12;
const START_CASH = [0, 10000, 25000, 50000, 100000, 200000, 350000, 500000, 750000, 1000000, 2000000, 3000000, 5000000];
const FEATURES = {
  loans: 3, rnd: 3, districtPrices: 4, online: 6, franchise: 7, acquire: 8, ipo: 9, moonshots: 10,
};
const FRANCHISE_MAX = (level) => (level >= 7 ? 2 + (level - 7) * 2 : 0);   // 2, 4, 6 ... franchise stores
const ACQUIRE_COOLDOWN = (level) => (level >= 11 ? 7 : 15);
const MOONSHOT_SLOTS = (level) => (level >= 12 ? 3 : level >= 11 ? 2 : level >= 10 ? 1 : 0);

function clampLevel(level) { return Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(level) || 1))); }
function unlockedDistricts(level) { level = clampLevel(level); return DISTRICT_IDS.filter(d => DISTRICTS[d].level <= level); }
function unlockedCategories(level) { level = clampLevel(level); return CATEGORY_IDS.filter(c => CATEGORIES[c].level <= level); }
function unlockedTiers(level) { level = clampLevel(level); return Object.keys(TIERS).filter(t => TIERS[t].level <= level); }
function unlockedChannels(level) { level = clampLevel(level); return CHANNEL_IDS.filter(c => CHANNELS[c].level <= level); }
function has(level, feature) { return clampLevel(level) >= FEATURES[feature]; }
function startTier(level) { return clampLevel(level) >= 2 ? 'shop' : 'cart'; }

function calendarFor(level) {
  level = clampLevel(level);
  return (CALENDARS[level] || []).map(([type, from, to], i) => {
    const T = EVENT_TYPES[type];
    return { id: `${type}-${from}`, type, name: T.name, icon: T.icon, kind: T.k, from, to, text: T.text, mods: T.mods, n: i };
  });
}

// ── time helpers ─────────────────────────────────────────────────────────────
function seasonIndex(day) { return Math.min(3, Math.floor((day - 1) / 30)); }
/** Smooth seasonal multiplier: interpolates between the season centres (days 15, 45, 75, 105). */
function seasonal(arr, day) {
  const x = (day - 15) / 30;               // 0 at spring centre
  const i = Math.floor(x), f = x - i;
  const a = arr[((i % 4) + 4) % 4], b = arr[(((i + 1) % 4) + 4) % 4];
  return a + (b - a) * f;
}
function weekdayOf(day) { return (day - 1) % 7; }                  // day 1 = Monday
function isWeekend(day) { return weekdayOf(day) >= 5; }

/** Everything the calendar does on one day, merged. */
function eventMods(level, day) {
  const out = { all: 1, cat: {}, dist: {}, walk: 1, online: 0, elas: 0, cost: {}, lead: 1, rent: {}, channel: {}, ipo: 1, onlineCap: 1, active: [] };
  for (const ev of calendarFor(level)) {
    if (day < ev.from || day > ev.to) continue;
    out.active.push(ev);
    const m = ev.mods;
    if (m.all) out.all *= m.all;
    if (m.walk) out.walk *= m.walk;
    if (m.online) out.online += m.online;
    if (m.elas) out.elas += m.elas;
    if (m.lead) out.lead = Math.max(out.lead, m.lead);
    if (m.ipo) out.ipo *= m.ipo;
    if (m.onlineCap) out.onlineCap *= m.onlineCap;
    for (const k of ['cat', 'dist', 'cost', 'rent', 'channel']) if (m[k]) for (const [a, v] of Object.entries(m[k])) out[k][a] = (out[k][a] || 1) * v;
  }
  return out;
}

/** Shoppers in district d who want category c on this day (before anyone's prices or brands). */
function potential(level, d, c, day, mods) {
  const D = DISTRICTS[d], C = CATEGORIES[c];
  if (!D || !C) return 0;
  const m = mods || eventMods(level, day);
  const wk = isWeekend(day) ? D.we : D.wk;
  return D.pop * (D.prefs[c] || 0) * seasonal(C.season, day) * seasonal(D.season, day) * wk * m.all * (m.cat[c] || 1) * (m.dist[d] || 1);
}

function levelInfo(level) {
  level = clampLevel(level);
  const ds = unlockedDistricts(level).filter(d => !DISTRICTS[d].needs);
  const cs = unlockedCategories(level);
  const lines = [
    `Start: $${START_CASH[level].toLocaleString('en-US')} cash + a free ${TIERS[startTier(level)].name.toLowerCase()} in your HQ district`,
    `Districts: ${ds.map(d => DISTRICTS[d].name).join(', ')}${level >= 12 ? ' (+ Moon Colony with the Space Hotel)' : ''}`,
    `Products: ${cs.map(c => CATEGORIES[c].name).join(', ')}`,
    `Stores: ${unlockedTiers(level).map(t => TIERS[t].name).join(', ')}`,
    `Marketing: ${unlockedChannels(level).map(c => CHANNELS[c].name).join(', ')}`,
  ];
  const feats = [];
  if (has(level, 'loans')) feats.push('loans + R&D');
  if (has(level, 'districtPrices')) feats.push('district prices');
  if (has(level, 'franchise')) feats.push(`franchising (${FRANCHISE_MAX(level)})`);
  if (has(level, 'acquire')) feats.push('acquisitions');
  if (has(level, 'ipo')) feats.push('IPO');
  if (has(level, 'moonshots')) feats.push(`moonshots (${MOONSHOT_SLOTS(level)} at a time)`);
  if (feats.length) lines.push(`Powers: ${feats.join(', ')}`);
  lines.push(`Calendar: ${calendarFor(level).map(e => `${e.name} d${e.from}-${e.to}`).join(', ')}`);
  const tag = level >= 10 ? 'MEGACORP' : level >= 7 ? 'Empire' : level >= 4 ? 'Chain' : 'Startup';
  return { level, headline: `${tag} · $${fmtShort(START_CASH[level])} start · ${ds.length} districts · ${cs.length} product${cs.length > 1 ? 's' : ''}`, lines };
}

function levelUnlocks(level) {
  level = clampLevel(level);
  const out = [];
  for (const d of DISTRICT_IDS) if (DISTRICTS[d].level === level) out.push(`district: ${DISTRICTS[d].name}${DISTRICTS[d].needs ? ' (needs the Space Hotel moonshot)' : ''}`);
  for (const c of CATEGORY_IDS) if (CATEGORIES[c].level === level) out.push(`product: ${CATEGORIES[c].name}`);
  for (const t of Object.keys(TIERS)) if (TIERS[t].level === level) out.push(`store: ${TIERS[t].name}`);
  for (const c of CHANNEL_IDS) if (CHANNELS[c].level === level) out.push(`marketing: ${CHANNELS[c].name}`);
  if (level === 3) out.push('bank loans (borrow / repay)', 'R&D: invest to raise product quality');
  if (level === 4) out.push('district prices: a different price per district');
  if (level === 7) out.push('franchising: partners open stores under your brand (10% royalty)');
  if (level === 8) out.push('acquisitions: buy one of the rival\'s stores (1.5x its build cost)');
  if (level === 9) out.push('IPO: sell up to 40% of your company on the stock market');
  if (level === 10) out.push('GLOBAL EXPANSION: Neo Tokyo, Paris, New York', 'MOONSHOTS: race the rival to world-changing projects');
  if (level === 11) out.push('2 moonshots at once; hostile takeovers every 7 days (any store)');
  if (level === 12) out.push('MEGACORP: 3 moonshots at once; the Moon Colony opens for Space Hotel owners');
  out.push(`starting cash $${fmtShort(START_CASH[level])}`);
  return out;
}

function fmtShort(v) {
  const a = Math.abs(v), s = v < 0 ? '-' : '';
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e4) return `${s}${Math.round(a / 1e3)}k`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(1)}k`;
  return `${s}${Math.round(a)}`;
}

module.exports = {
  DAYS, DAY_SEC, SEASONS, WEEKDAYS, LIMITS,
  DISTRICTS, DISTRICT_IDS, ADJ, CATEGORIES, CATEGORY_IDS, LINE_OVERHEAD,
  TIERS, TIER_ORDER, MAX_STORES_PER_DISTRICT, RESALE, TRAVEL_PENALTY, MEGASTORE_REACH_PENALTY, HIRE_COST, SEVERANCE_DAYS,
  buildCost, rentOf, wageOf, buildFactor,
  CHANNELS, CHANNEL_IDS, AW_DECAY, channelWeight,
  MODEL, MONEY, REP, RND, MOONSHOTS, MOONSHOT_IDS, MOONSHOT_VALUE, MOONSHOT_REFUND, MOONSHOT_MIN_DAYS,
  EVENT_TYPES, CALENDARS, calendarFor, eventMods, potential,
  MAX_LEVEL, START_CASH, FEATURES, FRANCHISE_MAX, ACQUIRE_COOLDOWN, MOONSHOT_SLOTS,
  clampLevel, unlockedDistricts, unlockedCategories, unlockedTiers, unlockedChannels, has, startTier, overdraftOf, bulkDiscount,
  seasonIndex, seasonal, weekdayOf, isWeekend, levelInfo, levelUnlocks, fmtShort,
};
