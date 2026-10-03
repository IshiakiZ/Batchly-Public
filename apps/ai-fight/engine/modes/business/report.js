'use strict';
// The post-round report each AI reads before improving its company (plain ASCII text, <= ~150 lines).

const R = require('./rules');

const $ = (v) => `${v < 0 ? '-' : ''}$${R.fmtShort(Math.abs(Math.round(v || 0)))}`;
const pct = (v) => `${Math.round(v)}%`;
const pad = (s, n) => String(s).padEnd(n).slice(0, n);
const lpad = (s, n) => String(s).padStart(n).slice(-n);

function buildReport({ side, replay, result, stats, labels, round, level, score }) {
  const me = side, rv = 1 - side;
  const S = replay.summary || [];
  const A = S[me] || {}, B = S[rv] || {};
  const sides = replay.sides || [];
  const myName = (sides[me] && sides[me].name) || 'you', rvName = (sides[rv] && sides[rv].name) || 'rival';
  const L = [];
  const push = (s = '') => L.push(s);
  const st = stats || [{}, {}];
  const won = result.winner === me, lost = result.winner === rv;

  push(`BUSINESS REPORT - round ${round}, level ${level}`);
  push(`You: ${labels[me]} running ${myName}   vs   ${labels[rv]} running ${rvName}`);
  push(`RESULT: ${won ? 'YOU WON' : lost ? 'YOU LOST' : 'DRAW'} (${result.method}) - ${result.text}`);
  if (score) push(`Match score: ${Array.isArray(score) ? `${labels[0]} ${score[0]} - ${score[1]} ${labels[1]}` : typeof score === 'object' ? JSON.stringify(score) : score}`);
  push();

  // ── the race ──
  push('NET WORTH RACE (cash + stock + 60% of store value + moonshots - debt)');
  const qh = (s) => (s.quarters || []).map(q => (q ? $(q.netWorth) : '-'));
  push(`  ${pad('', 12)}${['day 30', 'day 60', 'day 90', 'day 120'].map(x => lpad(x, 10)).join('')}${lpad('final', 11)}`);
  push(`  ${pad('you', 12)}${qh(A).map(x => lpad(x, 10)).join('')}${lpad($(st[me].netWorth), 11)}`);
  push(`  ${pad('rival', 12)}${qh(B).map(x => lpad(x, 10)).join('')}${lpad($(st[rv].netWorth), 11)}`);
  if (A.bankruptDay) push(`  !! You went BANKRUPT on day ${A.bankruptDay}: cash fell below the overdraft limit with no credit left.`);
  if (B.bankruptDay) push(`  The rival went bankrupt on day ${B.bankruptDay}.`);
  push();

  // ── P&L ──
  const ta = A.totals || {}, tb = B.totals || {};
  const row = (label, a, b, note = '') => push(`  ${pad(label, 26)}${lpad($(a), 10)}${lpad($(b), 10)}  ${note}`);
  push(`PROFIT & LOSS FOR THE YEAR ${lpad('you', 12)}${lpad('rival', 10)}`);
  row('revenue', ta.revenue, tb.revenue);
  row('cost of goods sold', -ta.cogs, -tb.cogs, `gross margin ${pct(st[me].grossMargin)} vs ${pct(st[rv].grossMargin)}`);
  row('wages', -ta.wages, -tb.wages);
  row('rent', -ta.rent, -tb.rent);
  row('marketing', -ta.marketing, -tb.marketing, ta.revenue ? `${pct(ta.marketing / ta.revenue * 100)} of your revenue` : '');
  if (ta.rnd || tb.rnd) row('R&D', -ta.rnd, -tb.rnd);
  row('spoiled stock', -ta.spoilage, -tb.spoilage);
  if (ta.shipping || tb.shipping) row('online shipping', -ta.shipping, -tb.shipping);
  row('line overheads + hiring', -(ta.overhead + ta.hiring), -(tb.overhead + tb.hiring));
  if (ta.interest || tb.interest) row('interest', -ta.interest, -tb.interest);
  if (ta.royalties || tb.royalties) row('franchise royalties', ta.royalties, tb.royalties);
  if (ta.tourism || tb.tourism) row('space tourism', ta.tourism, tb.tourism);
  row('= operating profit', st[me].profit, st[rv].profit);
  row('invested in stores', -ta.build, -tb.build, '(40% of it is lost from net worth)');
  if (ta.launch || tb.launch) row('product launches', -ta.launch, -tb.launch);
  if (ta.acqPaid || tb.acqPaid || ta.acqGot || tb.acqGot) row('acquisitions (paid-got)', ta.acqGot - ta.acqPaid, tb.acqGot - tb.acqPaid);
  if (ta.ipo || tb.ipo) row('IPO cash raised', ta.ipo, tb.ipo, `you sold ${pct((A.ipoShare || 0) * 100)}, rival ${pct((B.ipoShare || 0) * 100)}`);
  if (ta.moonshot || tb.moonshot) row('moonshot funding', -ta.moonshot, -tb.moonshot);
  push();

  // ── products ──
  push('BY PRODUCT                  you: units  revenue  price  quality lost:stock lost:capacity | rival: units   price  quality');
  for (const c of replay.categories || []) {
    const a = (A.byCat || {})[c], b = (B.byCat || {})[c];
    if (!a && !b) continue;
    const C = R.CATEGORIES[c];
    const ia = A.lines && A.lines.includes(c), ib = B.lines && B.lines.includes(c);
    push(`  ${pad(`${C.name} (fair $${C.ref})`, 26)}${lpad(ia || (a && a.units) ? Math.round(a.units) : '-', 10)}${lpad($(a ? a.revenue : 0), 9)}${lpad(ia ? `$${(a.price || 0).toFixed(2)}` : '-', 8)}${lpad(ia ? a.quality.toFixed(2) : '-', 8)}${lpad(a ? Math.round(a.lostStock) : 0, 11)}${lpad(a ? Math.round(a.lostCap) : 0, 14)} |${lpad(ib || (b && b.units) ? Math.round(b.units) : '-', 12)}${lpad(ib ? `$${(b.price || 0).toFixed(2)}` : '-', 8)}${lpad(ib ? b.quality.toFixed(2) : '-', 9)}`);
  }
  push('  (prices are the ones at year end; lost:stock = shoppers who wanted it but you had none left;');
  push('   lost:capacity = shoppers turned away because your stores/staff were full)');
  push();

  // ── districts ──
  push('BY DISTRICT              your customers  rival   your share  your revenue  awareness you/rival');
  for (const d of replay.districts || []) {
    const a = (A.byDist || {})[d], b = (B.byDist || {})[d];
    if (!a) continue;
    const tot = a.customers + a.rival;
    if (tot <= 0 && !(a.awareness > 0.05)) continue;
    push(`  ${pad(R.DISTRICTS[d].name, 22)}${lpad(Math.round(a.customers), 12)}${lpad(Math.round(a.rival), 9)}${lpad(tot > 0 ? pct(a.customers / tot * 100) : '-', 12)}${lpad($(a.revenue), 14)}${lpad(`${Math.round(a.awareness * 100)}% / ${Math.round(((b || {}).awareness || 0) * 100)}%`, 20)}`);
  }
  push();

  // ── stores ──
  const tierName = (t) => (R.TIERS[t] ? R.TIERS[t].name : t);
  const storeLine = (x) => `#${x.id} ${tierName(x.tier)}${x.franchise ? ' (franchise)' : ''} ${x.district ? R.DISTRICTS[x.district].name : 'online'} d${x.start}${x.closed ? `-${x.closed}` : ''}: ${Math.round(x.cust)} cust, ${$(x.rev)}`;
  push(`YOUR STORES (${(A.stores || []).length} ever, ${st[me].stores} open at the end)`);
  for (const x of (A.stores || []).slice(0, 14)) push(`  ${storeLine(x)}${x.status === 'closed' ? ' [closed]' : ''}`);
  if ((A.stores || []).length > 14) push(`  ... and ${(A.stores || []).length - 14} more`);
  push(`RIVAL'S STORES (${(B.stores || []).length} ever)`);
  for (const x of (B.stores || []).slice(0, 10)) push(`  ${storeLine(x)}${x.status === 'closed' ? ' [closed]' : ''}`);
  if ((B.stores || []).length > 10) push(`  ... and ${(B.stores || []).length - 10} more`);
  push();

  // ── the rival's playbook ──
  push('WHAT THE RIVAL DID');
  const bm = Object.entries(B.marketing || {}).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${$(v)}/day`).join(', ') || 'none';
  push(`  final marketing: ${bm}; reputation ${Math.round(B.rep || 0)} (yours ${Math.round(A.rep || 0)})`);
  push(`  lines: ${(B.lines || []).map(c => R.CATEGORIES[c].name).join(', ') || '-'}; R&D total ${$(tb.rnd)}; debt at the end ${$(st[rv].debt)}`);
  const rvEvents = (replay.events || []).filter(e => e.side === rv && ['price', 'launch', 'cash', 'marketing'].includes(e.k)).slice(0, 8);
  for (const e of rvEvents) push(`  day ${e.day}: ${e.text}`);
  if ((B.moonDone || []).length) push(`  completed moonshots: ${B.moonDone.map(m => R.MOONSHOTS[m].name).join(', ')}`);
  push();

  // ── insights ──
  push('WHAT DECIDED IT (read this before changing anything)');
  const tips = insights({ A, B, st, me, rv, replay, level });
  for (const t of tips.slice(0, 12)) push(`  - ${t}`);
  push();

  // ── strategy health ──
  const br = A.brain;
  push('YOUR STRATEGY');
  if (!br) push('  No strategy ran (empty or failed to load): the company ran on autopilot all year.');
  else {
    push(`  ${br.calls} decide() calls, ${br.errors} errors (${br.timeouts} timeouts), ${(st[me].brainMs || 0)} ms CPU${br.disabled ? ' - BURNED OUT' : ''}`);
    if (br.disabledReason) push(`  ${br.disabledReason}`);
    for (const e of br.firstErrors || []) push(`  error on day ${e.day}: ${e.message}`);
    for (const n of (A.refused || []).slice(0, 6)) push(`  refused on day ${n.day}: ${n.text}`);
    const logs = (br.logs || []).slice(0, 10);
    if (logs.length) { push('  your console.log output (first lines):'); for (const l of logs) push(`    day ${l.day}: ${l.text}`); }
  }
  push();
  push('REMEMBER: the rival read its own report and will change its strategy too. Do not just');
  push('hard-counter what it did this year - build something that wins against several plans');
  push('(test against: node arena.js test <id> all). The calendar and unlocks change every level.');
  if (level < R.MAX_LEVEL) {
    push();
    push(`NEXT LEVEL (${level + 1}) UNLOCKS: ${R.levelUnlocks(level + 1).join('; ')}`);
    push(`Next calendar: ${R.calendarFor(level + 1).map(e => `${e.name} d${e.from}-${e.to}`).join(', ')}`);
  }
  return L.slice(0, 160).join('\n');
}

function insights({ A, B, st, me, rv, replay, level }) {
  const out = [];
  const ta = A.totals || {}, tb = B.totals || {};
  const nwA = st[me].netWorth, nwB = st[rv].netWorth;
  if (nwA < nwB) out.push(`You finished ${$(nwB - nwA)} behind. Biggest gaps: ${gapList(ta, tb, st, me, rv)}.`);
  else if (nwA > nwB) out.push(`You finished ${$(nwA - nwB)} ahead. Keep what worked: ${gapList(tb, ta, st, rv, me)} were your edges.`);
  // stock-outs
  for (const [c, v] of Object.entries(A.byCat || {})) {
    if (v.lostStock > Math.max(50, v.units * 0.05)) out.push(`${R.CATEGORIES[c].name}: ${Math.round(v.lostStock)} shoppers found your shelves empty (${pct(v.lostStock / Math.max(1, v.units + v.lostStock) * 100)} of demand). Raise stockDays.${c} or order ahead of events (orders take 1 day, 3 during a Supply Shortage).`);
    if (v.lostCap > Math.max(80, v.units * 0.08)) out.push(`${R.CATEGORIES[c].name}: ${Math.round(v.lostCap)} shoppers were turned away by full stores. Hire (staff/staffing), upgrade busy stores or open more - or raise prices where you are full.`);
  }
  if (ta.spoilage > ta.revenue * 0.04) out.push(`You threw away ${$(ta.spoilage)} of spoiled stock (${pct(ta.spoilage / Math.max(1, ta.revenue) * 100)} of revenue): lower stockDays for perishable lines.`);
  // prices vs rival
  for (const c of A.lines || []) {
    if (!(B.lines || []).includes(c)) continue;
    const pa = A.byCat[c].price, pb = B.byCat[c].price;
    if (pa > pb * 1.12) out.push(`${R.CATEGORIES[c].name}: your price $${pa.toFixed(2)} vs rival $${pb.toFixed(2)}. In price-sensitive districts (University elasticity 3.8, Suburbs 3.2) that costs share; your quality ${A.byCat[c].quality.toFixed(2)} vs ${B.byCat[c].quality.toFixed(2)}.`);
    else if (pa < pb * 0.88) out.push(`${R.CATEGORIES[c].name}: you were ${pct((1 - pa / pb) * 100)} cheaper than the rival - check your margin ($${pa.toFixed(2)} vs unit cost $${R.CATEGORIES[c].cost}); was the extra volume worth it?`);
  }
  // districts
  const missed = [];
  for (const d of replay.districts || []) {
    const a = (A.byDist || {})[d];
    if (!a) continue;
    if (a.customers < a.rival * 0.25 && a.rival > 2000) missed.push(`${R.DISTRICTS[d].name} (${Math.round(a.rival)} rival customers vs your ${Math.round(a.customers)})`);
  }
  if (missed.length) out.push(`The rival owned districts you barely served: ${missed.slice(0, 4).join(', ')}.`);
  // marketing
  const ma = ta.revenue ? ta.marketing / ta.revenue : 0, mb = tb.revenue ? tb.marketing / tb.revenue : 0;
  if (st[me].awareness + 10 < st[rv].awareness) out.push(`Brand awareness ${Math.round(st[me].awareness)}% vs rival ${Math.round(st[rv].awareness)}% (marketing ${pct(ma * 100)} vs ${pct(mb * 100)} of revenue). Awareness is worth up to ~1.6 utility - as much as a big price cut.`);
  if (ma > 0.15 && nwA < nwB) out.push(`Marketing ate ${pct(ma * 100)} of your revenue. Returns diminish: 1 - e^(-spend/scale) per channel.`);
  // growth
  if (st[me].peakStores < st[rv].peakStores - 1) out.push(`The rival peaked at ${st[rv].peakStores} open stores vs your ${st[me].peakStores}. Stores pay back fast early in the year - expand sooner.`);
  if (ta.build > 0 && st[me].profit < ta.build * 0.4) out.push(`You invested ${$(ta.build)} in stores but earned only ${$(st[me].profit)} operating profit: late or badly placed stores lose 40% of their cost from net worth immediately.`);
  if (st[me].reputation < st[rv].reputation - 8) out.push(`Reputation ${Math.round(st[me].reputation)} vs ${Math.round(st[rv].reputation)}: reputation follows value for money (quality / price) and service (stock-outs, full stores).`);
  if (st[me].debt > 0 && ta.interest > st[me].profit * 0.2) out.push(`Interest cost you ${$(ta.interest)}. Emergency credit charges ${(R.MONEY.penaltyRate * 100).toFixed(2)}%/day - keep a cash buffer.`);
  if (level >= 3 && !ta.rnd && tb.rnd) out.push(`The rival spent ${$(tb.rnd)} on R&D; quality multiplies every sale's attractiveness (1.2 x ln(quality)).`);
  if (st[me].brainErrors > 0) out.push(`Your strategy threw ${st[me].brainErrors} errors: those days it changed nothing. Fix them first (node arena.js check <id>).`);
  if (!out.length) out.push('Close year. Look at the district table: small share gains in the biggest districts decide it.');
  return out;
}

function gapList(ta, tb, st, me, rv) {
  const gaps = [
    ['revenue', (tb.revenue - tb.cogs) - (ta.revenue - ta.cogs), 'gross profit'],
    ['wages', ta.wages - tb.wages, 'wages'],
    ['rent', ta.rent - tb.rent, 'rent'],
    ['marketing', ta.marketing - tb.marketing, 'marketing'],
    ['rnd', ta.rnd - tb.rnd, 'R&D'],
    ['spoilage', ta.spoilage - tb.spoilage, 'spoilage'],
    ['build', (ta.build - tb.build) * 0.4, 'store build write-offs'],
    ['interest', ta.interest - tb.interest, 'interest'],
  ].filter(g => g[1] > 0).sort((p, q) => q[1] - p[1]).slice(0, 3);
  return gaps.length ? gaps.map(g => `${g[2]} (${$(g[1])})`).join(', ') : 'many small things';
}

module.exports = { buildReport };
