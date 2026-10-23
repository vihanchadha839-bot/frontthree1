// Trivia Path / Snakes: roll, land, answer. Ladders need a hard question to climb, snakes need one to dodge.
const D = require('./data');
const Q = require('./questions');

const SIZE = 36;
const LADDERS = { 3: 12, 8: 17, 14: 25, 21: 30 };
const SNAKES = { 16: 6, 23: 13, 29: 19, 34: 24 };
const ROLL_MS = 15000, Q_MS = 20000, RESULT_MS = 3500;

function turnStart(g, api) {
  g.phase = 'roll'; g.dice = null; g.cur = null;
  g.deadline = api.timer('t', ROLL_MS, () => roll(g, g.ids[g.turn], api));
}
function roll(g, pid, api) {
  if (g.phase !== 'roll' || g.ids[g.turn] !== pid) return;
  const d = 1 + D.rand(6);
  const from = g.pos[pid];
  const to = Math.min(SIZE, from + d);
  const kind = to >= SIZE ? 'finish' : LADDERS[to] ? 'ladder' : SNAKES[to] ? 'snake' : 'normal';
  const diff = kind === 'normal' ? g.diff : Math.min(4, g.diff + 1);
  g.dice = d;
  g.cur = { pid, from, to, kind, q: Q.question(diff, null, g.avoid) };
  g.phase = 'question';
  g.deadline = api.timer('t', Q_MS, () => answer(g, pid, -1, api));
}
function answer(g, pid, choice, api) {
  if (g.phase !== 'question' || g.cur.pid !== pid) return;
  const c = g.cur, ok = choice === c.q.answer;
  let land = c.from, note;
  if (c.kind === 'normal') { land = ok ? c.to : c.from; note = ok ? `moves to ${c.to}` : 'stays put'; }
  else if (c.kind === 'ladder') { land = ok ? LADDERS[c.to] : c.to; note = ok ? `climbs the ladder to ${LADDERS[c.to]}! 🪜` : `lands on ${c.to} but misses the ladder`; }
  else if (c.kind === 'snake') { land = ok ? c.to : SNAKES[c.to]; note = ok ? `dodges the snake on ${c.to}` : `bitten! slides to ${SNAKES[c.to]} 🐍`; }
  else { land = ok ? SIZE : c.from; note = ok ? 'reaches the finish! 🏆' : 'misses the final question'; }
  g.pos[pid] = land;
  c.result = { ok, choice, note };
  g.log.unshift({ pid, text: `rolled ${c.to - c.from === 0 ? g.dice : g.dice}, ${ok ? '✓' : '✗'} ${note}` });
  g.phase = 'result';
  g.deadline = api.timer('t', RESULT_MS, () => {
    if (g.pos[pid] >= SIZE) {
      g.phase = 'over'; g.deadline = null;
      const pts = {}; g.ids.forEach(id => pts[id] = Math.floor(g.pos[id] / 9)); pts[pid] = 5;
      return api.finish(pts);
    }
    g.turn = (g.turn + 1) % g.ids.length;
    turnStart(g, api);
  });
}

module.exports = {
  id: 'trivia', name: 'Trivia Path', emoji: '🐍', min: 1, max: 8,
  blurb: 'Snakes and ladders with ball knowledge. Roll, land, answer. Get it wrong and you stay put, or worse, slide down a snake.',
  settings: [
    { key: 'diff', label: 'Difficulty', options: [[1, 'Easy'], [2, 'Medium'], [3, 'Hard']], default: 2 },
  ],
  create(ids, s, api) {
    const g = { ids: D.shuffle(ids), diff: s.diff, pos: {}, turn: 0, log: [], avoid: new Set() };
    ids.forEach(i => g.pos[i] = 0);
    turnStart(g, api);
    return g;
  },
  action(g, pid, m, api) {
    if (m.type === 'roll') roll(g, pid, api);
    else if (m.type === 'answer') answer(g, pid, Number(m.choice), api);
  },
  leave(g, pid, api) { if (g.ids[g.turn] === pid) { if (g.phase === 'roll') roll(g, pid, api); } },
  view(g, pid) {
    const c = g.cur;
    return {
      type: 'trivia', phase: g.phase, deadline: g.deadline, size: SIZE, ladders: LADDERS, snakes: SNAKES, pos: g.pos, order: g.ids, turnId: g.ids[g.turn], dice: g.dice,
      cur: c ? { pid: c.pid, from: c.from, to: c.to, kind: c.kind, q: { cat: c.q.cat, q: c.q.q, options: c.q.options }, result: c.result || null,
        answer: g.phase === 'result' ? c.q.answer : null, fact: g.phase === 'result' ? c.q.fact : null } : null,
      log: g.log.slice(0, 10), final: g.final, over: g.over,
    };
  },
};
