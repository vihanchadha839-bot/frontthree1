// Football Alphabet: go A to Z naming players from a category. Surname must start with the letter. Three strikes and you're out.
const D = require('./data');
const { BIG_CLUBS } = require('./questions');

const TURN_MS = 25000;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWYZ'.split(''); // X is skipped, nobody wants that

function categories() {
  const big = ['Manchester United', 'Liverpool', 'Arsenal', 'Chelsea', 'Manchester City', 'Tottenham', 'Barcelona', 'Real Madrid', 'Juventus', 'AC Milan', 'Inter', 'Bayern Munich', 'Borussia Dortmund', 'PSG', 'Atlético Madrid', 'Newcastle', 'Everton', 'Aston Villa', 'West Ham', 'Ajax', 'Benfica', 'FC Porto', 'Napoli', 'Roma', 'Marseille', 'Lyon', 'Celtic', 'Sevilla', 'Valencia'];
  const cats = [
    { id: 'pl', label: 'Played in the Premier League', test: p => p.leagues.GB1 },
    { id: 'laliga', label: 'Played in LaLiga', test: p => p.leagues.ES1 },
    { id: 'seriea', label: 'Played in Serie A', test: p => p.leagues.IT1 },
    { id: 'bund', label: 'Played in the Bundesliga', test: p => p.leagues.L1 },
    { id: 'l1', label: 'Played in Ligue 1', test: p => p.leagues.FR1 },
    { id: 'ucl', label: 'Scored in the Champions League', test: p => p.cl[1] > 0 },
    { id: 'gk', label: 'Goalkeepers', test: p => p.group === 'Goalkeeper' },
    { id: 'st', label: 'Strikers', test: p => p.pos === 'ST' },
    { id: 'eng', label: 'England internationals', test: p => p.nation === 'England' && p.caps > 0 },
    { id: 'bra', label: 'Brazilians', test: p => p.nation === 'Brazil' },
    { id: 'fra', label: 'French players', test: p => p.nation === 'France' },
    { id: 'esp', label: 'Spanish players', test: p => p.nation === 'Spain' },
    { id: 'arg', label: 'Argentines', test: p => p.nation === 'Argentina' },
    { id: 'ger', label: 'German players', test: p => p.nation === 'Germany' },
    { id: 'ita', label: 'Italian players', test: p => p.nation === 'Italy' },
    { id: 'af', label: 'African players', test: p => AFRICA.has(p.nation) },
    { id: 'big', label: '€50M+ peak value', test: p => p.peak >= 50e6 },
  ];
  for (const name of big) {
    const id = Object.keys(D.CLUBS).find(k => D.CLUBS[k].name === name);
    if (id) cats.push({ id: 'club' + id, label: `Played for ${name}`, test: p => p._clubIds.has(Number(id)) });
  }
  return cats;
}
const AFRICA = new Set(['Nigeria', 'Senegal', 'Cote d\'Ivoire', 'Ghana', 'Cameroon', 'Morocco', 'Algeria', 'Tunisia', 'Egypt', 'Mali', 'Guinea', 'DR Congo', 'Burkina Faso', 'Gabon', 'Zambia', 'South Africa', 'Cape Verde', 'Angola', 'Kenya', 'Zimbabwe', 'Togo', 'Benin', 'Congo', 'Equatorial Guinea', 'Gambia', 'Sierra Leone', 'Guinea-Bissau', 'Libya', 'Madagascar', 'Mozambique', 'Uganda', 'Comoros', 'Central African Republic']);
const CATS = categories();

// tokens a player can be "filed under": surname-ish words (skip the first name unless single name)
function letterTokens(p) {
  const t = p._tokens;
  if (t.length === 1) return t;
  return t.slice(1).concat(t.length === 2 ? [] : []);
}
function fits(p, letter) { return letterTokens(p).some(w => w[0] === letter.toLowerCase()); }

function setLetter(g, api) {
  // skip letters with no valid answers for this category
  while (g.li < LETTERS.length && !g.pool.some(p => fits(p, LETTERS[g.li]))) g.li++;
  if (g.li >= LETTERS.length) return finish(g, api);
  g.deadline = api.timer('t', TURN_MS, () => strike(g, g.alive[g.turn], 'ran out of time', api));
}
function advanceTurn(g) { g.turn = (g.turn + 1) % g.alive.length; }
function strike(g, pid, why, api) {
  g.lives[pid]--;
  g.log.unshift({ pid, letter: LETTERS[g.li], text: why, ok: false });
  if (g.lives[pid] <= 0) {
    const i = g.alive.indexOf(pid);
    g.alive.splice(i, 1);
    g.log.unshift({ pid, text: 'is OUT', ok: false });
    if (g.turn >= i && g.turn > 0) g.turn--;
    if (g.alive.length <= (g.ids.length > 1 ? 1 : 0)) return finish(g, api);
    g.turn = g.turn % g.alive.length;
    // letter stays the same, next player tries it
  } else advanceTurn(g);
  setLetter(g, api);
}
function finish(g, api) {
  g.phase = 'over'; g.deadline = null; api.clear('t');
  for (const id of g.alive) g.scores[id] = (g.scores[id] || 0) + 5;
  g.missed = LETTERS.map(L => ({ L, ex: g.pool.filter(p => fits(p, L) && !g.used.includes(p.id)).sort((a, b) => b.fame - a.fame).slice(0, 2).map(p => p.name) }));
  api.finish(g.scores);
}

module.exports = {
  id: 'alphabet', name: 'Alphabet Challenge', emoji: '🔤', min: 1, max: 10,
  blurb: 'A to Z in turns. Name a player from the category whose surname starts with the letter. Wrong, repeated or too slow costs a life.',
  settings: [
    { key: 'cat', label: 'Category', options: [['random', 'Random'], ...CATS.map(c => [c.id, c.label])], default: 'random' },
    { key: 'lives', label: 'Lives', options: [1, 2, 3, 5], default: 3 },
  ],
  create(ids, s, api) {
    const cat = s.cat === 'random' ? D.pick(CATS) : (CATS.find(c => c.id === s.cat) || CATS[0]);
    const g = { ids, cat: cat.label, pool: D.PLAYERS.filter(cat.test), li: 0, turn: 0, alive: D.shuffle(ids), lives: {}, used: [], log: [], scores: {}, phase: 'play' };
    ids.forEach(i => { g.lives[i] = s.lives; g.scores[i] = 0; });
    setLetter(g, api);
    return g;
  },
  action(g, pid, m, api) {
    if (g.phase !== 'play' || m.type !== 'answer' || g.alive[g.turn] !== pid) return;
    const L = LETTERS[g.li];
    const text = String(m.text || '').slice(0, 40);
    const cands = D.findPlayers(text, g.pool).filter(p => fits(p, L));
    if (!cands.length) {
      const anywhere = D.findPlayers(text)[0];
      return strike(g, pid, `"${text}" ✗ ${anywhere ? (fits(anywhere, L) ? `${anywhere.name} doesn't fit the category` : `wrong letter`) : 'not found'}`, api);
    }
    const fresh = cands.find(p => !g.used.includes(p.id));
    if (!fresh) return strike(g, pid, `${cands[0].name} was already used`, api);
    g.used.push(fresh.id);
    g.scores[pid] += 1;
    g.log.unshift({ pid, letter: L, text: fresh.name, ok: true });
    g.li++;
    advanceTurn(g);
    if (g.li >= LETTERS.length) return finish(g, api);
    setLetter(g, api);
  },
  leave(g, pid, api) { if (g.phase === 'play' && g.alive[g.turn] === pid) strike(g, pid, 'left the game', api); },
  view(g) {
    return {
      type: 'alphabet', phase: g.phase, deadline: g.deadline, cat: g.cat, letter: LETTERS[g.li] || null, letters: LETTERS, li: g.li,
      turnId: g.phase === 'play' ? g.alive[g.turn] : null, alive: g.alive, lives: g.lives, order: g.ids,
      log: g.log.slice(0, 15), scores: g.scores, missed: g.missed || null, final: g.final, over: g.over,
    };
  },
};
