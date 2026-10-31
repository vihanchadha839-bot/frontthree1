// The Chase: cash builder, head-to-head on the ladder against the Chaser, then the final chase.
const D = require('./data');
const Q = require('./questions');

const CASH_MS = 45000, OFFER_MS = 20000, H2H_MS = 15000, H2H_REVEAL = 3500, FINAL_MS = 60000, CHASER_STEP = 2600;
const HOME = 8;
const BOT_ACC = { bot1: 0.55, bot2: 0.7, bot3: 0.85 };
const BOT_NAME = { bot1: 'The Sunday Leaguer', bot2: 'The Pundit', bot3: 'The Gaffer' };

function q(g, d) { return Q.question(d, null, g.avoid); }
const strip = x => x && ({ cat: x.cat, q: x.q, options: x.options });

function startContestant(g, api) {
  if (g.ci >= g.contestants.length) return startFinal(g, api);
  const pid = g.contestants[g.ci];
  g.cur = { pid, bank: 0, correct: 0, q: q(g, 2), last: null };
  g.phase = 'cash';
  g.deadline = api.timer('t', CASH_MS, () => {
    g.phase = 'offer';
    const b = g.cur.bank;
    g.offers = { high: { start: 2, bank: b * 3 + 10000 }, mid: { start: 3, bank: b }, low: { start: 4, bank: Math.max(1000, Math.round(b / 4 / 1000) * 1000) } };
    g.deadline = api.timer('t', OFFER_MS, () => takeOffer(g, 'mid', api));
  });
}
function takeOffer(g, key, api) {
  if (g.phase !== 'offer') return;
  const o = g.offers[key];
  g.cur.bank = o.bank; g.cur.pos = o.start; g.cur.chaser = 0; g.cur.offer = key;
  nextH2H(g, api);
}
function nextH2H(g, api) {
  g.phase = 'h2h';
  g.cur.q = q(g, 3);
  g.cur.ans = {};
  g.cur.reveal = null;
  g.deadline = api.timer('t', H2H_MS, () => settleH2H(g, api));
  if (g.bot) {
    const delay = 2500 + Math.random() * 7000;
    api.timer('bot', delay, () => { if (g.phase === 'h2h') { g.cur.ans.chaser = botChoice(g, g.cur.q); maybeSettle(g, api); } });
  }
}
function botChoice(g, question) {
  if (Math.random() < g.acc) return question.answer;
  const wrong = question.options.map((_, i) => i).filter(i => i !== question.answer);
  return D.pick(wrong);
}
function maybeSettle(g, api) { if (g.cur.ans.contestant !== undefined && g.cur.ans.chaser !== undefined) settleH2H(g, api); }
function settleH2H(g, api) {
  if (g.phase !== 'h2h') return;
  api.clear('t'); api.clear('bot');
  const c = g.cur, a = c.q.answer;
  const cOk = c.ans.contestant === a, chOk = c.ans.chaser === a;
  if (cOk) c.pos++;
  if (chOk) c.chaser++;
  let outcome = null;
  if (c.chaser >= c.pos) outcome = 'caught';
  else if (c.pos >= HOME) outcome = 'home';
  c.reveal = { answer: a, contestant: c.ans.contestant ?? null, chaser: c.ans.chaser ?? null, cOk, chOk, outcome, fact: c.q.fact };
  g.phase = 'h2hReveal';
  g.deadline = api.timer('t', outcome ? H2H_REVEAL + 2500 : H2H_REVEAL, () => {
    if (!outcome) return nextH2H(g, api);
    g.results.push({ pid: c.pid, outcome, bank: c.bank });
    if (outcome === 'home') { g.pot += c.bank; g.scores[c.pid] += 3; g.survivors.push(c.pid); }
    else if (g.chaserId) g.scores[g.chaserId] += 2;
    g.ci++;
    startContestant(g, api);
  });
}
function startFinal(g, api) {
  if (!g.survivors.length) return end(g, 'chaser', api);
  g.phase = 'final';
  g.final_ = { steps: g.survivors.length, q: q(g, 2), log: [] };
  g.deadline = api.timer('t', FINAL_MS, () => startChaserFinal(g, api));
}
function startChaserFinal(g, api) {
  g.phase = 'finalChase';
  const f = g.final_;
  f.target = f.steps; f.chaser = 0; f.q = q(g, 2); f.chaserLog = [];
  g.deadline = api.timer('t', FINAL_MS, () => end(g, 'team', api));
  if (g.bot) {
    const tick = () => {
      if (g.phase !== 'finalChase') return;
      const ok = Math.random() < g.acc + 0.05;
      if (ok) f.chaser++;
      f.chaserLog.unshift(ok ? '✓' : '✗');
      if (f.chaser >= f.target) return end(g, 'chaser', api);
      api.timer('bot', CHASER_STEP, tick);
    };
    api.timer('bot', CHASER_STEP, tick);
  }
}
function end(g, winner, api) {
  api.clear('t'); api.clear('bot');
  g.phase = 'over'; g.deadline = null; g.winner = winner;
  if (winner === 'team') for (const id of g.survivors) g.scores[id] += 5;
  else if (g.chaserId) g.scores[g.chaserId] += 5;
  api.finish(g.scores);
}

module.exports = {
  id: 'chase', name: 'The Chase', emoji: '🏃', min: 1, max: 9,
  blurb: 'Build cash, take the high or low offer, then outrun the Chaser down the ladder. Survivors team up for the final chase.',
  settings: [
    { key: 'chaser', label: 'Chaser', options: [['bot1', 'Bot: easy'], ['bot2', 'Bot: medium'], ['bot3', 'Bot: hard'], ['human', 'One of us']], default: 'bot2' },
  ],
  create(ids, s, api) {
    const human = s.chaser === 'human' && ids.length >= 2;
    const order = D.shuffle(ids);
    const chaserId = human ? order.pop() : null;
    const g = {
      ids, contestants: order, chaserId, bot: !human, acc: BOT_ACC[s.chaser] || 0.7, chaserName: human ? api.name(chaserId) : BOT_NAME[s.chaser] || 'The Pundit',
      ci: 0, pot: 0, survivors: [], results: [], scores: {}, avoid: new Set(),
    };
    ids.forEach(i => g.scores[i] = 0);
    startContestant(g, api);
    return g;
  },
  action(g, pid, m, api) {
    const c = g.cur;
    if (g.phase === 'cash' && m.type === 'answer' && pid === c.pid) {
      const ok = Number(m.choice) === c.q.answer;
      if (ok) { c.bank += 5000; c.correct++; }
      c.last = { ok, answer: c.q.options[c.q.answer] };
      c.q = q(g, 2);
    } else if (g.phase === 'offer' && m.type === 'offer' && pid === c.pid && g.offers[m.key]) takeOffer(g, m.key, api);
    else if (g.phase === 'h2h' && m.type === 'answer') {
      if (pid === c.pid && c.ans.contestant === undefined) c.ans.contestant = Number(m.choice);
      else if (pid === g.chaserId && c.ans.chaser === undefined) c.ans.chaser = Number(m.choice);
      maybeSettle(g, api);
    } else if (g.phase === 'final' && m.type === 'answer' && g.survivors.includes(pid)) {
      const f = g.final_; const ok = Number(m.choice) === f.q.answer;
      if (ok) f.steps++;
      f.log.unshift({ pid, ok });
      f.q = q(g, 2);
    } else if (g.phase === 'finalChase' && m.type === 'answer' && pid === g.chaserId) {
      const f = g.final_; const ok = Number(m.choice) === f.q.answer;
      if (ok) f.chaser++;
      f.chaserLog.unshift(ok ? '✓' : '✗');
      f.q = q(g, 2);
      if (f.chaser >= f.target) end(g, 'chaser', api);
    }
  },
  leave(g, pid, api) {
    if (g.phase === 'offer' && g.cur?.pid === pid) takeOffer(g, 'mid', api);
  },
  view(g, pid) {
    const c = g.cur;
    const isC = c?.pid === pid, isChaser = pid === g.chaserId;
    const f = g.final_;
    return {
      type: 'chase', phase: g.phase, deadline: g.deadline, chaserName: g.chaserName, chaserId: g.chaserId, bot: g.bot, home: HOME,
      contestants: g.contestants, ci: g.ci, pot: g.pot, survivors: g.survivors, results: g.results,
      cur: c ? { pid: c.pid, bank: c.bank, correct: c.correct, pos: c.pos, chaser: c.chaser, offer: c.offer, last: isC ? c.last : null,
        q: g.phase === 'cash' || g.phase === 'h2h' || g.phase === 'h2hReveal' ? strip(c.q) : null,
        answered: c.ans ? { contestant: c.ans.contestant !== undefined, chaser: c.ans.chaser !== undefined } : null,
        mine: c.ans ? (isC ? c.ans.contestant : isChaser ? c.ans.chaser : undefined) : undefined,
        reveal: g.phase === 'h2hReveal' ? c.reveal : null } : null,
      offers: g.phase === 'offer' ? g.offers : null,
      fc: f ? { steps: f.steps, target: f.target, chaser: f.chaser, log: f.log?.slice(0, 20), chaserLog: f.chaserLog?.slice(0, 30),
        q: (g.phase === 'final' && g.survivors.includes(pid)) || (g.phase === 'finalChase' && isChaser) ? strip(f.q) : null } : null,
      winner: g.winner || null, scores: g.scores, final: g.final, over: g.over,
    };
  },
};
