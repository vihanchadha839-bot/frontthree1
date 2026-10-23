// Investment Game / Ballionaire: travel back in time, buy players at their real market value, cash out when the clock moves forward.
const D = require('./data');

const WINDOW_MS = 120000;

function ym(year) { return `${year}-07`; }
function priced(p, date) { const v = D.valueAt(p, date); return v && v > 0 ? v : 0; }

function buildMarket(g) {
  const date = ym(g.years[g.window]);
  const year = g.years[g.window];
  const taken = new Set(g.seen);
  const base = D.pool(g.tier, p => !taken.has(p.id) && (p.group !== 'Goalkeeper' || Math.random() < 0.15));
  const withVal = base.map(p => ({ p, v: priced(p, date), age: D.ageAt(p, new Date(`${year}-07-01`)) }))
    .filter(x => x.v >= 1e6 && x.age >= 16 && x.age <= 33);
  const young = withVal.filter(x => x.age <= 21 && x.v <= 30e6);
  const rising = withVal.filter(x => x.age >= 22 && x.age <= 25);
  const prime = withVal.filter(x => x.age >= 26);
  const n = g.marketSize;
  const picks = [...D.sample(young, Math.round(n * 0.4)), ...D.sample(rising, Math.round(n * 0.3)), ...D.sample(prime, n)].slice(0, n);
  g.market = D.shuffle(picks).map(x => x.p.id);
  g.seen.push(...g.market);
}

function cardFor(g, pid, date, year, reveal) {
  const p = D.BY_ID.get(pid);
  const v = priced(p, date);
  const prev = priced(p, `${year - 1}-07`);
  const hidden = g.blind && !reveal;
  return {
    id: pid, name: hidden ? null : p.name, pos: p.pos, nation: p.nation, age: D.ageAt(p, new Date(`${year}-07-01`)),
    club: D.clubAt(p, year) || D.clubAt(p, year - 1) || '?', value: v, prev, peakSoFar: Math.max(0, ...p.values.filter(x => x[0] <= date).map(x => x[1])),
  };
}

function worth(g, pid, date) {
  const s = g.state[pid];
  let h = 0;
  for (const id of Object.keys(s.hold)) h += priced(D.BY_ID.get(Number(id)), date);
  return s.cash + h;
}

function openWindow(g, api) {
  buildMarket(g);
  g.phase = 'market';
  for (const id of g.ids) g.state[id].ready = false;
  g.deadline = api.timer('w', WINDOW_MS, () => closeWindow(g, api));
}

function closeWindow(g, api) {
  api.clear('w');
  const from = ym(g.years[g.window]);
  g.window++;
  const to = g.window < g.windows ? ym(g.years[g.window]) : g.finalDate;
  // report what happened to every holding
  g.report = {};
  for (const id of g.ids) {
    g.report[id] = Object.keys(g.state[id].hold).map(h => {
      const p = D.BY_ID.get(Number(h));
      return { id: p.id, name: p.name, then: priced(p, from), now: priced(p, to), paid: g.state[id].hold[h] };
    });
  }
  g.table = g.ids.map(id => ({ id, worth: worth(g, id, to) })).sort((a, b) => b.worth - a.worth);
  g.reportFrom = from; g.reportTo = to;
  if (g.window >= g.windows) {
    g.phase = 'final';
    const pts = {};
    g.table.forEach((r, i) => { pts[r.id] = [5, 3, 2][i] ?? 1; });
    g.deadline = null;
    api.finish(pts);
  } else {
    g.phase = 'report';
    g.deadline = api.timer('w', 20000, () => openWindow(g, api));
  }
}

module.exports = {
  id: 'investment', name: 'Investment Game', emoji: '💰', min: 1, max: 10,
  blurb: 'Ballionaire style. Go back in time with a budget, buy players at their real Transfermarkt value, then jump forward and see who you made rich.',
  settings: [
    { key: 'budget', label: 'Budget', options: [[50e6, '€50M'], [100e6, '€100M'], [200e6, '€200M']], default: 100e6 },
    { key: 'windows', label: 'Windows', options: [2, 3, 4], default: 3 },
    { key: 'gap', label: 'Years per jump', options: [1, 2, 3], default: 2 },
    { key: 'tier', label: 'Players', options: [[2, 'Well known'], [3, 'Deep cuts'], [4, 'Anyone']], default: 3 },
    { key: 'blind', label: 'Names', options: [[false, 'Shown'], [true, 'Blind cards']], default: false },
  ],
  create(ids, s, api) {
    const span = s.windows * s.gap; // years from first window to final valuation
    const latestStart = 2025 - span;
    const start = 2010 + D.rand(Math.max(1, latestStart - 2010 + 1));
    const years = Array.from({ length: s.windows }, (_, i) => start + i * s.gap);
    const g = {
      ids, budget: s.budget, windows: s.windows, gap: s.gap, tier: s.tier, blind: s.blind, marketSize: 10,
      years, finalDate: ym(start + span), finalYear: start + span, window: 0, seen: [], state: {},
    };
    for (const id of ids) g.state[id] = { cash: s.budget, hold: {}, ready: false, log: [] };
    openWindow(g, api);
    return g;
  },
  action(g, pid, m, api) {
    const s = g.state[pid]; if (!s) return;
    if (g.phase === 'market') {
      const year = g.years[g.window], date = ym(year);
      const id = Number(m.id);
      if (m.type === 'buy' && g.market.includes(id) && !s.hold[id]) {
        const v = priced(D.BY_ID.get(id), date);
        if (v > 0 && s.cash >= v) { s.cash -= v; s.hold[id] = v; s.ready = false; }
        else api.toast('Not enough cash', pid);
      } else if (m.type === 'sell' && s.hold[id] !== undefined) {
        s.cash += priced(D.BY_ID.get(id), date); delete s.hold[id]; s.ready = false;
      } else if (m.type === 'ready') {
        s.ready = !s.ready;
        if (g.ids.every(i => g.state[i].ready)) closeWindow(g, api);
      }
    } else if (m.type === 'next' && g.phase === 'report') { api.clear('w'); openWindow(g, api); }
  },
  view(g, pid) {
    const s = g.state[pid];
    const inMarket = g.phase === 'market';
    const year = inMarket ? g.years[g.window] : (g.window < g.windows ? g.years[g.window] : g.finalYear);
    const date = inMarket ? ym(year) : g.reportTo;
    const holdings = s ? Object.keys(s.hold).map(h => ({ ...cardFor(g, Number(h), date, year, !inMarket), paid: s.hold[h] })) : [];
    return {
      type: 'investment', phase: g.phase, deadline: g.deadline, year, window: g.window, windows: g.windows, years: g.years, finalYear: g.finalYear,
      blind: g.blind, budget: g.budget,
      market: inMarket ? g.market.map(id => ({ ...cardFor(g, id, date, year, false), owned: !!(s && s.hold[id] !== undefined) })) : [],
      me: s ? { cash: s.cash, holdings, ready: s.ready, worth: worth(g, pid, date) } : null,
      ready: g.ids.filter(i => g.state[i].ready),
      report: g.report ? g.report[pid] : null, reportFrom: g.reportFrom, reportTo: g.reportTo,
      allReports: g.phase === 'final' ? g.report : null,
      table: g.table || null, final: g.final, over: g.over,
    };
  },
};
