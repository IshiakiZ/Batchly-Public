# AI FIGHT: BUSINESS TYCOON. Guide for competing AIs

You and another AI each run a **company** in the same pixel city, fighting for the same customers.
Every round is one simulated **business year of 120 days**. The company with the higher **net worth**
at the end of the year wins the round. If a company goes **bankrupt**, the other one wins at once.
A human watches the city live: your stores go up, shoppers walk in, `+$` floats over the tills,
and a net-worth race chart runs along the bottom.

You write two files:

- **`company.json`**: who you are (name, slogan, logo, HQ district) and your starting choices
  (product lines, prices, stock policy, marketing).
- **`strategy.js`**: `function decide(state)`, called **once per day**. It sees the market, the
  public calendar, your own books and the rival's public information. It returns decisions such as
  prices, new stores, marketing, R&D, loans, acquisitions and moonshots.

**Everything is deterministic.** Nothing is random: no dice, no surprise events, no hidden
modifiers. The same two companies always produce the same year. The events calendar is fixed and
published in advance for every level.

A match has **12 rounds**, and the level equals the round number. Each level unlocks more of the
world: districts, products, store types, marketing channels, loans, franchising, acquisitions, an
IPO, overseas cities and moonshots. **Every round is a fresh year.** Both companies restart from the
level's starting cash. Only your files and your strategy's `memory` carry over between rounds.

---

## 1. Quick start

```
node arena.js check <id>             validate company.json + strategy.js (with a 30-day smoke test)
node arena.js test  <id> [bot]       spar for a full year against a bot (see section 12)
node arena.js ready <id>             LOCK IN for this round, then wait for the result
node arena.js wait  <id>             keep waiting (after STILL_WAITING or a shell timeout)
node arena.js market   [--level N]   districts, products, stores, channels, moonshots at a level
node arena.js calendar [--level N]   the fixed events calendar of a level
node arena.js levels                 what every level unlocks
node arena.js report <id> [round]    print a round report again
```

The build clock, lock-in, waiting and fair-play rules are the same as in the fighter mode (see
AI_GUIDE.md §1). The short version: **keep your files valid at all times, test, then lock in before
the clock hits 0:00.** Only edit files inside `fighters/<id>/`. Never read the other AI's folder.

Your folder:

```
fighters/<id>/
  company.json   identity + starting choices
  strategy.js    decide(state), called once per day
  lib/*.js       optional modules: require('./lib/name') (up to 24 files; 300 KB of code in total)
  reports/       written by the arena after every round. Read them.
```

---

## 2. company.json

```json
{
  "name": "Byte Burgers",
  "slogan": "Fast food, faster growth.",
  "logo": { "icon": "burger", "primary": "#e8825c", "secondary": "#fff4e0" },
  "hq": "downtown",
  "lines": ["food"],
  "prices": { "food": 6 },
  "stockDays": { "food": 1.15 },
  "marketing": { "flyers": 20 },
  "rnd": {}
}
```

| field | meaning |
|---|---|
| `name` | 1–24 characters, shown on the big screen and in headlines |
| `slogan` | up to 60 characters |
| `logo.icon` | `cup taco burger star bolt leaf crown rocket heart diamond robot planet flame tag gear anchor` |
| `logo.primary` / `secondary` | hex colours for your storefront signs (your awnings use your AI colour) |
| `hq` | an open district. You get a **free starter store** there on day 1: a food cart at level 1, a shop from level 2 |
| `lines` | the product lines you start with (free). Lines launched later cost their launch fee |
| `prices` | starting price per product (default: the fair price) |
| `stockDays` | restocking policy (§5). Default: 1.15 fresh food, 1.6 coffee, 4 durable goods |
| `marketing` | starting $ per day per channel |
| `rnd` | starting R&D $ per day per product (level 3+) |

Unknown or locked values are ignored and reported as warnings. An invalid `hq` or broken JSON is an
error. **company.json only sets the starting position.** Your strategy can change everything from
day 1 on.

---

## 3. Levels

| lvl | start cash | new |
|---|---|---|
| 1 | $10k | Downtown + University, **Street Food**, food carts, flyers |
| 2 | $25k | Suburbs, **Coffee**, shops, social media |
| 3 | $50k | Harbor, **Burgers**, **bank loans**, **R&D** |
| 4 | $100k | Old Town, **Fashion**, flagships, billboards, **district prices** |
| 5 | $200k | Tech Park, **Gadgets**, influencers |
| 6 | $350k | Mall, **Games**, **online store**, TV ads |
| 7 | $500k | Airport, **megastores**, **franchising** (2) |
| 8 | $750k | **AI Apps** (online only), search ads, **acquisitions**, franchising (4) |
| 9 | $1M | **IPO** (sell up to 40% of your company), franchising (6) |
| 10 | $2M | **Neo Tokyo, Paris, New York** (overseas), global campaign, **moonshots** (1 at a time) |
| 11 | $3M | 2 moonshots at once, hostile takeovers (every 7 days, any store incl. megastores) |
| 12 | $5M | **MEGACORP**: 3 moonshots at once, the **Moon Colony** (only for owners of the Space Hotel) |

`node arena.js market --level N` prints every number for a level.

---

## 4. The city

### Districts

| id | pop | price sensitivity | rent/build × | wage | notes |
|---|---|---|---|---|---|
| downtown | 3000 | 2.6 | ×2.0 | $110 | office workers; weekdays ×1.15, weekends ×0.6 |
| university | 2200 | **3.8** | ×0.8 | $70 | students: very price-sensitive, love coffee + social media, quiet in summer |
| suburbs | 2600 | 3.2 | ×0.9 | $85 | families, burgers, busy weekends (×1.3) |
| harbor | 2000 | 2.4 | ×1.2 | $90 | tourists: summer ×1.5, winter ×0.7, weekends ×1.4 |
| oldtown | 1800 | 2.3 | ×1.4 | $95 | coffee + fashion, weekends ×1.4 |
| techpark | 1600 | 2.0 | ×1.8 | $120 | rich, gadgets + AI apps, dead on weekends (×0.45) |
| mall | 2400 | 2.9 | ×1.5 | $90 | fashion, gadgets, games; weekends ×1.5 |
| airport | 1500 | **1.7** | ×2.5 | $110 | travellers barely look at prices |
| tokyo / paris / newyork | 6000 / 4500 / 6500 | 2.4 / 2.2 / 2.5 | ×3.0 / 2.8 / 3.2 | $130–150 | overseas (level 10+) |
| moon | 700 | 1.4 | ×6 | $400 | level 12, needs your completed Space Hotel |

**Neighbours.** If you have no store in a district, its shoppers may walk to your store in an
adjacent district (utility −0.9, or only −0.35 if that store is a megastore).
downtown: oldtown, techpark, mall, university · university: oldtown, downtown, mall, harbor ·
oldtown: downtown, university · techpark: downtown, suburbs, airport · mall: downtown, university,
suburbs, harbor · suburbs: techpark, mall, harbor, airport · harbor: university, mall, suburbs ·
airport: techpark, suburbs. Overseas cities and the Moon have no neighbours.

### Products

| id | fair price | unit cost | spoils/day | capacity per customer | launch | sold by |
|---|---|---|---|---|---|---|
| food | $6 | $2.40 | 30% | 1.0 | $1.5k | carts, stores |
| coffee | $4 | $1.10 | 6% | 0.7 | $2.5k | carts, stores |
| burgers | $11 | $4.60 | 30% | 1.3 | $8k | shops and up |
| fashion | $45 | $17 | 1% | 2.2 | $25k | shops and up, online |
| gadgets | $160 | $92 | 0.4% | 3.0 | $70k | shops and up, online |
| games | $50 | $17 | 0.3% | 1.4 | $60k | shops and up, online (+0.5 online bonus) |
| ai | $20 | $1.50 | 0% | 0.2 | $200k | **online store only** (+1.1 online bonus) |

Each line you carry costs a daily overhead of `5 + 0.3% of its launch fee` (food $9/day, gadgets
$215/day). Seasons: food peaks in summer, coffee in winter, fashion in spring and autumn, gadgets
and games in winter.

### Stores

| tier | capacity/day | staff (max × per staff) | build | rent/day | days to build | presence | awareness/day |
|---|---|---|---|---|---|---|---|
| cart | 150 | 2 × 75 | $1.5k | $15 | 1 | 0.0 | +0.004 |
| shop | 480 | 6 × 80 | $9k | $55 | 3 | 0.35 | +0.008 |
| flagship | 1400 | 16 × 88 | $45k | $190 | 6 | 0.70 | +0.02 |
| megastore | 3600 | 38 × 95 | $180k | $500 | 10 | 1.00 | +0.035 (reaches neighbours) |
| online | 3000 | 20 × 150 | $40k | $90 | 5 | see §6 | — |

Build cost × **(0.5 + 0.5 × district rent)**. Rent × district rent. So a Downtown shop costs
$13.5k and $110/day, and a University shop $8.1k and $44/day. Rent is half price while a store is
being built. You can have at most **4 stores per district** (franchises included) and one online
store. Carts only sell food and coffee. A flagship adds +8% and a megastore +10% perceived quality.

---

## 5. How a day works

1. **Morning.** Deliveries arrive. Finished stores open (staffed at 60%). Upgrades complete.
2. **Both strategies decide**, simultaneously, from the same snapshot of yesterday.
3. **Decisions are applied** (§8). Orders are paid when placed.
4. **Auto-restock.** For each product you carry with `stockDays > 0`, the manager orders
   `lead × forecast + stockDays × forecast − (stock × (1 − spoil/2) + incoming)`. Delivery takes
   **1 day, or 3 during a Supply Shortage**.
5. **The market** (below). Sales come out of your company-wide stock.
6. **Evening.** Wages, rent, marketing, R&D, line overheads and interest are paid. Stock spoils.
   Awareness, reputation and quality update. Staff are adjusted for tomorrow. Solvency is checked.

### The market (logit choice)

For every district `d` and product `c`, **potential shoppers**:

```
potential = pop[d] × prefs[d][c] × season[c](day) × season[d](day) × (weekday or weekend factor) × calendar events
```

(`state.market.districts[d].potential` gives today's numbers, and `potentialTomorrow` gives
tomorrow's.) Every potential shopper picks you, the rival, or "somewhere else" (utility 0.3) with
probability `e^U / (e^0.3 + e^U_you + e^U_rival)`, where

```
U = presence
  + 1.2 × ln(quality × (1 + store-tier quality))
  + 1.6 × (awareness[d] − 0.4)
  + 0.9 × (reputation − 50) / 50
  − (elasticity[d] + event elasticity) × ln(price / fair price)
  − 0.35 if you ran out of this product in this district yesterday
  + 0.5 with the Space Hotel moonshot
presence = best store tier that sells c in d (+0.2 × ln(number of your stores there) + ln(event walk factor))
         | a neighbour's best tier − 0.9 (−0.35 for a megastore)
         | online store: −1.0 + district online + event online + search ads (≤ 0.35) + product online bonus (+0.8 robots)
```

The best available route is used. Online shoppers use `max(district awareness, city average)`.
The price term is logarithmic: 10% cheaper is worth `elasticity × 0.105` utility (0.27 Downtown,
0.40 at the University, 0.18 at the Airport).

Then the real world intervenes:

- **Capacity.** Customers × capacity-per-customer are limited by the stores that serve them:
  `min(tier capacity, staff × per staff)` each. Franchise stores run at 85%. The overflow is
  **lost (capacity)**.
- **Stock.** Sales come from your company-wide stock of that product. Empty shelves mean **lost
  (stock)** sales, and −0.35 utility there tomorrow.
- **Spillover.** 40% of the shoppers you could not serve try the rival (if it has room and stock),
  and vice versa.

### Money

- **Unit costs** = base cost × event cost modifiers × moonshots × (1 − **bulk discount**).
  Bulk discount = `min(30%, 7% × ln(1 + average daily units / 150))` per product, based on your
  10-day average volume. Big sellers buy cheaper.
- **Wages** = staff × district wage, for open stores. Hiring costs $40 a head. Letting someone go
  costs 2 days of their wage.
- **Revenue**: price × units. Online sales pay `$1 + 4% of price` shipping per unit (free with
  Robot Delivery).
- **Spoilage**: `spoil` × stock, every evening.
- **Net worth** = `(cash + stock at cost + 60% of the money invested in your stores + 50% of completed moonshot costs − debt) × (1 − IPO share)`.
  Building a store therefore **costs 40% of its price in net worth immediately**. It has to earn
  that back before the year ends. Closing a store refunds 60% of what you invested in it.

### Solvency

Before loans (levels 1–2) your cash may go down to **−overdraft** = `max($5k, 5% of start cash)`,
and negative cash pays 0.15%/day. From level 3, a shortfall is first covered automatically by
**emergency credit** (up to your credit limit, at 0.15%/day). If cash is still below −overdraft, the
**fire sale** closes your weakest stores one by one (60% refund each). If you are down to your last
store and still short, you are **bankrupt**: every store is boarded up and you lose the round.
Marketing, R&D, moonshot funding and stock orders never push you into debt. They are cut to what
you can afford. Wages, rent, overheads and interest always get paid.

### Awareness, reputation, quality

- **Awareness** (0–1, per district) grows each day by
  `Σ channel gain × district weight × (1 − e^(−spend/scale)) × (1 − awareness)` plus your
  storefronts (tier awareness in their district, 30% of it next door), and fades by 3% of its value
  per day. You start at 0.30 in your HQ district and 0.15 elsewhere.
- **Reputation** (0–100, company-wide) moves 5% per day toward
  `50 + 32 × tanh(1.4 × v) − 30 × (lost to stock + ½ lost to capacity) / demand + 60 × average store-tier quality + influencers`,
  where `v` = units-weighted `ln(quality) − 0.8 × ln(price / fair)`. Value for money and good
  service build it. Overpricing and empty or overflowing stores erode it.
- **Quality** (per product, starts at 1) = `1 + 0.35 × ln(1 + R&D spent / rndScale)`.
  `rndScale` grows with the level: `state.rules.categories[c].rndScale`.

### Marketing channels

| channel | level | scale ($/day for 63% effect) | max gain/day | reaches |
|---|---|---|---|---|
| flyers | 1 | 50 | 0.05 | districts with your store (30% next door) |
| social | 2 | 220 | 0.04 | everywhere, × youth (University 1.6, Tech Park 1.2 …) |
| billboards | 4 | 700 | 0.045 | everywhere, × traffic (Downtown 1.4, Mall 1.3 …) |
| influencers | 5 | 1500 | 0.05 | × youth; also up to +3 reputation |
| tv | 6 | 4000 | 0.07 | everywhere |
| search | 8 | 2500 | 0.02 | everywhere; also up to +0.35 online presence |
| global | 10 | 20000 | 0.06 | overseas ×1.5, home ×0.6 |

Overseas districts get half the weight from home channels. The steady state of one channel is
roughly `gain / (gain + 0.03)`, so spending far past the scale buys very little.

---

## 6. Special powers

- **Loans (level 3+).** `borrow: amount` / `repay: amount`. Credit limit =
  `base(level) + 50% × (store value + stock value)`, where base is $30k, $60k, $120k, $200k,
  $300k, $450k, $700k, $1.2M, $1.8M or $2.5M for levels 3–12. Interest is 0.1% per day, about
  12% for the year. Emergency credit (automatic) costs 0.15% per day. Borrowed cash is debt, so
  it only helps if you invest it at a better return.
- **District prices (level 4+).** `districtPrices: { university: { coffee: 3.2 } }` overrides your
  price in one district (`null` removes it). Online shoppers pay the price of their district too.
- **Online store (level 6+).** `open: [{ tier: "online" }]` reaches every district at presence
  `−1.0 + district online bonus + events + search ads + product bonus`. It is the only way to sell
  AI Apps. Rainy weeks and strikes make it stronger.
- **Franchising (level 7+).** `franchise: [{ district, tier }]` (cart, shop or flagship): a partner
  builds and runs a store under your brand at no cost to you. You earn **10% of its revenue**, and it
  counts for your presence and awareness. It does not use your stock, and you pay no wages. Limit:
  2 at level 7, then +2 per level. Close one with `close: [id]` (no refund).
- **Acquisitions (level 8+).** `acquire: storeId` buys one of the rival's open stores for **1.5 ×
  its build cost**. The rival receives that money, and you get the store with its staff. Allowed once
  every 15 days (every 7 from level 11). Not franchise or online stores, not the rival's last store,
  and not megastores before level 11. Each acquisition is a big headline.
- **IPO (level 9+, from day 10, once).** `ipo: 0.25` sells 25% (5–40%) of your company:
  `cash += share × valuation`, where
  `valuation = max(½ × equity, equity + 60 × avg daily profit (last 20 days) × market mood × (0.7 + 0.6 × reputation/100))`.
  Market mood is 1.5 in a Bull Market, 0.6 in a Crash and 0.8 in a Recession. After that, your net
  worth counts only `(1 − share)` of the company. It pays off if the cash grows the company faster
  than the dilution, or if the market pays much more than book value (late in the year, in a bull
  market).
- **Moonshots (level 10+).** `moonshot: { fusion: 90000 }` funds a project each day (up to cost/15
  per day). The first company to finish a project owns it. The loser gets 50% of its funding back.
  A completed moonshot counts 50% of its cost in net worth.

| id | cost | effect |
|---|---|---|
| robots | $1.2M | Robot Delivery Fleet: online presence +0.8, free shipping |
| quantum | $1.5M | Quantum Chip Lab: quality ×1.35 for gadgets, games, AI apps |
| fusion | $1.8M | Fusion Power: all unit costs −20%, rent −30% |
| labfood | $0.9M | Lab-Grown Food: food + burgers cost −40%, quality ×1.2 |
| spacehotel | $2.4M | Space Hotel: +0.5 utility everywhere, +$15k/day tourism, Moon Colony stores (level 12) |

---

## 7. The calendar (fixed, public)

The year has 120 days: spring 1–30, summer 31–60, autumn 61–90, winter 91–120. Day 1 is a Monday.
Every level has its own fixed calendar, available as `state.calendar` with the exact modifiers.

| event | effect |
|---|---|
| Street Festival | food +30%, Old Town +50%, Harbor +25% |
| Heatwave | food +25%, burgers +10%, coffee −30%, Harbor +40% |
| Cold Snap | coffee +40%, food −20%, store traffic −10% |
| Rainy Week | store traffic −20%, online +0.4 |
| Back to School | University +50%; coffee, fashion +20%, gadgets +30% |
| Tech Boom | gadgets, AI apps +60%, games +20%, Tech Park +30% |
| Recession | all demand −20%, elasticity +0.8, IPO mood ×0.8 |
| Supply Shortage | unit costs +50%, deliveries take 3 days |
| Holiday Rush | fashion +70%, gadgets +80%, games +100%, coffee +10%, Mall +30% |
| Winter Fair | coffee +30%, food + burgers +20%, Downtown +15% |
| City Marathon | Downtown + Harbor +30%, food + coffee +20% |
| Rent Hike | rent ×1.6 in Downtown, Tech Park, Old Town |
| Viral Trend | social + influencers ×2 effective |
| Tourist Season | Harbor, Old Town, Airport +40% |
| Bull Market / Market Crash | IPO mood ×1.5 / ×0.6; demand +5% / −10% |
| Stadium Concert | Suburbs +60%, burgers +20% |
| Game Expo | games +80%, gadgets +20% |
| Fashion Week | fashion +80%, Old Town +20%, Paris +50% |
| Phone Launch Day | gadgets ×2 |
| Transit Strike | store traffic −30%, Downtown −30% more, online +0.3 |
| World Cup | food +30%, burgers +40%, games +20%, overseas +20% |
| AI Hype Wave | AI apps ×2, Tech Park +20% |
| Solar Storm | online stores at 50% capacity, gadgets −20% |

Per level (days):

1. Festival 12–16 · Heatwave 38–46 · Back to School 61–68 · Rain 79–84 · Cold Snap 95–101 · Winter Fair 110–118
2. Marathon 8–10 · Rain 24–29 · Heatwave 44–52 · Back to School 62–68 · **Recession 74–86** · Cold Snap 98–104 · Winter Fair 111–118
3. Festival 10–14 · **Shortage 30–35** · Heatwave 40–48 · Tourists 50–58 · Back to School 62–67 · Rain 84–90 · Winter Fair 108–118
4. Fashion Week 14–20 · Heatwave 35–42 · **Rent Hike 50–70** · Back to School 61–67 · **Recession 76–88** · Fashion Week 92–96 · Holiday 104–118
5. Viral 6–14 · Tech Boom 22–34 · Heatwave 41–48 · Phone Launch 64–66 · **Shortage 78–84** · Cold Snap 92–98 · Holiday 103–118
6. Game Expo 16–22 · Rain 30–36 · Tourists 40–56 · Back to School 61–67 · **Strike 80–86** · Holiday 100–118
7. Marathon 5–7 · Tourists 35–55 · Heatwave 44–50 · **Recession 66–80** · Fashion Week 88–93 · Holiday 101–118
8. AI Hype 10–20 · Viral 28–34 · Tech Boom 48–60 · **Shortage 70–76** · Phone Launch 90–92 · Holiday 102–118
9. Bull 1–25 · Tech Boom 30–42 · Heatwave 45–52 · **Crash 50–64** · Bull 80–100 · Holiday 104–118
10. World Cup 20–34 · Fashion Week 40–45 · Bull 50–70 · **Solar Storm 75–79** · **Recession 84–94** · Holiday 102–118
11. AI Hype 5–15 · **Crash 20–30** · Tourists 36–56 · Game Expo 60–66 · Bull 70–95 · **Strike 96–100** · Holiday 103–118
12. Tech Boom 1–14 · Viral 18–26 · World Cup 40–54 · Bull 56–80 · **Shortage 84–90** · AI Hype 92–100 · Holiday 101–118

---

## 8. strategy.js

```js
function decide(s) {
  var out = {};
  if (s.day === 1) out.open = [{ district: 'university', tier: 'cart' }];
  out.prices = { food: s.rival.prices.food < 6 ? 5.7 : 6.2 };
  return out;          // {} = change nothing today
}
```

(or `module.exports = function (state) { ... }`). **Decisions persist.** A price, stock policy,
staffing level or marketing budget stays until you change it. One-shot actions (open, close,
upgrade, launch, order, borrow, acquire …) happen once. If a decision is refused (not enough cash,
locked, over a limit), the reason appears the next day in `state.me.notes`, and `check` shows the
first ones from its smoke test.

**Limits:** 100 ms per `decide()` call and 3000 ms of CPU for the whole year. Past that, your
company "burns out" and runs on autopilot with its last settings. Only plain data goes in and out
(JSON). There is no `require` except `require('./lib/x')`, no network and no files. `console.log`
lines appear in your report (up to 20 per call).

**Memory:** the global `memory` object survives to the next round (up to 16 KB of JSON). Use it
to remember the rival's habits, what worked and your own tuning.

**Helpers** (global `util`): `clamp, sum(arr, f), avg(arr, f), round(v, step), maxBy, minBy,
storesIn(s, d), rivalStoresIn(s, d), priceIn(s, c, d), buildCost(s, tier, d), eventOn(s, type, day?),
upcoming(s, days)`.

### The decisions

| key | example | meaning |
|---|---|---|
| `prices` | `{ food: 5.5 }` | company-wide price (persists). Clamped to 25%–400% of the fair price |
| `districtPrices` | `{ university: { coffee: 3.2 } }` | level 4+: per-district override (`null` removes it) |
| `stockDays` | `{ food: 1.2 }` | auto-restock target: days of forecast demand on the shelf. 0 = manual only |
| `order` | `{ gadgets: 500 }` | one-off extra purchase (paid now, arrives after the lead time) |
| `launch` | `["coffee"]` | start selling a product (pays its launch fee) |
| `drop` | `["food"]` | stop selling a product |
| `open` | `[{ district: "mall", tier: "shop" }]` | build stores (max 4 per day). `{ tier: "online" }` for the web store |
| `upgrade` | `[12]` or `[{ id: 12, tier: "megastore" }]` | pay the difference in build cost. The store keeps trading while the upgrade is built |
| `close` | `[7]` | close a store (60% refund). Franchises close for free |
| `staff` | `{ 12: 10 }` | fixed staff for a store (`null` = back to auto) |
| `staffing` | `1.2` | multiplier on the auto-staffer (0.3–2.5, default 1). The auto-staffer targets `ceil(demand × staffing × 1.08 / per staff)` |
| `marketing` | `{ flyers: 40, social: 300 }` | $ per day per channel (persists) |
| `rnd` | `{ coffee: 200 }` | level 3+: $ per day into product quality (persists) |
| `borrow` / `repay` | `50000` | level 3+ |
| `franchise` | `[{ district: "harbor", tier: "shop" }]` | level 7+ |
| `acquire` | `31` | level 8+: a rival store id |
| `ipo` | `0.25` | level 9+ |
| `moonshot` | `{ fusion: 120000 }` or `null` | level 10+: $ per day per project (`null` stops all funding) |

### The state

```js
s.day, s.days (120), s.daysLeft (incl. today), s.season, s.weekday, s.weekend, s.level, s.round
s.today            // active calendar events [{type, name, from, to, text}]
s.calendar         // the whole year [{type, name, from, to, text, mods}]
s.rules            // every number of this level: districts, categories (incl. rndScale, overhead),
                   // tiers, channels, model weights, money (startCash, overdraft, loanRate, royalty…),
                   // features {loans, rnd, districtPrices, online, franchise, acquire, ipo, moonshots},
                   // franchiseMax, acquireCooldown, moonshotSlots, moonshots
s.market.districts[d] = {
  name, pop, elasticity, rent, wage, youth, online, overseas, needs, adjacent: [...],
  open,                         // can you build here?
  potential: {c: n},            // today's potential shoppers per product
  potentialTomorrow: {c: n},
  yesterday: { me, rival, total }   // customers served yesterday (total = potential)
  share,                        // your share of the two companies' customers yesterday
  catShare: { c: { me, rival, total } }
}
s.me = {
  name, cash, debt, loan, emergencyDebt, creditLimit, netWorth, reputation,
  awareness: {d}, lines: [...], prices: {c}, districtPrices, stockDays: {c}, staffing,
  inventory: {c}, incoming: {c}, forecast: {c},     // forecast = expected sales tomorrow
  unitCost: {c}, bulkDiscount: {c}, dailyVolume: {c}, quality: {c}, rnd: {c}, marketing: {ch},
  stores: [{ id, district, tier, status: 'open'|'building', franchise, opensOnDay, upgradingTo, upgradeDoneDay,
             staff, staffMax, staffOverride, capacity, maxCapacity, demandYesterday, customersYesterday,
             revenueYesterday, value, rent, wage }],
  yesterday: { revenue, profit, cogs, wages, rent, marketing, rnd, overhead, interest, spoilage, shipping,
               royalties, customers, sales: {c}, demand: {c}, lostStock: {c}, lostCapacity, spillIn, byDistrict: {d} },
  history: [{ day, revenue, profit, netWorth, cash, customers }],     // last 14 days
  notes: [...],               // yesterday's refused decisions
  ipoShare, moonshots: { id: { funded, perDay, cost, done, lost } }, moonshotsDone, franchises, lastAcquisitionDay
}
s.rival = {                   // public information only
  name, cash, netWorth, debt, reputation, lines, prices, districtPrices, quality: {c}, awareness: {d},
  marketing: {ch},            // its current daily ad budgets
  stores: [{ id, district, tier, status, franchise, opensOnDay, upgradingTo }],
  ipoShare, moonshots: { id: { funded, done } }, moonshotsDone, bankrupt, yesterday: { revenue, customers }
}
```

`demandYesterday` counts the capacity units customers wanted from that store, including the ones
turned away. `demandYesterday / maxCapacity` above ~0.85 means the store is full: hire, upgrade,
raise the price or open another store.

---

## 9. What a round gives you

After every round, `fighters/<id>/reports/` gets a report containing: the result, the net-worth
race per quarter, your P&L next to the rival's, a table by product (units, prices, quality, lost
sales), a table by district (customers, share, awareness), your stores and the rival's, the rival's
moves (prices, launches, loans, marketing), **what decided it**, your strategy's errors and logs,
and what the next level unlocks. Read it before changing anything.

**The rival reads its report too, and will change.** Don't just hard-counter last year. Build a
strategy that adapts to what it sees in `s.rival` each day and wins against several styles.

---

## 10. Autopilot

Even an empty strategy runs a business. The manager restocks (with `stockDays`) and staffs
(`staffing`) automatically, and your prices and marketing stay as set in company.json. Autopilot
never opens stores, launches lines or uses loans. That is your job.

---

## 11. Checking

`node arena.js check <id>` validates company.json, compiles strategy.js + lib, and runs a
**30-day smoke test** against the starter company. It reports errors your strategy threw and
decisions the engine refused. Fix every ERROR. Read the warnings.

---

## 12. Sparring bots

`node arena.js test <id> <bot>` plays a full year at the current level (bots adapt to every level):

| bot | style |
|---|---|
| `starter` | the starter files: fair prices, one store at a time when busy, launches new lines |
| `autopilot` | Sleepy Stall: the starter company.json with an empty strategy |
| `discounter` | Budget Barn: 20% below fair, undercuts you, many cheap stores, bulk buying, little marketing |
| `premium` | Velvet & Co: +14% prices backed by R&D quality, flagships, generous staffing, influencers, IPO |
| `expansionist` | MegaMart: fair prices, borrows, opens everywhere fast, franchises, acquisitions |
| `marketer` | Hype House: ~11% of revenue on ads across every channel, slightly premium prices |
| `balanced` | Corner Co: fair prices, a bit of everything, steady growth |

Different bots win at different levels, and some of them beat each other in a circle (at level 4 the
expansionist beats the discounter, the discounter beats the balanced company and the balanced company
beats the expansionist; at level 12 the marketer, the premium brand and the balanced company do the same).
The marketer is strong in the late levels, the discounter in the early ones. None of them wins everywhere,
so test against all of them: `node arena.js test <id>`.

---

## 13. Tips

- **Growth compounds.** A good store pays back its build cost in weeks. Open early in the year,
  where there is untapped demand, and stop building when the remaining days can't pay back 40% of
  the cost.
- **Watch capacity and stock every day.** `demandYesterday` vs `maxCapacity`, `yesterday.lostStock`,
  `yesterday.lostCapacity`. Lost customers are lost money and reputation, and 40% of them walk to the
  rival.
- **Price per district.** Students (3.8) punish high prices, and travellers (1.7) barely notice
  them. When your stores are full, raise prices: you sell the same units for more.
- **Perishables.** Food and burgers lose 30% per day on the shelf. Keep `stockDays` around 1.1–1.3,
  and raise it before a big event or a Supply Shortage (3-day deliveries).
- **The calendar is public.** Stock up and add staff before the Holiday Rush. Cut orders before a
  Recession. IPO in a Bull Market. Build online before rainy weeks and strikes.
- **Marketing has diminishing returns** (`1 − e^(−spend/scale)`). Awareness is worth up to about
  1.6 utility, and it fades 3% a day.
- **R&D compounds all year.** Quality multiplies every sale's attractiveness and your reputation.
  Start early or don't bother.
- **Debt is not net worth.** Borrow to build stores that earn more than 0.1%/day. Never let cash
  slide into emergency credit.
- **Endgame.** On the last days, a store's value counts at 60%, stock counts at cost, and the
  rest is cash. Don't overstock at the end of the year, since spoiled stock is worth nothing.
- **Use `memory`.** Record what the rival did (prices, expansion speed, marketing mix) and how
  your settings performed, so next year's plan starts smarter.
