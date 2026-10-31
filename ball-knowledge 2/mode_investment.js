// Investment Game: blind stat-card draft. Go back to a random summer, draft position by position
// (keeper, defenders, midfielders, forwards) turn by turn, buying at the real value back then.
// Then jump forward in time: names are revealed and squads are valued at the future date.
const D = require('./data');

const TURN_MS = 35000;
const POSITIONS = [
  { key: 'GK', label: 'Goalkeepers', group: 'Goalkeeper', slots: 1 },
  { key: 'DEF', label: 'Defenders', group: 'Defender', slots: 2 },
  { key: 'MID', label: 'Midfielders', group: 'Midfielder', slots: 2 },
  { key: 'FWD', label: 'Forwards', group: 'Forward', slots: 2 },
];
const POS_NAME = { GK: 'Goalkeeper', CB: 'Centre-back', LB: 'Left-back', RB: 'Right-back', DM: 'Defensive mid', CM: 'Central mid', AM: 'Attacking mid', LM: 'Left mid', RM: 'Right mid', LW: 'Left winger', RW: 'Right winger', ST: 'Striker', SS: 'Second striker' };

const ym = y => `${y}-07`;
const priced = (p, date) => { const v = D.valueAt(p, date); return v && v > 0 ? v : 0; };
function clubIdAt(p, year) {
  const c = p.clubs.filter(c => c.from <= year && c.to >= year).sort((a, b) => b.apps - a.apps)[0]
    || p.clubs.filter(c => c.to < year).sort((a, b) => b.to - a.to)[0];
  return c?.id;
}
function statsBefore(p, year) {
  const before = p.seasons.filter(s => s[0] < year);
  const last = p.seasons.find(s => s[0] === year - 1) || [year - 1, 0, 0, 0, 0];
  const sum = i => before.reduce((t, s) => t + s[i], 0);
  return { last: { apps: last[1], goals: last[2], assists: last[3], cs: last[4] }, career: { apps: sum(1), goals: sum(2), assists: sum(3), cs: sum(4), seasons: before.length } };
}

function buildMarket(g, pos) {
  const year = g.year, date = ym(year);
  const n = Math.max(8, g.ids.length * pos.slots + 2);
  const cands = D.pool(g.tier, p => p.group === pos.group && !g.usedP.has(p.id))
    .map(p => ({ p, v: priced(p, date), age: D.ageAt(p, new Date(`${year}-07-01`)), st: statsBefore(p, year) }))
    .filter(x => x.v >= 500e3 && x.age >= 17 && x.age <= 34 && x.st.career.apps >= 15 && x.st.last.apps >= 5);
  // spread across price bands so there are bargains and big names
  const bands = [[0, 3e6], [3e6, 10e6], [10e6, 25e6], [25e6, 1e10]];
  const picks = [];
  const per = Math.ceil(n / bands.length);
  for (const [lo, hi] of bands) picks.push(...D.sample(cands.filter(x => x.v >= lo && x.v < hi), per));
  const chosen = D.shuffle(picks).slice(0, n);
  if (chosen.length < n) chosen.push(...D.sample(cands.filter(x => !chosen.includes(x)), n - chosen.length));
  chosen.sort((a, b) => b.v - a.v);
  return chosen.map((x, i) => {
    g.usedP.add(x.p.id);
    const cid = clubIdAt(x.p, year);
    return {
      n: g.cardNo++, pid: x.p.id, pos: x.p.pos, posName: POS_NAME[x.p.pos], age: x.age, nation: x.p.nation,
      league: (cid && D.CLUBS[cid]?.league) || (cid && D.CLUBS[cid]?.country ? `${D.CLUBS[cid].country} league` : 'Unknown league'),
      height: x.p.height, foot: x.p.foot, value: x.v, prev: priced(x.p, ym(year - 1)), ...x.st, owner: null, paid: null,
    };
  });
}

function startPosition(g, api) {
  const pos = POSITIONS[g.pi];
  g.market = buildMarket(g, pos);
  g.allCards.push(...g.market);
  // snake order, and the starting player rotates each position
  const rot = g.ids.slice(g.pi % g.ids.length).concat(g.ids.slice(0, g.pi % g.ids.length));
  g.queue = [];
  for (let k = 0; k < pos.slots; k++) g.queue.push(...(k % 2 ? rot.slice().reverse() : rot));
  g.phase = 'draft';
  nextTurn(g, api, true);
}
function nextTurn(g, api, first) {
  if (!first) g.queue.shift();
  const anyLeft = g.market.some(c => !c.owner);
  if (!g.queue.length || !anyLeft) {
    g.pi++;
    if (g.pi >= POSITIONS.length) return reveal(g, api);
    return startPosition(g, api);
  }
  g.deadline = api.timer('turn', TURN_MS, () => { g.log.unshift({ pid: g.queue[0], text: 'ran out of time, passed' }); nextTurn(g, api); });
}
function reveal(g, api) {
  api.clear('turn');
  g.phase = 'reveal'; g.deadline = null;
  const date = ym(g.endYear);
  g.results = g.ids.map(id => {
    const squad = g.allCards.filter(c => c.owner === id).map(c => {
      const p = D.BY_ID.get(c.pid);
      return { n: c.n, pos: c.pos, name: p.name, paid: c.paid, now: priced(p, date), clubThen: D.CLUBS[clubIdAt(p, g.year)]?.name || '', clubNow: D.CLUBS[clubIdAt(p, g.endYear)]?.name || '' };
    });
    const worth = g.cash[id] + squad.reduce((t, c) => t + c.now, 0);
    return { id, squad, cash: g.cash[id], worth };
  }).sort((a, b) => b.worth - a.worth);
  // reveal every card's name, sold or not
  for (const c of g.allCards) { const p = D.BY_ID.get(c.pid); c.revealName = p.name; c.nowValue = priced(p, date); }
  const pts = {};
  g.results.forEach((r, i) => { pts[r.id] = [5, 3, 2][i] ?? 1; });
  api.finish(pts);
}

module.exports = {
  id: 'investment', name: 'Investment Game', emoji: '💰', min: 1, max: 6,
  blurb: 'Blind stat cards, no names. Go back to a random summer and draft position by position, taking turns to buy at the real value back then. Then jump forward and see who you really bought.',
  settings: [
    { key: 'budget', label: 'Budget', options: [[50e6, '€50M'], [100e6, '€100M'], [200e6, '€200M']], default: 100e6 },
    { key: 'jump', label: 'Jump forward', options: [[3, '3 years'], [5, '5 years'], [7, '7 years']], default: 5 },
    { key: 'tier', label: 'Players', options: [[2, 'Well known'], [3, 'Deep cuts'], [4, 'Anyone']], default: 3 },
  ],
  create(ids, s, api) {
    const year = 2010 + D.rand(Math.max(1, 2025 - s.jump - 2010 + 1));
    const g = { ids: D.shuffle(ids), budget: s.budget, tier: s.tier, year, endYear: year + s.jump, pi: 0, cardNo: 1, usedP: new Set(), cash: {}, log: [], allCards: [] };
    ids.forEach(i => g.cash[i] = s.budget);
    startPosition(g, api);
    return g;
  },
  action(g, pid, m, api) {
    if (g.phase !== 'draft' || g.queue[0] !== pid) return;
    if (m.type === 'buy') {
      const c = g.market.find(c => c.n === Number(m.n));
      if (!c || c.owner) return;
      if (g.cash[pid] < c.value) return api.toast('Not enough cash', pid);
      c.owner = pid; c.paid = c.value; g.cash[pid] -= c.value;
      g.log.unshift({ pid, text: `bought card #${c.n} (${c.posName}, ${c.nation}) for ${D.fmtM(c.value)}` });
    } else if (m.type === 'pass') {
      g.log.unshift({ pid, text: 'passed' });
    } else return;
    nextTurn(g, api);
  },
  leave(g, pid, api) {
    if (g.phase === 'draft' && g.queue[0] === pid) { g.log.unshift({ pid, text: 'left, passed' }); nextTurn(g, api); }
  },
  view(g, pid) {
    const pos = POSITIONS[Math.min(g.pi, POSITIONS.length - 1)];
    const strip = c => { const { pid: _hidden, revealName, nowValue, ...rest } = c; return g.phase === 'reveal' ? { ...rest, name: revealName, nowValue } : rest; };
    const squads = g.ids.map(id => ({ id, cash: g.cash[id], cards: g.allCards.filter(c => c.owner === id).map(strip) }));
    return {
      type: 'investment', phase: g.phase, deadline: g.deadline, year: g.year, endYear: g.endYear, budget: g.budget,
      positions: POSITIONS.map(p => ({ key: p.key, label: p.label, slots: p.slots })), pi: g.pi, posLabel: pos.label,
      turnId: g.phase === 'draft' ? g.queue[0] : null, upNext: g.phase === 'draft' ? g.queue.slice(1, 4) : [],
      market: g.phase === 'draft' ? g.market.map(strip) : [], squads, log: g.log.slice(0, 10),
      results: g.results || null, unsold: g.phase === 'reveal' ? g.allCards.filter(c => !c.owner).map(strip).sort((a, b) => b.nowValue - a.nowValue).slice(0, 6) : null,
      final: g.final, over: g.over,
    };
  },
};
