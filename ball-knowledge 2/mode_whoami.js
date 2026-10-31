// Who Am I: clues drop one by one. Guess the player early for more points. Three guesses per round.
const D = require('./data');
const Q = require('./questions');

const CLUE_MS = 11000;

function newRound(g, api) {
  g.round++;
  let w;
  for (let i = 0; i < 20; i++) { w = Q.whoAmI(g.tier); if (!g.usedP.includes(w.player.id)) break; }
  g.usedP.push(w.player.id);
  g.player = w.player.id; g.clues = w.clues; g.shown = 1;
  g.guesses = {}; g.solved = {}; g.phase = 'play';
  for (const id of g.ids) g.guesses[id] = [];
  g.deadline = api.timer('t', CLUE_MS, () => nextClue(g, api));
}
function nextClue(g, api) {
  if (g.shown >= g.clues.length) return endRound(g, api);
  g.shown++;
  g.deadline = api.timer('t', g.shown >= g.clues.length ? CLUE_MS + 4000 : CLUE_MS, () => nextClue(g, api));
}
function endRound(g, api) {
  api.clear('t');
  g.phase = 'reveal'; g.deadline = null;
  const p = D.BY_ID.get(g.player);
  g.reveal = { name: p.name, nation: p.nation, clubs: p.clubs.filter(c => c.apps >= 8).map(c => c.name) };
}

module.exports = {
  id: 'whoami', name: 'Who Am I?', emoji: '❓', min: 1, max: 10,
  blurb: 'Six clues drop one at a time, from vague to obvious. Guess the player early to bag more points. Three guesses a round.',
  settings: [
    { key: 'rounds', label: 'Rounds', options: [5, 8, 12], default: 8 },
    { key: 'tier', label: 'Players', options: [[1, 'Famous'], [2, 'Well known'], [3, 'Deep cuts'], [4, 'Anyone']], default: 2 },
  ],
  create(ids, s, api) {
    const g = { ids, rounds: s.rounds, tier: s.tier, round: 0, usedP: [], scores: {} };
    ids.forEach(i => g.scores[i] = 0);
    newRound(g, api);
    return g;
  },
  action(g, pid, m, api) {
    if (m.type === 'guess' && g.phase === 'play' && g.guesses[pid] && !g.solved[pid] && g.guesses[pid].length < 3) {
      const text = String(m.text || '').slice(0, 40);
      const p = D.BY_ID.get(g.player);
      const ok = D.guessMatches(text, p);
      g.guesses[pid].push({ text, ok });
      if (ok) {
        const pts = 7 - g.shown;
        const first = Object.keys(g.solved).length === 0;
        g.solved[pid] = pts + (first ? 1 : 0);
        g.scores[pid] += g.solved[pid];
        api.toast(`${api.name(pid)} got it${first ? ' first' : ''}!`);
      }
      const done = g.ids.every(id => g.solved[id] || g.guesses[id].length >= 3);
      if (done) endRound(g, api);
    } else if (m.type === 'next' && g.phase === 'reveal') {
      if (g.round >= g.rounds) { g.phase = 'over'; api.finish(g.scores); }
      else newRound(g, api);
    }
  },
  view(g, pid) {
    return {
      type: 'whoami', phase: g.phase, deadline: g.deadline, round: g.round, rounds: g.rounds,
      clues: g.clues.slice(0, g.shown), total: g.clues.length, worth: 7 - g.shown,
      myGuesses: g.guesses[pid] || [], solvedMe: g.solved[pid] || 0,
      solved: Object.keys(g.solved), outOfGuesses: g.ids.filter(id => !g.solved[id] && g.guesses[id].length >= 3),
      reveal: g.phase !== 'play' ? g.reveal : null, allGuesses: g.phase !== 'play' ? g.guesses : null,
      scores: g.scores, final: g.final, over: g.over,
    };
  },
};
