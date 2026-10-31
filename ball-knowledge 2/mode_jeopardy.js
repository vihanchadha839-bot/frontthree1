// Football Jeopardy: pick a square, everyone races to buzz, buzzer answers. Wrong answers cost points.
const D = require('./data');
const Q = require('./questions');

const VALUES = [100, 200, 300, 400, 500];
const DIFF = { 100: 1, 200: 2, 300: 2, 400: 3, 500: 4 };
const PICK_MS = 25000, BUZZ_MS = 12000, ANSWER_MS = 9000, REVEAL_MS = 5000;

function toBoard(g, api) {
  if (g.board.every(col => col.every(c => c.done))) {
    g.phase = 'over'; g.deadline = null; api.clear('t');
    return api.finish(Object.fromEntries(Object.entries(g.scores).map(([k, v]) => [k, Math.max(0, Math.round(v / 100))])));
  }
  g.phase = 'board'; g.cur = null; g.buzzer = null; g.locked = [];
  g.deadline = api.timer('t', PICK_MS, () => {
    const open = []; g.board.forEach((col, ci) => col.forEach((c, ri) => !c.done && open.push([ci, ri])));
    const [ci, ri] = D.pick(open); choose(g, ci, ri, api);
  });
}
function choose(g, ci, ri, api) {
  const cell = g.board[ci][ri];
  if (!cell || cell.done) return;
  cell.done = true;
  g.cur = { ci, ri, value: VALUES[ri] * (cell.double ? 2 : 1), double: cell.double, q: cell.q };
  g.locked = [];
  if (cell.double) { g.buzzer = g.picker; g.phase = 'answer'; g.deadline = api.timer('t', ANSWER_MS + 5000, () => answer(g, g.picker, -1, api)); }
  else openBuzz(g, BUZZ_MS, api);
}
function openBuzz(g, ms, api) {
  g.phase = 'buzz'; g.buzzer = null;
  g.deadline = api.timer('t', ms, () => reveal(g, null, api));
}
function answer(g, pid, choice, api) {
  const ok = choice === g.cur.q.answer;
  g.cur.answers = g.cur.answers || [];
  g.cur.answers.push({ pid, choice, ok });
  if (ok) { g.scores[pid] += g.cur.value; g.picker = pid; return reveal(g, pid, api); }
  g.scores[pid] -= g.cur.double ? g.cur.value / 2 : g.cur.value;
  g.locked.push(pid);
  if (g.cur.double || g.locked.length >= g.ids.length) return reveal(g, null, api);
  openBuzz(g, 8000, api);
}
function reveal(g, winner, api) {
  g.phase = 'reveal'; g.cur.winner = winner;
  g.deadline = api.timer('t', REVEAL_MS, () => toBoard(g, api));
}

module.exports = {
  id: 'jeopardy', name: 'Football Jeopardy', emoji: '🟦', min: 1, max: 10,
  blurb: 'Five categories, five values. Pick a square, then everyone races to buzz in. Wrong answers lose you points. One square hides a Daily Double.',
  settings: [
    { key: 'cols', label: 'Categories', options: [4, 5, 6], default: 5 },
  ],
  create(ids, s, api) {
    const cats = D.sample(Object.keys(Q.CATEGORIES), Math.min(s.cols, Object.keys(Q.CATEGORIES).length));
    const avoid = new Set();
    const board = cats.map(cat => VALUES.map(v => ({ q: Q.question(DIFF[v], cat, avoid), done: false, double: false })));
    const dc = D.rand(board.length), dr = 2 + D.rand(3);
    board[dc][dr].double = true;
    const g = { ids, cats, board, scores: {}, picker: D.pick(ids), phase: 'board' };
    ids.forEach(i => g.scores[i] = 0);
    toBoard(g, api);
    return g;
  },
  action(g, pid, m, api) {
    if (m.type === 'pick' && g.phase === 'board' && pid === g.picker) choose(g, Number(m.c), Number(m.r), api);
    else if (m.type === 'buzz' && g.phase === 'buzz' && !g.locked.includes(pid) && g.ids.includes(pid)) {
      g.buzzer = pid; g.phase = 'answer';
      g.deadline = api.timer('t', ANSWER_MS, () => answer(g, pid, -1, api));
    } else if (m.type === 'answer' && g.phase === 'answer' && pid === g.buzzer) answer(g, pid, Number(m.choice), api);
  },
  leave(g, pid, api) { if (g.phase === 'answer' && g.buzzer === pid) answer(g, pid, -1, api); },
  view(g, pid) {
    const q = g.cur?.q;
    const showQ = g.cur && g.phase !== 'board';
    return {
      type: 'jeopardy', phase: g.phase, deadline: g.deadline, cats: g.cats, values: VALUES, picker: g.picker, buzzer: g.buzzer, locked: g.locked,
      board: g.board.map(col => col.map(c => ({ done: c.done }))),
      cur: showQ ? { ci: g.cur.ci, ri: g.cur.ri, value: g.cur.value, double: g.cur.double, cat: g.cats[g.cur.ci], q: q.q, options: (g.phase === 'answer' || g.phase === 'reveal') ? q.options : null,
        answer: g.phase === 'reveal' ? q.answer : null, fact: g.phase === 'reveal' ? q.fact : null, winner: g.cur.winner, answers: g.cur.answers || [] } : null,
      scores: g.scores, final: g.final, over: g.over,
    };
  },
};
