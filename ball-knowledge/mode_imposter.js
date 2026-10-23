// Football Imposter: everyone sees the same player except the imposter. Give clues, vote them out.
const D = require('./data');

const CLUE_MS = 35000, VOTE_MS = 40000, GUESS_MS = 25000;

function card(p) {
  return { name: p.name, nation: p.nation, pos: p.pos, club: p.club || (p.status === 'retired' ? 'Retired' : 'Free agent'),
    clubs: p.clubs.filter(c => c.apps >= 8).map(c => c.name), born: p.dob.slice(0, 4) };
}

function newRound(g, api) {
  g.round++;
  const used = new Set(g.usedPlayers);
  const p = D.pick(D.pool(g.tier, x => !used.has(x.id) && x.clubs.length));
  g.usedPlayers.push(p.id);
  g.player = p.id;
  g.imposter = D.pick(g.ids);
  g.clues = [];
  g.votes = {};
  g.guess = null;
  g.order = D.shuffle(g.ids);
  g.turn = 0;
  g.lap = 0;
  g.phase = 'reveal';
  g.deadline = api.timer('t', 6000, () => startClues(g, api));
}
function startClues(g, api) {
  g.phase = 'clues';
  g.deadline = api.timer('t', CLUE_MS, () => submitClue(g, g.order[g.turn], '(no clue)', api));
}
function submitClue(g, pid, text, api) {
  if (g.phase !== 'clues' || g.order[g.turn] !== pid) return;
  g.clues.push({ pid, text: String(text).slice(0, 40), lap: g.lap });
  g.turn++;
  if (g.turn >= g.order.length) { g.turn = 0; g.lap++; }
  if (g.lap >= g.laps) return startVote(g, api);
  g.deadline = api.timer('t', CLUE_MS, () => submitClue(g, g.order[g.turn], '(no clue)', api));
}
function startVote(g, api) {
  g.phase = 'vote';
  g.deadline = api.timer('t', VOTE_MS, () => tally(g, api));
}
function tally(g, api) {
  const count = {};
  for (const v of Object.values(g.votes)) count[v] = (count[v] || 0) + 1;
  const top = Object.entries(count).sort((a, b) => b[1] - a[1]);
  const caught = top.length && top[0][0] === g.imposter && (top.length === 1 || top[1][1] < top[0][1]);
  g.voteResult = { count, caught, accused: top[0]?.[0] || null };
  if (caught) {
    g.phase = 'steal';
    g.deadline = api.timer('t', GUESS_MS, () => resolve(g, false, api));
  } else resolve(g, false, api);
}
function resolve(g, stole, api) {
  const p = D.BY_ID.get(g.player);
  const caught = g.voteResult.caught;
  const pts = {};
  if (!caught) pts[g.imposter] = 3;
  else if (stole) pts[g.imposter] = 2;
  else for (const id of g.ids) if (id !== g.imposter) pts[id] = 1;
  // crew who voted correctly get a bonus point
  for (const [voter, target] of Object.entries(g.votes)) if (target === g.imposter && voter !== g.imposter) pts[voter] = (pts[voter] || 0) + 1;
  for (const [id, v] of Object.entries(pts)) g.scores[id] = (g.scores[id] || 0) + v;
  g.result = { player: card(p), imposter: g.imposter, caught, stole, pts };
  g.phase = 'result';
  g.deadline = null;
  api.clear('t');
}

module.exports = {
  id: 'imposter', name: 'Football Imposter', emoji: '🕵️', min: 3, max: 10,
  blurb: 'Everyone gets the same secret player. One of you is the imposter and has no idea who it is. Give clues, then vote them out.',
  settings: [
    { key: 'rounds', label: 'Rounds', options: [3, 5, 8], default: 5 },
    { key: 'tier', label: 'Players', options: [[1, 'Famous'], [2, 'Well known'], [3, 'Deep cuts'], [4, 'Anyone']], default: 2 },
    { key: 'laps', label: 'Clue laps', options: [1, 2, 3], default: 2 },
    { key: 'hint', label: 'Imposter hint', options: [['none', 'Nothing'], ['pos', 'Position'], ['nation', 'Nation']], default: 'pos' },
  ],
  create(ids, s, api) {
    const g = { ids, rounds: s.rounds, tier: s.tier, laps: s.laps, hint: s.hint, round: 0, usedPlayers: [], scores: {} };
    newRound(g, api);
    return g;
  },
  action(g, pid, m, api) {
    if (m.type === 'clue') submitClue(g, pid, m.text || '(no clue)', api);
    else if (m.type === 'vote' && g.phase === 'vote' && g.ids.includes(m.target) && m.target !== pid) {
      g.votes[pid] = m.target;
      if (Object.keys(g.votes).length >= g.ids.length) tally(g, api);
    } else if (m.type === 'steal' && g.phase === 'steal' && pid === g.imposter) {
      const p = D.BY_ID.get(g.player);
      g.guess = String(m.text || '').slice(0, 40);
      resolve(g, D.guessMatches(g.guess, p), api);
    } else if (m.type === 'next' && g.phase === 'result') {
      if (g.round >= g.rounds) api.finish(g.scores);
      else newRound(g, api);
    }
  },
  leave(g, pid, api) {
    if (g.phase === 'clues' && g.order[g.turn] === pid) submitClue(g, pid, '(left)', api);
  },
  view(g, pid, room) {
    const p = D.BY_ID.get(g.player);
    const isImp = pid === g.imposter;
    const showAll = g.phase === 'result' || g.over;
    let secret = null;
    if (g.ids.includes(pid)) {
      if (!isImp || showAll) secret = card(p);
      else secret = { imposter: true, hint: g.hint === 'pos' ? `Position: ${p.group}` : g.hint === 'nation' ? `Nation: ${p.nation}` : null };
    }
    return {
      type: 'imposter', phase: g.phase, round: g.round, rounds: g.rounds, deadline: g.deadline, secret,
      order: g.order, turnId: g.phase === 'clues' ? g.order[g.turn] : null, lap: g.lap, laps: g.laps,
      clues: g.clues, voted: Object.keys(g.votes), myVote: g.votes[pid] || null,
      voteResult: g.phase === 'steal' || showAll ? g.voteResult : null,
      result: showAll ? { ...g.result, guess: g.guess } : null,
      stealing: g.phase === 'steal' ? g.imposter : null,
      scores: g.scores, final: g.final, over: g.over,
    };
  },
};
